// src/app/api/avicola/dashboard/route.ts
// Panel del módulo "Clientes Avícola" (req. §14) — admin-only, solo lectura.
// KPIs de cartera + ventas (día/semana/mes) + cobranza + rankings + inactivos.
// Toda agregación filtra NOT anulada / NOT anulado (disciplina gotcha #24).
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import type { DashboardAvicola } from "@/lib/avicola/types";
import { leerParametrosNegocio } from "@/lib/parametros-negocio";
import { listaClientesConSaldo, UMBRAL_DEUDA } from "@/lib/avicola/saldos";

export const dynamic = "force-dynamic";

/** Redondeo a 2 decimales para limpiar ruido de float en sumas TS. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const [lista, ventasRows, cobranzaRows, kgRows, rankingVolumen, sinComprarRows] =
      await Promise.all([
        // Estado de cuenta de TODOS los clientes (base de cartera + ranking deuda).
        listaClientesConSaldo(sql),

        // Ventas día / semana / mes en una sola pasada con FILTER (patrón consolidado).
        sql`
          SELECT
            COALESCE(SUM(total) FILTER (
              WHERE fecha = (NOW() AT TIME ZONE 'America/Lima')::date
            ), 0)::float8 AS dia,
            COALESCE(SUM(total) FILTER (
              WHERE fecha >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima'))::date
            ), 0)::float8 AS semana,
            COALESCE(SUM(total) FILTER (
              WHERE fecha >= date_trunc('month', (NOW() AT TIME ZONE 'America/Lima'))::date
            ), 0)::float8 AS mes,
            COUNT(*) FILTER (
              WHERE fecha >= date_trunc('month', (NOW() AT TIME ZONE 'America/Lima'))::date
            )::int AS ventas_mes
          FROM ventas_avicola
          WHERE NOT anulada
        ` as unknown as Promise<
          Array<{ dia: number; semana: number; mes: number; ventas_mes: number }>
        >,

        // Cobranza día / mes sobre abonos.
        sql`
          SELECT
            COALESCE(SUM(monto) FILTER (
              WHERE fecha = (NOW() AT TIME ZONE 'America/Lima')::date
            ), 0)::float8 AS dia,
            COALESCE(SUM(monto) FILTER (
              WHERE fecha >= date_trunc('month', (NOW() AT TIME ZONE 'America/Lima'))::date
            ), 0)::float8 AS mes
          FROM abonos_avicola
          WHERE NOT anulado
        ` as unknown as Promise<Array<{ dia: number; mes: number }>>,

        // Kilos vendidos en el mes (ítems de ventas no anuladas).
        sql`
          SELECT COALESCE(SUM(vi.peso_kg), 0)::float8 AS kg
          FROM venta_avicola_items vi
          JOIN ventas_avicola v ON v.id = vi.venta_id
          WHERE NOT v.anulada
            AND v.fecha >= date_trunc('month', (NOW() AT TIME ZONE 'America/Lima'))::date
        ` as unknown as Promise<Array<{ kg: number }>>,

        // Top 10 clientes por monto vendido en el mes en curso.
        sql`
          SELECT v.cliente_id, c.nombre, c.mercado, SUM(v.total)::float8 AS total
          FROM ventas_avicola v
          JOIN clientes_avicola c ON c.id = v.cliente_id
          WHERE NOT v.anulada
            AND v.fecha >= date_trunc('month', (NOW() AT TIME ZONE 'America/Lima'))::date
          GROUP BY v.cliente_id, c.nombre, c.mercado
          ORDER BY SUM(v.total) DESC
          LIMIT 10
        ` as unknown as Promise<
          Array<{ cliente_id: string; nombre: string; mercado: string; total: number }>
        >,

        // Días sin comprar de clientes ACTIVOS (si nunca compró, cuenta desde su alta).
        sql`
          SELECT
            c.id AS cliente_id,
            c.nombre,
            c.mercado,
            (
              (NOW() AT TIME ZONE 'America/Lima')::date
              - COALESCE(MAX(v.fecha), (c.created_at AT TIME ZONE 'America/Lima')::date)
            )::int AS dias
          FROM clientes_avicola c
          LEFT JOIN ventas_avicola v ON v.cliente_id = c.id AND NOT v.anulada
          WHERE c.activo
          GROUP BY c.id, c.nombre, c.mercado, c.created_at
          HAVING (
            (NOW() AT TIME ZONE 'America/Lima')::date
            - COALESCE(MAX(v.fecha), (c.created_at AT TIME ZONE 'America/Lima')::date)
          ) >= 7
          ORDER BY dias DESC
        ` as unknown as Promise<
          Array<{ cliente_id: string; nombre: string; mercado: string; dias: number }>
        >,
      ]);

    const ventas = ventasRows[0] ?? { dia: 0, semana: 0, mes: 0, ventas_mes: 0 };
    const cobranza = cobranzaRows[0] ?? { dia: 0, mes: 0 };

    // ── Cartera (base listaClientesConSaldo) ─────────────────────────────────
    const clientesConDeuda = lista.filter((c) => c.saldo_actual > UMBRAL_DEUDA);
    const cartera_total = r2(
      lista.reduce((s, c) => s + Math.max(c.saldo_actual, 0), 0)
    );
    const ranking_deuda = [...clientesConDeuda]
      .sort((a, b) => b.saldo_actual - a.saldo_actual)
      .slice(0, 10)
      .map((c) => ({
        cliente_id: c.id,
        nombre: c.nombre,
        mercado: c.mercado,
        saldo_actual: r2(c.saldo_actual),
      }));

    // ── Buckets EXCLUYENTES de días sin comprar (ya vienen ORDER BY dias DESC) ─
    // Cortes configurables desde /dashboard/configuracion (default histórico 7/15/30).
    const [corte1, corte2, corte3] = (await leerParametrosNegocio(sql)).cortes_deuda_avicola;
    const sin_comprar = {
      d7: sinComprarRows.filter((c) => c.dias >= corte1 && c.dias < corte2),
      d15: sinComprarRows.filter((c) => c.dias >= corte2 && c.dias < corte3),
      d30: sinComprarRows.filter((c) => c.dias >= corte3),
    };

    const respuesta: DashboardAvicola = {
      total_clientes: lista.length,
      clientes_activos: lista.filter((c) => c.activo).length,
      clientes_con_deuda: clientesConDeuda.length,
      cartera_total,
      ventas: { dia: r2(ventas.dia), semana: r2(ventas.semana), mes: r2(ventas.mes) },
      cobranza: { dia: r2(cobranza.dia), mes: r2(cobranza.mes) },
      ticket_promedio_mes:
        ventas.ventas_mes > 0 ? r2(ventas.mes / ventas.ventas_mes) : 0,
      kg_vendidos_mes: r2(kgRows[0]?.kg ?? 0),
      ranking_volumen: rankingVolumen.map((c) => ({
        cliente_id: c.cliente_id,
        nombre: c.nombre,
        mercado: c.mercado,
        total: r2(c.total),
      })),
      ranking_deuda,
      sin_comprar,
    };

    return NextResponse.json(respuesta);
  } catch (error) {
    console.error("Error en GET /api/avicola/dashboard:", error);
    return NextResponse.json(
      { error: "Error al cargar el panel avícola" },
      { status: 500 }
    );
  }
}
