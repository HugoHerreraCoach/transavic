// src/app/api/pos/ventas/[id]/fecha/route.ts
// PATCH — cambia la fecha de una venta del POS de planta.
// Roles admin + produccion.
//
// Reglas y Guardas obligatorias:
// 1. Que el pedido exista, sea origen='pos_planta' y no esté anulado.
// 2. Que no tenga un comprobante SUNAT activo (aceptado/observado/pendiente/emitiendo).
// 3. Que la caja (caja_diaria) del día original de la venta no esté cerrada.
// 4. Que la caja (caja_diaria) del nuevo día destino no esté cerrada.
//
// El cambio actualiza fecha_pedido + created_at del pedido, fecha + created_at de la transacción,
// fecha_emision + fecha_vencimiento + created_at de la cobranza (si es crédito), y crea auditoría.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const Schema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD")
    .refine((val) => {
      const d = new Date(`${val}T00:00:00.000Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val;
    }, "La fecha indicada no existe"),
});

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos para editar" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors.fecha?.[0] || "Fecha inválida" }, { status: 400 });
  }
  const nuevaFecha = parsed.data.fecha;

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // 1. Cargar el pedido + guardas contables en una sola consulta
    const rows = await sql`
      SELECT
        p.id,
        p.origen,
        p.anulada,
        TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha_venta_orig,
        TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'HH24:MI:SS') AS hora_venta_orig,
        EXISTS (
          SELECT 1 FROM comprobantes c
          WHERE c.pedido_id = p.id AND c.tipo IN ('01', '03')
            AND c.estado IN ('aceptado', 'observado', 'pendiente', 'emitiendo')
        ) AS tiene_comprobante,
        (SELECT serie_numero FROM comprobantes c
          WHERE c.pedido_id = p.id AND c.tipo IN ('01', '03')
            AND c.estado IN ('aceptado', 'observado', 'pendiente', 'emitiendo')
          ORDER BY c.created_at DESC LIMIT 1) AS comprobante_serie,
        -- Caja cerrada del día original
        EXISTS (
          SELECT 1 FROM caja_diaria cd
          JOIN transacciones t ON t.cuenta_id = cd.cuenta_id
            AND t.referencia_id = p.id AND t.tipo = 'ingreso'
          WHERE cd.operacion = 'planta' AND cd.estado = 'Cerrada'
            AND cd.fecha = (p.created_at AT TIME ZONE 'America/Lima')::date
        ) AS caja_original_cerrada,
        -- Caja cerrada del día destino (para la misma cuenta si es al contado)
        EXISTS (
          SELECT 1 FROM caja_diaria cd
          WHERE cd.operacion = 'planta' AND cd.estado = 'Cerrada'
            AND cd.fecha = ${nuevaFecha}::date
            AND cd.cuenta_id = (
              SELECT t.cuenta_id FROM transacciones t 
              WHERE t.referencia_id = p.id AND t.tipo = 'ingreso' 
              LIMIT 1
            )
        ) AS caja_destino_cerrada
      FROM pedidos p
      WHERE p.id = ${id}::uuid
    `;

    const pedido = rows[0];
    if (!pedido) {
      return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });
    }
    if (pedido.origen !== "pos_planta") {
      return NextResponse.json({ error: "Esta venta no es del POS de planta." }, { status: 400 });
    }
    if (pedido.anulada) {
      return NextResponse.json({ error: "No se puede editar la fecha de una venta anulada." }, { status: 400 });
    }
    if (pedido.tiene_comprobante) {
      return NextResponse.json(
        { error: `No se puede modificar la fecha: ya tiene el comprobante emitido ${pedido.comprobante_serie}.` },
        { status: 409 }
      );
    }
    if (pedido.caja_original_cerrada) {
      return NextResponse.json(
        { error: "No se puede modificar la fecha: la caja de la fecha original ya está cerrada (arqueada)." },
        { status: 409 }
      );
    }
    if (pedido.caja_destino_cerrada) {
      return NextResponse.json(
        { error: `No se puede mover la venta al ${nuevaFecha}: la caja de planta para ese día ya está cerrada.` },
        { status: 409 }
      );
    }

    if (pedido.fecha_venta_orig === nuevaFecha) {
      return NextResponse.json({ ok: true, message: "La venta ya tiene esa fecha." });
    }

    // 2. Realizar actualización en transacción atómica
    const actorId = session.user.id;
    const actorNombre = session.user.name || "POS Usuario";
    const actorRol = session.user.role;

    // Calcular el nuevo created_at para mantener la misma hora en la fecha destino
    const nuevoCreatedAt = `${nuevaFecha} ${pedido.hora_venta_orig}`;

    const queries = [];

    queries.push(sql`
      UPDATE pedidos
      SET fecha_pedido = ${nuevaFecha}::date,
          created_at = ${nuevoCreatedAt}::timestamp AT TIME ZONE 'America/Lima'
      WHERE id = ${id}::uuid AND origen = 'pos_planta' AND NOT anulada
    `);

    // - Actualizar transacciones (contado)
    queries.push(sql`
      UPDATE transacciones
      SET fecha = ${nuevaFecha}::date,
          created_at = ${nuevoCreatedAt}::timestamp AT TIME ZONE 'America/Lima'
      WHERE referencia_id = ${id}::uuid AND tipo IN ('ingreso', 'egreso')
    `);

    // - Actualizar cobranzas_planta (crédito)
    queries.push(sql`
      UPDATE cobranzas_planta
      SET fecha_emision = ${nuevaFecha}::date,
          fecha_vencimiento = ${nuevaFecha}::date + plazo_dias,
          created_at = ${nuevoCreatedAt}::timestamp AT TIME ZONE 'America/Lima',
          updated_at = NOW()
      WHERE pedido_id = ${id}::uuid AND NOT anulada
    `);

    // - Registrar auditoría de edición
    queries.push(sql`
      INSERT INTO pedido_ediciones (pedido_id, usuario_id, usuario_nombre, usuario_rol, cambios)
      VALUES (
        ${id}::uuid,
        ${actorId}::uuid,
        ${actorNombre},
        ${actorRol},
        jsonb_build_array(jsonb_build_object(
          'campo', 'created_at',
          'etiqueta', 'Fecha de venta',
          'antes', ${pedido.fecha_venta_orig},
          'despues', ${nuevaFecha}::text
        ))
      )
    `);

    await sql.transaction(queries);

    return NextResponse.json({ ok: true, message: "Fecha de venta modificada exitosamente." });
  } catch (error) {
    console.error("Error al modificar fecha de venta POS:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
