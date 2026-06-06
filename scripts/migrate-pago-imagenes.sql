-- scripts/migrate-pago-imagenes.sql
-- Múltiples capturas de pago por cobranza.
-- Antes: las capturas vivían como un solo base64 en facturas.pago_img_base64.
-- Ahora: cada captura es una fila en pago_imagenes, identificada por UUID estable
--        → permite subir varias imágenes y borrar individuales sin afectar las demás.
--
-- Las columnas viejas (pago_img_base64 / pago_img_mime) se dejan para compatibilidad
-- hacia atrás; el código ya no las escribe, pero el endpoint pago-imagen las lee
-- como fallback si pago_imagenes está vacía para ese registro.
--
-- Aditiva e idempotente. Migra las imágenes existentes automáticamente.
-- Aplicar con psql (gotcha #13/#17):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-pago-imagenes.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS pago_imagenes (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id  uuid        NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  imagen_base64 TEXT      NOT NULL,
  imagen_mime   VARCHAR(50) NOT NULL DEFAULT 'image/webp',
  orden       SMALLINT    NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pago_imagenes_factura_id_idx ON pago_imagenes(factura_id);

-- Migrar imágenes existentes de facturas.pago_img_base64 → pago_imagenes (orden=1).
-- ON CONFLICT DO NOTHING protege si se corre dos veces.
INSERT INTO pago_imagenes (factura_id, imagen_base64, imagen_mime, orden)
SELECT
  id,
  pago_img_base64,
  COALESCE(pago_img_mime, 'image/webp'),
  1
FROM facturas
WHERE pago_img_base64 IS NOT NULL
ON CONFLICT DO NOTHING;
