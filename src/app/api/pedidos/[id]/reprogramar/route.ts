// src/app/api/pedidos/[id]/reprogramar/route.ts
// POST — reprogramar un pedido que no se pudo entregar (pedido de Antonio/Ariana,
// video 9 jul 2026). Dos modos excluyentes:
//   { nueva_fecha: 'YYYY-MM-DD' } → mueve la fecha de ENTREGA (normalmente a mañana).
//     Si estaba Asignado/En_Camino/Fallido, vuelve a Pendiente y se limpia TODO el
//     reparto (repartidor, orden, distancia, ETA…) para que salga de la ruta de hoy
//     — las queries de despacho por repartidor no tienen tope de fecha, sin esta
//     limpieza el pedido seguiría visible en la columna del motorizado.
//   { mas_tarde: true } → mismo día, solo deja la marca visible "se envía más tarde"
//     (no toca fecha, estado ni reparto).
// Ambos dejan huella en reprogramado_de/at/motivo (badge en Lista de Pedidos y
// Producción), auditan en pedido_ediciones y notifican a la asesora dueña.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { crearNotificacion } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

const ReprogramarSchema = z
  .object({
    nueva_fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD")
      .optional(),
    mas_tarde: z.boolean().optional(),
    motivo: z.string().trim().max(200).optional(),
  })
  .refine((d) => Boolean(d.nueva_fecha) !== Boolean(d.mas_tarde), {
    message: "Indica la nueva fecha O 'se envía más tarde' (solo uno de los dos)",
  });

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Estados cuyo reparto hay que deshacer al cambiar la fecha: el pedido sale de la
// ruta de hoy y vuelve a la cola como Pendiente.
const ESTADOS_CON_REPARTO = ["Asignado", "En_Camino", "Fallido"];

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = ReprogramarSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { nueva_fecha, mas_tarde, motivo } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);

    const rows = (await sql`
      SELECT id, cliente, estado, asesor_id,
             TO_CHAR(fecha_pedido, 'YYYY-MM-DD') AS fecha_pedido,
             (${nueva_fecha ?? null}::date < (NOW() AT TIME ZONE 'America/Lima')::date) AS fecha_pasada
      FROM pedidos WHERE id = ${id}
    `) as Array<{
      id: string;
      cliente: string;
      estado: string;
      asesor_id: string | null;
      fecha_pedido: string;
      fecha_pasada: boolean | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    const pedido = rows[0];

    // Guard: admin o la asesora dueña (el repartidor NO reprograma — si no pudo
    // entregar, marca Fallido y la oficina decide).
    if (session.user.role !== "admin" && pedido.asesor_id !== session.user.id) {
      return NextResponse.json(
        { error: "No tienes permiso para reprogramar este pedido" },
        { status: 403 }
      );
    }

    if (pedido.estado === "Entregado") {
      return NextResponse.json(
        { error: "Este pedido ya se entregó: no se puede reprogramar" },
        { status: 409 }
      );
    }

    const motivoFinal = motivo || null;

    if (mas_tarde) {
      // Marca del mismo día: no toca fecha, estado ni reparto.
      await sql`
        UPDATE pedidos SET
          reprogramado_de = NULL,
          reprogramado_at = NOW(),
          reprogramado_motivo = ${motivoFinal}
        WHERE id = ${id}
      `;
    } else {
      // Cambio de fecha: no al pasado, y tiene que ser una fecha distinta.
      if (pedido.fecha_pasada) {
        return NextResponse.json(
          { error: "La nueva fecha no puede ser pasada" },
          { status: 400 }
        );
      }
      if (nueva_fecha === pedido.fecha_pedido) {
        return NextResponse.json(
          { error: "El pedido ya tiene esa fecha de entrega" },
          { status: 400 }
        );
      }

      if (ESTADOS_CON_REPARTO.includes(pedido.estado)) {
        // Reset completo del reparto (lista exacta de columnas del ciclo de
        // despacho — sin esto el pedido seguiría en la columna del motorizado).
        await sql`
          UPDATE pedidos SET
            fecha_pedido = ${nueva_fecha}::date,
            reprogramado_de = ${pedido.fecha_pedido}::date,
            reprogramado_at = NOW(),
            reprogramado_motivo = ${motivoFinal},
            estado = 'Pendiente',
            entregado = FALSE,
            entregado_por = NULL,
            entregado_at = NULL,
            razon_fallo = NULL,
            repartidor_id = NULL,
            orden_ruta = NULL,
            distancia_km = NULL,
            duracion_estimada_min = NULL,
            inicio_viaje_at = NULL,
            hora_llegada_estimada = NULL,
            notificado_por_llegar = FALSE,
            notificado_llegada = FALSE
          WHERE id = ${id}
        `;
      } else {
        // Pendiente / En_Produccion / Listo_Para_Despacho: conserva su avance,
        // solo se mueve de día (producción lo verá en la cola de la nueva fecha).
        await sql`
          UPDATE pedidos SET
            fecha_pedido = ${nueva_fecha}::date,
            reprogramado_de = ${pedido.fecha_pedido}::date,
            reprogramado_at = NOW(),
            reprogramado_motivo = ${motivoFinal}
          WHERE id = ${id}
        `;
      }
    }

    // Auditoría en el historial del pedido (no bloqueante, mismo patrón del PATCH).
    try {
      const cambios = mas_tarde
        ? [
            {
              campo: "reprogramacion",
              etiqueta: "Reprogramación",
              antes: pedido.fecha_pedido,
              despues: `Se enviará más tarde${motivoFinal ? ` — ${motivoFinal}` : ""}`,
            },
          ]
        : [
            {
              campo: "fecha_pedido",
              etiqueta: "Reprogramación",
              antes: pedido.fecha_pedido,
              despues: `${nueva_fecha}${motivoFinal ? ` — ${motivoFinal}` : ""}`,
            },
          ];
      await sql`
        INSERT INTO pedido_ediciones
          (pedido_id, usuario_id, usuario_nombre, usuario_rol, cambios)
        VALUES (
          ${id},
          ${session.user.id ?? null},
          ${session.user.name || "Desconocido"},
          ${session.user.role ?? null},
          ${JSON.stringify(cambios)}::jsonb
        )
      `;
    } catch (e) {
      console.error("No se pudo registrar el historial de reprogramación:", e);
    }

    // Aviso a la asesora dueña (si no fue ella quien reprogramó).
    if (pedido.asesor_id && pedido.asesor_id !== session.user.id) {
      const [d1, m1] = mas_tarde
        ? ["", ""]
        : [nueva_fecha!.slice(8, 10), nueva_fecha!.slice(5, 7)];
      await crearNotificacion({
        userId: pedido.asesor_id,
        tipo: "pedido_reprogramado",
        titulo: mas_tarde ? "🕐 Pedido se envía más tarde" : "📅 Pedido reprogramado",
        mensaje: `Cliente: ${pedido.cliente} · ${
          mas_tarde ? "Hoy, más tarde" : `Nueva fecha: ${d1}/${m1}`
        }${motivoFinal ? ` · ${motivoFinal}` : ""} · Por ${session.user.name}`,
        link: "/dashboard",
        pedidoId: id,
      });
    }

    return NextResponse.json({
      ok: true,
      fecha_pedido: mas_tarde ? pedido.fecha_pedido : nueva_fecha,
      estado_reseteado: !mas_tarde && ESTADOS_CON_REPARTO.includes(pedido.estado),
    });
  } catch (error: unknown) {
    console.error("Error al reprogramar pedido:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}
