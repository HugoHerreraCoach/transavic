-- Comunicados internos: el admin envía mensajes con texto e imágenes
-- a usuarios seleccionados. Los destinatarios ven un popup la próxima vez
-- que abren el dashboard y lo marcan como "Leído". El admin puede ver
-- quién lo leyó y a qué hora.
--
-- Aplicar con:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-comunicados.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla principal de comunicados
CREATE TABLE IF NOT EXISTS comunicados (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo        TEXT NOT NULL,
  cuerpo        TEXT NOT NULL DEFAULT '',
  creado_por    TEXT NOT NULL,
  -- Array de UUID strings de los usuarios destinatarios
  destinatarios JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comunicados_created
  ON comunicados(created_at DESC);

-- Imágenes adjuntas al comunicado (base64, igual que pago_imagenes)
CREATE TABLE IF NOT EXISTS comunicado_imagenes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comunicado_id   UUID REFERENCES comunicados(id) ON DELETE CASCADE,
  imagen_base64   TEXT NOT NULL,
  imagen_mime     VARCHAR(50) NOT NULL DEFAULT 'image/webp',
  orden           SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_com_imagenes_orden
  ON comunicado_imagenes(comunicado_id, orden);

-- Registro de quién leyó cada comunicado y cuándo
CREATE TABLE IF NOT EXISTS comunicado_lecturas (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comunicado_id  UUID REFERENCES comunicados(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  leido_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comunicado_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_com_lecturas_user
  ON comunicado_lecturas(user_id, comunicado_id);
