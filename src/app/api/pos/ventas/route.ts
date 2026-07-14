// src/app/api/pos/ventas/route.ts
// GET — lista las ventas del POS de planta por rango de fechas (default hoy Lima).
// Para la vista "Ventas de Planta" (ver, anular). Roles admin + produccion. Espejo de
// GET /api/avicola/ventas. Incluye ítems, total, a qué cuenta cayó, tipo de pago,
// estado de comprobante y si está anulada.
import { auth } from "@/auth";
import { normalizarVentaConDetallePos } from "@/lib/planta/ventas-pos";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const desdeParam = searchParams.get("desde");
  const hastaParam = searchParams.get("hasta");
  for (const f of [desdeParam, hastaParam]) {
    if (f && (!FECHA_REGEX.test(f) || Number.isNaN(Date.parse(f)))) {
      return NextResponse.json({ error: "Formato de fecha inválido (YYYY-MM-DD)." }, { status: 400 });
    }
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hoyRows = (await sql`
      SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
    `) as Array<{ hoy: string }>;
    const desde = desdeParam ?? hoyRows[0].hoy;
    const hasta = hastaParam ?? hoyRows[0].hoy;

    const ventasRaw = (await sql`
      SELECT
        p.id,
        p.cliente,
        p.razon_social,
        p.ruc_dni,
        p.empresa,
        (p.created_at AT TIME ZONE 'America/Lima')::date::text AS fecha,
        TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
        p.created_at::text AS created_at,
        p.anulada,
        p.anulacion_motivo,
        COALESCE(det.total, 0)::float8 AS total,
        -- 'Credito' si el pedido tuvo cobranza de planta (aunque esté anulada por anular la
        -- venta) — así una venta a crédito anulada no se muestra engañosamente como 'Contado'.
        CASE WHEN EXISTS (SELECT 1 FROM cobranzas_planta cpx WHERE cpx.pedido_id = p.id)
             THEN 'Credito' ELSE 'Contado' END AS tipo_pago,
        pago.cuenta_nombre,
        co.serie_numero AS comprobante_serie_numero,
        co.tipo         AS comprobante_tipo,
        co.estado       AS comprobante_estado,
        COALESCE(det.items, '[]'::jsonb) AS items
      FROM pedidos p
      LEFT JOIN LATERAL (
        SELECT
          SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)) AS total,
          jsonb_agg(jsonb_build_object(
            'producto_nombre', pi.producto_nombre,
            'cantidad', pi.cantidad::float8,
            'unidad', pi.unidad,
            'precio_unitario', COALESCE(pi.precio_unitario, 0)::float8,
            'subtotal_venta', COALESCE(pi.subtotal_real, pi.subtotal, 0)::float8,
            'costo_unitario', pi.costo_unitario_snapshot::float8,
            'subtotal_costo', CASE
              WHEN pi.costo_unitario_snapshot IS NULL THEN NULL
              ELSE ROUND(pi.cantidad * pi.costo_unitario_snapshot, 2)::float8
            END
          ) ORDER BY pi.created_at, pi.id) AS items
        FROM pedido_items pi
        WHERE pi.pedido_id = p.id
      ) det ON TRUE
      LEFT JOIN LATERAL (
        SELECT cta.nombre AS cuenta_nombre
        FROM transacciones t
        JOIN cuentas_bancarias cta ON cta.id = t.cuenta_id
        WHERE t.referencia_id = p.id AND t.tipo = 'ingreso'
        ORDER BY t.created_at, t.id
        LIMIT 1
      ) pago ON TRUE
      LEFT JOIN LATERAL (
        SELECT serie_numero, tipo, estado
        FROM comprobantes cc
        WHERE cc.pedido_id = p.id AND cc.tipo IN ('01', '03')
          AND cc.estado IN ('aceptado', 'observado', 'pendiente')
        ORDER BY cc.created_at DESC LIMIT 1
      ) co ON TRUE
      WHERE p.origen = 'pos_planta'
        AND (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desde}::date AND ${hasta}::date
      ORDER BY p.created_at DESC
    `) as Array<Record<string, unknown> & { total: unknown; items: unknown }>;
    const ventas = ventasRaw.map(normalizarVentaConDetallePos);

    return NextResponse.json({ ventas });
  } catch (error) {
    console.error("Error al listar ventas de planta:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
