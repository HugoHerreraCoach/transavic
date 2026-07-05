-- Kardex de inventario + política "descuento al ENTREGAR" (Fase B, 5 jul 2026).
--
-- 1. inventario_movimientos: registro de CADA movimiento de stock (kardex).
--    tipo: 'compra' (+), 'venta_pos' (−), 'entrega' (− pedido normal al entregar),
--          'reversion' (+ al deshacer una entrega), 'ajuste' (± manual con motivo).
--    referencia_id: id de la compra / pedido / lote según el tipo.
-- 2. pedidos.inventario_descontado: guard de idempotencia — la offline-queue del
--    repartidor puede repetir el POST /entregar y NO debe descontar dos veces.
-- 3. mermas_diarias.compra_id: vincula la merma al lote/compra del día (merma por lote).
--
-- Aplicar por psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-inventario-movimientos.sql
-- En producción: aplicar JUNTO con la migración consolidada cuando la expansión suba.

CREATE TABLE IF NOT EXISTS public.inventario_movimientos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  cantidad_cambio NUMERIC(12,2) NOT NULL,
  tipo VARCHAR(20) NOT NULL, -- compra | venta_pos | entrega | reversion | ajuste
  motivo TEXT,               -- obligatorio a nivel de API cuando tipo = 'ajuste'
  usuario_id UUID REFERENCES public.users(id),
  referencia_id UUID,        -- compra.id / pedido.id según tipo
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_producto_fecha
  ON public.inventario_movimientos (producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_referencia
  ON public.inventario_movimientos (referencia_id);

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS inventario_descontado BOOLEAN DEFAULT FALSE;

ALTER TABLE public.mermas_diarias
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES public.compras(id);
