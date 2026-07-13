// Fuente ÚNICA de las ventas generales por fecha para las tres operaciones.
//
// Definición de "venta del día":
// - Ejecutivas: pedido registrado ese día (created_at Lima), no Fallido, monto
//   comercial = cantidad × precio_unitario (misma regla de ventas-metricas.ts).
// - Planta: pedido POS registrado ese día; usa la misma fórmula (en POS el peso y
//   subtotal ya nacen definitivos).
// - Campo: ventas_avicola.fecha del día, no anulada.
//
// Ventas Generales, Consolidado y el comparativo Hoy/Ayer deben consumir este
// helper para no volver a mezclar ventas registradas con entregas programadas.
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export interface ResumenOperacionVenta {
  total: number;
  ventas: number;
}

export interface ResumenVentasGenerales {
  fecha: string;
  operaciones: {
    ejecutivas: ResumenOperacionVenta;
    campo: ResumenOperacionVenta;
    planta: ResumenOperacionVenta;
  };
  total: number;
  totalVentas: number;
}

export async function resumenVentasGeneralesPorFecha(
  sql: Sql,
  fecha: string
): Promise<ResumenVentasGenerales> {
  const [pedidosRows, campoRows] = await Promise.all([
    sql`
      SELECT
        COALESCE(SUM(im.monto) FILTER (
          WHERE COALESCE(p.origen, 'asesor') <> 'pos_planta'
        ), 0)::float8 AS ejecutivas_total,
        COUNT(*) FILTER (
          WHERE COALESCE(p.origen, 'asesor') <> 'pos_planta'
        )::int AS ejecutivas_ventas,
        COALESCE(SUM(im.monto) FILTER (
          WHERE p.origen = 'pos_planta'
        ), 0)::float8 AS planta_total,
        COUNT(*) FILTER (
          WHERE p.origen = 'pos_planta'
        )::int AS planta_ventas
      FROM pedidos p
      LEFT JOIN (
        SELECT pedido_id, SUM(cantidad * precio_unitario) AS monto
        FROM pedido_items
        GROUP BY pedido_id
      ) im ON im.pedido_id = p.id
      WHERE (p.created_at AT TIME ZONE 'America/Lima')::date = ${fecha}::date
        AND p.estado <> 'Fallido'
        AND NOT COALESCE(p.anulada, FALSE)
    ` as unknown as Promise<
      Array<{
        ejecutivas_total: number;
        ejecutivas_ventas: number;
        planta_total: number;
        planta_ventas: number;
      }>
    >,
    sql`
      SELECT
        COALESCE(SUM(total), 0)::float8 AS campo_total,
        COUNT(*)::int AS campo_ventas
      FROM ventas_avicola
      WHERE fecha = ${fecha}::date AND NOT anulada
    ` as unknown as Promise<Array<{ campo_total: number; campo_ventas: number }>>,
  ]);

  const p = pedidosRows[0] ?? {
    ejecutivas_total: 0,
    ejecutivas_ventas: 0,
    planta_total: 0,
    planta_ventas: 0,
  };
  const c = campoRows[0] ?? { campo_total: 0, campo_ventas: 0 };
  const operaciones = {
    ejecutivas: {
      total: Number(p.ejecutivas_total) || 0,
      ventas: Number(p.ejecutivas_ventas) || 0,
    },
    campo: {
      total: Number(c.campo_total) || 0,
      ventas: Number(c.campo_ventas) || 0,
    },
    planta: {
      total: Number(p.planta_total) || 0,
      ventas: Number(p.planta_ventas) || 0,
    },
  };

  return {
    fecha,
    operaciones,
    total:
      operaciones.ejecutivas.total + operaciones.campo.total + operaciones.planta.total,
    totalVentas:
      operaciones.ejecutivas.ventas + operaciones.campo.ventas + operaciones.planta.ventas,
  };
}
