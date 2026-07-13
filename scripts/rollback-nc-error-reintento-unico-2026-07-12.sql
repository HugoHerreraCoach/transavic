-- scripts/rollback-nc-error-reintento-unico-2026-07-12.sql
-- Restaura el guard anterior, que liberaba toda NC en `error` aunque tuviera XML.
-- Solo usar para revertir código antes de producción; reduce la protección frente
-- a una doble NC tras un timeout ambiguo.

BEGIN;

DROP INDEX IF EXISTS public.ux_comprobantes_nc_referencia_activa;
CREATE UNIQUE INDEX ux_comprobantes_nc_referencia_activa
  ON public.comprobantes (referencia_comprobante_id)
  WHERE referencia_comprobante_id IS NOT NULL
    AND tipo = '07'
    AND estado NOT IN ('error', 'rechazado', 'anulado');

COMMIT;
