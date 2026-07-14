-- Rollback protegido de migrate-pagos-proveedores-estado-cuenta-2026-07-13.sql.
-- Solo es seguro antes de registrar pagos con el flujo nuevo.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/rollback-pagos-proveedores-estado-cuenta-2026-07-13.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pagos_proveedores
    WHERE origen_registro = 'sistema'
  ) THEN
    RAISE EXCEPTION
      'Rollback bloqueado: ya existen pagos creados por el flujo nuevo';
  END IF;
END $$;

DROP INDEX IF EXISTS public.transacciones_pago_proveedor_reverso_uk;
DROP INDEX IF EXISTS public.transacciones_pago_proveedor_egreso_uk;
DROP INDEX IF EXISTS public.pagos_proveedores_aplicaciones_deuda_idx;
DROP INDEX IF EXISTS public.pagos_proveedores_proveedor_fecha_idx;
DROP INDEX IF EXISTS public.cuentas_por_pagar_compra_uk;
DROP FUNCTION IF EXISTS public.validar_anticipo_pago_proveedor(UUID, BOOLEAN);

ALTER TABLE public.transacciones DROP COLUMN IF EXISTS pago_proveedor_id;
DROP TABLE IF EXISTS public.pagos_proveedores_aplicaciones;
DROP TABLE IF EXISTS public.pagos_proveedores;

ALTER TABLE public.cuentas_por_pagar
  DROP CONSTRAINT IF EXISTS cuentas_por_pagar_montos_chk,
  DROP CONSTRAINT IF EXISTS cuentas_por_pagar_estado_chk,
  DROP CONSTRAINT IF EXISTS cuentas_por_pagar_id_proveedor_uk;

ALTER TABLE public.cuentas_por_pagar
  ALTER COLUMN monto_pagado DROP NOT NULL,
  ALTER COLUMN estado DROP NOT NULL;
