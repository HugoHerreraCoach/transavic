-- migrate-eta-honesto.sql
-- Calibración por-viaje del ETA del reparto (11 ago 2026).
--
-- Contexto: las alertas "por llegar"/"en destino" salían con ~1 min de
-- diferencia porque el ETA se estimaba con 3 min/km EN LÍNEA RECTA. Ahora
-- `iniciar-viaje` persiste la calibración del Google Directions inicial
-- (factor de ruta + velocidad efectiva) y cada ping GPS la reutiliza.
--
-- NULL = viaje viejo o sin Directions → el código usa defaults (1.3 / 18 km/h).
-- Idempotente y aditiva. Aplicar ANTES del deploy (el SELECT del ping las lee):
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-eta-honesto.sql

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS eta_factor_ruta   NUMERIC(4,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS eta_velocidad_kmh NUMERIC(5,2);

COMMENT ON COLUMN pedidos.eta_factor_ruta   IS 'Calibración del viaje: distancia de ruta Google / línea recta (clamp 1.1-2.2 en código). NULL = usar default.';
COMMENT ON COLUMN pedidos.eta_velocidad_kmh IS 'Calibración del viaje: velocidad efectiva sobre ruta según Google Directions (clamp 8-45 en código). NULL = usar default.';
