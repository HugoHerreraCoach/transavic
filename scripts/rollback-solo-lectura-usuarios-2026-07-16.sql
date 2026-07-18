-- Rollback de migrate-solo-lectura-usuarios-2026-07-16.sql.
-- Quita la bandera solo_lectura. Seguro: es una columna aditiva sin dependencias.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/rollback-solo-lectura-usuarios-2026-07-16.sql

ALTER TABLE public.users DROP COLUMN IF EXISTS solo_lectura;
