-- scripts/migrate-rider-locations.sql
-- Ubicación EN VIVO del motorizado, para el marker en tiempo real del mapa de despacho.
-- Modelo "1 fila viva por rider" (PRIMARY KEY = repartidor_id → habilita el UPSERT
-- ON CONFLICT). NO guarda histórico (eso se agregaría aparte si se quiere replay de ruta).
-- Convención de tipos: DECIMAL(10,8) lat / DECIMAL(11,8) lng (igual que el resto del repo, §7 CLAUDE.md).
--
-- Idempotente y aditiva. Aplicar con psql (gotcha #13 — los .mjs fallan con Node 26):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-rider-locations.sql

CREATE TABLE IF NOT EXISTS rider_locations (
  repartidor_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude      DECIMAL(10,8) NOT NULL,
  longitude     DECIMAL(11,8) NOT NULL,
  accuracy      NUMERIC(6,2),               -- precisión en metros (opcional)
  heading       NUMERIC(6,2),               -- rumbo 0-360 (opcional)
  speed         NUMERIC(6,2),               -- velocidad m/s (opcional)
  captured_at   TIMESTAMP WITH TIME ZONE NOT NULL, -- cuándo lo midió el GPS del teléfono
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
