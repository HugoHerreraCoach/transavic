-- scripts/migrate-factura-vinculo.sql
-- Vincula opcionalmente cada registro de la tabla `facturas` (cobranzas) con un
-- cliente y/o un comprobante emitido. Permite que la "Cobranza manual"
-- autocomplete del catálogo de clientes y del listado de facturas/boletas ya
-- emitidas — sin romper el flujo actual (ambas columnas son NULL-ables y caen
-- a SET NULL si se borra el referenciado).
--
-- Aplicar (NUNCA con scripts node, gotcha #13 Node 26):
--   psql "$DATABASE_URL" -f scripts/migrate-factura-vinculo.sql
-- TODO LOCAL en la branch dev-hugo. Producción NO se toca.

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS cliente_id UUID NULL REFERENCES clientes(id) ON DELETE SET NULL;

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS comprobante_id UUID NULL REFERENCES comprobantes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_facturas_cliente_id ON facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_comprobante_id ON facturas(comprobante_id);
