-- Pagos de proveedores, aplicaciones por deuda y anticipos (13 jul 2026).
--
-- Aplicar primero en dev-hugo y luego en produccion, SIEMPRE antes del codigo:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/migrate-pagos-proveedores-estado-cuenta-2026-07-13.sql
--
-- La migracion es aditiva e idempotente. Convierte cada egreso historico creado
-- por Cuentas por Pagar en un pago individual y valida que la suma migrada
-- coincida con cuentas_por_pagar.monto_pagado antes de endurecer invariantes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.pagos_proveedores (
  id UUID PRIMARY KEY,
  proveedor_id UUID NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  cuenta_bancaria_id UUID NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE RESTRICT,
  deuda_prioritaria_id UUID,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha DATE NOT NULL,
  notas TEXT,
  estado VARCHAR(15) NOT NULL DEFAULT 'registrado'
    CHECK (estado IN ('registrado', 'anulado')),
  origen_registro VARCHAR(15) NOT NULL DEFAULT 'sistema'
    CHECK (origen_registro IN ('sistema', 'migracion')),
  registrado_por UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  anulado_por UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  anulado_at TIMESTAMP WITH TIME ZONE,
  motivo_anulacion TEXT,
  procesado_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT pagos_proveedores_id_proveedor_uk UNIQUE (id, proveedor_id)
);

CREATE TABLE IF NOT EXISTS public.pagos_proveedores_aplicaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pago_id UUID NOT NULL,
  deuda_id UUID NOT NULL,
  proveedor_id UUID NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  origen VARCHAR(25) NOT NULL DEFAULT 'pago'
    CHECK (origen IN ('pago', 'anticipo_posterior', 'migracion')),
  fecha_aplicacion DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT pagos_proveedores_aplicaciones_pago_deuda_uk UNIQUE (pago_id, deuda_id),
  CONSTRAINT pagos_proveedores_aplicaciones_pago_fk
    FOREIGN KEY (pago_id, proveedor_id)
    REFERENCES public.pagos_proveedores(id, proveedor_id) ON DELETE RESTRICT
);

-- Una FK compuesta impide, tambien a nivel de base de datos, aplicar dinero de
-- un proveedor a la deuda de otro.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cuentas_por_pagar_id_proveedor_uk'
  ) THEN
    ALTER TABLE public.cuentas_por_pagar
      ADD CONSTRAINT cuentas_por_pagar_id_proveedor_uk UNIQUE (id, proveedor_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pagos_proveedores_aplicaciones_deuda_fk'
  ) THEN
    ALTER TABLE public.pagos_proveedores_aplicaciones
      ADD CONSTRAINT pagos_proveedores_aplicaciones_deuda_fk
      FOREIGN KEY (deuda_id, proveedor_id)
      REFERENCES public.cuentas_por_pagar(id, proveedor_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pagos_proveedores_deuda_prioritaria_fk'
  ) THEN
    ALTER TABLE public.pagos_proveedores
      ADD CONSTRAINT pagos_proveedores_deuda_prioritaria_fk
      FOREIGN KEY (deuda_prioritaria_id, proveedor_id)
      REFERENCES public.cuentas_por_pagar(id, proveedor_id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS pago_proveedor_id UUID
    REFERENCES public.pagos_proveedores(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS transacciones_pago_proveedor_egreso_uk
  ON public.transacciones (pago_proveedor_id)
  WHERE pago_proveedor_id IS NOT NULL AND tipo = 'egreso';

CREATE UNIQUE INDEX IF NOT EXISTS transacciones_pago_proveedor_reverso_uk
  ON public.transacciones (pago_proveedor_id)
  WHERE pago_proveedor_id IS NOT NULL AND tipo = 'ingreso';

CREATE INDEX IF NOT EXISTS pagos_proveedores_proveedor_fecha_idx
  ON public.pagos_proveedores (proveedor_id, fecha, created_at);
CREATE INDEX IF NOT EXISTS pagos_proveedores_aplicaciones_deuda_idx
  ON public.pagos_proveedores_aplicaciones (deuda_id);

-- Una compra solo puede originar una cuenta por pagar. Las deudas manuales
-- (compra_id NULL) siguen admitiendo varias filas.
CREATE UNIQUE INDEX IF NOT EXISTS cuentas_por_pagar_compra_uk
  ON public.cuentas_por_pagar (compra_id)
  WHERE compra_id IS NOT NULL;

-- Guard transaccional: se invoca DESPUES del advisory lock. Evita que dos
-- pagos distintos consuman la misma deuda y que el segundo cree un anticipo
-- sin la confirmacion explicita del usuario.
CREATE OR REPLACE FUNCTION public.validar_anticipo_pago_proveedor(
  p_pago_id UUID,
  p_confirmado BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_monto NUMERIC(12,2);
  v_proveedor UUID;
  v_procesado TIMESTAMP WITH TIME ZONE;
  v_deuda NUMERIC(12,2);
BEGIN
  SELECT monto, proveedor_id, procesado_at
  INTO v_monto, v_proveedor, v_procesado
  FROM public.pagos_proveedores
  WHERE id = p_pago_id;

  IF v_monto IS NULL OR v_procesado IS NOT NULL OR p_confirmado THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(monto_deuda - monto_pagado), 0)
  INTO v_deuda
  FROM public.cuentas_por_pagar
  WHERE proveedor_id = v_proveedor
    AND monto_pagado < monto_deuda;

  IF v_monto > v_deuda THEN
    RAISE EXCEPTION 'ANTICIPO_REQUIERE_CONFIRMACION'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Preflight del backfill: no se continua si un egreso legacy no apunta a una
-- deuda o si su suma no reconcilia al centimo con el cache historico.
DO $$
DECLARE
  diferencias INTEGER;
  huerfanos INTEGER;
  hay_legacy BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.transacciones t
    WHERE t.tipo = 'egreso'
      AND t.concepto ILIKE 'Pago a Proveedor:%'
      AND t.pago_proveedor_id IS NULL
  ) INTO hay_legacy;

  SELECT COUNT(*) INTO huerfanos
  FROM public.transacciones t
  LEFT JOIN public.cuentas_por_pagar cpp ON cpp.id = t.referencia_id
  WHERE t.tipo = 'egreso'
    AND t.concepto ILIKE 'Pago a Proveedor:%'
    AND t.pago_proveedor_id IS NULL
    AND cpp.id IS NULL;

  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'Backfill abortado: % pago(s) legacy no apuntan a una deuda valida',
      huerfanos;
  END IF;

  -- Solo se reconcilia el cache antiguo cuando realmente quedan movimientos
  -- sin migrar. En una reejecucion, los pagos ya enlazados y los del flujo
  -- nuevo se validan por aplicaciones en el postflight final.
  IF hay_legacy THEN
    SELECT COUNT(*) INTO diferencias
    FROM public.cuentas_por_pagar cpp
    WHERE ABS(
      COALESCE(cpp.monto_pagado, 0) -
      COALESCE((
        SELECT SUM(t.monto)
        FROM public.transacciones t
        WHERE t.tipo = 'egreso'
          AND t.referencia_id = cpp.id
          AND t.concepto ILIKE 'Pago a Proveedor:%'
          AND t.pago_proveedor_id IS NULL
      ), 0)
    ) > 0.01;
  ELSE
    diferencias := 0;
  END IF;

  IF diferencias > 0 THEN
    RAISE EXCEPTION
      'Backfill abortado: % deuda(s) no reconcilian con sus pagos legacy',
      diferencias;
  END IF;
END $$;

INSERT INTO public.pagos_proveedores (
  id, proveedor_id, cuenta_bancaria_id, deuda_prioritaria_id, monto, fecha,
  notas, estado, origen_registro, registrado_por, procesado_at, created_at, updated_at
)
SELECT
  t.id,
  cpp.proveedor_id,
  t.cuenta_id,
  cpp.id,
  t.monto,
  COALESCE(t.fecha, (t.created_at AT TIME ZONE 'America/Lima')::date),
  NULL,
  'registrado',
  'migracion',
  t.usuario_id,
  t.created_at,
  t.created_at,
  t.created_at
FROM public.transacciones t
JOIN public.cuentas_por_pagar cpp ON cpp.id = t.referencia_id
WHERE t.tipo = 'egreso'
  AND t.concepto ILIKE 'Pago a Proveedor:%'
  AND t.pago_proveedor_id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pagos_proveedores_aplicaciones (
  pago_id, deuda_id, proveedor_id, monto, origen, fecha_aplicacion, created_at
)
SELECT
  pp.id,
  pp.deuda_prioritaria_id,
  pp.proveedor_id,
  pp.monto,
  'migracion',
  pp.fecha,
  pp.created_at
FROM public.pagos_proveedores pp
WHERE pp.origen_registro = 'migracion'
  AND pp.deuda_prioritaria_id IS NOT NULL
ON CONFLICT (pago_id, deuda_id) DO NOTHING;

UPDATE public.transacciones t
SET pago_proveedor_id = t.id
FROM public.pagos_proveedores pp
WHERE pp.id = t.id
  AND pp.origen_registro = 'migracion'
  AND t.pago_proveedor_id IS NULL;

UPDATE public.cuentas_por_pagar
SET monto_pagado = COALESCE(monto_pagado, 0),
    estado = CASE
      WHEN COALESCE(monto_pagado, 0) >= monto_deuda THEN 'Pagado'
      WHEN COALESCE(monto_pagado, 0) > 0 THEN 'Parcial'
      ELSE 'Pendiente'
    END
WHERE monto_pagado IS NULL OR estado IS NULL;

ALTER TABLE public.cuentas_por_pagar
  ALTER COLUMN monto_pagado SET DEFAULT 0,
  ALTER COLUMN monto_pagado SET NOT NULL,
  ALTER COLUMN estado SET DEFAULT 'Pendiente',
  ALTER COLUMN estado SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cuentas_por_pagar_montos_chk'
  ) THEN
    ALTER TABLE public.cuentas_por_pagar
      ADD CONSTRAINT cuentas_por_pagar_montos_chk
      CHECK (
        monto_deuda >= 0 AND
        monto_pagado >= 0 AND
        -- Tolerancia de 1 centimo: el codigo VIEJO admitia pagar hasta restante+0.01,
        -- por lo que pueden existir filas legacy con monto_pagado = monto_deuda + 0.01
        -- (y ese codigo sigue vivo durante la ventana migracion->deploy). El codigo
        -- NUEVO siempre fija monto_pagado = LEAST(monto_deuda, ...), asi que esta
        -- tolerancia no lo afecta y evita que el ADD CONSTRAINT aborte la migracion.
        monto_pagado <= monto_deuda + 0.01
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cuentas_por_pagar_estado_chk'
  ) THEN
    ALTER TABLE public.cuentas_por_pagar
      ADD CONSTRAINT cuentas_por_pagar_estado_chk
      CHECK (estado IN ('Pendiente', 'Parcial', 'Pagado'));
  END IF;
END $$;

-- Verificacion final: aplicaciones activas y cache deben ser identicos.
DO $$
DECLARE
  diferencias INTEGER;
BEGIN
  SELECT COUNT(*) INTO diferencias
  FROM public.cuentas_por_pagar cpp
  WHERE ABS(
    cpp.monto_pagado -
    COALESCE((
      SELECT SUM(a.monto)
      FROM public.pagos_proveedores_aplicaciones a
      JOIN public.pagos_proveedores p ON p.id = a.pago_id
      WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
    ), 0)
  ) > 0.01;

  IF diferencias > 0 THEN
    RAISE EXCEPTION
      'Migracion abortada: % deuda(s) no reconcilian con sus aplicaciones',
      diferencias;
  END IF;
END $$;
