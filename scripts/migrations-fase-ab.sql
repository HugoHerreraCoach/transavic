-- ═══════════════════════════════════════════════════════════════════════
-- Migraciones Fase A + Fase B — Transavic
-- ═══════════════════════════════════════════════════════════════════════
-- Generado: 2026-05-17
-- Aplicación: psql -f scripts/migrations-fase-ab.sql
--
-- Todas las operaciones son IDEMPOTENTES (IF NOT EXISTS / ON CONFLICT DO
-- NOTHING). Re-ejecutarlas no rompe nada.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- Asegurar extensión uuid-ossp (necesaria para uuid_generate_v4())
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════
-- FASE A.1 — Precios de productos + histórico
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_compra NUMERIC(10, 2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_venta NUMERIC(10, 2);

CREATE TABLE IF NOT EXISTS precios_productos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
  precio_compra NUMERIC(10, 2),
  precio_venta NUMERIC(10, 2) NOT NULL,
  vigente_desde DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  vigente_hasta DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_precios_vigentes
  ON precios_productos(producto_id, vigente_desde DESC)
  WHERE vigente_hasta IS NULL;

ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10, 2);
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10, 2);

-- ═══════════════════════════════════════════════════════════════════════
-- FASE A.2 — Cantidad real + tracking de quién pesó
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS cantidad_real NUMERIC(10, 2);
ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS subtotal_real NUMERIC(10, 2);

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pesado_por UUID REFERENCES users(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pesado_at TIMESTAMP WITH TIME ZONE;

-- ═══════════════════════════════════════════════════════════════════════
-- FASE A.4 — Correlativos de guía + foto firmada
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS correlativos (
  tipo VARCHAR(50) PRIMARY KEY,
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO correlativos (tipo) VALUES ('guia_remision')
  ON CONFLICT (tipo) DO NOTHING;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero_guia INTEGER;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_data TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_mime VARCHAR(50);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero_guia
  ON pedidos(numero_guia) WHERE numero_guia IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- FASE B.1 — Metas mensuales por asesora (overrides manuales)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS metas_asesoras (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  asesor_id UUID REFERENCES users(id) ON DELETE CASCADE,
  mes DATE NOT NULL,
  monto_meta NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(asesor_id, mes)
);

CREATE INDEX IF NOT EXISTS idx_metas_asesor_mes ON metas_asesoras(asesor_id, mes);

-- ═══════════════════════════════════════════════════════════════════════
-- FASE B.2 — Notificaciones in-app
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  link TEXT,
  pedido_id UUID,
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread
  ON notificaciones(user_id, leida, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- FASE B.3 — Cobranzas (plazo de pago + facturas)
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS facturas (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  cliente_id UUID,
  cliente_nombre VARCHAR(255) NOT NULL,
  asesor_id UUID REFERENCES users(id),
  monto NUMERIC(12, 2) NOT NULL,
  plazo_dias INTEGER NOT NULL DEFAULT 0,
  fecha_emision DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  fecha_vencimiento DATE NOT NULL,
  fecha_pago DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  numero_comprobante VARCHAR(50),
  notas TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_vencimiento
  ON facturas(fecha_vencimiento) WHERE fecha_pago IS NULL;
CREATE INDEX IF NOT EXISTS idx_facturas_asesor ON facturas(asesor_id, estado);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id);

-- ═══════════════════════════════════════════════════════════════════════
-- FASE B.4 — Comprobantes SUNAT + correlativos atómicos
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comprobantes_contador (
  ruc VARCHAR(11) NOT NULL,
  serie VARCHAR(10) NOT NULL,
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (ruc, serie)
);

CREATE TABLE IF NOT EXISTS comprobantes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  ruc_emisor VARCHAR(11) NOT NULL,
  empresa VARCHAR(50) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  serie VARCHAR(10) NOT NULL,
  numero INTEGER NOT NULL,
  serie_numero VARCHAR(50) NOT NULL,
  cliente_doc_tipo VARCHAR(2),
  cliente_doc_num VARCHAR(20),
  cliente_razon_social VARCHAR(255),
  monto_subtotal NUMERIC(12, 2),
  monto_igv NUMERIC(12, 2),
  monto_total NUMERIC(12, 2),
  moneda VARCHAR(3) DEFAULT 'PEN',
  estado VARCHAR(50) NOT NULL,
  hash_cpe TEXT,
  xml_firmado_base64 TEXT,
  cdr_base64 TEXT,
  observaciones TEXT,
  mensaje_sunat TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (ruc_emisor, serie, numero)
);

CREATE INDEX IF NOT EXISTS idx_comp_pedido ON comprobantes(pedido_id);
CREATE INDEX IF NOT EXISTS idx_comp_estado ON comprobantes(estado);

-- ═══════════════════════════════════════════════════════════════════════
-- FASE A.1.b — Seed de precios 2026 (39 productos)
-- ═══════════════════════════════════════════════════════════════════════
-- Solo afecta productos cuyo nombre coincida exactamente con el catálogo.
-- Si un nombre no coincide, lo ignora silenciosamente.

DO $seed$
DECLARE
  prod_id UUID;
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- POLLO
      ('Pollo con menudencia entero',                                  8.50::numeric,  10.50::numeric),
      ('Pollo entero sin menudencia',                                  9.00,  11.00),
      ('Pechuga deshuesada / filetes',                                 14.50, 18.00),
      ('Pechuga especial con hueso',                                   11.50, 14.50),
      ('Filetes de pierna',                                            12.50, 15.50),
      ('Pierna especial',                                              10.00, 12.50),
      ('Piernas solas',                                                9.50,  12.00),
      ('Encuentro / muslo',                                            10.50, 13.00),
      ('Alas',                                                         9.50,  12.00),
      ('Milanesas',                                                    15.50, 19.00),
      ('Gallina doble pecho venta entera (peso aprox. 3.600 a 4.200 kg)', 11.00, 14.00),
      ('Gallina colorada (peso aprox. 1.700 a 2kg)',                   12.00, 15.00),
      ('Menudencia',                                                   4.20,  5.50),
      ('Pato entero precio',                                           19.00, 24.00),
      ('Magret de pato',                                               78.00, 99.50),
      ('Cuy entero precio por uni.',                                   28.00, 35.00),
      ('Pavita',                                                       19.00, 24.00),
      ('Piernitas bouchet de pollo',                                   11.00, 14.00),
      -- CARNES (RES + CERDO)
      ('Bistec de res',                                                24.00, 30.00),
      ('Lomo Fino (peso de 2 a 2.900 sale por entero)',                38.00, 48.00),
      ('Carne guiso de res (sin hueso)',                               18.00, 22.00),
      ('Carne molida de res especial',                                 20.00, 25.00),
      ('Costillar',                                                    22.00, 28.00),
      ('Hueso Manzano',                                                12.00, 15.00),
      ('Cerdo en corte de guiso',                                      18.50, 23.00),
      ('Osobuco con hueso',                                            20.50, 26.00),
      ('Osobuco sin hueso',                                            26.50, 33.00),
      ('Huachalomo',                                                   32.00, 40.00),
      ('Hígado de Res',                                                12.00, 15.00),
      ('Churrasco',                                                    19.50, 24.50),
      ('Lomo de cerdo sin hueso (peso de 5kg a 7kg) sale por entero',  22.00, 28.00),
      ('Lomo de cerdo con hueso (peso de 5kg a 7kg) sale por entero',  19.00, 24.00),
      ('Panceta',                                                      25.50, 32.00),
      ('Chuleta de cerdo',                                             19.50, 24.50),
      ('Mondonguito',                                                  13.50, 17.00),
      ('Corazón de res para anticucho por entero (peso aprox 1 kg)',   16.00, 20.00),
      -- HUEVOS
      ('Huevos x paquete de 6 planchas A GRANEL (solo x paquete 11.500 KG a 11.80 KG aprox)', 62.00, 75.00),
      ('Huevos la calera plancha de 30 uni. Con fecha vencimiento',    13.50, 16.50),
      ('Huevos de corral x 12 unid. La calera',                        9.50,  12.00)
    ) AS t(nombre_prod, precio_c, precio_v)
  LOOP
    SELECT id INTO prod_id FROM productos WHERE nombre = r.nombre_prod LIMIT 1;
    IF prod_id IS NOT NULL THEN
      -- 1. Snapshot en productos
      UPDATE productos
        SET precio_compra = r.precio_c, precio_venta = r.precio_v
        WHERE id = prod_id;
      -- 2. Cerrar histórico anterior (si lo había vigente)
      UPDATE precios_productos
        SET vigente_hasta = (NOW() AT TIME ZONE 'America/Lima')::date
        WHERE producto_id = prod_id AND vigente_hasta IS NULL;
      -- 3. Insertar nuevo registro vigente
      INSERT INTO precios_productos (producto_id, precio_compra, precio_venta)
        VALUES (prod_id, r.precio_c, r.precio_v);
    END IF;
  END LOOP;
END
$seed$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- INICIALIZAR correlativos de comprobantes para Transavic + Avícola de Tony
-- ═══════════════════════════════════════════════════════════════════════
-- Serie F001 = factura, B001 = boleta. Tony usa series distintas (F002, B002).
-- Cambiar el RUC según tus credenciales SUNAT reales.

INSERT INTO comprobantes_contador (ruc, serie, ultimo_numero) VALUES
  ('20000000001', 'F001', 0),
  ('20000000001', 'B001', 0),
  ('20000000002', 'F002', 0),
  ('20000000002', 'B002', 0)
ON CONFLICT (ruc, serie) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-migración
-- ═══════════════════════════════════════════════════════════════════════

\echo ''
\echo '════════════════ TABLAS NUEVAS ════════════════'
SELECT tablename FROM pg_tables
  WHERE schemaname='public'
    AND tablename IN ('precios_productos','correlativos','metas_asesoras',
                      'notificaciones','facturas','comprobantes','comprobantes_contador')
  ORDER BY tablename;

\echo ''
\echo '════════════════ PRODUCTOS CON PRECIO (top 5) ════════════════'
SELECT nombre, precio_compra, precio_venta
  FROM productos WHERE precio_venta IS NOT NULL
  ORDER BY precio_venta DESC LIMIT 5;

\echo ''
\echo '════════════════ COLUMNAS NUEVAS EN pedidos ════════════════'
SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='pedidos'
    AND column_name IN ('numero_guia','guia_firmada_data','guia_firmada_mime',
                        'guia_firmada_at','pesado_por','pesado_at')
  ORDER BY column_name;

\echo ''
\echo '════════════════ COLUMNAS NUEVAS EN pedido_items ════════════════'
SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='pedido_items'
    AND column_name IN ('precio_unitario','subtotal','cantidad_real','subtotal_real')
  ORDER BY column_name;

\echo ''
\echo '════════════════ MIGRACIÓN COMPLETA ════════════════'
