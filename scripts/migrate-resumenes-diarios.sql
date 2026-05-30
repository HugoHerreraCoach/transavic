-- scripts/migrate-resumenes-diarios.sql
-- Equivalente SQL de migrate-resumenes-diarios.mjs (aplicar con psql en Node 26).
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-resumenes-diarios.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS resumenes_diarios (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  empresa VARCHAR(50) NOT NULL,
  ruc VARCHAR(11) NOT NULL,
  fecha_referencia DATE NOT NULL,
  correlativo INTEGER,
  nombre_archivo VARCHAR(120),
  ticket TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'enviando',
  boletas_incluidas INTEGER DEFAULT 0,
  mensaje_sunat TEXT,
  xml_firmado_base64 TEXT,
  cdr_base64 TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resumen_ruc_fecha ON resumenes_diarios (ruc, fecha_referencia);
CREATE INDEX IF NOT EXISTS idx_resumen_ticket ON resumenes_diarios (ticket);
