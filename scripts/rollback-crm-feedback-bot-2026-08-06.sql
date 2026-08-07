-- scripts/rollback-crm-feedback-bot-2026-08-06.sql
-- Revierte migrate-crm-feedback-bot-2026-08-06.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-crm-feedback-bot-2026-08-06.sql
--
-- ⚠️ A DIFERENCIA de otros rollbacks, este BORRA DATOS: se pierden todas las
-- calificaciones que las asesoras ya hicieron sobre las respuestas del bot, que
-- son justamente lo que sirve para mejorar el prompt. Antes de correrlo conviene
-- guardarlas:
--   \copy (SELECT id, feedback, feedback_motivo, feedback_user_id, feedback_at
--          FROM public.lead_mensajes WHERE feedback IS NOT NULL)
--     TO 'feedback-bot.csv' CSV HEADER
--
-- Solo tiene sentido con el código VIEJO desplegado: el chat nuevo lee estas
-- columnas y sin ellas el GET de mensajes devuelve 42703.

DROP INDEX IF EXISTS public.idx_lead_mensajes_feedback;

ALTER TABLE public.lead_mensajes DROP CONSTRAINT IF EXISTS ck_lead_mensajes_feedback;

ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS feedback_at;
ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS feedback_user_id;
ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS feedback_motivo;
ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS feedback;
