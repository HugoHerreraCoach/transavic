-- Usuario "solo lectura" (16 jul 2026).
--
-- Bandera por usuario: quien la tiene puede VER todo lo de su rol pero el middleware
-- rechaza cualquier escritura (POST/PATCH/PUT/DELETE a /api y Server Actions). El
-- observador de Antonio = rol admin + solo_lectura=TRUE (ve todo, no cambia nada).
--
-- Aditiva e idempotente. Aplicar por psql en dev-hugo y luego en produccion ANTES
-- de desplegar el codigo:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/migrate-solo-lectura-usuarios-2026-07-16.sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS solo_lectura BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.solo_lectura IS
  'Si TRUE, el usuario solo puede ver: el middleware bloquea toda escritura. Aplica desde su proximo login.';

-- Verificacion:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='users' AND column_name='solo_lectura';
