// src/lib/ventas-metricas.ts
// ÚNICA fuente de la métrica de ventas de asesoras para metas/incentivos.
//
// Regla de negocio (ratificada por Hugo, 5 jul 2026): la venta de una asesora se
// mide por PEDIDOS, no por comprobantes: monto = SUM(pedido_items.cantidad ×
// precio_unitario), atribuido a la fecha en que la asesora REGISTRÓ el pedido
// (`created_at`, zona Lima). Se excluyen las ventas rápidas del POS de planta
// (`origen = 'pos_planta'`); los pedidos históricos sin origen cuentan como de
// asesora (COALESCE). La vista `ventas_facturadas` queda solo como fuente de
// facturación/reportes, ya NO para incentivos.
//
// Dos variantes, porque ~86% de los pedidos se entrega DESPUÉS del día de venta:
//  - "entregadas": solo pedidos ya Entregados. Cifra confirmada — se usa para la
//    meta mensual, ventas del mes anterior y el ranking mensual.
//  - "vigentes": todo lo no Fallido. Cifra optimista del día/semana en curso — se
//    usa para rachas y meta de equipo semanal (un pedido registrado hoy cuenta ya,
//    y deja de contar solo si termina Fallido).
//
// Si cambias esta regla, cambia SOLO este módulo: lib/metas.ts y lib/incentivos.ts
// consumen estas funciones y no deben duplicar la query.
import { neon } from "@neondatabase/serverless";

export type VarianteVentas = "entregadas" | "vigentes";

export interface VentasDia {
  dia: string; // YYYY-MM-DD (zona Lima)
  monto: number;
  pedidos: number;
}

/** Total vendido (S/) por la asesora en el rango [desdeIso, hastaIso] inclusive. */
export async function sumarVentasAsesora(
  asesorId: string,
  desdeIso: string,
  hastaIso: string,
  variante: VarianteVentas
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const soloEntregadas = variante === "entregadas";
  const rows = (await sql`
    SELECT COALESCE(SUM(pi.cantidad * pi.precio_unitario), 0)::numeric AS total
    FROM pedidos p
    JOIN pedido_items pi ON p.id = pi.pedido_id
    WHERE p.asesor_id = ${asesorId}
      AND (CASE WHEN ${soloEntregadas} THEN p.estado = 'Entregado' ELSE p.estado <> 'Fallido' END)
      AND COALESCE(p.origen, 'asesor') <> 'pos_planta'
      AND (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desdeIso}::date AND ${hastaIso}::date
  `) as Array<{ total: string | number }>;
  return Number(rows[0]?.total ?? 0);
}

/** Venta por día de la asesora en el rango (monto y N° de pedidos por día de registro). */
export async function ventasPorDiaAsesora(
  asesorId: string,
  desdeIso: string,
  hastaIso: string,
  variante: VarianteVentas
): Promise<VentasDia[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const soloEntregadas = variante === "entregadas";
  const rows = (await sql`
    SELECT (p.created_at AT TIME ZONE 'America/Lima')::date AS dia,
           COALESCE(SUM(pi.cantidad * pi.precio_unitario), 0)::numeric AS monto,
           COUNT(DISTINCT p.id)::int AS pedidos
    FROM pedidos p
    JOIN pedido_items pi ON p.id = pi.pedido_id
    WHERE p.asesor_id = ${asesorId}
      AND (CASE WHEN ${soloEntregadas} THEN p.estado = 'Entregado' ELSE p.estado <> 'Fallido' END)
      AND COALESCE(p.origen, 'asesor') <> 'pos_planta'
      AND (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desdeIso}::date AND ${hastaIso}::date
    GROUP BY dia
  `) as Array<{ dia: string | Date; monto: string | number; pedidos: number }>;
  return rows.map((r) => ({
    dia: (typeof r.dia === "string" ? r.dia : r.dia.toISOString()).slice(0, 10),
    monto: Number(r.monto),
    pedidos: Number(r.pedidos),
  }));
}

/** N° de pedidos (ventas) de la asesora en el rango. */
export async function contarPedidosAsesora(
  asesorId: string,
  desdeIso: string,
  hastaIso: string,
  variante: VarianteVentas
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const soloEntregadas = variante === "entregadas";
  const rows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM pedidos p
    WHERE p.asesor_id = ${asesorId}
      AND (CASE WHEN ${soloEntregadas} THEN p.estado = 'Entregado' ELSE p.estado <> 'Fallido' END)
      AND COALESCE(p.origen, 'asesor') <> 'pos_planta'
      AND (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desdeIso}::date AND ${hastaIso}::date
  `) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Venta de TODO el equipo de asesoras en el rango. Solo cuenta pedidos cuyo
 * asesor tiene rol 'asesor' (los del admin no inflan la meta de equipo), para
 * que el total cuadre con la suma del ranking. `criterio`: "monto" (S/) o
 * "pedidos" (N° de pedidos).
 */
export async function ventasEquipo(
  desdeIso: string,
  hastaIso: string,
  variante: VarianteVentas,
  criterio: "monto" | "pedidos" = "monto"
): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const soloEntregadas = variante === "entregadas";
  if (criterio === "pedidos") {
    const rows = (await sql`
      SELECT COUNT(DISTINCT p.id)::int AS n
      FROM pedidos p
      JOIN users u ON p.asesor_id = u.id AND u.role = 'asesor'
      WHERE (CASE WHEN ${soloEntregadas} THEN p.estado = 'Entregado' ELSE p.estado <> 'Fallido' END)
        AND COALESCE(p.origen, 'asesor') <> 'pos_planta'
        AND (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desdeIso}::date AND ${hastaIso}::date
    `) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }
  const rows = (await sql`
    SELECT COALESCE(SUM(pi.cantidad * pi.precio_unitario), 0)::numeric AS total
    FROM pedidos p
    JOIN users u ON p.asesor_id = u.id AND u.role = 'asesor'
    JOIN pedido_items pi ON p.id = pi.pedido_id
    WHERE (CASE WHEN ${soloEntregadas} THEN p.estado = 'Entregado' ELSE p.estado <> 'Fallido' END)
      AND COALESCE(p.origen, 'asesor') <> 'pos_planta'
      AND (p.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ${desdeIso}::date AND ${hastaIso}::date
  `) as Array<{ total: string | number }>;
  return Number(rows[0]?.total ?? 0);
}
