-- Rollback de migrate-vistas-permitidas-usuarios-2026-07-16.sql.
-- Quita la columna. Seguro: aditiva sin dependencias.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/rollback-vistas-permitidas-usuarios-2026-07-16.sql

ALTER TABLE public.users DROP COLUMN IF EXISTS vistas_permitidas;
