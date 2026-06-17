-- migrate-fecha-emision-comprobante.sql
-- Fecha de emisión seleccionable en comprobantes (boletas/facturas).
--
-- Hasta ahora el comprobante se emitía SIEMPRE con la fecha de hoy y esa fecha se
-- infería de `created_at`. Para permitir emitir con una fecha distinta (hoy o
-- retroactiva dentro del plazo SUNAT: factura 3 días, boleta 7 días), guardamos la
-- fecha de emisión REAL del XML en una columna propia.
--
-- Idempotente y aditiva. Aplicar con psql (NO con los .mjs — gotcha #13/#17):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-fecha-emision-comprobante.sql
-- Aplicar a producción ANTES de que el deploy del código nuevo quede activo.

ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS fecha_emision DATE;

-- Backfill: la fecha de emisión "real" hoy se infiere de created_at en zona Lima
-- (mismo criterio que [id]/route.ts) → ningún comprobante histórico cambia de fecha visible.
UPDATE comprobantes
SET fecha_emision = (created_at AT TIME ZONE 'America/Lima')::date
WHERE fecha_emision IS NULL;

CREATE INDEX IF NOT EXISTS idx_comprobantes_fecha_emision ON comprobantes(fecha_emision);
