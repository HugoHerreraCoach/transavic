-- scripts/migrate-crm-whatsapp-2026-07-19.sql
-- Cablea el CRM de leads con Meta WhatsApp Cloud API para las DOS marcas.
-- Idempotente y aditivo. Aplicar por psql en dev-hugo primero y en producción
-- ANTES del deploy del código nuevo (gotchas #13/#17).
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-crm-whatsapp-2026-07-19.sql
-- El flag -1 ya envuelve todo en una transacción (no repetir BEGIN/COMMIT aquí).

-- 1) Un mismo cliente puede escribir a las DOS marcas: la unicidad del teléfono
--    pasa de global a compuesta (telefono, empresa). Antes: leads_telefono_key.
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_telefono_key;
DROP INDEX IF EXISTS public.leads_telefono_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_telefono_empresa
  ON public.leads (telefono, empresa);

-- 2) Ventana de servicio de 24h + atribución del anuncio Click-to-WhatsApp (CTWA).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ctwa_clid TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ctwa_source_id TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ctwa_headline TEXT;

-- Backfill de last_inbound_at con el último mensaje entrante de cada lead
-- (solo donde aún es NULL, por lo que es re-ejecutable sin efectos).
UPDATE public.leads l
SET last_inbound_at = sub.max_created
FROM (
  SELECT lead_id, MAX(created_at) AS max_created
  FROM public.lead_mensajes
  WHERE sender = 'cliente'
  GROUP BY lead_id
) sub
WHERE l.id = sub.lead_id AND l.last_inbound_at IS NULL;

-- 3) Mensajes: media (dataURL), id del mensaje de WhatsApp y estado de entrega.
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS estado VARCHAR(20); -- enviado|entregado|leido|fallido
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS error_msg TEXT;

-- Para actualizar el estado por wamid (statuses del webhook) y para idempotencia
-- de mensajes entrantes (no reprocesar reintentos de Meta con el mismo message.id).
CREATE INDEX IF NOT EXISTS idx_lead_mensajes_wamid
  ON public.lead_mensajes (whatsapp_message_id);
