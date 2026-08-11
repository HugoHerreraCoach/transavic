-- rollback-eta-honesto.sql
-- Reversa de migrate-eta-honesto.sql (11 ago 2026). Idempotente.
-- OJO: solo aplicar con el código ANTERIOR desplegado (el código nuevo
-- SELECTea estas columnas en /api/repartidor/ubicacion y daría 42703).

ALTER TABLE pedidos DROP COLUMN IF EXISTS eta_factor_ruta;
ALTER TABLE pedidos DROP COLUMN IF EXISTS eta_velocidad_kmh;
