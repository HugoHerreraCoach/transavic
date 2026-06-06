-- scripts/migrate-autorizaciones-precio.sql
-- Tabla para gestionar solicitudes de autorización cuando una asesora quiere
-- emitir un comprobante con un precio menor al mínimo del catálogo.
-- Aditiva e idempotente (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS autorizaciones_precio (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asesora_id       TEXT NOT NULL,
  asesora_nombre   TEXT NOT NULL,
  tipo             TEXT NOT NULL,     -- '01' factura | '03' boleta
  empresa          TEXT NOT NULL,     -- 'transavic' | 'avicola'
  items_json       JSONB NOT NULL,    -- [{nombre, precio_solicitado, precio_minimo, cantidad}]
  razon            TEXT,              -- motivo opcional de la asesora
  estado           TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | aprobada | rechazada
  razon_rechazo    TEXT,
  aprobada_por     TEXT,              -- name del admin que resolvió
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_at      TIMESTAMPTZ,
  usada_at         TIMESTAMPTZ        -- cuando se usó para emitir (marca como usada)
);

CREATE INDEX IF NOT EXISTS idx_autorizaciones_asesora ON autorizaciones_precio (asesora_id);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_estado  ON autorizaciones_precio (estado);
CREATE INDEX IF NOT EXISTS idx_autorizaciones_created ON autorizaciones_precio (created_at DESC);
