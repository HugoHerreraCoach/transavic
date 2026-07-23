// POST — reprogramar un pedido que no se pudo preparar o entregar.
//
// Reglas por rol:
// - Producción solo puede mover a MAÑANA (hora Lima) pedidos que todavía están
//   en Pendiente / En_Produccion / Listo_Para_Despacho. Conserva pesos y estado.
// - Admin y la asesora dueña mantienen el flujo amplio: otra fecha o "más tarde".
//
// El UPDATE, la auditoría y las notificaciones viven en un único statement con
// CTEs: o se guardan los tres efectos o no se guarda ninguno. El WHERE condicional
// hace idempotente el doble clic para la misma fecha.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ReprogramarSchema = z
  .object({
    nueva_fecha: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD")
      .refine((fecha) => {
        const valor = new Date(`${fecha}T00:00:00.000Z`);
        return !Number.isNaN(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha;
      }, "La fecha indicada no existe")
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

const UuidSchema = z.string().uuid();
const ESTADOS_CON_REPARTO = ["Asignado", "En_Camino", "Fallido"];
const ESTADOS_PRODUCCION = ["Pendiente", "En_Produccion", "Listo_Para_Despacho"];

interface PedidoReprogramable {
  id: string;
  cliente: string;
  cliente_id: string | null;
  estado: string;
  asesor_id: string | null;
  asesor_cliente_id: string | null;
  asesor_propietario_id: string | null;
  fecha_pedido: string;
  fecha_pasada: boolean | null;
  manana_lima: string;
}

interface ResultadoAtomico {
  existe: boolean;
  permitido: boolean;
  estado_actual: string | null;
  fecha_actual: string | null;
  actualizado: boolean;
  estado_reseteado: boolean;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const idResult = UuidSchema.safeParse(id);
    if (!idResult.success) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }
    const pedidoId = idResult.data;

    const actorResult = UuidSchema.safeParse(session.user.id);
    if (!actorResult.success) {
      return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
    }
    const actorId = actorResult.data;
    const rol = session.user.role;
    if (!["admin", "asesor", "produccion"].includes(rol)) {
      return NextResponse.json(
        { error: "No tienes permiso para reprogramar pedidos" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "El cuerpo JSON no es válido" }, { status: 400 });
    }
    const parsed = ReprogramarSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detalles: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { nueva_fecha, mas_tarde, motivo } = parsed.data;
    const motivoFinal = motivo || null;
    const sql = neon(process.env.DATABASE_URL!);

    const rows = (await sql`
      SELECT
        p.id,
        p.cliente,
        p.cliente_id,
        p.estado,
        p.asesor_id,
        c.asesor_id AS asesor_cliente_id,
        COALESCE(p.asesor_id, c.asesor_id) AS asesor_propietario_id,
        TO_CHAR(p.fecha_pedido, 'YYYY-MM-DD') AS fecha_pedido,
        (${nueva_fecha ?? null}::date < (NOW() AT TIME ZONE 'America/Lima')::date) AS fecha_pasada,
        TO_CHAR((NOW() AT TIME ZONE 'America/Lima')::date + 1, 'YYYY-MM-DD') AS manana_lima
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.id = ${pedidoId}
    `) as PedidoReprogramable[];

    if (rows.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    const pedido = rows[0];
    const esAdmin = rol === "admin";
    const esAsesor = rol === "asesor";
    const esProduccion = rol === "produccion";
    const esAdminODuena =
      esAdmin || (esAsesor && pedido.asesor_propietario_id === actorId);

    if (!esProduccion && !esAdminODuena) {
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

    if (esProduccion) {
      if (mas_tarde || nueva_fecha !== pedido.manana_lima) {
        return NextResponse.json(
          { error: "Producción solo puede reprogramar el pedido para mañana" },
          { status: 403 }
        );
      }
      if (!ESTADOS_PRODUCCION.includes(pedido.estado)) {
        return NextResponse.json(
          { error: `Producción no puede reprogramar un pedido en estado ${pedido.estado}` },
          { status: 409 }
        );
      }
    }

    if (!mas_tarde && pedido.fecha_pasada) {
      return NextResponse.json(
        { error: "La nueva fecha no puede ser pasada" },
        { status: 400 }
      );
    }

    const link = `/dashboard?pedido=${pedidoId}`;
    const actorNombre = session.user.name || "Desconocido";
    const actorRol = rol;

    let resultado: ResultadoAtomico;
    if (mas_tarde) {
      const descripcionCambio =
        `Se enviará más tarde${motivoFinal ? ` - ${motivoFinal}` : ""}`;
      const filas = (await sql`
        WITH bloqueado AS (
          SELECT
            p.id,
            p.cliente,
            p.fecha_pedido,
            p.estado,
            COALESCE(p.asesor_id, c.asesor_id) AS asesor_destino_id
          FROM pedidos p
          LEFT JOIN clientes c ON c.id = p.cliente_id
          WHERE p.id = ${pedidoId}
          FOR UPDATE OF p
        ), permitido AS (
          SELECT *
          FROM bloqueado
          WHERE estado <> 'Entregado'
            AND (
              ${esAdmin}
              OR (${esAsesor} AND asesor_destino_id = ${actorId}::uuid)
            )
        ), actualizado AS (
          UPDATE pedidos p SET
            reprogramado_de = NULL,
            reprogramado_at = NOW(),
            reprogramado_motivo = ${motivoFinal}
          FROM permitido b
          WHERE p.id = b.id
            AND NOT (
              p.reprogramado_de IS NULL
              AND p.reprogramado_at IS NOT NULL
              AND (p.reprogramado_at AT TIME ZONE 'America/Lima')::date =
                  (NOW() AT TIME ZONE 'America/Lima')::date
              AND p.reprogramado_motivo IS NOT DISTINCT FROM ${motivoFinal}
            )
          RETURNING
            p.id,
            p.cliente,
            b.fecha_pedido AS fecha_anterior,
            b.asesor_destino_id
        ), auditoria AS (
          INSERT INTO pedido_ediciones
            (pedido_id, usuario_id, usuario_nombre, usuario_rol, cambios)
          SELECT
            id,
            ${actorId},
            ${actorNombre},
            ${actorRol},
            jsonb_build_array(jsonb_build_object(
              'campo', 'reprogramacion',
              'etiqueta', 'Reprogramación',
              'antes', TO_CHAR(fecha_anterior, 'YYYY-MM-DD'),
              'despues', ${descripcionCambio}::text
            ))
          FROM actualizado
          RETURNING id
        ), destinatarios AS (
          SELECT
            a.id AS pedido_id,
            a.cliente,
            a.asesor_destino_id AS user_id
          FROM actualizado a
          WHERE a.asesor_destino_id IS NOT NULL
            AND a.asesor_destino_id IS DISTINCT FROM ${actorId}::uuid
          UNION ALL
          SELECT
            a.id AS pedido_id,
            a.cliente,
            u.id AS user_id
          FROM actualizado a
          JOIN users u ON u.role = 'admin' AND COALESCE(u.activo, TRUE)
          WHERE a.asesor_destino_id IS NULL
            AND u.id IS DISTINCT FROM ${actorId}::uuid
        ), avisos AS (
          INSERT INTO notificaciones
            (user_id, tipo, titulo, mensaje, link, pedido_id)
          SELECT
            d.user_id,
            'pedido_reprogramado',
            'Pedido se envía más tarde',
            'Cliente: ' || d.cliente || ' - Hoy, más tarde' ||
              CASE WHEN ${motivoFinal}::text IS NULL THEN '' ELSE ' - ' || ${motivoFinal}::text END ||
              ' - Por ' || ${actorNombre},
            ${link},
            d.pedido_id
          FROM destinatarios d
          RETURNING id
        )
        SELECT
          EXISTS(SELECT 1 FROM bloqueado) AS existe,
          EXISTS(SELECT 1 FROM permitido) AS permitido,
          (SELECT estado FROM bloqueado LIMIT 1) AS estado_actual,
          (SELECT TO_CHAR(fecha_pedido, 'YYYY-MM-DD') FROM bloqueado LIMIT 1) AS fecha_actual,
          EXISTS(SELECT 1 FROM actualizado) AS actualizado,
          FALSE AS estado_reseteado
      `) as ResultadoAtomico[];
      resultado = filas[0];
    } else {
      const descripcionCambio =
        `${nueva_fecha}${motivoFinal ? ` - ${motivoFinal}` : ""}`;
      const fechaCorta = `${nueva_fecha!.slice(8, 10)}/${nueva_fecha!.slice(5, 7)}`;

      const filas = (await sql`
        WITH bloqueado AS (
          SELECT
            p.id,
            p.cliente,
            p.fecha_pedido,
            p.estado,
            COALESCE(p.asesor_id, c.asesor_id) AS asesor_destino_id
          FROM pedidos p
          LEFT JOIN clientes c ON c.id = p.cliente_id
          WHERE p.id = ${pedidoId}
          FOR UPDATE OF p
        ), permitido AS (
          SELECT *
          FROM bloqueado
          WHERE estado <> 'Entregado'
            AND ${nueva_fecha}::date >= (NOW() AT TIME ZONE 'America/Lima')::date
            AND (
              ${esAdmin}
              OR (${esAsesor} AND asesor_destino_id = ${actorId}::uuid)
              OR (
                ${esProduccion}
                AND estado = ANY(${ESTADOS_PRODUCCION}::text[])
                AND ${nueva_fecha}::date =
                    (NOW() AT TIME ZONE 'America/Lima')::date + 1
              )
            )
        ), actualizado AS (
          UPDATE pedidos p SET
            fecha_pedido = ${nueva_fecha}::date,
            reprogramado_de = b.fecha_pedido,
            reprogramado_at = NOW(),
            reprogramado_motivo = ${motivoFinal},
            estado = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN 'Pendiente' ELSE p.estado END,
            entregado = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN FALSE ELSE p.entregado END,
            entregado_por = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.entregado_por END,
            entregado_at = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.entregado_at END,
            razon_fallo = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.razon_fallo END,
            repartidor_id = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.repartidor_id END,
            orden_ruta = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.orden_ruta END,
            distancia_km = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.distancia_km END,
            duracion_estimada_min = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.duracion_estimada_min END,
            inicio_viaje_at = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.inicio_viaje_at END,
            hora_llegada_estimada = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN NULL ELSE p.hora_llegada_estimada END,
            notificado_por_llegar = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN FALSE ELSE p.notificado_por_llegar END,
            notificado_llegada = CASE WHEN b.estado = ANY(${ESTADOS_CON_REPARTO}::text[]) THEN FALSE ELSE p.notificado_llegada END
          FROM permitido b
          WHERE p.id = b.id AND p.fecha_pedido IS DISTINCT FROM ${nueva_fecha}::date
          RETURNING
            p.id,
            p.cliente,
            b.estado AS estado_anterior,
            b.fecha_pedido AS fecha_anterior,
            b.asesor_destino_id
        ), auditoria AS (
          INSERT INTO pedido_ediciones
            (pedido_id, usuario_id, usuario_nombre, usuario_rol, cambios)
          SELECT
            id,
            ${actorId},
            ${actorNombre},
            ${actorRol},
            jsonb_build_array(jsonb_build_object(
              'campo', 'fecha_pedido',
              'etiqueta', 'Reprogramación',
              'antes', TO_CHAR(fecha_anterior, 'YYYY-MM-DD'),
              'despues', ${descripcionCambio}::text
            ))
          FROM actualizado
          RETURNING id
        ), destinatarios AS (
          SELECT
            a.id AS pedido_id,
            a.cliente,
            a.asesor_destino_id AS user_id
          FROM actualizado a
          WHERE a.asesor_destino_id IS NOT NULL
            AND a.asesor_destino_id IS DISTINCT FROM ${actorId}::uuid
          UNION ALL
          SELECT
            a.id AS pedido_id,
            a.cliente,
            u.id AS user_id
          FROM actualizado a
          JOIN users u ON u.role = 'admin' AND COALESCE(u.activo, TRUE)
          WHERE a.asesor_destino_id IS NULL
            AND u.id IS DISTINCT FROM ${actorId}::uuid
        ), avisos AS (
          INSERT INTO notificaciones
            (user_id, tipo, titulo, mensaje, link, pedido_id)
          SELECT
            d.user_id,
            'pedido_reprogramado',
            'Pedido reprogramado',
            'Cliente: ' || d.cliente || ' - Nueva fecha: ' || ${fechaCorta} ||
              CASE WHEN ${motivoFinal}::text IS NULL THEN '' ELSE ' - ' || ${motivoFinal}::text END ||
              ' - Por ' || ${actorNombre},
            ${link},
            d.pedido_id
          FROM destinatarios d
          RETURNING id
        )
        SELECT
          EXISTS(SELECT 1 FROM bloqueado) AS existe,
          EXISTS(SELECT 1 FROM permitido) AS permitido,
          (SELECT estado FROM bloqueado LIMIT 1) AS estado_actual,
          (SELECT TO_CHAR(fecha_pedido, 'YYYY-MM-DD') FROM bloqueado LIMIT 1) AS fecha_actual,
          EXISTS(SELECT 1 FROM actualizado) AS actualizado,
          COALESCE(
            (SELECT estado_anterior = ANY(${ESTADOS_CON_REPARTO}::text[]) FROM actualizado LIMIT 1),
            FALSE
          ) AS estado_reseteado
      `) as ResultadoAtomico[];
      resultado = filas[0];
    }

    // La lectura inicial ofrece errores claros. Estas comprobaciones repiten las
    // invariantes sobre la fila ya bloqueada y cubren una reasignación o cambio de
    // estado concurrente entre la lectura y el UPDATE.
    if (!resultado.existe) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    if (!resultado.permitido) {
      if (resultado.estado_actual === "Entregado") {
        return NextResponse.json(
          { error: "Este pedido ya se entregó: no se puede reprogramar" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: esProduccion
            ? `Producción no puede reprogramar un pedido en estado ${resultado.estado_actual}`
            : "Ya no tienes permiso para reprogramar este pedido",
        },
        { status: esProduccion ? 409 : 403 }
      );
    }

    return NextResponse.json({
      ok: true,
      idempotente: !resultado.actualizado,
      fecha_pedido: mas_tarde ? resultado.fecha_actual : nueva_fecha,
      estado_reseteado: resultado.estado_reseteado,
    });
  } catch (error: unknown) {
    console.error("Error al reprogramar pedido:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}
