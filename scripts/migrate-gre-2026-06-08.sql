-- scripts/migrate-gre-2026-06-08.sql
-- Consolidated migrations for GRE 2.0 REST Module and other improvements

-- 1A: comprobantes_guias table and users columns
CREATE TABLE IF NOT EXISTS public.comprobantes_guias (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  ruc_emisor VARCHAR(11) NOT NULL,
  empresa VARCHAR(50) NOT NULL,
  serie VARCHAR(10) NOT NULL,
  numero INTEGER NOT NULL,
  serie_numero VARCHAR(50) NOT NULL,
  cliente_doc_tipo VARCHAR(2) NOT NULL,
  cliente_doc_num VARCHAR(20) NOT NULL,
  cliente_razon_social VARCHAR(255) NOT NULL,
  peso_bruto_total NUMERIC(10, 2) NOT NULL,
  total_bultos INTEGER NOT NULL DEFAULT 1,
  modalidad_traslado VARCHAR(2) NOT NULL DEFAULT '02',
  motivo_traslado VARCHAR(2) NOT NULL DEFAULT '01',
  fecha_inicio_traslado DATE NOT NULL,
  repartidor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  vehiculo_placa VARCHAR(15),
  chofer_doc_tipo VARCHAR(2),
  chofer_doc_num VARCHAR(20),
  chofer_licencia VARCHAR(30),
  estado VARCHAR(50) NOT NULL,
  hash_cpe TEXT,
  xml_firmado_base64 TEXT,
  cdr_base64 TEXT,
  observaciones TEXT,
  mensaje_sunat TEXT,
  emitido_por VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (ruc_emisor, serie, numero)
);

CREATE INDEX IF NOT EXISTS idx_comp_guias_pedido ON public.comprobantes_guias(pedido_id);
CREATE INDEX IF NOT EXISTS idx_comp_guias_estado ON public.comprobantes_guias(estado);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS chofer_dni VARCHAR(15);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS chofer_licencia VARCHAR(30);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS vehiculo_placa VARCHAR(15);

-- 1B: comprobante_id relationship in comprobantes_guias
ALTER TABLE public.comprobantes_guias
  ADD COLUMN IF NOT EXISTS comprobante_id UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_comp_guias_comprobante ON public.comprobantes_guias(comprobante_id);

-- 1C: correlativos table and digital guide columns in pedidos
CREATE TABLE IF NOT EXISTS correlativos (
  tipo VARCHAR(50) PRIMARY KEY,
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO correlativos (tipo) VALUES ('guia_remision') ON CONFLICT (tipo) DO NOTHING;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero_guia INTEGER;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_data TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_mime VARCHAR(50);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero_guia ON pedidos(numero_guia) WHERE numero_guia IS NOT NULL;

-- 1D: chofer_nombres and chofer_apellidos columns in users + backfill
ALTER TABLE users ADD COLUMN IF NOT EXISTS chofer_nombres VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS chofer_apellidos VARCHAR(100);

-- Backfill de chofer_nombres y chofer_apellidos para motorizados existentes (role = 'repartidor')
UPDATE users
SET 
  chofer_nombres = COALESCE(chofer_nombres, 
    CASE 
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) IS NULL THEN ''
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) <= 1 THEN trim(name)
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) = 2 THEN (regexp_split_to_array(trim(name), '\s+'))[1]
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) = 3 THEN (regexp_split_to_array(trim(name), '\s+'))[1]
      ELSE (regexp_split_to_array(trim(name), '\s+'))[1] || ' ' || (regexp_split_to_array(trim(name), '\s+'))[2]
    END
  ),
  chofer_apellidos = COALESCE(chofer_apellidos,
    CASE 
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) IS NULL THEN ''
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) <= 1 THEN '-'
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) = 2 THEN (regexp_split_to_array(trim(name), '\s+'))[2]
      WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) = 3 THEN (regexp_split_to_array(trim(name), '\s+'))[2] || ' ' || (regexp_split_to_array(trim(name), '\s+'))[3]
      ELSE array_to_string((regexp_split_to_array(trim(name), '\s+'))[3:array_length(regexp_split_to_array(trim(name), '\s+'), 1)], ' ')
    END
  )
WHERE role = 'repartidor';
