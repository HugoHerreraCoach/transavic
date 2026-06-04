-- migrate-cobranza-anular.sql
-- Cobranzas (facturas): SOFT-ANULAR.
--
-- Una cobranza creada por error, o cuya factura/boleta se anuló con Nota de
-- Crédito, deja de ser deuda — pero NO se borra: pasa a estado 'Anulada' y
-- guardamos quién la anuló, cuándo y por qué (auditoría, igual que el sistema
-- ya hace con comprobantes y con las ediciones de pedido).
--
-- Aditiva e idempotente. `facturas.estado` ya es VARCHAR(20) sin CHECK
-- constraint → el valor 'Anulada' NO requiere cambiar el tipo de la columna.
--
-- Aplicar con psql (gotcha #13 — los .mjs fallan con Node 26):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-cobranza-anular.sql

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS anulada_at     TIMESTAMPTZ NULL;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS anulada_por    TEXT NULL;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS anulada_motivo TEXT NULL;
