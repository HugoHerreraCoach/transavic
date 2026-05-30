// src/app/api/cobranzas/aging/route.ts
// P3.13 — Reporte de "aging" de cobranzas.
//
// Agrupa las facturas internas pendientes/vencidas en 4 buckets clásicos
// según los días transcurridos desde el VENCIMIENTO (no desde la emisión):
//   • 0-30   → recién pasadas, presión baja
//   • 31-60  → atención
//   • 61-90  → riesgo medio
//   • +90    → riesgo alto (recuperar/escalar)
//
// Las facturas Pagadas NO entran (ya no son deuda). Las que vencen en el
// futuro aparecen como bucket "0-30" con días negativos — para el reporte
// solo cuentan las que ya vencieron (días > 0). El cliente front se
// encarga de mostrar también un bucket "Por vencer" si quiere.
//
// Scoping: admin ve todo; asesor solo los pedidos suyos. Las cobranzas
// sin asesor_id (cobranzas manuales standalone) las ve solo el admin.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

interface Bucket {
  label: string;
  cnt: number;
  total: number;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const role = session.user.role;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const userId = session.user.id;
    const esAdmin = role === "admin";

    // Una sola query que devuelve filas con bucket + total + cnt.
    // La fórmula de días: (hoy - fecha_vencimiento) en días, donde "hoy" es
    // la fecha en Lima (UTC-5, sin DST). Bucket -1 = "por vencer".
    const rows = (esAdmin
      ? await sql`
          SELECT
            CASE
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento < 0 THEN '_por_vencer'
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento <= 30 THEN '0_30'
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento <= 60 THEN '31_60'
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento <= 90 THEN '61_90'
              ELSE '90_plus'
            END AS bucket,
            COUNT(*)::int AS cnt,
            COALESCE(SUM(monto), 0)::numeric AS total
          FROM facturas
          WHERE estado IN ('Pendiente', 'Vencida')
          GROUP BY bucket
        `
      : await sql`
          SELECT
            CASE
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento < 0 THEN '_por_vencer'
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento <= 30 THEN '0_30'
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento <= 60 THEN '31_60'
              WHEN (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento <= 90 THEN '61_90'
              ELSE '90_plus'
            END AS bucket,
            COUNT(*)::int AS cnt,
            COALESCE(SUM(monto), 0)::numeric AS total
          FROM facturas
          WHERE estado IN ('Pendiente', 'Vencida')
            AND asesor_id = ${userId}::uuid
          GROUP BY bucket
        `) as Array<{ bucket: string; cnt: number; total: string | number }>;

    const init: Record<string, Bucket> = {
      _por_vencer: { label: "Por vencer", cnt: 0, total: 0 },
      "0_30": { label: "0–30 días", cnt: 0, total: 0 },
      "31_60": { label: "31–60 días", cnt: 0, total: 0 },
      "61_90": { label: "61–90 días", cnt: 0, total: 0 },
      "90_plus": { label: "+90 días", cnt: 0, total: 0 },
    };
    for (const r of rows) {
      if (init[r.bucket]) {
        init[r.bucket].cnt = r.cnt;
        init[r.bucket].total = Number(r.total);
      }
    }

    // También devolvemos el TOP 5 de clientes con más deuda vencida
    // (>0 días) para que admin pueda ir directo a llamarlos.
    const topMorosos = (esAdmin
      ? await sql`
          SELECT
            cliente_nombre,
            COUNT(*)::int AS cnt,
            COALESCE(SUM(monto), 0)::numeric AS total,
            MAX((NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento)::int AS max_dias
          FROM facturas
          WHERE estado IN ('Pendiente', 'Vencida')
            AND (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento >= 0
          GROUP BY cliente_nombre
          ORDER BY total DESC
          LIMIT 5
        `
      : await sql`
          SELECT
            cliente_nombre,
            COUNT(*)::int AS cnt,
            COALESCE(SUM(monto), 0)::numeric AS total,
            MAX((NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento)::int AS max_dias
          FROM facturas
          WHERE estado IN ('Pendiente', 'Vencida')
            AND asesor_id = ${userId}::uuid
            AND (NOW() AT TIME ZONE 'America/Lima')::date - fecha_vencimiento >= 0
          GROUP BY cliente_nombre
          ORDER BY total DESC
          LIMIT 5
        `) as Array<{
        cliente_nombre: string;
        cnt: number;
        total: string | number;
        max_dias: number;
      }>;

    return NextResponse.json({
      buckets: [
        init._por_vencer,
        init["0_30"],
        init["31_60"],
        init["61_90"],
        init["90_plus"],
      ],
      topMorosos: topMorosos.map((m) => ({
        ...m,
        total: Number(m.total),
      })),
    });
  } catch (error) {
    console.error("Error GET /api/cobranzas/aging:", error);
    return NextResponse.json({ error: "Error al generar aging" }, { status: 500 });
  }
}
