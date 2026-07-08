// src/lib/avicola/historial.ts
// Historial de movimientos (ventas + abonos) de un cliente del módulo
// "Clientes Avícola". Los ANULADOS se incluyen MARCADOS (anulado=true) por
// transparencia — no suman en saldos (eso lo garantiza saldos.ts), pero el
// caller decide cómo pintarlos.
// ⚠️ Neon devuelve NUMERIC como string → todo monto se castea ::float8 en SQL.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { MovimientoAvicola, VentaAvicolaItem } from "@/lib/avicola/types";

type Sql = NeonQueryFunction<false, false>;

/**
 * Movimientos del cliente (ventas + abonos intercalados) ORDER BY created_at DESC.
 * Cada venta incluye sus items (peso y precio usados — req. §6);
 * tiene_comprobante = foto adjunta (solo aplica a abonos, false en ventas).
 */
export async function historialCliente(
  sql: Sql,
  clienteId: string
): Promise<MovimientoAvicola[]> {
  // El UNION va en subquery para que el ORDER BY use el timestamptz REAL
  // (ordenar por el ::text sería lexicográfico y frágil con fracciones de segundo).
  const movimientos = (await sql`
    SELECT
      m.tipo, m.id, m.fecha, m.created_at::text AS created_at, m.monto,
      m.numero_guia, m.medio_pago, m.observaciones, m.anulado,
      m.anulacion_motivo, m.tiene_comprobante
    FROM (
      SELECT
        'venta' AS tipo,
        v.id,
        v.fecha::text AS fecha,
        v.created_at,
        v.total::float8 AS monto,
        v.numero_guia,
        NULL::varchar AS medio_pago,
        v.observaciones,
        v.anulada AS anulado,
        v.anulacion_motivo,
        FALSE AS tiene_comprobante
      FROM ventas_avicola v
      WHERE v.cliente_id = ${clienteId}
      UNION ALL
      SELECT
        'abono' AS tipo,
        a.id,
        a.fecha::text AS fecha,
        a.created_at,
        a.monto::float8 AS monto,
        NULL::integer AS numero_guia,
        a.medio_pago,
        a.observaciones,
        a.anulado,
        a.anulacion_motivo,
        (a.comprobante_data IS NOT NULL) AS tiene_comprobante
      FROM abonos_avicola a
      WHERE a.cliente_id = ${clienteId}
    ) m
    ORDER BY m.created_at DESC
  `) as MovimientoAvicola[];

  // Items de las ventas (segunda query + agrupado en TS — volumen: decenas).
  const ventaIds = movimientos.filter((m) => m.tipo === "venta").map((m) => m.id);
  if (ventaIds.length > 0) {
    const items = (await sql`
      SELECT
        id,
        venta_id,
        producto_id,
        producto_nombre,
        peso_kg::float8 AS peso_kg,
        precio_kg::float8 AS precio_kg,
        subtotal::float8 AS subtotal
      FROM venta_avicola_items
      WHERE venta_id = ANY(${ventaIds})
      ORDER BY created_at ASC
    `) as VentaAvicolaItem[];

    const porVenta = new Map<string, VentaAvicolaItem[]>();
    for (const item of items) {
      const lista = porVenta.get(item.venta_id);
      if (lista) lista.push(item);
      else porVenta.set(item.venta_id, [item]);
    }
    for (const mov of movimientos) {
      if (mov.tipo === "venta") mov.items = porVenta.get(mov.id) ?? [];
    }
  }

  return movimientos;
}
