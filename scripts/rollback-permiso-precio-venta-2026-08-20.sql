-- Rollback de migrate-permiso-precio-venta-2026-08-20.sql.
--
-- Quita la bandera puede_editar_precio_venta. Seguro: la columna es aditiva y
-- nada mas depende de ella (el admin edita precios por su rol, no por esto).
--
-- Solo hace falta si se abandona la funcionalidad: para revertir un deploy basta
-- con volver atras el codigo, la columna queda inerte.
--
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/rollback-permiso-precio-venta-2026-08-20.sql

ALTER TABLE public.users DROP COLUMN IF EXISTS puede_editar_precio_venta;
