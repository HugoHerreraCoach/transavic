-- scripts/rollback-crm-whatsapp-2026-07-19.sql
-- Revierte migrate-crm-whatsapp-2026-07-19.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-crm-whatsapp-2026-07-19.sql
-- NOTA: restaurar el UNIQUE global de telefono FALLARÁ si ya existen dos leads con
-- el mismo teléfono en marcas distintas (creados tras la migración). En ese caso,
-- resolver los duplicados antes de revertir, o dejar el índice compuesto.
-- El flag -1 ya envuelve todo en una transacción (no repetir BEGIN/COMMIT aquí).

DROP INDEX IF EXISTS public.idx_lead_mensajes_wamid;
ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS error_msg;
ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS estado;
ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS whatsapp_message_id;
ALTER TABLE public.lead_mensajes DROP COLUMN IF EXISTS media_url;

ALTER TABLE public.leads DROP COLUMN IF EXISTS ctwa_headline;
ALTER TABLE public.leads DROP COLUMN IF EXISTS ctwa_source_id;
ALTER TABLE public.leads DROP COLUMN IF EXISTS ctwa_clid;
ALTER TABLE public.leads DROP COLUMN IF EXISTS last_inbound_at;

DROP INDEX IF EXISTS public.ux_leads_telefono_empresa;
ALTER TABLE public.leads ADD CONSTRAINT leads_telefono_key UNIQUE (telefono);
