-- scripts/migrate-comprobante-referencia.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Vincula una Nota de Crédito (07) con el comprobante (factura/boleta) que modifica.
--
-- Antes, la relación NC→original solo vivía (a) dentro del XML firmado de la NC
-- (cac:DiscrepancyResponse + BillingReference) y (b) como texto libre en
-- `comprobantes.observaciones` del comprobante original ("Nota de crédito FC01-X…").
-- Ninguna de las dos es consultable de forma confiable desde la UI.
--
-- Esta columna la hace explícita y permite:
--   (a) mostrar en la lista "esta NC anula a F001-5" con enlace clicable, y
--   (b) que la asesora dueña del comprobante original vea TAMBIÉN su NC
--       (el GET /api/comprobantes la incluye vía esta referencia, SIN tocar
--        pedido_id — así la NC no ensucia el badge "Facturado" del pedido ni los
--        chequeos de "pedido ya facturado").
--
-- Idempotente y aditivo. Aplicar con psql (gotcha #13 — los .mjs fallan en Node 26):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-comprobante-referencia.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS referencia_comprobante_id UUID
  REFERENCES comprobantes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comp_referencia
  ON comprobantes(referencia_comprobante_id);
