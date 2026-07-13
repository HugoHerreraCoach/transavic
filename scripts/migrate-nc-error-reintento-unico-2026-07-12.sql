-- scripts/migrate-nc-error-reintento-unico-2026-07-12.sql
-- Una Nota de Crédito en `error` que YA tiene XML firmado representa un envío
-- de resultado incierto: debe reintentarse con la misma fila/correlativo y no
-- puede convivir con otra NC nueva sobre el mismo comprobante base.
--
-- Un error SIN XML ocurrió antes de firmar/enviar y no es reintentable; ese caso
-- sí libera una nueva NC. Rechazado/anulado también liberan un intento corregido.
-- Aplicar DESPUÉS de migrate-facturacion-campo-2026-07-12.sql y antes del deploy.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.comprobantes
    WHERE referencia_comprobante_id IS NOT NULL
      AND tipo = '07'
      AND (
        estado NOT IN ('error', 'rechazado', 'anulado')
        OR (estado = 'error' AND xml_firmado_base64 IS NOT NULL)
      )
    GROUP BY referencia_comprobante_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Migración cancelada: hay referencias con más de una NC activa/error con XML; revisar antes de crear el índice.';
  END IF;
END $$;

DROP INDEX IF EXISTS public.ux_comprobantes_nc_referencia_activa;
CREATE UNIQUE INDEX ux_comprobantes_nc_referencia_activa
  ON public.comprobantes (referencia_comprobante_id)
  WHERE referencia_comprobante_id IS NOT NULL
    AND tipo = '07'
    AND (
      estado NOT IN ('error', 'rechazado', 'anulado')
      OR (estado = 'error' AND xml_firmado_base64 IS NOT NULL)
    );

COMMIT;

-- Verificación:
-- SELECT indexdef FROM pg_indexes
-- WHERE indexname = 'ux_comprobantes_nc_referencia_activa';
