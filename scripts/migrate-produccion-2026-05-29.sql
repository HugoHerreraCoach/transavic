-- ============================================================================
-- migrate-produccion-2026-05-29.sql
-- ----------------------------------------------------------------------------
-- Migración CONSOLIDADA para llevar la base de PRODUCCIÓN al esquema que el
-- código nuevo (módulo SUNAT, comprobantes, cobranzas, incentivos, catálogo,
-- guía firmada, pesos) espera.
--
-- Estado de partida (producción, ep-cool-sound): 6 tablas
--   clientes, pedido_items, pedidos, productos, settings, users
-- Estado objetivo (dev-hugo, ep-super-violet): 14 tablas + columnas extra.
--
-- Esta migración agrega:
--   • 8 tablas nuevas:
--       comprobantes, comprobantes_contador, correlativos, facturas,
--       metas_asesoras, notificaciones, precios_productos, resumenes_diarios
--   • 13 columnas nuevas en 4 tablas existentes (clientes, pedidos,
--       pedido_items, productos)
--   • backfill del código interno de producto (POL001/CAR001/HUE001…)
--
-- ES ADITIVA Y BACKWARDS-COMPATIBLE: la app que HOY corre en producción no
-- referencia nada de esto, así que aplicarla NO interrumpe la operación en vivo.
-- Es IDEMPOTENTE (IF NOT EXISTS + guards), se puede re-ejecutar sin romper.
--
-- CÓMO EJECUTAR (Node 26 rompe los .mjs por gotcha §12.13 → usar psql):
--   PROD_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
--   psql "$PROD_URL" -f scripts/migrate-produccion-2026-05-29.sql
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================ 8 TABLAS NUEVAS ===============================

CREATE TABLE IF NOT EXISTS public.comprobantes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    pedido_id uuid,
    ruc_emisor character varying(11) NOT NULL,
    empresa character varying(50) NOT NULL,
    tipo character varying(20) NOT NULL,
    serie character varying(10) NOT NULL,
    numero integer NOT NULL,
    serie_numero character varying(50) NOT NULL,
    cliente_doc_tipo character varying(2),
    cliente_doc_num character varying(20),
    cliente_razon_social character varying(255),
    monto_subtotal numeric(12,2),
    monto_igv numeric(12,2),
    monto_total numeric(12,2),
    moneda character varying(3) DEFAULT 'PEN'::character varying,
    estado character varying(50) NOT NULL,
    hash_cpe text,
    xml_firmado_base64 text,
    cdr_base64 text,
    observaciones text,
    mensaje_sunat text,
    created_at timestamp with time zone DEFAULT now(),
    forma_pago character varying(10),
    fecha_vencimiento date,
    CONSTRAINT comprobantes_pkey PRIMARY KEY (id),
    CONSTRAINT comprobantes_ruc_emisor_serie_numero_key UNIQUE (ruc_emisor, serie, numero)
);

CREATE TABLE IF NOT EXISTS public.comprobantes_contador (
    ruc character varying(11) NOT NULL,
    serie character varying(10) NOT NULL,
    ultimo_numero integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT comprobantes_contador_pkey PRIMARY KEY (ruc, serie)
);

CREATE TABLE IF NOT EXISTS public.correlativos (
    tipo character varying(50) NOT NULL,
    ultimo_numero integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT correlativos_pkey PRIMARY KEY (tipo)
);

CREATE TABLE IF NOT EXISTS public.facturas (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    pedido_id uuid,
    cliente_id uuid,
    cliente_nombre character varying(255) NOT NULL,
    asesor_id uuid,
    monto numeric(12,2) NOT NULL,
    plazo_dias integer DEFAULT 0 NOT NULL,
    fecha_emision date DEFAULT ((now() AT TIME ZONE 'America/Lima'::text))::date NOT NULL,
    fecha_vencimiento date NOT NULL,
    fecha_pago date,
    estado character varying(20) DEFAULT 'Pendiente'::character varying NOT NULL,
    numero_comprobante character varying(50),
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    comprobante_id uuid,
    CONSTRAINT facturas_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.metas_asesoras (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    asesor_id uuid,
    mes date NOT NULL,
    monto_meta numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT metas_asesoras_pkey PRIMARY KEY (id),
    CONSTRAINT metas_asesoras_asesor_id_mes_key UNIQUE (asesor_id, mes)
);

CREATE TABLE IF NOT EXISTS public.notificaciones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    tipo character varying(50) NOT NULL,
    titulo text NOT NULL,
    mensaje text NOT NULL,
    link text,
    pedido_id uuid,
    leida boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notificaciones_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.precios_productos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    producto_id uuid,
    precio_compra numeric(10,2),
    precio_venta numeric(10,2) NOT NULL,
    vigente_desde date DEFAULT ((now() AT TIME ZONE 'America/Lima'::text))::date NOT NULL,
    vigente_hasta date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by uuid,
    CONSTRAINT precios_productos_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.resumenes_diarios (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    empresa character varying(50) NOT NULL,
    ruc character varying(11) NOT NULL,
    fecha_referencia date NOT NULL,
    correlativo integer,
    nombre_archivo character varying(120),
    ticket text,
    estado character varying(20) DEFAULT 'enviando'::character varying NOT NULL,
    boletas_incluidas integer DEFAULT 0,
    mensaje_sunat text,
    xml_firmado_base64 text,
    cdr_base64 text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT resumenes_diarios_pkey PRIMARY KEY (id)
);

-- ============================ ÍNDICES =======================================

CREATE INDEX IF NOT EXISTS idx_comp_estado            ON public.comprobantes      USING btree (estado);
CREATE INDEX IF NOT EXISTS idx_comp_pedido            ON public.comprobantes      USING btree (pedido_id);
CREATE INDEX IF NOT EXISTS idx_facturas_asesor        ON public.facturas          USING btree (asesor_id, estado);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente       ON public.facturas          USING btree (cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente_id    ON public.facturas          USING btree (cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_comprobante_id ON public.facturas         USING btree (comprobante_id);
CREATE INDEX IF NOT EXISTS idx_facturas_vencimiento   ON public.facturas          USING btree (fecha_vencimiento) WHERE (fecha_pago IS NULL);
CREATE INDEX IF NOT EXISTS idx_metas_asesor_mes       ON public.metas_asesoras    USING btree (asesor_id, mes);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread      ON public.notificaciones    USING btree (user_id, leida, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_precios_vigentes       ON public.precios_productos USING btree (producto_id, vigente_desde DESC) WHERE (vigente_hasta IS NULL);
CREATE INDEX IF NOT EXISTS idx_resumen_ruc_fecha      ON public.resumenes_diarios USING btree (ruc, fecha_referencia);
CREATE INDEX IF NOT EXISTS idx_resumen_ticket         ON public.resumenes_diarios USING btree (ticket);

-- ============================ FOREIGN KEYS (guardadas) ======================
-- Se envuelven en DO/EXCEPTION para que re-ejecutar la migración no falle si
-- la FK ya existe (no hay ADD CONSTRAINT IF NOT EXISTS en Postgres).

DO $$ BEGIN
  ALTER TABLE ONLY public.comprobantes
    ADD CONSTRAINT comprobantes_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_asesor_id_fkey FOREIGN KEY (asesor_id) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_comprobante_id_fkey FOREIGN KEY (comprobante_id) REFERENCES public.comprobantes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.metas_asesoras
    ADD CONSTRAINT metas_asesoras_asesor_id_fkey FOREIGN KEY (asesor_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.precios_productos
    ADD CONSTRAINT precios_productos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ONLY public.precios_productos
    ADD CONSTRAINT precios_productos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===================== 13 COLUMNAS NUEVAS (tablas existentes) ===============

-- clientes: plazo de pago por cliente (cobranzas inteligentes)
ALTER TABLE public.clientes      ADD COLUMN IF NOT EXISTS plazo_pago_dias integer DEFAULT 0;

-- pedidos: guía de remisión firmada + pesado (Fase A)
ALTER TABLE public.pedidos       ADD COLUMN IF NOT EXISTS numero_guia integer;
ALTER TABLE public.pedidos       ADD COLUMN IF NOT EXISTS guia_firmada_at timestamp with time zone;
ALTER TABLE public.pedidos       ADD COLUMN IF NOT EXISTS guia_firmada_data text;
ALTER TABLE public.pedidos       ADD COLUMN IF NOT EXISTS guia_firmada_mime character varying(50);
ALTER TABLE public.pedidos       ADD COLUMN IF NOT EXISTS pesado_at timestamp with time zone;
ALTER TABLE public.pedidos       ADD COLUMN IF NOT EXISTS pesado_por uuid;

-- pedido_items: precio estimado (venta) + peso/subtotal real (entrega)
ALTER TABLE public.pedido_items  ADD COLUMN IF NOT EXISTS precio_unitario numeric(10,2);
ALTER TABLE public.pedido_items  ADD COLUMN IF NOT EXISTS subtotal numeric(10,2);
ALTER TABLE public.pedido_items  ADD COLUMN IF NOT EXISTS cantidad_real numeric(10,2);
ALTER TABLE public.pedido_items  ADD COLUMN IF NOT EXISTS subtotal_real numeric(10,2);

-- productos: código interno SUNAT + precios compra/venta (catálogo)
ALTER TABLE public.productos     ADD COLUMN IF NOT EXISTS codigo character varying(30);
ALTER TABLE public.productos     ADD COLUMN IF NOT EXISTS precio_compra numeric(10,2);
ALTER TABLE public.productos     ADD COLUMN IF NOT EXISTS precio_venta numeric(10,2);

-- ===================== BACKFILL código interno de producto ==================
-- Genera POL001/CAR001/HUE001… por categoría, solo donde falta (no pisa nada).
WITH numerados AS (
  SELECT
    id,
    CASE categoria
      WHEN 'Pollo'  THEN 'POL'
      WHEN 'Carnes' THEN 'CAR'
      WHEN 'Huevos' THEN 'HUE'
      ELSE 'PRD'
    END AS prefijo,
    ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY nombre, id) AS n
  FROM public.productos
)
UPDATE public.productos p
SET codigo = num.prefijo || LPAD(num.n::text, 3, '0')
FROM numerados num
WHERE p.id = num.id AND (p.codigo IS NULL OR p.codigo = '');

COMMIT;

-- ===================== VERIFICACIÓN (no modifica nada) ======================
-- Tras COMMIT, debe listar 14 tablas y los códigos generados.
SELECT 'TABLAS' AS chk, count(*) AS total
  FROM information_schema.tables WHERE table_schema='public';
SELECT categoria, codigo, nombre FROM public.productos ORDER BY categoria, codigo LIMIT 12;
