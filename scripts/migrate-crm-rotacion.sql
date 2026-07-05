-- Rotación de leads del CRM: columnas de users + índice.
-- Versión SQL de migrate-crm-rotacion.mjs (los .mjs no corren con Node 26 —
-- gotcha #13 — y PRODUCCIÓN se migra por psql). Idempotente.
--
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-crm-rotacion.sql

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS activo_rotacion BOOLEAN DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS orden_rotacion INT DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS leads_recibidos_hoy INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_rotacion
  ON public.users(role, activo_rotacion, orden_rotacion);
