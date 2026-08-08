// src/lib/planta/historial.ts
// Historial de un cliente de planta: sus COMPRAS (contado y crédito) y sus ABONOS
// intercalados cronológicamente. Espejo de src/lib/avicola/historial.ts.
//
// Los movimientos ANULADOS se incluyen MARCADOS (no se filtran): la ficha los
// muestra tachados, que es la forma de auditar qué se dio de baja y por qué.
//
// ⚠️ Dos diferencias con campo que NO se pueden copiar tal cual:
//   1. La venta de planta vive en `pedidos` (origen='pos_planta'), no en una
//      tabla propia; el vínculo con el cliente es `pedidos.cliente_planta_id`.
//   2. El abono cuelga de la COBRANZA (`abonos_planta.cobranza_id`), no del
//      cliente — hay que pasar por `cobranzas_planta` para llegar a él.
//
// ⚠️ Neon devuelve NUMERIC como string → todo monto se castea ::float8.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { ItemMovimientoPlanta, MovimientoPlanta } from "@/lib/planta/types";

type Sql = NeonQueryFunction<false, false>;

/**
 * Movimientos del cliente, del más reciente al más antiguo.
 * Devuelve [] si el cliente no tiene ninguno.
 */
export async function historialClientePlanta(
  sql: Sql,
  clienteId: string
): Promise<MovimientoPlanta[]> {
  // El UNION va DENTRO de una subquery para que el ORDER BY use el timestamptz
  // real: ordenar por el ::text sería lexicográfico y frágil con fracciones de
  // segundo (mismo criterio que avicola/historial.ts).
  const movimientos = (await sql`
    SELECT
      m.tipo, m.id, m.fecha, m.created_at::text AS created_at, m.monto,
      m.tipo_pago, m.medio_pago, m.observaciones, m.anulado,
      m.anulacion_motivo, m.tiene_comprobante, m.comprobante_serie_numero,
      m.creado_por_nombre
    FROM (
      SELECT
        'venta' AS tipo,
        p.id,
        p.fecha_pedido::text AS fecha,
        p.created_at,
        COALESCE(pi.total, 0)::float8 AS monto,
        -- Contado vs crédito se DERIVA de tener cobranza viva, igual que en
        -- GET /api/pos/ventas: así una cobranza anulada no se lee como contado.
        CASE WHEN co.id IS NOT NULL THEN 'Credito' ELSE 'Contado' END AS tipo_pago,
        NULL::varchar AS medio_pago,
        p.notas AS observaciones,
        COALESCE(p.anulada, FALSE) AS anulado,
        p.anulacion_motivo,
        FALSE AS tiene_comprobante,
        cp.serie_numero AS comprobante_serie_numero,
        p.entregado_por AS creado_por_nombre
      FROM pedidos p
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(i.subtotal_real, i.subtotal, 0)) AS total
        FROM pedido_items i
        WHERE i.pedido_id = p.id
      ) pi ON TRUE
      LEFT JOIN LATERAL (
        SELECT c2.id
        FROM cobranzas_planta c2
        WHERE c2.pedido_id = p.id AND NOT c2.anulada
        LIMIT 1
      ) co ON TRUE
      -- Mismo criterio de "comprobante vivo" que GET /api/pos/ventas: solo
      -- factura/boleta (01/03) y solo en estados que cuentan como emitido.
      LEFT JOIN LATERAL (
        SELECT c3.serie_numero
        FROM comprobantes c3
        WHERE c3.pedido_id = p.id
          AND c3.tipo IN ('01', '03')
          AND c3.estado IN ('aceptado', 'observado', 'pendiente')
        ORDER BY c3.created_at DESC
        LIMIT 1
      ) cp ON TRUE
      WHERE p.origen = 'pos_planta'
        AND p.cliente_planta_id = ${clienteId}
      UNION ALL
      SELECT
        'abono' AS tipo,
        a.id,
        a.fecha::text AS fecha,
        a.created_at,
        a.monto::float8 AS monto,
        NULL::text AS tipo_pago,
        a.medio_pago,
        a.observaciones,
        a.anulado,
        a.anulacion_motivo,
        (a.comprobante_data IS NOT NULL) AS tiene_comprobante,
        NULL::text AS comprobante_serie_numero,
        ua.name AS creado_por_nombre
      FROM abonos_planta a
      JOIN cobranzas_planta c4 ON c4.id = a.cobranza_id
      LEFT JOIN users ua ON ua.id = a.creado_por
      WHERE c4.cliente_planta_id = ${clienteId}
        AND NOT c4.anulada
    ) m
    ORDER BY m.created_at DESC
  `) as MovimientoPlanta[];

  // Ítems en una segunda query + agrupado en TS (volumen: decenas por cliente).
  const ventaIds = movimientos.filter((m) => m.tipo === "venta").map((m) => m.id);
  if (ventaIds.length > 0) {
    const items = (await sql`
      SELECT
        pedido_id,
        producto_nombre,
        COALESCE(cantidad_real, cantidad)::float8            AS cantidad,
        unidad,
        COALESCE(precio_unitario, 0)::float8                 AS precio_unitario,
        COALESCE(subtotal_real, subtotal, 0)::float8         AS subtotal
      FROM pedido_items
      WHERE pedido_id = ANY(${ventaIds})
      ORDER BY created_at ASC, producto_nombre ASC
    `) as ItemMovimientoPlanta[];

    const porVenta = new Map<string, ItemMovimientoPlanta[]>();
    for (const item of items) {
      const lista = porVenta.get(item.pedido_id);
      if (lista) lista.push(item);
      else porVenta.set(item.pedido_id, [item]);
    }
    for (const mov of movimientos) {
      if (mov.tipo === "venta") mov.items = porVenta.get(mov.id) ?? [];
    }
  }

  return movimientos;
}
