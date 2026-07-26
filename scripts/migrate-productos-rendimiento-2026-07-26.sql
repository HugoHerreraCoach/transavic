-- Migración: Agregar columna rendimiento_porcentaje a la tabla productos
-- Idempotente y aditivo

ALTER TABLE public.productos 
ADD COLUMN IF NOT EXISTS rendimiento_porcentaje DECIMAL(5,2) DEFAULT 100.00;
