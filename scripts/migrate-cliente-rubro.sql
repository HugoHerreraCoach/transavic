-- Migración: columna `rubro` (giro / tipo de negocio del cliente) en la tabla clientes.
--
-- NO confundir con `tipo_cliente` (que guarda 'Frecuente' / 'Nuevo', un estado de relación
-- denormalizado a pedidos). `rubro` es el GIRO del negocio para clasificar el directorio:
-- Restaurante, Cafetería, Avícola, Chifa, Fast food, Market / Minimarket, Tienda / Bodega,
-- Casa / Hogar, Otro. NULL = "Sin clasificar".
--
-- Aditiva e idempotente. Aplicar por psql (gotcha #13 — los .mjs fallan con Node 26):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-cliente-rubro.sql
-- Aplicar a producción ANTES de que el deploy con el código nuevo quede activo (gotcha #17).

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS rubro TEXT;

-- Índice para los conteos por rubro (GROUP BY rubro) y el filtro de la lista.
CREATE INDEX IF NOT EXISTS idx_clientes_rubro ON clientes(rubro);
