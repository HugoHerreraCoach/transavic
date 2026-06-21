-- scripts/migrate-rider-gps-enforcement.sql
-- GPS obligatorio para repartidores con pedidos activos + detección de "repartidor oscuro".
--
-- Agrega a rider_locations tres columnas para clasificar el estado del GPS reportado
-- por el cliente y poder distinguir un apagado DELIBERADO (revocó el permiso / GPS
-- simulado) de una simple falta de señal (túnel, cobertura):
--   - simulated:             la última posición venía de un "mock provider" (GPS falso).
--   - gps_status:            estado reportado por la app: 'activo' | 'permiso_revocado' | 'mock'.
--   - gps_status_changed_at: cuándo cambió ese estado (para el mapa y el debounce).
--
-- El debounce de las alertas al admin NO vive acá: va en la tabla `settings`
-- (key 'gps_oscuros_alertados', JSON) porque un repartidor que NUNCA abrió la app
-- no tiene fila en rider_locations y aun así hay que controlar el spam de avisos.
--
-- Aditivo e idempotente. Aplicar con psql (gotcha #13/#17), NO con los .mjs:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-rider-gps-enforcement.sql

ALTER TABLE rider_locations ADD COLUMN IF NOT EXISTS simulated             BOOLEAN     DEFAULT FALSE;
ALTER TABLE rider_locations ADD COLUMN IF NOT EXISTS gps_status            VARCHAR(24) DEFAULT 'activo';
ALTER TABLE rider_locations ADD COLUMN IF NOT EXISTS gps_status_changed_at TIMESTAMP WITH TIME ZONE;
