// src/app/api/pos/resumen-dia/route.ts
// Resumen del día del POS de planta: cuánto se vendió, en cuántas ventas, A QUÉ CUENTA
// cayó cada cobro (contado) y cuánto quedó por cobrar (crédito). Responde el "no veo
// dónde se acumula el dinero" del POS: el contado suma a la cuenta elegida en "Cobrar en"
// (cuentas_bancarias + transacciones); el crédito va a cobranzas_planta.
// Roles: admin + produccion (mismos que el POS). Solo lectura.
import { auth } from "@/auth";
import { normalizarVentaConDetallePos } from "@/lib/planta/ventas-pos";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fechaRaw = searchParams.get("fecha") ?? undefined;
  if (fechaRaw && (!FECHA_REGEX.test(fechaRaw) || Number.isNaN(Date.parse(fechaRaw)))) {
    return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hoyRows = (await sql`
      SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
    `) as Array<{ hoy: string }>;
    const fecha = fechaRaw ?? hoyRows[0].hoy;

    // Fuente canónica del encabezado: pedidos POS activos + sus ítems. No se deriva
    // de movimientos financieros, porque una cobranza corregida/anulada no debe
    // cambiar retroactivamente cuánto se vendió ni cuántas ventas se registraron.
    const totalVentaRows = (await sql`
      SELECT COALESCE(SUM(venta.total), 0)::float8 AS total,
             COUNT(*)::int AS ventas
      FROM (
        SELECT p.id, COALESCE(SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)), 0) AS total
        FROM pedidos p
        LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
        WHERE p.origen = 'pos_planta'
          AND (p.created_at AT TIME ZONE 'America/Lima')::date = ${fecha}::date
          AND NOT COALESCE(p.anulada, FALSE)
        GROUP BY p.id
      ) venta
    `) as Array<{ total: number; ventas: number }>;

    // Contado del día por cuenta: cada venta del POS registra una transacción 'ingreso'
    // en la cuenta elegida, con referencia_id = pedido. Se une por ESE id al pedido
    // pos_planta (robusto; no depende del texto del concepto, que trae acento).
    // Se filtra por la fecha del PEDIDO (autoritativa, misma que la lista de ventas),
    // no por la de la transacción — cerca de medianoche pueden caer en días distintos.
    const porCuenta = (await sql`
      SELECT c.id, c.nombre, c.tipo,
             COALESCE(SUM(t.monto), 0)::float8 AS monto,
             COUNT(*)::int AS ventas
      FROM transacciones t
      JOIN pedidos p ON p.id = t.referencia_id AND p.origen = 'pos_planta'
      JOIN cuentas_bancarias c ON c.id = t.cuenta_id
      WHERE t.tipo = 'ingreso'
        AND (p.created_at AT TIME ZONE 'America/Lima')::date = ${fecha}::date
        AND NOT COALESCE(p.anulada, FALSE)
      GROUP BY c.id, c.nombre, c.tipo
      ORDER BY monto DESC
    `) as Array<{ id: string; nombre: string; tipo: string; monto: number; ventas: number }>;

    // Saldo de crédito realmente pendiente del día. El tipo de pago original
    // no cambia al abonar/anular, pero "por cobrar" sí debe descontar los
    // abonos activos y omitir cobranzas/ventas anuladas.
    const creditoRows = (await sql`
      SELECT
        COALESCE(SUM(saldo), 0)::float8 AS total,
        COUNT(*) FILTER (WHERE saldo > 0)::int AS ventas
      FROM (
        SELECT
          GREATEST(
            cob.monto - COALESCE(SUM(ab.monto) FILTER (WHERE NOT ab.anulado), 0),
            0
          ) AS saldo
        FROM cobranzas_planta cob
        JOIN pedidos p ON p.id = cob.pedido_id AND p.origen = 'pos_planta'
        LEFT JOIN abonos_planta ab ON ab.cobranza_id = cob.id
        WHERE NOT cob.anulada
          AND NOT COALESCE(p.anulada, FALSE)
          AND (p.created_at AT TIME ZONE 'America/Lima')::date = ${fecha}::date
        GROUP BY cob.id, cob.monto
      ) creditos
    `) as Array<{ total: number; ventas: number }>;

    // Historial breve con el detalle que explica el total. El tipo de pago se
    // determina por la existencia HISTÓRICA de la cobranza; si luego se anula esa
    // deuda, la venta original no se etiqueta engañosamente como contado.
    const ventasRaw = (await sql`
      SELECT
        p.id,
        p.cliente,
        p.razon_social,
        p.empresa,
        TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
        COALESCE(im.total, 0)::float8 AS total,
        CASE WHEN EXISTS (
          SELECT 1 FROM cobranzas_planta cpx WHERE cpx.pedido_id = p.id
        ) THEN 'Credito' ELSE 'Contado' END AS tipo_pago,
        pago.cuenta_nombre,
        COALESCE(im.items, '[]'::jsonb) AS items
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
      ) im ON TRUE
      LEFT JOIN LATERAL (
        SELECT cta.nombre AS cuenta_nombre
        FROM transacciones t
        JOIN cuentas_bancarias cta ON cta.id = t.cuenta_id
        WHERE t.referencia_id = p.id AND t.tipo = 'ingreso'
        ORDER BY t.created_at, t.id
        LIMIT 1
      ) pago ON TRUE
      WHERE p.origen = 'pos_planta'
        AND (p.created_at AT TIME ZONE 'America/Lima')::date = ${fecha}::date
        AND NOT COALESCE(p.anulada, FALSE)
      ORDER BY p.created_at DESC
      LIMIT 30
    `) as Array<{
      id: string;
      cliente: string | null;
      razon_social: string | null;
      empresa: string;
      hora: string;
      total: unknown;
      tipo_pago: string;
      cuenta_nombre: string | null;
      items: unknown;
    }>;
    const ventas = ventasRaw.map(normalizarVentaConDetallePos);

    const contadoTotal = porCuenta.reduce((s, c) => s + c.monto, 0);
    const contadoVentas = porCuenta.reduce((s, c) => s + c.ventas, 0);
    const credito = creditoRows[0] ?? { total: 0, ventas: 0 };
    const totalVenta = totalVentaRows[0] ?? { total: 0, ventas: 0 };

    return NextResponse.json({
      fecha,
      total_dia: Math.round(totalVenta.total * 100) / 100,
      num_ventas: totalVenta.ventas,
      contado: {
        total: Math.round(contadoTotal * 100) / 100,
        ventas: contadoVentas,
        por_cuenta: porCuenta.map((c) => ({
          cuenta: c.nombre,
          tipo: c.tipo,
          monto: Math.round(c.monto * 100) / 100,
          ventas: c.ventas,
        })),
      },
      credito: {
        total: Math.round(credito.total * 100) / 100,
        ventas: credito.ventas,
      },
      ventas,
    });
  } catch (error) {
    console.error("Error en GET /api/pos/resumen-dia:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
