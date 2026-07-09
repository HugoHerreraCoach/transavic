-- scripts/migrate-ventas-avicola-edit-2026-07-09.sql
-- Auditoría de EDICIÓN de ventas de campo (Clientes Avícola): quién y cuándo modificó
-- una venta ya creada. Pedido de Antonio (8-9 jul 2026): en la tarde ajusta peso/precio
-- reales al cobrar, así que la venta de la mañana se puede editar. El PATCH de
-- /api/avicola/ventas/[id] escribe estas columnas.
-- Idempotente y aditivo. Aplicar por psql (gotcha #13); a producción ANTES del deploy (gotcha #17):
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-ventas-avicola-edit-2026-07-09.sql
-- NOTA: en producción estas columnas YA existen (se aplicaron el 9 jul por el .mjs equivalente);
-- esta .sql es la fuente estándar y sirve para poner al día dev-hugo / cualquier entorno.

ALTER TABLE public.ventas_avicola
  ADD COLUMN IF NOT EXISTS modificada_por UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.ventas_avicola
  ADD COLUMN IF NOT EXISTS modificada_at TIMESTAMPTZ;

-- Verificación:
--   \d public.ventas_avicola
