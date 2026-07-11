-- Seed: insumos frecuentes que faltaban en el catálogo de Compras (pedido de
-- Nelita, 11 jul 2026): arcos, oferta, mandil. Categoría "Insumos" → se cargan
-- cantidad × precio, sin pesar ni tocar inventario (regla src/lib/compras-lineas.ts).
--
-- Idempotente y aditivo (solo data, sin cambio de esquema). Aplicar por psql:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/seed-insumos-compras-2026-07-11.sql

INSERT INTO productos (nombre, categoria, unidad, activo, codigo)
SELECT 'Arcos', 'Insumos', 'uni', TRUE, 'INS001'
WHERE NOT EXISTS (SELECT 1 FROM productos WHERE nombre ILIKE 'arcos');

INSERT INTO productos (nombre, categoria, unidad, activo, codigo)
SELECT 'Oferta', 'Insumos', 'uni', TRUE, 'INS002'
WHERE NOT EXISTS (SELECT 1 FROM productos WHERE nombre ILIKE 'oferta');

INSERT INTO productos (nombre, categoria, unidad, activo, codigo)
SELECT 'Mandil', 'Insumos', 'uni', TRUE, 'INS003'
WHERE NOT EXISTS (SELECT 1 FROM productos WHERE nombre ILIKE 'mandil');
