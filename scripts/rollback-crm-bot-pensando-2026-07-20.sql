-- scripts/rollback-crm-bot-pensando-2026-07-20.sql
-- Revierte migrate-crm-bot-pensando-2026-07-20.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-crm-bot-pensando-2026-07-20.sql

ALTER TABLE public.leads DROP COLUMN IF EXISTS bot_pensando_desde;
