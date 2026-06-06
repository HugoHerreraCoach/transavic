-- migrate-ventas-facturadas-view.sql
-- Vista `ventas_facturadas`: una fila por comprobante de VENTA, con la asesora
-- efectiva, la fecha de emisión y el monto neto. Es la fuente ÚNICA para medir
-- el desempeño de las asesoras (metas día/semana/mes, racha, ranking, equipo).
--
-- Por qué una vista: la lógica de atribución + el signo de las Notas de Crédito
-- vivía repartida; acá queda en UN solo lugar y las queries de lib/metas.ts e
-- lib/incentivos.ts se vuelven triviales. Como es una vista (se evalúa al vuelo)
-- y /api/metas + /api/incentivos son force-dynamic (sin caché), cualquier cambio
-- —emitir una NC, trasladar el comprobante a otra asesora (reescribir
-- emitido_por), vincularlo a un pedido— se refleja al instante en la siguiente
-- carga, sin trabajo extra.
--
-- Reglas (alineadas con el reporte Excel contable, reporte-excel-comprobantes.ts):
--   * Solo cuentan facturas (01) y boletas (03); las Notas de Crédito (07) RESTAN.
--   * Solo estados 'aceptado'/'observado' (rechazado/error/pendiente NO cuentan).
--   * Monto CON IGV (monto_total) — es lo que cobra la asesora; los precios en
--     Transavic ya incluyen IGV.
--   * Atribución (decisión de Antonio, jun 2026): primero quien EMITIÓ
--     (emitido_por, match por nombre TRIM+lower — gotcha #11), luego la dueña del
--     pedido vinculado; una NC sin señal propia hereda de la asesora del
--     comprobante que referencia.
--   * Fecha = created_at del comprobante (zona Lima) = cuándo se emitió. La NC
--     resta en SU período de emisión.
--
-- Aditiva e idempotente (CREATE OR REPLACE VIEW). NO toca datos ni columnas.
-- Aplicar con psql (gotcha #13 — los .mjs fallan con Node 26):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-ventas-facturadas-view.sql

CREATE OR REPLACE VIEW ventas_facturadas AS
SELECT
  c.id   AS comprobante_id,
  c.tipo,                                                      -- '01' | '03' | '07'
  c.empresa,
  (c.created_at AT TIME ZONE 'America/Lima')::date AS fecha,   -- fecha de emisión
  -- Asesora efectiva: emisor → dueña del pedido → (para NC) asesora del
  -- comprobante referenciado (su emisor, luego su pedido).
  COALESCE(ue.id, p.asesor_id, uref.id, pref.asesor_id) AS asesora_id,
  -- Monto neto con IGV: la NC (07) resta.
  CASE WHEN c.tipo = '07' THEN -c.monto_total ELSE c.monto_total END AS monto_neto,
  -- Para CONTAR ventas (criterio "pedidos"/número): la NC no es una venta.
  CASE WHEN c.tipo = '07' THEN 0 ELSE 1 END AS es_venta
FROM comprobantes c
LEFT JOIN pedidos p   ON c.pedido_id = p.id
LEFT JOIN users   ue  ON ue.role = 'asesor'
                     AND LOWER(TRIM(ue.name)) = LOWER(TRIM(c.emitido_por))
LEFT JOIN comprobantes cref ON c.referencia_comprobante_id = cref.id   -- solo NC
LEFT JOIN pedidos pref ON cref.pedido_id = pref.id
LEFT JOIN users   uref ON uref.role = 'asesor'
                     AND LOWER(TRIM(uref.name)) = LOWER(TRIM(cref.emitido_por))
WHERE c.tipo IN ('01', '03', '07')
  AND c.estado IN ('aceptado', 'observado');
