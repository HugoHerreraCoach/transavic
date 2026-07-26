// src/app/api/reportes/balance-asesoras/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  let asesorId = searchParams.get("asesor_id");

  // Validación de Rol y Alcance de Datos
  if (session.user.role === "asesor") {
    // Las asesoras normales solo pueden consultar sus propios datos
    asesorId = session.user.id;
  } else if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Si se pasa 'todos' o 'todas', lo tratamos como null para el filtro de base de datos
  const filterAsesorId = asesorId && asesorId !== "todos" && asesorId !== "todas" ? asesorId : null;

  if (!desde || !hasta || !FECHA_REGEX.test(desde) || !FECHA_REGEX.test(hasta)) {
    return NextResponse.json(
      { error: "Rango de fechas requerido y válido (desde/hasta en formato YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const rows = await sql`
      WITH clientes_seleccionados AS (
        SELECT id, nombre, razon_social, ruc_dni, asesor_id
        FROM clientes
        WHERE (${filterAsesorId}::uuid IS NULL OR asesor_id = ${filterAsesorId}::uuid)
      ),
      ventas_periodo AS (
        -- Kilos y Montos facturados en el rango [desde, hasta]
        SELECT 
          f.cliente_id,
          COALESCE(SUM(COALESCE(pi.cantidad_real, pi.cantidad, 0)), 0)::numeric(14, 2) AS kg_vendidos,
          COALESCE(SUM(f.monto), 0)::numeric(14, 2) AS monto_venta
        FROM facturas f
        LEFT JOIN pedidos p ON p.id = f.pedido_id
        LEFT JOIN pedido_items pi ON pi.pedido_id = p.id AND pi.unidad IN ('kg', 'KGM')
        WHERE f.fecha_emision BETWEEN ${desde}::date AND ${hasta}::date
          AND f.estado <> 'Anulada'
          AND (${filterAsesorId}::uuid IS NULL OR f.asesor_id = ${filterAsesorId}::uuid)
        GROUP BY f.cliente_id
      ),
      cobranzas_periodo AS (
        -- Pagos confirmados y cobrados en el rango [desde, hasta]
        SELECT 
          f.cliente_id,
          COALESCE(SUM(f.monto), 0)::numeric(14, 2) AS monto_cobrado
        FROM facturas f
        WHERE f.fecha_pago BETWEEN ${desde}::date AND ${hasta}::date
          AND f.estado = 'Pagada'
          AND (${filterAsesorId}::uuid IS NULL OR f.asesor_id = ${filterAsesorId}::uuid)
        GROUP BY f.cliente_id
      ),
      saldo_anterior AS (
        -- Deuda que estaba pendiente antes de la fecha 'desde'
        SELECT 
          f.cliente_id,
          COALESCE(SUM(f.monto), 0)::numeric(14, 2) AS saldo_ant
        FROM facturas f
        WHERE f.fecha_emision < ${desde}::date
          AND f.estado <> 'Anulada'
          AND (f.fecha_pago IS NULL OR f.fecha_pago >= ${desde}::date)
          AND (${filterAsesorId}::uuid IS NULL OR f.asesor_id = ${filterAsesorId}::uuid)
        GROUP BY f.cliente_id
      ),
      descuentos_periodo AS (
        -- Notas de Crédito de descuento en el rango [desde, hasta]
        SELECT 
          p.cliente_id,
          COALESCE(SUM(c.monto_total), 0)::numeric(14, 2) AS monto_descuento
        FROM comprobantes c
        JOIN pedidos p ON p.id = c.pedido_id
        WHERE c.tipo = '07'
          AND c.estado IN ('aceptado', 'observado', 'pendiente')
          AND c.fecha_emision BETWEEN ${desde}::date AND ${hasta}::date
          AND (${filterAsesorId}::uuid IS NULL OR p.asesor_id = ${filterAsesorId}::uuid)
        GROUP BY p.cliente_id
      )
      SELECT 
        cl.id AS cliente_id,
        cl.nombre AS cliente_nombre,
        cl.razon_social AS cliente_razon_social,
        cl.ruc_dni AS cliente_ruc_dni,
        COALESCE(u.name, 'Sin ejecutiva') AS asesor_name,
        COALESCE(v.kg_vendidos, 0)::float8 AS kg_vendidos,
        COALESCE(v.monto_venta, 0)::float8 AS monto_venta,
        COALESCE(sa.saldo_ant, 0)::float8 AS saldo_anterior,
        COALESCE(cob.monto_cobrado, 0)::float8 AS cobrado,
        COALESCE(d.monto_descuento, 0)::float8 AS descuento,
        (COALESCE(sa.saldo_ant, 0) + COALESCE(v.monto_venta, 0) - COALESCE(cob.monto_cobrado, 0) - COALESCE(d.monto_descuento, 0))::float8 AS saldo_pendiente
      FROM clientes_seleccionados cl
      LEFT JOIN users u ON u.id = cl.asesor_id
      LEFT JOIN ventas_periodo v ON v.cliente_id = cl.id
      LEFT JOIN cobranzas_periodo cob ON cob.cliente_id = cl.id
      LEFT JOIN saldo_anterior sa ON sa.cliente_id = cl.id
      LEFT JOIN descuentos_periodo d ON d.cliente_id = cl.id
      WHERE COALESCE(v.monto_venta, 0) > 0 
         OR COALESCE(sa.saldo_ant, 0) > 0 
         OR COALESCE(cob.monto_cobrado, 0) > 0 
         OR COALESCE(d.monto_descuento, 0) > 0
      ORDER BY cl.nombre ASC
    `;

    return NextResponse.json({
      desde,
      hasta,
      asesor_id: filterAsesorId,
      clientes: rows,
    });
  } catch (error) {
    console.error("Error al calcular balance de asesoras:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
