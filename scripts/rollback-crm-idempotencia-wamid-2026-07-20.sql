-- scripts/rollback-crm-idempotencia-wamid-2026-07-20.sql
-- Revierte migrate-crm-idempotencia-wamid-2026-07-20.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-crm-idempotencia-wamid-2026-07-20.sql
--
-- Nota: el saneo de duplicados (wamid puesto en NULL) NO se revierte — es
-- irrecuperable y además inocuo: esas filas eran copias del mismo mensaje de Meta.

-- Restituye el índice no único que existía antes.
CREATE INDEX IF NOT EXISTS idx_lead_mensajes_wamid
  ON public.lead_mensajes (whatsapp_message_id);

DROP INDEX IF EXISTS public.ux_lead_mensajes_wamid;
