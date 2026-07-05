// src/lib/reportes/datos-ventas.ts
// ─────────────────────────────────────────────────────────────
// Datos del Reporte de Ventas (vista admin de /dashboard/reportes).
//
// Mide FACTURACIÓN ENTREGADA, no lo registrado por la asesora:
//   - El dinero (S/) cuenta solo pedidos en estado 'Entregado'.
//   - El monto por pedido usa COALESCE(subtotal_real, subtotal) → peso real
//     cuando ya se pesó al entregar, estimado si todavía no.
//   - Se filtra por fecha_pedido (fecha de ENTREGA), zona implícita de la
//     columna DATE. Es lo correcto para reportes de admin (ver CLAUDE.md §13:
//     "los reportes de admin siguen midiendo facturación ENTREGADA").
//
// Este módulo es la ÚNICA fuente de las cifras: lo usan el endpoint JSON
// (/api/reportes/ventas), el Excel (/api/reportes/ventas/export-xlsx) y, vía
// ese JSON, el PDF que se arma en el cliente. Una sola verdad para los 3.
// ─────────────────────────────────────────────────────────────

import { neon } from "@neondatabase/serverless";

export interface ReporteVentas {
  rango: { desde: string; hasta: string };
  kpis: {
    total_pedidos: number;
    entregados: number;
    pendientes: number;
    fallidos: number;
    total_facturado: number;
    ticket_promedio: number;
  };
  ventasPorDia: { fecha: string; fecha_corta: string; pedidos: number; monto: number }[];
  topProductos: { nombre: string; unidad: string; cantidad: number; monto: number }[];
  porEmpresa: { empresa: string; pedidos: number; monto: number }[];
  porDistrito: { distrito: string; pedidos: number; monto: number }[];
  ranking: {
    id: string;
    name: string;
    total_pedidos: number;
    entregados: number;
    fallidos: number;
    facturado: number;
    tasa: number; // % de entrega (entregados / total) — 0..100
  }[];
}

// Subconsulta reutilizada: monto facturado por pedido (peso real si existe).
// La declaramos como string para inyectarla con sql.query/templates idénticos
// en cada consulta (el cliente HTTP de Neon no comparte CTEs entre llamadas).
const MONTO_POR_PEDIDO = `
  LEFT JOIN (
    SELECT pedido_id, SUM(COALESCE(subtotal_real, subtotal, 0)) AS monto
    FROM pedido_items
    GROUP BY pedido_id
  ) im ON im.pedido_id = p.id`;

/**
 * Calcula todas las cifras del reporte de ventas para el rango [desde, hasta]
 * (ambos YYYY-MM-DD, inclusive). Devuelve números ya parseados (no strings de
 * Neon) listos para JSON, Excel o PDF.
 */
export async function obtenerReporteVentas(
  desde: string,
  hasta: string
): Promise<ReporteVentas> {
  const sql = neon(process.env.DATABASE_URL!);

  // ── KPIs del período ──
  const kpisRows = (await sql.query(
    `SELECT
       COUNT(*)::int AS total_pedidos,
       COUNT(*) FILTER (WHERE p.estado = 'Entregado')::int AS entregados,
       COUNT(*) FILTER (WHERE p.estado NOT IN ('Entregado','Fallido'))::int AS pendientes,
       COUNT(*) FILTER (WHERE p.estado = 'Fallido')::int AS fallidos,
       COALESCE(SUM(im.monto) FILTER (WHERE p.estado = 'Entregado'), 0)::float8 AS total_facturado
     FROM pedidos p
     ${MONTO_POR_PEDIDO}
     WHERE p.fecha_pedido >= $1::date AND p.fecha_pedido <= $2::date`,
    [desde, hasta]
  )) as Record<string, number>[];
  const k = kpisRows[0] || {};
  const entregados = Number(k.entregados || 0);
  const totalFacturado = Number(k.total_facturado || 0);

  // ── Ventas por día (monto entregado) ──
  const ventasPorDia = (await sql.query(
    `SELECT
       TO_CHAR(p.fecha_pedido, 'YYYY-MM-DD') AS fecha,
       TO_CHAR(p.fecha_pedido, 'DD/MM') AS fecha_corta,
       COUNT(*) FILTER (WHERE p.estado = 'Entregado')::int AS pedidos,
       COALESCE(SUM(im.monto) FILTER (WHERE p.estado = 'Entregado'), 0)::float8 AS monto
     FROM pedidos p
     ${MONTO_POR_PEDIDO}
     WHERE p.fecha_pedido >= $1::date AND p.fecha_pedido <= $2::date
     GROUP BY p.fecha_pedido
     ORDER BY p.fecha_pedido ASC`,
    [desde, hasta]
  )) as { fecha: string; fecha_corta: string; pedidos: number; monto: number }[];

  // ── Top productos (entregados, por monto) ──
  const topProductos = (await sql.query(
    `SELECT
       COALESCE(prod.nombre, pi.producto_nombre) AS nombre,
       pi.unidad,
       SUM(COALESCE(pi.cantidad_real, pi.cantidad))::float8 AS cantidad,
       SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0))::float8 AS monto
     FROM pedido_items pi
     JOIN pedidos p ON pi.pedido_id = p.id
     LEFT JOIN productos prod ON pi.producto_id = prod.id
     WHERE p.fecha_pedido >= $1::date AND p.fecha_pedido <= $2::date
       AND p.estado = 'Entregado'
     GROUP BY COALESCE(prod.nombre, pi.producto_nombre), pi.unidad
     ORDER BY monto DESC
     LIMIT 15`,
    [desde, hasta]
  )) as { nombre: string; unidad: string; cantidad: number; monto: number }[];

  // ── Por empresa (entregados) ──
  const porEmpresa = (await sql.query(
    `SELECT
       p.empresa,
       COUNT(*) FILTER (WHERE p.estado = 'Entregado')::int AS pedidos,
       COALESCE(SUM(im.monto) FILTER (WHERE p.estado = 'Entregado'), 0)::float8 AS monto
     FROM pedidos p
     ${MONTO_POR_PEDIDO}
     WHERE p.fecha_pedido >= $1::date AND p.fecha_pedido <= $2::date
     GROUP BY p.empresa
     ORDER BY monto DESC`,
    [desde, hasta]
  )) as { empresa: string; pedidos: number; monto: number }[];

  // ── Por distrito (entregados) ──
  const porDistrito = (await sql.query(
    `SELECT
       COALESCE(p.distrito, 'Sin distrito') AS distrito,
       COUNT(*) FILTER (WHERE p.estado = 'Entregado')::int AS pedidos,
       COALESCE(SUM(im.monto) FILTER (WHERE p.estado = 'Entregado'), 0)::float8 AS monto
     FROM pedidos p
     ${MONTO_POR_PEDIDO}
     WHERE p.fecha_pedido >= $1::date AND p.fecha_pedido <= $2::date
     GROUP BY COALESCE(p.distrito, 'Sin distrito')
     ORDER BY monto DESC
     LIMIT 12`,
    [desde, hasta]
  )) as { distrito: string; pedidos: number; monto: number }[];

  // ── Ranking de asesoras (entregados, por monto facturado) ──
  const rankingRaw = (await sql.query(
    `SELECT
       u.id, u.name,
       COUNT(*)::int AS total_pedidos,
       COUNT(*) FILTER (WHERE p.estado = 'Entregado')::int AS entregados,
       COUNT(*) FILTER (WHERE p.estado = 'Fallido')::int AS fallidos,
       COALESCE(SUM(im.monto) FILTER (WHERE p.estado = 'Entregado'), 0)::float8 AS facturado
     FROM pedidos p
     ${MONTO_POR_PEDIDO}
     JOIN users u ON p.asesor_id = u.id
     WHERE p.fecha_pedido >= $1::date AND p.fecha_pedido <= $2::date
       AND (p.origen IS NULL OR p.origen != 'pos_planta')
     GROUP BY u.id, u.name
     ORDER BY facturado DESC, total_pedidos DESC`,
    [desde, hasta]
  )) as {
    id: string;
    name: string;
    total_pedidos: number;
    entregados: number;
    fallidos: number;
    facturado: number;
  }[];

  const ranking = rankingRaw.map((r) => ({
    ...r,
    facturado: Number(r.facturado || 0),
    tasa: r.total_pedidos > 0 ? Math.round((r.entregados / r.total_pedidos) * 100) : 0,
  }));

  return {
    rango: { desde, hasta },
    kpis: {
      total_pedidos: Number(k.total_pedidos || 0),
      entregados,
      pendientes: Number(k.pendientes || 0),
      fallidos: Number(k.fallidos || 0),
      total_facturado: totalFacturado,
      ticket_promedio: entregados > 0 ? totalFacturado / entregados : 0,
    },
    ventasPorDia: ventasPorDia.map((d) => ({
      ...d,
      pedidos: Number(d.pedidos || 0),
      monto: Number(d.monto || 0),
    })),
    topProductos: topProductos.map((p) => ({
      ...p,
      cantidad: Number(p.cantidad || 0),
      monto: Number(p.monto || 0),
    })),
    porEmpresa: porEmpresa.map((e) => ({
      ...e,
      pedidos: Number(e.pedidos || 0),
      monto: Number(e.monto || 0),
    })),
    porDistrito: porDistrito.map((d) => ({
      ...d,
      pedidos: Number(d.pedidos || 0),
      monto: Number(d.monto || 0),
    })),
    ranking,
  };
}

/** Etiqueta legible del período para encabezados y nombres de archivo. */
export function etiquetaPeriodo(desde: string, hasta: string): string {
  const ddmm = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  if (desde === hasta) return ddmm(desde);
  return `${ddmm(desde)} al ${ddmm(hasta)}`;
}
