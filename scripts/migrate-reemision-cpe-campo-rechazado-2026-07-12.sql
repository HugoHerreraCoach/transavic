-- scripts/migrate-reemision-cpe-campo-rechazado-2026-07-12.sql
-- Reemisión segura de factura/boleta de Campo cuando SUNAT la RECHAZÓ.
--
-- Un rechazo es una respuesta definitiva sobre el XML/correlativo enviado: esa
-- fila, XML y CDR quedan como auditoría y NO se reenvían. Después de corregir la
-- venta/receptor se crea un CPE nuevo (nuevo correlativo) enlazado al rechazado.
-- Los estados `error` siguen reintentándose sobre la misma fila y correlativo.
--
-- Esta migración es ADITIVA respecto de migrate-facturacion-campo-2026-07-12.sql.
-- No editar ni volver a aplicar aquella migración para introducir este cambio.
-- Aplicar por psql ANTES del deploy del código nuevo:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-reemision-cpe-campo-rechazado-2026-07-12.sql

BEGIN;

-- 1. Cadena de reemplazo. Cada CPE nuevo apunta exactamente al CPE rechazado
--    cuyos datos corrige. La venta sigue identificándose por venta_avicola_id.
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS reemplaza_comprobante_id UUID
    REFERENCES public.comprobantes(id);

-- Un rechazado solo puede tener UN hijo. Junto con el claim de la venta, este
-- índice cierra doble clic, pestañas concurrentes y reintentos HTTP tardíos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_comprobantes_reemplaza_cpe
  ON public.comprobantes (reemplaza_comprobante_id)
  WHERE reemplaza_comprobante_id IS NOT NULL
    AND tipo IN ('01', '03');

CREATE INDEX IF NOT EXISTS idx_comprobantes_reemplaza_cpe
  ON public.comprobantes (reemplaza_comprobante_id, created_at DESC)
  WHERE reemplaza_comprobante_id IS NOT NULL;

-- 2. Solo puede existir UN CPE actual (no rechazado) por venta. Los rechazados
--    permanecen en el historial y liberan el cupo para su reemplazo. `error` NO
--    se excluye: debe reintentarse con el mismo correlativo y bloquea uno nuevo.
DROP INDEX IF EXISTS public.ux_comprobantes_venta_avicola_cpe;
CREATE UNIQUE INDEX ux_comprobantes_venta_avicola_cpe
  ON public.comprobantes (venta_avicola_id)
  WHERE venta_avicola_id IS NOT NULL
    AND tipo IN ('01', '03')
    AND estado <> 'rechazado';

COMMENT ON COLUMN public.comprobantes.reemplaza_comprobante_id IS
  'CPE 01/03 rechazado que este nuevo comprobante corrige; conserva la cadena de auditoría y exige nuevo correlativo';

COMMIT;

-- Verificación post-migración:
--   \d public.comprobantes
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename='comprobantes'
--      AND indexname IN ('ux_comprobantes_venta_avicola_cpe','ux_comprobantes_reemplaza_cpe');
