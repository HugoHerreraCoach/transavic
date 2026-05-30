-- scripts/migrate-comprobante-credito.sql
-- Guarda la forma de pago y la fecha de vencimiento del comprobante para que el
-- PDF pueda armar la sección "INFORMACIÓN DEL CRÉDITO" (forma de pago AL CRÉDITO
-- + cuota con su vencimiento). Antes solo viajaban dentro del XML; no se
-- persistían, así que el PDF siempre mostraba "Contado" y vencimiento vacío.
--
-- Aplicar con psql (gotcha #13: los scripts node + @neondatabase/serverless
-- fallan en Node 26):
--   psql "$DATABASE_URL" -f scripts/migrate-comprobante-credito.sql
-- TODO LOCAL en la branch dev-hugo. Producción NO se toca.

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(10);

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

-- (Sin backfill: los comprobantes ya emitidos quedan con forma_pago NULL → el
--  PDF los trata como "Contado", que es el caso por defecto y el más común.)
