-- scripts/migrate-pedido-ediciones.sql
-- Historial de ediciones / correcciones de un pedido (auditoría).
-- Cada fila = una edición; la columna `cambios` (JSONB) guarda el detalle
-- de cada campo modificado: [{ campo, etiqueta, antes, despues }].
-- El admin lo consulta desde /dashboard (botón "Ver historial").
--
-- Idempotente y aditiva. Aplicar con psql (gotcha #13 — los .mjs fallan con
-- Node 26 + @neondatabase/serverless):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-pedido-ediciones.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS pedido_ediciones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  usuario_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  usuario_nombre  TEXT NOT NULL,
  usuario_rol     TEXT,
  cambios         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Para listar rápido el historial de un pedido, del más reciente al más antiguo.
CREATE INDEX IF NOT EXISTS idx_pedido_ediciones_pedido
  ON pedido_ediciones (pedido_id, created_at DESC);
