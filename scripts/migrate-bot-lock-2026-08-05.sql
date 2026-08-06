-- scripts/migrate-bot-lock-2026-08-05.sql
-- Turno del bot de WhatsApp: un solo respondedor por lead y "responder al último".
--
-- Problema que resuelve: el cliente escribe en ráfaga ("20 kg" / "para mañana" /
-- "en Surco") y hoy salen TRES llamadas a la IA con tres respuestas encimadas.
-- La idempotencia por wamid (ux_lead_mensajes_wamid) solo cubre el reintento del
-- MISMO mensaje, no mensajes distintos.
--
-- Idempotente y aditivo. psql en dev-hugo primero, y en producción ANTES del
-- deploy del código nuevo (gotchas #13/#17). El flag -1 ya envuelve en transacción.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-bot-lock-2026-08-05.sql

-- Lock de turno. El TTL (70 s) es MAYOR que el maxDuration del webhook (60 s) a
-- propósito: si la invocación muere a mitad, el lock caduca solo y el siguiente
-- mensaje del cliente destraba el lead. Nunca queda colgado para siempre.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_lock_token  UUID;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_lock_expira TIMESTAMPTZ;

-- Contador monótono de mensajes entrantes del cliente. Permite descartar una
-- respuesta que quedó vieja (llegó un mensaje nuevo mientras la IA respondía)
-- sin depender de relojes ni de comparar timestamps de Meta.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_turno_seq   BIGINT NOT NULL DEFAULT 0;

-- Hasta qué turno contestó el bot. `bot_turno_seq > bot_turno_respondido` significa
-- "hay mensajes del cliente sin responder": es lo que impide que se pierda el
-- mensaje que llegó mientras otro turno tenía el lock (el perdedor del lock se va
-- sin hacer nada, así que alguien tiene que reencolar — lo hace el que suelta).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_turno_respondido BIGINT NOT NULL DEFAULT 0;

-- checkAndEscalateLeads() corre en CADA mensaje entrante y escanea `leads`
-- buscando los que están en cola. La condición es muy selectiva (pocos leads en
-- cola a la vez), así que un índice parcial es barato y evita el seq scan.
CREATE INDEX IF NOT EXISTS idx_leads_en_cola
  ON public.leads (inicio_turno)
  WHERE estado_asignacion = 'en_cola';
