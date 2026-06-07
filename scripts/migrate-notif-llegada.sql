-- scripts/migrate-notif-llegada.sql
-- Agrega columnas de control para evitar spam de notificaciones de arribo (5 min y llegada).
--
-- Aplicar con:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-notif-llegada.sql

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS notificado_por_llegar BOOLEAN DEFAULT FALSE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS notificado_llegada BOOLEAN DEFAULT FALSE;
