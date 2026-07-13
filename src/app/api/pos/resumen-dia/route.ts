// src/app/api/pos/resumen-dia/route.ts
// Resumen del día del POS de planta: cuánto se vendió, en cuántas ventas, A QUÉ CUENTA
// cayó cada cobro (contado) y cuánto quedó por cobrar (crédito). Responde el "no veo
// dónde se acumula el dinero" del POS: el contado suma a la cuenta elegida en "Cobrar en"
// (cuentas_bancarias + transacciones); el crédito va a cobranzas_planta.
// Roles: admin + produccion (mismos que el POS). Solo lectura.
import { auth } from "@/auth";
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

    // Crédito del día (a cobrar) en cobranzas_planta no anuladas. Por fecha_emision
    // (DATE en zona Lima), consistente con la fecha del pedido.
    const creditoRows = (await sql`
      SELECT COALESCE(SUM(monto), 0)::float8 AS total, COUNT(*)::int AS ventas
      FROM cobranzas_planta
      WHERE NOT anulada
        AND fecha_emision = ${fecha}::date
    `) as Array<{ total: number; ventas: number }>;

    // Historial breve: últimas ventas del POS del día (cliente + total + a dónde fue).
    const ventas = (await sql`
      SELECT
        p.id,
        p.cliente,
        p.razon_social,
        p.empresa,
        TO_CHAR(p.created_at AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
        COALESCE(im.total, 0)::float8 AS total,
        CASE WHEN cob.id IS NOT NULL THEN 'Crédito' ELSE 'Contado' END AS tipo_pago,
        cta.nombre AS cuenta_nombre
      FROM pedidos p
      LEFT JOIN (
        SELECT pedido_id, SUM(COALESCE(subtotal_real, subtotal, 0)) AS total
        FROM pedido_items GROUP BY pedido_id
      ) im ON im.pedido_id = p.id
      LEFT JOIN cobranzas_planta cob ON cob.pedido_id = p.id AND NOT cob.anulada
      LEFT JOIN transacciones t ON t.referencia_id = p.id AND t.tipo = 'ingreso'
      LEFT JOIN cuentas_bancarias cta ON cta.id = t.cuenta_id
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
      total: number;
      tipo_pago: string;
      cuenta_nombre: string | null;
    }>;

    const contadoTotal = porCuenta.reduce((s, c) => s + c.monto, 0);
    const contadoVentas = porCuenta.reduce((s, c) => s + c.ventas, 0);
    const credito = creditoRows[0] ?? { total: 0, ventas: 0 };

    return NextResponse.json({
      fecha,
      total_dia: Math.round((contadoTotal + credito.total) * 100) / 100,
      num_ventas: contadoVentas + credito.ventas,
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
