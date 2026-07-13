-- scripts/rollback-pos-anular-2026-07-13.sql
-- Revierte migrate-pos-anular-2026-07-13.sql.
-- OJO: si ya hay ventas anuladas, quitar estas columnas pierde ese estado (las ventas
-- volverían a contar). Revertir solo si no se anuló ninguna venta aún.
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/rollback-pos-anular-2026-07-13.sql

DROP INDEX IF EXISTS idx_pedidos_anulada;
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_anulada_motivo_chk;
ALTER TABLE public.pedidos
  DROP COLUMN IF EXISTS anulada,
  DROP COLUMN IF EXISTS anulada_at,
  DROP COLUMN IF EXISTS anulacion_motivo,
  DROP COLUMN IF EXISTS anulada_por;
