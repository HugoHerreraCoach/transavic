-- scripts/rollback-reemision-cpe-campo-rechazado-2026-07-12.sql
-- Revierte migrate-reemision-cpe-campo-rechazado-2026-07-12.sql.
--
-- Es deliberadamente conservador: si ya existe una cadena de reemplazo, aborta
-- antes de borrar el vínculo de auditoría. En ese caso no hay rollback automático
-- seguro; se debe mantener el esquema nuevo o planificar una migración de datos.

BEGIN;

DO $$
DECLARE
  hay_cadena BOOLEAN := FALSE;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comprobantes'
      AND column_name = 'reemplaza_comprobante_id'
  ) THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.comprobantes WHERE reemplaza_comprobante_id IS NOT NULL)'
      INTO hay_cadena;
    IF hay_cadena THEN
      RAISE EXCEPTION
        'Rollback cancelado: ya existen CPE de reemplazo y no se borrará su trazabilidad.';
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_comprobantes_reemplaza_cpe;
DROP INDEX IF EXISTS public.ux_comprobantes_reemplaza_cpe;

-- Restaurar la regla anterior: una sola fila 01/03 por venta, incluso rechazada.
DROP INDEX IF EXISTS public.ux_comprobantes_venta_avicola_cpe;
CREATE UNIQUE INDEX ux_comprobantes_venta_avicola_cpe
  ON public.comprobantes (venta_avicola_id)
  WHERE venta_avicola_id IS NOT NULL
    AND tipo IN ('01', '03');

ALTER TABLE public.comprobantes
  DROP COLUMN IF EXISTS reemplaza_comprobante_id;

COMMIT;
