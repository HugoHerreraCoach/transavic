-- Pre-clasificación del RUBRO de los clientes existentes por palabras clave en el nombre /
-- razón social. Heurística de "mejor esfuerzo": lo que no calce queda en NULL (Sin clasificar)
-- y la asesora lo corrige. Solo toca filas con `rubro IS NULL` → re-ejecutable sin pisar
-- correcciones manuales. Escribe EXACTAMENTE los strings de la lista RUBROS del front
-- (clientes-client.tsx) para que el filtro agrupe bien.
--
-- Orden de prioridad: lo más específico primero (chifa antes que restaurante; market/bodega
-- antes que el catch-all). Recomendado correr el dry-run (SELECT con el mismo CASE) antes.
--
-- Aplicar por psql tras migrate-cliente-rubro.sql:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/backfill-rubro.sql

UPDATE clientes
SET rubro = CASE
  WHEN t LIKE '%chifa%'
    THEN 'Chifa'
  WHEN t LIKE '%cafe%' OR t LIKE '%café%' OR t LIKE '%coffee%' OR t LIKE '%cafeter%'
    THEN 'Cafetería'
  WHEN t LIKE '%avicola%' OR t LIKE '%avícola%' OR t LIKE '%granja%'
    THEN 'Avícola'
  WHEN t LIKE '%burger%' OR t LIKE '%broaster%' OR t LIKE '%broster%' OR t LIKE '%sangu%'
       OR t LIKE '%salchipap%' OR t LIKE '%hot dog%' OR t LIKE '%hotdog%' OR t LIKE '%pizza%'
       OR t LIKE '%fast food%' OR t LIKE '%fastfood%'
    THEN 'Fast food'
  WHEN t LIKE '%minimarket%' OR t LIKE '%mini market%' OR t LIKE '%minimark%' OR t LIKE '%market%'
       OR t LIKE '%mercad%' OR t LIKE '%tambo%' OR t LIKE '%supermerc%'
    THEN 'Market / Minimarket'
  WHEN t LIKE '%bodega%' OR t LIKE '%abarrote%'
    THEN 'Tienda / Bodega'
  WHEN t LIKE '%restaurant%' OR t LIKE '%resto%' OR t LIKE '%cevich%' OR t LIKE '%cebich%'
       OR t LIKE '%marisqu%' OR t LIKE '%polleria%' OR t LIKE '%pollería%' OR t LIKE '%parrilla%'
       OR t LIKE '%grill%' OR t LIKE '%menú%' OR t LIKE '% menu%' OR t LIKE '%comida%'
       OR t LIKE '%cocina%' OR t LIKE '%snack%' OR t LIKE '%juguer%'
    THEN 'Restaurante'
  ELSE NULL
END
FROM (
  SELECT id, lower(coalesce(nombre, '') || ' ' || coalesce(razon_social, '')) AS t
  FROM clientes
) AS src
WHERE clientes.id = src.id
  AND clientes.rubro IS NULL;
