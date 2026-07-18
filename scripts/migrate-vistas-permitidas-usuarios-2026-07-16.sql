-- Vistas por usuario (16 jul 2026) — Fase 2 de roles flexibles.
--
-- Lista opcional de secciones que un usuario puede ver/abrir. NULL = sin restricción
-- (usa los defaults de su rol). Solo NARROWA dentro del rol; nunca amplía. Controla
-- visibilidad (sidebar + acceso a paginas), el scope de DATOS lo sigue dando el rol.
--
-- Aditiva e idempotente. Aplicar por psql en dev-hugo y luego produccion ANTES de
-- desplegar el codigo:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/migrate-vistas-permitidas-usuarios-2026-07-16.sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS vistas_permitidas TEXT[] DEFAULT NULL;

COMMENT ON COLUMN public.users.vistas_permitidas IS
  'Lista de hrefs de seccion que el usuario puede ver/abrir. NULL = sin restriccion (defaults del rol). Aplica desde su proximo login.';

-- Verificacion:
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='users' AND column_name='vistas_permitidas';
