-- scripts/migrate-planta-clientes-cobranzas-2026-07-08.sql
-- Separación de la operación 3 (Venta en Planta / POS) de la operación 2 (Ejecutivas).
-- Antonio (7 jul 2026): cada operación con su propia base de clientes y de deudas/cobranzas.
-- El POS SIGUE escribiendo la venta en `pedidos` (conserva orden imprimible + comprobante SUNAT);
-- solo se le da directorio de clientes y cobranza PROPIOS, aislados de `clientes`/`facturas` de
-- ejecutivas. Como todos los consumidores de cobranzas leen de `facturas`, al no escribir ahí, dejan
-- de ver la deuda de planta automáticamente. Espejo del patrón campo (migrate-clientes-avicola).
-- Idempotente y aditivo. Aplicar por psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-planta-clientes-cobranzas-2026-07-08.sql
-- A producción SIEMPRE ANTES del deploy (gotcha #17).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. clientes_planta — directorio propio del POS (sin scoping por asesora, sin anti-dup de ejecutivas).
--    El id lo genera el CLIENTE (idempotencia offline, patrón ventas_avicola).
CREATE TABLE IF NOT EXISTS public.clientes_planta (
  id              UUID PRIMARY KEY,
  nombre          VARCHAR(255) NOT NULL,
  razon_social    VARCHAR(255),                    -- para comprobante con RUC (se denormaliza al pedido)
  ruc_dni         VARCHAR(20),
  telefono        VARCHAR(30),
  direccion       TEXT,
  plazo_pago_dias INTEGER NOT NULL DEFAULT 0,       -- vencimiento de la deuda a crédito
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  empresa         VARCHAR(50) NOT NULL DEFAULT 'Avícola de Tony'
                  CHECK (empresa IN ('Transavic', 'Avícola de Tony')),
  created_by      UUID NOT NULL REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_planta_nombre ON public.clientes_planta (nombre);
-- Dedup suave por documento: solo aplica cuando hay RUC/DNI de verdad (varios sin doc coexisten).
CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_planta_ruc
  ON public.clientes_planta (ruc_dni) WHERE ruc_dni IS NOT NULL AND ruc_dni <> '';

-- 2. cobranzas_planta — deuda por venta a crédito del POS. Aislada de `facturas`.
--    Una fila por venta a crédito (trazable a su pedido); saldo = monto − Σ abonos (parciales).
CREATE TABLE IF NOT EXISTS public.cobranzas_planta (
  id                UUID PRIMARY KEY,               -- generado client-side (idempotencia)
  pedido_id         UUID REFERENCES public.pedidos(id) ON DELETE SET NULL,
  cliente_planta_id UUID NOT NULL REFERENCES public.clientes_planta(id),
  cliente_nombre    VARCHAR(255) NOT NULL,          -- denormalizado (histórico congelado)
  monto             NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  plazo_dias        INTEGER NOT NULL DEFAULT 0,
  fecha_emision     DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  fecha_vencimiento DATE NOT NULL,
  estado            VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                    CHECK (estado IN ('Pendiente', 'Parcial', 'Vencida', 'Pagada', 'Anulada')),
  comprobante_id    UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  empresa           VARCHAR(50) NOT NULL DEFAULT 'Avícola de Tony',
  notas             TEXT,
  creado_por        UUID NOT NULL REFERENCES public.users(id),
  anulada           BOOLEAN NOT NULL DEFAULT FALSE,
  anulada_at        TIMESTAMPTZ,
  anulada_por       UUID REFERENCES public.users(id),
  anulacion_motivo  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cobranzas_planta_anulada_motivo_chk CHECK (NOT anulada OR anulacion_motivo IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_cobranzas_planta_cliente ON public.cobranzas_planta (cliente_planta_id);
CREATE INDEX IF NOT EXISTS idx_cobranzas_planta_estado ON public.cobranzas_planta (estado);
CREATE INDEX IF NOT EXISTS idx_cobranzas_planta_pedido ON public.cobranzas_planta (pedido_id);

-- 3. abonos_planta — pagos parciales del "saldito". NO tocan cuentas/transacciones/caja (patrón campo).
CREATE TABLE IF NOT EXISTS public.abonos_planta (
  id               UUID PRIMARY KEY,               -- generado client-side (idempotencia)
  cobranza_id      UUID NOT NULL REFERENCES public.cobranzas_planta(id),
  monto            NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  medio_pago       VARCHAR(20) NOT NULL
                   CHECK (medio_pago IN ('efectivo', 'transferencia', 'yape', 'plin', 'otro')),
  fecha            DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  observaciones    TEXT,
  comprobante_data TEXT,                            -- foto opcional (patrón abonos_avicola)
  comprobante_mime VARCHAR(50),
  creado_por       UUID NOT NULL REFERENCES public.users(id),
  anulado          BOOLEAN NOT NULL DEFAULT FALSE,
  anulado_at       TIMESTAMPTZ,
  anulado_por      UUID REFERENCES public.users(id),
  anulacion_motivo TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT abonos_planta_anulado_motivo_chk CHECK (NOT anulado OR anulacion_motivo IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_abonos_planta_cobranza ON public.abonos_planta (cobranza_id);

-- Verificación:
--   \dt public.*planta*
--   \d public.cobranzas_planta
