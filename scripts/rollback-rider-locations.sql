-- scripts/rollback-rider-locations.sql
-- Revierte migrate-rider-locations.sql. La tabla solo guarda la ÚLTIMA posición
-- (sin histórico), así que dropearla no pierde data de negocio.
DROP TABLE IF EXISTS rider_locations;
