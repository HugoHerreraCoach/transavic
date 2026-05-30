-- migrate-codigo-producto.sql
-- Agrega un CÓDIGO INTERNO estable por producto (SellersItemIdentification de SUNAT).
-- Formato: prefijo por categoría + correlativo de 3 dígitos (POL001, CAR001, HUE001…).
-- SUNAT no lo exige (cardinalidad 0..1) pero es buena práctica para identificar
-- cada producto de forma estable en facturas/boletas.
-- Aplicar con: psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-codigo-producto.sql
--   (Node 26 + @neondatabase/serverless falla en scripts; usar psql — gotcha §12.13)

ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo VARCHAR(30);

-- Generar código solo para los productos que aún no lo tienen.
WITH numerados AS (
  SELECT
    id,
    CASE categoria
      WHEN 'Pollo' THEN 'POL'
      WHEN 'Carnes' THEN 'CAR'
      WHEN 'Huevos' THEN 'HUE'
      ELSE 'PRD'
    END AS prefijo,
    ROW_NUMBER() OVER (
      PARTITION BY categoria ORDER BY nombre, id
    ) AS n
  FROM productos
)
UPDATE productos p
SET codigo = num.prefijo || LPAD(num.n::text, 3, '0')
FROM numerados num
WHERE p.id = num.id AND (p.codigo IS NULL OR p.codigo = '');

-- Verificación
SELECT categoria, codigo, nombre FROM productos ORDER BY categoria, codigo LIMIT 12;
