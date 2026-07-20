-- scripts/migrate-crm-bot-pensando-2026-07-20.sql
-- Feedback en vivo del bot para la asesora: marca cuándo el bot está generando
-- una respuesta, para mostrar "El bot está escribiendo…" en el CRM y evitar que
-- la asesora conteste encima del bot (duplicando mensajes al cliente).
--
-- Idempotente y aditivo. psql en dev-hugo primero, y en producción ANTES del
-- deploy del código nuevo (gotchas #13/#17). El flag -1 ya envuelve en transacción.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-crm-bot-pensando-2026-07-20.sql

-- NULL = el bot no está trabajando en este lead.
-- Con valor = está generando respuesta desde ese instante.
-- La UI solo pinta la burbuja si el valor es RECIENTE (< 60 s), de modo que un
-- flag colgado por un crash no deje la burbuja encendida para siempre.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_pensando_desde TIMESTAMPTZ;
