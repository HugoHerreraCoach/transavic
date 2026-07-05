-- Siembra inventario_lotes en 0 para todos los productos ACTIVOS que aún no
-- tienen fila, para que la vista Inventario muestre el catálogo completo desde
-- el primer día (y no una lista vacía hasta la primera compra). Idempotente:
-- ON CONFLICT DO NOTHING no pisa saldos existentes.
--
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-seed-inventario-cero.sql

INSERT INTO public.inventario_lotes (producto_id, cantidad)
SELECT id, 0 FROM public.productos WHERE activo = TRUE
ON CONFLICT (producto_id) DO NOTHING;
