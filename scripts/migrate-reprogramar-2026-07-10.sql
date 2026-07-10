-- Migración: reprogramación de pedidos (pedido de Antonio/Ariana, video 9 jul 2026)
-- Un pedido que no se pudo entregar se REPROGRAMA a otra fecha (normalmente mañana)
-- o se marca "se enviará más tarde" (mismo día). Estas columnas dejan la huella
-- visible para producción y asesoras (badge en Lista de Pedidos y Producción).
--
-- Idempotente y aditiva: el código viejo la ignora (aplicar por psql ANTES del deploy).
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-reprogramar-2026-07-10.sql

-- Fecha de entrega ANTERIOR (NULL cuando la marca fue "se envía más tarde" sin cambio de fecha)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS reprogramado_de DATE;

-- Cuándo se reprogramó / marcó (también funciona de flag: NULL = nunca reprogramado)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS reprogramado_at TIMESTAMPTZ;

-- Motivo opcional que escribe quien reprograma (ej. "cliente no estaba")
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS reprogramado_motivo TEXT;
