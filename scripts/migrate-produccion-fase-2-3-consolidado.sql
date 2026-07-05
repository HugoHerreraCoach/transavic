-- scripts/migrate-produccion-fase-2-3-consolidado.sql
-- =============================================================================
-- MIGRACIÓN CONSOLIDADA DE BASE DE DATOS (FASE 2 Y FASE 3)
-- =============================================================================
-- Aplicar este script en la consola de Neon o vía psql antes de desplegar
-- el código de producción en Vercel.
-- Este script es seguro e idempotente (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS).
-- No borra ni altera ningún dato preexistente de clientes, pedidos ni productos.
-- =============================================================================

-- 1. EXTENSIONES Y TRIGGERS DE SEGURIDAD
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ALTERACIONES A TABLAS EXISTENTES
ALTER TABLE public.pedidos 
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) DEFAULT 'asesor',
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE public.pedido_items 
  ADD COLUMN IF NOT EXISTS notas TEXT;

-- 3. NUEVA TABLA: proveedores
CREATE TABLE IF NOT EXISTS public.proveedores (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  ruc VARCHAR(11) NOT NULL UNIQUE,
  razon_social VARCHAR(255) NOT NULL,
  direccion TEXT,
  telefono VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. NUEVA TABLA: compras
CREATE TABLE IF NOT EXISTS public.compras (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  tipo_doc VARCHAR(20),
  nro_doc VARCHAR(50),
  estado VARCHAR(20) DEFAULT 'Completado',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  igv NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. NUEVA TABLA: compra_items
CREATE TABLE IF NOT EXISTS public.compra_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  compra_id UUID REFERENCES public.compras(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES public.productos(id) ON DELETE RESTRICT,
  jabas INTEGER DEFAULT 0,
  peso_bruto NUMERIC(10,2) NOT NULL,
  peso_tara NUMERIC(10,2) NOT NULL DEFAULT 0,
  peso_neto NUMERIC(10,2) NOT NULL,
  costo_unitario NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL
);

-- 6. NUEVA TABLA: cuentas_por_pagar
CREATE TABLE IF NOT EXISTS public.cuentas_por_pagar (
  id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
  proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  compra_id UUID REFERENCES public.compras(id) ON DELETE CASCADE,
  monto_deuda NUMERIC(12,2) NOT NULL,
  monto_pagado NUMERIC(12,2) DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'Pendiente', -- Pendiente, Parcial, Pagado
  fecha_vencimiento DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. NUEVA TABLA: gastos
CREATE TABLE IF NOT EXISTS public.gastos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  fecha DATE NOT NULL,
  categoria VARCHAR(50) NOT NULL,
  descripcion TEXT,
  monto NUMERIC(12,2) NOT NULL,
  metodo_pago VARCHAR(50) NOT NULL,
  referencia_doc VARCHAR(50),
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. NUEVA TABLA: caja_diaria
CREATE TABLE IF NOT EXISTS public.caja_diaria (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  fecha DATE NOT NULL UNIQUE,
  monto_apertura NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_ingresos NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_egresos NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_cierre_real NUMERIC(12,2),
  monto_cierre_calculado NUMERIC(12,2),
  estado VARCHAR(20) DEFAULT 'Abierta',
  abierta_por UUID REFERENCES public.users(id),
  cerrada_por UUID REFERENCES public.users(id),
  abierta_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  cerrada_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. NUEVA TABLA: precios_audit_log
CREATE TABLE IF NOT EXISTS public.precios_audit_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  producto_id UUID REFERENCES public.productos(id) ON DELETE CASCADE,
  precio_anterior NUMERIC(10,2),
  precio_nuevo NUMERIC(10,2) NOT NULL,
  tipo_precio VARCHAR(10) NOT NULL, -- 'venta' o 'compra'
  modificado_por UUID REFERENCES public.users(id),
  fecha_modificacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. NUEVA TABLA: inventario_lotes
CREATE TABLE IF NOT EXISTS public.inventario_lotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  cantidad DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima'),
  UNIQUE(producto_id)
);

-- 11. NUEVA TABLA: mermas_diarias
CREATE TABLE IF NOT EXISTS public.mermas_diarias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Lima')::date),
  peso_bruto DECIMAL(10,2) NOT NULL,
  peso_limpio DECIMAL(10,2) NOT NULL,
  peso_menudencia DECIMAL(10,2) NOT NULL,
  merma DECIMAL(10,2) NOT NULL,
  porcentaje_merma DECIMAL(5,2) NOT NULL,
  usuario_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
);

-- 12. NUEVA TABLA: cuentas_bancarias
CREATE TABLE IF NOT EXISTS public.cuentas_bancarias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(100) NOT NULL UNIQUE,
  tipo VARCHAR(50) NOT NULL, -- 'efectivo', 'banco', 'billetera'
  saldo DECIMAL(12,2) NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima'),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
);

-- 13. NUEVA TABLA: transacciones
CREATE TABLE IF NOT EXISTS public.transacciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cuenta_id UUID NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  tipo VARCHAR(20) NOT NULL, -- 'ingreso', 'egreso'
  monto DECIMAL(12,2) NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  referencia_id UUID, -- pedido_id, gasto_id, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
);

-- 14. NUEVA TABLA: prestamos_saldos
CREATE TABLE IF NOT EXISTS public.prestamos_saldos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proveedor_id UUID NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  jabas INTEGER NOT NULL DEFAULT 0,
  peso_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima'),
  UNIQUE(proveedor_id, producto_id)
);

-- 15. NUEVA TABLA: prestamos_transacciones
CREATE TABLE IF NOT EXISTS public.prestamos_transacciones (
  id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
  proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  producto_id UUID REFERENCES public.productos(id) ON DELETE RESTRICT,
  tipo_movimiento VARCHAR(50) NOT NULL, -- 'PRESTAMO_RECIBIDO', 'PRESTAMO_OTORGADO', 'DEVOLUCION_RECIBIDA', 'DEVOLUCION_OTORGADA'
  jabas INTEGER NOT NULL DEFAULT 0,
  peso_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
  fecha DATE NOT NULL,
  notas TEXT,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INICIALIZACIÓN DE DATOS (DML)
-- =============================================================================

-- A. Inicializar registros de inventario en 0 para todos los productos existentes
INSERT INTO public.inventario_lotes (producto_id, cantidad)
SELECT id, 0 FROM public.productos
ON CONFLICT (producto_id) DO NOTHING;

-- B. Cuentas bancarias por defecto necesarias para la operación y el POS
INSERT INTO public.cuentas_bancarias (nombre, tipo, saldo) VALUES
  ('Caja Efectivo Planta', 'efectivo', 0),
  ('Yape Antonio', 'billetera', 0),
  ('BCP Antonio', 'banco', 0),
  ('BBVA Antonio', 'banco', 0)
ON CONFLICT (nombre) DO NOTHING;
