-- scripts/migrate-clientes-avicola-2026-07-07.sql
-- Módulo "Clientes Avícola": venta en campo del Gerente General a clientes de
-- mercados/avícolas, con cuenta corriente (saldo anterior + ventas − abonos).
-- COMPLETAMENTE INDEPENDIENTE de pedidos/clientes/facturas (decisión 7 jul 2026:
-- reutilizar `pedidos` con un origen nuevo contaminaría las metas de asesoras).
-- Idempotente y aditivo. Aplicar por psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-clientes-avicola-2026-07-07.sql
-- A producción SIEMPRE ANTES del deploy con el código nuevo (gotcha #17).

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA: clientes_avicola (directorio propio del módulo, sin scoping por asesora)
CREATE TABLE IF NOT EXISTS public.clientes_avicola (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre         VARCHAR(255) NOT NULL,
  mercado        VARCHAR(255) NOT NULL,           -- texto libre; la UI sugiere con DISTINCT
  numero_puesto  VARCHAR(50),                     -- opcional (ej. "Puesto 14")
  telefono       VARCHAR(30),
  direccion      TEXT,
  observaciones  TEXT,
  empresa        VARCHAR(50) NOT NULL DEFAULT 'Transavic'
                 CHECK (empresa IN ('Transavic', 'Avícola de Tony')),
  -- Deuda acumulada ANTES de entrar al sistema. Punto de partida del estado de
  -- cuenta. Editable por admin. Sin CHECK >= 0: permite arrancar con saldo a favor.
  saldo_anterior NUMERIC(12,2) NOT NULL DEFAULT 0,
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_avicola_mercado ON public.clientes_avicola (mercado);

-- 3. TABLA: ventas_avicola (venta rápida de campo; la "guía" es 1:1 con la venta)
-- El id NO tiene DEFAULT a propósito: lo genera el CLIENTE (crypto.randomUUID)
-- como mecanismo de idempotencia contra el doble-tap en campo.
CREATE TABLE IF NOT EXISTS public.ventas_avicola (
  id               UUID PRIMARY KEY,
  cliente_id       UUID NOT NULL REFERENCES public.clientes_avicola(id),
  numero_guia      INTEGER NOT NULL,              -- correlativo tipo "guia_avicola" (src/lib/correlativos.ts)
  fecha            DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  total            NUMERIC(12,2) NOT NULL CHECK (total >= 0),  -- calculado SIEMPRE en server
  observaciones    TEXT,
  -- Anulación soft (nunca DELETE): errores de dedo en campo + auditoría.
  -- Toda query de saldo/reportes filtra NOT anulada (disciplina gotcha #24).
  anulada          BOOLEAN NOT NULL DEFAULT FALSE,
  anulada_at       TIMESTAMPTZ,
  anulada_por      UUID REFERENCES public.users(id),
  anulacion_motivo TEXT,
  creado_por       UUID NOT NULL REFERENCES public.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ventas_avicola_anulada_motivo_chk CHECK (NOT anulada OR anulacion_motivo IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ventas_avicola_numero_guia ON public.ventas_avicola (numero_guia);
CREATE INDEX IF NOT EXISTS idx_ventas_avicola_cliente_fecha ON public.ventas_avicola (cliente_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_avicola_fecha ON public.ventas_avicola (fecha);

-- 4. TABLA: venta_avicola_items (peso × precio/kg; ~5 líneas por venta)
CREATE TABLE IF NOT EXISTS public.venta_avicola_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id        UUID NOT NULL REFERENCES public.ventas_avicola(id) ON DELETE CASCADE,
  producto_id     UUID REFERENCES public.productos(id),  -- FK viva (reporte kg/producto); nullable
  producto_nombre VARCHAR(255) NOT NULL,                 -- denormalizado: congela el histórico (patrón pedido_items)
  peso_kg         NUMERIC(10,2) NOT NULL CHECK (peso_kg > 0),
  precio_kg       NUMERIC(10,2) NOT NULL CHECK (precio_kg >= 0),
  subtotal        NUMERIC(12,2) NOT NULL,                -- ROUND(peso_kg * precio_kg, 2) en server
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venta_avicola_items_venta ON public.venta_avicola_items (venta_id);
CREATE INDEX IF NOT EXISTS idx_venta_avicola_items_producto ON public.venta_avicola_items (producto_id);

-- 5. TABLA: abonos_avicola (pagos a la CUENTA del cliente, no a una venta puntual)
-- Los abonos NO tocan cuentas_bancarias/transacciones/caja (decisión 7 jul 2026,
-- igual que los cobros de cobranzas).
CREATE TABLE IF NOT EXISTS public.abonos_avicola (
  id               UUID PRIMARY KEY,               -- también generado por el cliente (idempotencia)
  cliente_id       UUID NOT NULL REFERENCES public.clientes_avicola(id),
  fecha            DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  monto            NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  medio_pago       VARCHAR(20) NOT NULL
                   CHECK (medio_pago IN ('efectivo', 'transferencia', 'yape', 'plin', 'otro')),
  observaciones    TEXT,
  -- Foto del comprobante (opcional): single-photo base64 webp comprimida en cliente
  -- (patrón guia_firmada_data/mime de pedidos).
  comprobante_data TEXT,
  comprobante_mime VARCHAR(50),
  -- Anulación soft; la foto se CONSERVA (auditoría).
  anulado          BOOLEAN NOT NULL DEFAULT FALSE,
  anulado_at       TIMESTAMPTZ,
  anulado_por      UUID REFERENCES public.users(id),
  anulacion_motivo TEXT,
  creado_por       UUID NOT NULL REFERENCES public.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT abonos_avicola_anulado_motivo_chk CHECK (NOT anulado OR anulacion_motivo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_abonos_avicola_cliente_fecha ON public.abonos_avicola (cliente_id, fecha);
CREATE INDEX IF NOT EXISTS idx_abonos_avicola_fecha ON public.abonos_avicola (fecha);

-- 6. Correlativo "guia_avicola": NO se siembra aquí — siguienteCorrelativo() es
-- un UPSERT que arranca solo en 1 (gotcha #20).

-- Verificación rápida post-migración:
--   \dt public.*avicola*
--   \d public.ventas_avicola
