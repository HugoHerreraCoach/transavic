-- migrate-comprobante-items.sql
-- Agrega `comprobantes.items_json` (JSONB): guarda las LÍNEAS emitidas de cada
-- comprobante (descripción, unidad, cantidad, precio unitario, código,
-- afectación IGV) en el momento de emitir.
--
-- POR QUÉ: las facturas/boletas "standalone" (sin pedido) no guardan sus ítems
-- en ninguna tabla. Si una de esas quedaba en error/rechazado y se REINTENTABA,
-- el endpoint reconstruía el XML con una línea genérica ("Venta a <cliente>", 1
-- UNIDAD) → re-emitía un documento equivocado. Con items_json, el reintento
-- reconstruye con los ítems REALES. (El reintento igual prioriza reenviar el
-- xml_firmado_base64 original cuando existe; items_json es la red de seguridad
-- para el caso sin XML.)
--
-- Aditivo, idempotente. Aplicar con psql (Node 26 rompe los .mjs — gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-comprobante-items.sql

ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS items_json JSONB;
