-- Revierte migrate-pos-costo-snapshot-2026-07-13.sql.
-- ADVERTENCIA: elimina los costos históricos ya capturados por el POS.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-pos-costo-snapshot-2026-07-13.sql

ALTER TABLE public.pedido_items
  DROP CONSTRAINT IF EXISTS pedido_items_costo_snapshot_no_negativo_chk;

ALTER TABLE public.pedido_items
  DROP COLUMN IF EXISTS costo_unitario_snapshot;
