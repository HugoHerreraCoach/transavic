-- migrate-unidad-pedido.sql
-- Separa la unidad DEL PEDIDO (lo que pidió el cliente, fija) de la unidad de
-- VENTA (`unidad`, que Producción puede cambiar al pesar — ej. uni→kg para cobrar
-- por peso). El RESUMEN usa `unidad_pedido`; la boleta/GRE siguen usando `unidad`.
--
-- Idempotente y aditivo. Aplicar por psql (gotcha #13/#17), a dev y a PROD ANTES
-- del deploy del código nuevo:
--   psql "$DATABASE_URL" -f scripts/migrate-unidad-pedido.sql

ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS unidad_pedido VARCHAR(50);

-- Backfill: para los existentes, la unidad del pedido = la unidad actual.
-- (Correcto para todo ítem no pesado o cuyo `unidad` no fue cambiado por Producción.
--  Los pocos ya pesados con unidad cambiada — ej. chuletas uni→kg — se corrigen
--  con un UPDATE puntual recuperando la unidad del texto del detalle.)
UPDATE pedido_items SET unidad_pedido = unidad WHERE unidad_pedido IS NULL;
