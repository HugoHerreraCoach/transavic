-- migrate-ia-insights-cache.sql
-- Caché persistente de los insights del Asistente IA.
--
-- Antes el caché vivía en un Map() in-memory (src/lib/insights.ts) que NO sobrevivía
-- a los cold starts de Vercel ni a los deploys → cada carga de Reportes/Mis Metas
-- disparaba hasta 4 llamadas frescas a Gemini y topaba la cuota gratuita (429).
-- Esta tabla persiste cada insight ≤1 vez/hora por scope (admin-* / asesor-{uuid}-*).
--
-- Idempotente y aditiva. Aplicar con psql (NO con los .mjs — gotcha #13/#17):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-ia-insights-cache.sql
--
-- Sin cron de purga: las claves son acotadas (4 admin + 4 × Nº asesoras) y se
-- upsertean, así que la tabla no crece; expires_at solo controla la frescura.

CREATE TABLE IF NOT EXISTS ia_insights_cache (
  cache_key   VARCHAR(120) PRIMARY KEY,
  value       JSONB NOT NULL,
  expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_insights_cache_expires
  ON ia_insights_cache (expires_at);
