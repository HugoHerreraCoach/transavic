// Fuente ÚNICA de las ventas generales por fecha para las tres operaciones.
//
// Definición de "venta del día":
// - Ejecutivas: pedido registrado ese día (`created_at` Lima), de origen asesor,
//   no fallido/anulado. El importe solo se confirma cuando TODOS sus ítems tienen
//   `subtotal_real`; mientras Producción no termine de pesar, el pedido se muestra
//   como "Por pesar" y no aporta un monto parcial o estimado.
// - Planta: pedido POS registrado ese día; su subtotal nace definitivo.
// - Campo: venta de `ventas_avicola.fecha`, no anulada.
//
// Facturas y comprobantes NO participan en este cálculo. La consulta agrupa los
// ítems por `pedido_id` antes de resumir, por lo que un pedido cuenta una sola vez.
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export interface ResumenOperacionVenta {
  total: number;
  ventas: number;
  ventasValorizadas: number;
  ventasPorValorizar: number;
}

export interface DetalleVentaEjecutiva {
  id: string;
  cliente: string;
  asesor: string;
  createdAt: string;
  fechaEntrega: string;
  estadoPedido: string;
  numeroGuia: string | null;
  monto: number | null;
  estadoValoracion: "confirmada" | "por_valorizar";
  itemsPendientes: number;
}

export interface ResumenVentasGenerales {
  fecha: string;
  operaciones: {
    ejecutivas: ResumenOperacionVenta;
    campo: ResumenOperacionVenta;
    planta: ResumenOperacionVenta;
  };
  detalleEjecutivas: DetalleVentaEjecutiva[];
  total: number;
  totalVentas: number;
}

type NumeroSql = number | string | null | undefined;

interface ResumenSqlRow {
  operaciones?: Partial<
    Record<
      "ejecutivas" | "campo" | "planta",
      {
        total?: NumeroSql;
        ventas?: NumeroSql;
        ventasValorizadas?: NumeroSql;
        ventasPorValorizar?: NumeroSql;
      }
    >
  >;
  detalle_ejecutivas?: Array<{
    id?: unknown;
    cliente?: unknown;
    asesor?: unknown;
    createdAt?: unknown;
    fechaEntrega?: unknown;
    estadoPedido?: unknown;
    numeroGuia?: unknown;
    monto?: NumeroSql;
    estadoValoracion?: unknown;
    itemsPendientes?: NumeroSql;
  }>;
  total?: NumeroSql;
  total_ventas?: NumeroSql;
}

function numero(valor: NumeroSql): number {
  const resultado = Number(valor ?? 0);
  return Number.isFinite(resultado) ? resultado : 0;
}

type OperacionSql = NonNullable<ResumenSqlRow["operaciones"]>["ejecutivas"];

function operacion(valor: OperacionSql | undefined): ResumenOperacionVenta {
  return {
    total: numero(valor?.total),
    ventas: numero(valor?.ventas),
    ventasValorizadas: numero(valor?.ventasValorizadas),
    ventasPorValorizar: numero(valor?.ventasPorValorizar),
  };
}

export async function resumenVentasGeneralesPorFecha(
  sql: Sql,
  fecha: string
): Promise<ResumenVentasGenerales> {
  const rows = (await sql`
    WITH items_por_pedido AS (
      SELECT
        pi.pedido_id,
        COUNT(pi.id)::int AS total_items,
        COUNT(pi.id) FILTER (WHERE pi.subtotal_real IS NULL)::int AS items_pendientes,
        COALESCE(SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0)), 0)::numeric(14, 2)
          AS monto_planta,
        CASE
          WHEN COUNT(pi.id) > 0
           AND COUNT(pi.subtotal_real) = COUNT(pi.id)
          THEN SUM(pi.subtotal_real)::numeric(14, 2)
          ELSE NULL
        END AS monto_confirmado
      FROM pedido_items pi
      GROUP BY pi.pedido_id
    ),
    pedidos_dia AS (
      SELECT
        p.id,
        p.cliente,
        COALESCE(NULLIF(BTRIM(u.name), ''), 'Sin ejecutiva') AS asesor,
        p.created_at,
        p.fecha_pedido,
        p.estado,
        p.numero_guia,
        CASE
          WHEN COALESCE(p.origen, 'asesor') = 'asesor' THEN 'ejecutivas'
          WHEN p.origen = 'pos_planta' THEN 'planta'
        END AS canal,
        COALESCE(ip.total_items, 0)::int AS total_items,
        COALESCE(ip.items_pendientes, 0)::int AS items_pendientes,
        (
          COALESCE(ip.total_items, 0) > 0
          AND COALESCE(ip.items_pendientes, 0) = 0
        ) AS valorizado,
        ip.monto_confirmado,
        COALESCE(ip.monto_planta, 0)::numeric(14, 2) AS monto_planta
      FROM pedidos p
      LEFT JOIN items_por_pedido ip ON ip.pedido_id = p.id
      LEFT JOIN users u ON u.id = p.asesor_id
      WHERE (p.created_at AT TIME ZONE 'America/Lima')::date = ${fecha}::date
        AND p.estado <> 'Fallido'
        AND NOT COALESCE(p.anulada, FALSE)
        AND COALESCE(p.origen, 'asesor') IN ('asesor', 'pos_planta')
    ),
    resumen_pedidos AS (
      SELECT
        canal,
        CASE
          WHEN canal = 'ejecutivas'
            THEN COALESCE(SUM(monto_confirmado) FILTER (WHERE valorizado), 0)
          ELSE COALESCE(SUM(monto_planta), 0)
        END::numeric(14, 2) AS total,
        COUNT(*)::int AS ventas,
        CASE
          WHEN canal = 'ejecutivas' THEN COUNT(*) FILTER (WHERE valorizado)
          ELSE COUNT(*)
        END::int AS ventas_valorizadas,
        CASE
          WHEN canal = 'ejecutivas' THEN COUNT(*) FILTER (WHERE NOT valorizado)
          ELSE 0
        END::int AS ventas_por_valorizar
      FROM pedidos_dia
      GROUP BY canal
    ),
    resumen_campo AS (
      SELECT
        'campo'::text AS canal,
        COALESCE(SUM(total), 0)::numeric(14, 2) AS total,
        COUNT(*)::int AS ventas,
        COUNT(*)::int AS ventas_valorizadas,
        0::int AS ventas_por_valorizar
      FROM ventas_avicola
      WHERE fecha = ${fecha}::date
        AND NOT anulada
    ),
    resumen_base AS (
      SELECT * FROM resumen_pedidos WHERE canal IS NOT NULL
      UNION ALL
      SELECT * FROM resumen_campo
    ),
    canales(canal) AS (
      VALUES ('ejecutivas'::text), ('campo'::text), ('planta'::text)
    ),
    operaciones AS (
      SELECT
        c.canal,
        COALESCE(r.total, 0)::numeric(14, 2) AS total,
        COALESCE(r.ventas, 0)::int AS ventas,
        COALESCE(r.ventas_valorizadas, 0)::int AS ventas_valorizadas,
        COALESCE(r.ventas_por_valorizar, 0)::int AS ventas_por_valorizar
      FROM canales c
      LEFT JOIN resumen_base r ON r.canal = c.canal
    )
    SELECT
      (
        SELECT jsonb_object_agg(
          canal,
          jsonb_build_object(
            'total', total,
            'ventas', ventas,
            'ventasValorizadas', ventas_valorizadas,
            'ventasPorValorizar', ventas_por_valorizar
          )
        )
        FROM operaciones
      ) AS operaciones,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pd.id,
            'cliente', pd.cliente,
            'asesor', pd.asesor,
            'createdAt', TO_CHAR(
              pd.created_at AT TIME ZONE 'America/Lima',
              'YYYY-MM-DD HH24:MI'
            ),
            'fechaEntrega', pd.fecha_pedido::text,
            'estadoPedido', pd.estado,
            'numeroGuia', pd.numero_guia,
            'monto', CASE WHEN pd.valorizado THEN pd.monto_confirmado ELSE NULL END,
            'estadoValoracion', CASE
              WHEN pd.valorizado THEN 'confirmada'
              ELSE 'por_valorizar'
            END,
            'itemsPendientes', pd.items_pendientes
          )
          ORDER BY pd.created_at DESC, pd.id
        )
        FROM pedidos_dia pd
        WHERE pd.canal = 'ejecutivas'
      ), '[]'::jsonb) AS detalle_ejecutivas,
      (SELECT COALESCE(SUM(total), 0)::numeric(14, 2) FROM operaciones) AS total,
      (SELECT COALESCE(SUM(ventas), 0)::int FROM operaciones) AS total_ventas
  `) as unknown as ResumenSqlRow[];

  const row = rows[0] ?? {};
  const operacionesSql = row.operaciones ?? {};
  const operaciones = {
    ejecutivas: operacion(operacionesSql.ejecutivas),
    campo: operacion(operacionesSql.campo),
    planta: operacion(operacionesSql.planta),
  };
  const detalleEjecutivas: DetalleVentaEjecutiva[] = (
    Array.isArray(row.detalle_ejecutivas) ? row.detalle_ejecutivas : []
  ).map((detalle) => ({
    id: String(detalle.id ?? ""),
    cliente: String(detalle.cliente ?? "Sin cliente"),
    asesor: String(detalle.asesor ?? "Sin ejecutiva"),
    createdAt: String(detalle.createdAt ?? ""),
    fechaEntrega: String(detalle.fechaEntrega ?? ""),
    estadoPedido: String(detalle.estadoPedido ?? ""),
    numeroGuia:
      detalle.numeroGuia === null || detalle.numeroGuia === undefined
        ? null
        : String(detalle.numeroGuia),
    monto:
      detalle.monto === null || detalle.monto === undefined
        ? null
        : numero(detalle.monto),
    estadoValoracion:
      detalle.estadoValoracion === "confirmada" ? "confirmada" : "por_valorizar",
    itemsPendientes: numero(detalle.itemsPendientes),
  }));

  return {
    fecha,
    operaciones,
    detalleEjecutivas,
    total: numero(row.total),
    totalVentas: numero(row.total_ventas),
  };
}
