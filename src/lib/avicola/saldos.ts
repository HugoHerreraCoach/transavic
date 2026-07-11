// src/lib/avicola/saldos.ts
// ÚNICA fuente de la aritmética del saldo del módulo Clientes Avícola:
//   saldo_actual = saldo_anterior + Σ ventas (NOT anulada) − Σ abonos (NOT anulado)
// El saldo se calcula AL VUELO (no se persiste): con decenas de clientes y pocos
// movimientos/día los SUM con índice (cliente_id, fecha) son sub-milisegundo, y
// persistirlo crearía 4 caminos de sincronización (crear/anular venta y abono)
// — pura superficie de bugs (ver gotchas #1/#36 del proyecto).
// ⚠️ Neon devuelve NUMERIC como string → todo monto se castea ::float8 en SQL.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type {
  ClienteAvicolaConSaldo,
  EstadoCuentaGuia,
} from "@/lib/avicola/types";

type Sql = NeonQueryFunction<false, false>;

/** Umbral para considerar que un cliente "tiene deuda" (evita ruido de céntimos). */
export const UMBRAL_DEUDA = 0.01;

/**
 * Lista de clientes con su estado de cuenta calculado.
 * Los filtros (búsqueda, mercado, activo, con deuda) se aplican en el caller
 * sobre el resultado — el volumen es de decenas de filas.
 */
export async function listaClientesConSaldo(
  sql: Sql
): Promise<ClienteAvicolaConSaldo[]> {
  const rows = (await sql`
    SELECT
      c.id, c.nombre, c.mercado, c.numero_puesto, c.telefono, c.direccion,
      c.observaciones, c.empresa, c.activo,
      c.saldo_anterior::float8 AS saldo_anterior,
      c.created_at::text AS created_at,
      c.updated_at::text AS updated_at,
      COALESCE(v.total_vendido, 0)::float8 AS total_vendido,
      COALESCE(a.total_abonado, 0)::float8 AS total_abonado,
      (c.saldo_anterior + COALESCE(v.total_vendido, 0) - COALESCE(a.total_abonado, 0))::float8 AS saldo_actual,
      v.ultima_compra::text AS ultima_compra,
      a.ultimo_pago::text AS ultimo_pago
    FROM clientes_avicola c
    LEFT JOIN (
      SELECT cliente_id, SUM(total) AS total_vendido, MAX(fecha) AS ultima_compra
      FROM ventas_avicola WHERE NOT anulada GROUP BY cliente_id
    ) v ON v.cliente_id = c.id
    LEFT JOIN (
      SELECT cliente_id, SUM(monto) AS total_abonado, MAX(fecha) AS ultimo_pago
      FROM abonos_avicola WHERE NOT anulado GROUP BY cliente_id
    ) a ON a.cliente_id = c.id
    ORDER BY c.mercado ASC, c.nombre ASC
  `) as ClienteAvicolaConSaldo[];
  return rows;
}

/** Estado de cuenta de UN cliente (misma aritmética que la lista). */
export async function estadoCuentaCliente(
  sql: Sql,
  clienteId: string
): Promise<ClienteAvicolaConSaldo | null> {
  const rows = (await sql`
    SELECT
      c.id, c.nombre, c.mercado, c.numero_puesto, c.telefono, c.direccion,
      c.observaciones, c.empresa, c.activo,
      c.saldo_anterior::float8 AS saldo_anterior,
      c.created_at::text AS created_at,
      c.updated_at::text AS updated_at,
      COALESCE(v.total_vendido, 0)::float8 AS total_vendido,
      COALESCE(a.total_abonado, 0)::float8 AS total_abonado,
      (c.saldo_anterior + COALESCE(v.total_vendido, 0) - COALESCE(a.total_abonado, 0))::float8 AS saldo_actual,
      v.ultima_compra::text AS ultima_compra,
      a.ultimo_pago::text AS ultimo_pago
    FROM clientes_avicola c
    LEFT JOIN (
      SELECT cliente_id, SUM(total) AS total_vendido, MAX(fecha) AS ultima_compra
      FROM ventas_avicola WHERE NOT anulada AND cliente_id = ${clienteId} GROUP BY cliente_id
    ) v ON v.cliente_id = c.id
    LEFT JOIN (
      SELECT cliente_id, SUM(monto) AS total_abonado, MAX(fecha) AS ultimo_pago
      FROM abonos_avicola WHERE NOT anulado AND cliente_id = ${clienteId} GROUP BY cliente_id
    ) a ON a.cliente_id = c.id
    WHERE c.id = ${clienteId}
  `) as ClienteAvicolaConSaldo[];
  return rows[0] ?? null;
}

/**
 * Estado de cuenta para la GUÍA de una venta (req. §9), ANCLADO por `created_at`:
 *   saldo_previo      = saldo_anterior + ventas − abonos con created_at ANTERIOR a la venta
 *   abonos_aplicados  = abonos hechos DESPUÉS de esta venta y ANTES de la siguiente
 *                       venta (no anulada) del cliente — SIN filtrar por fecha
 *   saldo_actualizado = saldo_previo + total − abonos_aplicados
 *
 * La ventana es puramente por `created_at`: `saldo_previo` toma lo anterior a la
 * venta y `abonos_aplicados` lo posterior hasta la próxima venta — se parten sin
 * solaparse ni duplicar. Antes se restringía `abonos` a `fecha = v.fecha`, y un
 * abono hecho un día POSTERIOR a la venta caía en un hueco (ni previo ni del día)
 * → la guía de esa venta mostraba el saldo sin ese pago (bug del caso Vicki,
 * 11 jul 2026). Con la cota "hasta la siguiente venta", la guía de la ÚLTIMA venta
 * refleja el saldo real actual (== estadoCuentaCliente) y las guías de ventas
 * viejas encadenan coherentes. Solo cambia si hubo anulaciones (corregir la
 * realidad es correcto).
 */
export async function estadoCuentaParaGuia(
  sql: Sql,
  ventaId: string
): Promise<EstadoCuentaGuia | null> {
  const rows = (await sql`
    SELECT
      (
        c.saldo_anterior
        + COALESCE((
            SELECT SUM(total) FROM ventas_avicola
            WHERE cliente_id = v.cliente_id AND NOT anulada AND created_at < v.created_at
          ), 0)
        - COALESCE((
            SELECT SUM(monto) FROM abonos_avicola
            WHERE cliente_id = v.cliente_id AND NOT anulado AND created_at < v.created_at
          ), 0)
      )::float8 AS saldo_previo,
      v.total::float8 AS total_venta,
      COALESCE((
        SELECT SUM(monto) FROM abonos_avicola a
        WHERE a.cliente_id = v.cliente_id AND NOT a.anulado
          AND a.created_at >= v.created_at
          AND a.created_at < COALESCE((
            SELECT MIN(v2.created_at) FROM ventas_avicola v2
            WHERE v2.cliente_id = v.cliente_id AND NOT v2.anulada
              AND v2.created_at > v.created_at
          ), 'infinity'::timestamptz)
      ), 0)::float8 AS abonos_aplicados
    FROM ventas_avicola v
    JOIN clientes_avicola c ON c.id = v.cliente_id
    WHERE v.id = ${ventaId}
  `) as Array<{
    saldo_previo: number;
    total_venta: number;
    abonos_aplicados: number;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    saldo_previo: r.saldo_previo,
    total_venta: r.total_venta,
    abonos_aplicados: r.abonos_aplicados,
    saldo_actualizado: r.saldo_previo + r.total_venta - r.abonos_aplicados,
  };
}
