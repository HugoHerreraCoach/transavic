-- scripts/migrate-crm-idempotencia-wamid-2026-07-20.sql
-- Idempotencia REAL de los mensajes entrantes de WhatsApp por message.id de Meta.
--
-- Antes: el índice de whatsapp_message_id NO era único y el orquestador hacía
-- check-then-act (SELECT y después INSERT), así que dos reintentos concurrentes de
-- Meta pasaban ambos el SELECT y el bot respondía DOS VECES al cliente. Con el
-- índice único parcial, el INSERT ... ON CONFLICT DO NOTHING resuelve la carrera
-- en la base de datos.
--
-- Idempotente y aditivo. Aplicar por psql en dev-hugo primero y en producción
-- ANTES del deploy del código nuevo (gotchas #13/#17).
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-crm-idempotencia-wamid-2026-07-20.sql
-- El flag -1 ya envuelve todo en una transacción (no repetir BEGIN/COMMIT aquí).

-- 1) Saneo previo: si ya hay duplicados por wamid (mensajes que el bug dejó pasar),
--    el índice único no podría crearse. NO se borran filas: se conserva la más
--    antigua con su wamid y a las demás se les pone NULL (el índice es parcial, así
--    que quedan fuera). El mensaje sigue visible en la conversación.
WITH duplicados AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY whatsapp_message_id
           ORDER BY created_at ASC, id ASC
         ) AS fila
  FROM public.lead_mensajes
  WHERE whatsapp_message_id IS NOT NULL
)
UPDATE public.lead_mensajes m
SET whatsapp_message_id = NULL
FROM duplicados d
WHERE m.id = d.id AND d.fila > 1;

-- 2) Índice único parcial: un message.id de Meta se registra una sola vez.
--    Parcial porque los mensajes que no vienen de WhatsApp (creados desde el CRM
--    antes de enviarse) tienen wamid NULL y pueden ser varios.
CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_mensajes_wamid
  ON public.lead_mensajes (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- 3) El índice no único anterior queda redundante (el único ya sirve para las
--    búsquedas por wamid de los statuses del webhook).
DROP INDEX IF EXISTS public.idx_lead_mensajes_wamid;
