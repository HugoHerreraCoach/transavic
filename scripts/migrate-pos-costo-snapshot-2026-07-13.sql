-- Snapshot del costo de compra para cada ítem vendido desde el POS de Planta.
--
-- El costo se captura desde productos.precio_compra al registrar la venta y queda
-- congelado: cambiar el catálogo después no altera el margen histórico. Las ventas
-- anteriores quedan en NULL porque no existe evidencia confiable del costo vigente
-- en el momento de su registro.
--
-- Idempotente y aditivo. Aplicar por psql antes de desplegar el código:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-pos-costo-snapshot-2026-07-13.sql

ALTER TABLE public.pedido_items
  ADD COLUMN IF NOT EXISTS costo_unitario_snapshot NUMERIC(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pedido_items_costo_snapshot_no_negativo_chk'
  ) THEN
    ALTER TABLE public.pedido_items
      ADD CONSTRAINT pedido_items_costo_snapshot_no_negativo_chk
      CHECK (costo_unitario_snapshot IS NULL OR costo_unitario_snapshot >= 0)
      NOT VALID;
    ALTER TABLE public.pedido_items
      VALIDATE CONSTRAINT pedido_items_costo_snapshot_no_negativo_chk;
  END IF;
END $$;

COMMENT ON COLUMN public.pedido_items.costo_unitario_snapshot IS
  'Costo unitario de compra capturado al registrar la venta POS; NULL si no estaba disponible.';

-- Verificación:
--   SELECT column_name, data_type, numeric_precision, numeric_scale
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'pedido_items'
--     AND column_name = 'costo_unitario_snapshot';
