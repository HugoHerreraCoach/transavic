-- scripts/rollback-bot-lock-2026-08-05.sql
-- Revierte migrate-bot-lock-2026-08-05.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-bot-lock-2026-08-05.sql
--
-- ⚠️ Solo tiene sentido con el código VIEJO desplegado: el orquestador nuevo lee
-- estas tres columnas en cada mensaje entrante y sin ellas devuelve 42703.

DROP INDEX IF EXISTS public.idx_leads_en_cola;

ALTER TABLE public.leads DROP COLUMN IF EXISTS bot_turno_respondido;
ALTER TABLE public.leads DROP COLUMN IF EXISTS bot_turno_seq;
ALTER TABLE public.leads DROP COLUMN IF EXISTS bot_lock_expira;
ALTER TABLE public.leads DROP COLUMN IF EXISTS bot_lock_token;
