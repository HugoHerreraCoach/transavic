-- ================================================
-- Migración: Vincular clientes a asesoras
-- Ejecutar manualmente en la consola de Neon
-- ================================================

-- 1. Agregar columna asesor_id a clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS asesor_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 2. Asignar clientes existentes al primer admin del sistema
-- (Esto es necesario para que los clientes sin asesora no queden huérfanos)
UPDATE clientes 
SET asesor_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) 
WHERE asesor_id IS NULL;

-- 3. Índice para consultas filtradas por asesora (rendimiento)
CREATE INDEX IF NOT EXISTS idx_clientes_asesor_id ON clientes(asesor_id);
