-- scripts/migrate-pos-anular-2026-07-13.sql
-- Anular (eliminar) una venta del POS de planta: reversa dinero + inventario y marca
-- el pedido como anulado. Pedido de Ariana (13 jul 2026) — antes no se podía eliminar
-- una venta del POS. Los campos van en `pedidos` (nullable, aditivos): hoy solo los usa
-- el POS, pero la columna es compartida y una venta anulada NO debe contar para nadie.
--
-- Idempotente y aditivo. Aplicar por psql (gotcha #13) — a producción ANTES del deploy
-- del código nuevo (gotcha #17):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-pos-anular-2026-07-13.sql

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS anulada          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anulada_at       TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS anulacion_motivo TEXT,
  ADD COLUMN IF NOT EXISTS anulada_por      UUID REFERENCES public.users(id);

-- Coherencia: si está anulada, debe tener motivo (misma disciplina que ventas_avicola).
-- Se agrega NOT VALID + VALIDATE para no fallar si hubiera filas raras (no las hay: default FALSE).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_anulada_motivo_chk'
  ) THEN
    ALTER TABLE public.pedidos
      ADD CONSTRAINT pedidos_anulada_motivo_chk
      CHECK (NOT anulada OR anulacion_motivo IS NOT NULL) NOT VALID;
    ALTER TABLE public.pedidos VALIDATE CONSTRAINT pedidos_anulada_motivo_chk;
  END IF;
END $$;

-- Índice parcial: las consultas de ventas/reportes filtran las anuladas.
CREATE INDEX IF NOT EXISTS idx_pedidos_anulada
  ON public.pedidos (anulada)
  WHERE anulada;

-- Verificación:
--   \d public.pedidos   (ver anulada, anulada_at, anulacion_motivo, anulada_por)
