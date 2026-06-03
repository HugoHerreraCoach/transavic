-- scripts/migrate-cobranza-pago.sql
-- Cobranzas: método de pago + captura del comprobante de pago.
--   metodo_pago     → 'efectivo' | 'transferencia' | 'yape' | 'plin' | 'otro'
--   pago_detalle    → texto libre (sobre todo para 'otro', o nota del pago)
--   pago_img_base64 → captura del pago COMPRIMIDA en el cliente (~50-90KB webp) en base64;
--                     se guarda en DB para no usar storage externo ($0). El endpoint
--                     limita el tamaño para que la base de datos no crezca rápido.
--   pago_img_mime   → tipo MIME de la captura (ej. image/webp, image/jpeg)
--
-- Aditiva, nullable e idempotente. NO toca cobranzas existentes.
-- Aplicar con psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-cobranza-pago.sql

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS metodo_pago     VARCHAR(20);
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pago_detalle    TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pago_img_base64 TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pago_img_mime   VARCHAR(50);
