-- scripts/migrate-crm-feedback-bot-2026-08-06.sql
-- Calificación 👍/👎 de cada respuesta del bot de ventas.
--
-- Problema que resuelve: hoy no hay forma de saber QUÉ respuestas del bot
-- estuvieron mal. El único rastro es que la asesora escribe encima y el chatbot
-- se apaga solo (api/crm/leads/[id]/mensajes/route.ts) — una corrección tácita
-- que no queda registrada en ningún lado. Sin datos, cada ajuste del prompt es
-- una opinión. Esto convierte esa corrección en un dato consultable.
--
-- Idempotente y aditivo. psql en dev-hugo primero, y en producción ANTES del
-- deploy del código nuevo (gotchas #13/#17). El flag -1 ya envuelve en transacción.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-crm-feedback-bot-2026-08-06.sql

-- Veredicto. SMALLINT y no texto a propósito: son 3 estados (NULL = sin calificar,
-- 1 = 👍, -1 = 👎) imposibles de tipear mal, y AVG(feedback) da la salud del bot
-- sin un solo CASE.
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS feedback SMALLINT;

-- Motivo OPCIONAL del 👎. Se guarda el SLUG, no la etiqueta que ve la asesora:
-- reescribir el texto del chip no obliga a migrar las filas históricas. La lista
-- viva está en src/lib/crm/feedback-bot.ts (fuente única).
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS feedback_motivo VARCHAR(24);

-- Quién calificó. Hace falta el id real: `sender` guarda el NOMBRE del usuario
-- (texto libre), así que no sirve para saber quién opinó.
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS feedback_user_id UUID
  REFERENCES public.users(id) ON DELETE SET NULL;

-- Cuándo se calificó. NO es created_at del mensaje: se puede calificar algo de
-- hace una semana, y el análisis se filtra por cuándo se OPINÓ.
ALTER TABLE public.lead_mensajes ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ;

-- Coherencia de los 4 campos. Sin esto entra basura del tipo "motivo sin voto" o
-- "👍 con motivo", que en un GROUP BY miente. Postgres no tiene
-- ADD CONSTRAINT IF NOT EXISTS: de ahí el bloque DO.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_lead_mensajes_feedback') THEN
    ALTER TABLE public.lead_mensajes ADD CONSTRAINT ck_lead_mensajes_feedback CHECK (
      (feedback IS NULL AND feedback_motivo IS NULL AND feedback_at IS NULL AND feedback_user_id IS NULL)
      OR (
        feedback IN (-1, 1)
        AND feedback_at IS NOT NULL
        AND (feedback_motivo IS NULL OR feedback = -1)
        AND (feedback_motivo IS NULL OR feedback_motivo IN
             ('invento_dato', 'precio_malo', 'no_entendio', 'muy_largo', 'tono_raro'))
      )
    );
  END IF;
END $$;

-- La vista de análisis lee SOLO las filas calificadas (una fracción mínima del
-- total de mensajes) ordenadas por fecha de calificación. Índice PARCIAL: pesa
-- casi nada y evita el seq scan sobre toda la tabla de mensajes. Los filtros de
-- veredicto/motivo/marca se resuelven encima de ese conjunto ya diminuto.
CREATE INDEX IF NOT EXISTS idx_lead_mensajes_feedback
  ON public.lead_mensajes (feedback_at DESC)
  WHERE feedback IS NOT NULL;
