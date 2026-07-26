-- scripts/migrate-rendimiento-productos.sql
-- Migración idempotente para agregar el porcentaje de rendimiento a los productos
-- Permite despostar cortes indicando qué porcentaje rinde del pollo entero (por defecto 100%)

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS rendimiento_porcentaje NUMERIC(5,2) DEFAULT 100.00;

-- Rollback correspondiente:
-- ALTER TABLE public.productos DROP COLUMN IF EXISTS rendimiento_porcentaje;
