-- scripts/migrate-rider-locations-accuracy.sql
-- Amplía rider_locations.accuracy de NUMERIC(6,2) a NUMERIC(10,2).
--
-- Motivo: `accuracy` es el radio de confianza del GPS en METROS. En fixes degradados
-- (arranque en frío, interiores, "urban canyon", posicionamiento por celda/WiFi) Android
-- reporta habitualmente miles o decenas de miles de metros. NUMERIC(6,2) solo admite
-- hasta 9999.99 → un valor ≥10000 lanzaba `numeric field overflow` (Postgres 22003),
-- el INSERT entero fallaba (500) y se PERDÍA ese reporte de ubicación, justo cuando la
-- señal está peor. NUMERIC(10,2) cubre cualquier lectura real (hasta ~99,999 km).
--
-- (El endpoint además recorta `accuracy` por las dudas — defensa en profundidad.)
-- Aplicar con psql (gotcha #13). Es seguro re-aplicar (ALTER TYPE idempotente en la práctica).
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-rider-locations-accuracy.sql

ALTER TABLE rider_locations ALTER COLUMN accuracy TYPE NUMERIC(10,2);
