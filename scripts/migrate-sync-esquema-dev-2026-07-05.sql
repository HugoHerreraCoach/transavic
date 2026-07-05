-- Sincroniza dev-hugo con el esquema OBJETIVO de la expansión ERP.
--
-- Problema (auditoría 5 jul 2026): `migrate-fase1-compras-caja.mjs` creó
-- versiones VIEJAS de gastos / caja_diaria / precios_audit_log en dev-hugo, y
-- `migrate-produccion-fase-2-3-consolidado.sql` usa CREATE TABLE IF NOT EXISTS,
-- así que NO las actualizó → el código (que usa las columnas nuevas:
-- gastos.metodo_pago/created_by, caja_diaria.monto_apertura/abierta_por, etc.)
-- fallaba con 500 en esas rutas. Las 3 tablas estaban VACÍAS, se recrean.
--
-- ⚠️ SOLO para bases donde las 3 tablas estén vacías (dev). En producción NO
-- hace falta: allá no existe ninguna tabla nueva y el consolidado las crea ya
-- con el esquema correcto. El .mjs de fase 1 queda OBSOLETO para estas tablas.
--
-- Aplicar por psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-sync-esquema-dev-2026-07-05.sql

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.gastos) > 0
     OR (SELECT COUNT(*) FROM public.caja_diaria) > 0
     OR (SELECT COUNT(*) FROM public.precios_audit_log) > 0 THEN
    RAISE EXCEPTION 'ABORTADO: alguna de las tablas tiene datos — migrar a mano, no recrear.';
  END IF;
END $$;

DROP TABLE IF EXISTS public.gastos;
DROP TABLE IF EXISTS public.caja_diaria;
DROP TABLE IF EXISTS public.precios_audit_log;

-- Definiciones EXACTAS del consolidado (migrate-produccion-fase-2-3-consolidado.sql)

CREATE TABLE public.gastos (
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

CREATE TABLE public.caja_diaria (
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

CREATE TABLE public.precios_audit_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  producto_id UUID REFERENCES public.productos(id) ON DELETE CASCADE,
  precio_anterior NUMERIC(10,2),
  precio_nuevo NUMERIC(10,2) NOT NULL,
  tipo_precio VARCHAR(10) NOT NULL, -- 'venta' o 'compra'
  modificado_por UUID REFERENCES public.users(id),
  fecha_modificacion TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Re-crear el guard de una sola caja abierta (migrate-caja-unica-abierta.sql),
-- que se pierde al recrear la tabla.
CREATE UNIQUE INDEX IF NOT EXISTS ux_caja_diaria_unica_abierta
  ON public.caja_diaria ((estado))
  WHERE estado = 'Abierta';
