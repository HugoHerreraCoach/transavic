-- Rollback de metadatos de reconciliacion CPE.
-- Ejecutar solo despues de retirar el codigo que usa estas columnas.

BEGIN;

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pedidos
    WHERE facturacion_cpe_claim_token IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Rollback abortado: existen claims de facturacion CPE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM comprobantes
    WHERE sunat_consulta_claim_at IS NOT NULL
       OR sunat_postproceso_estado IN ('pendiente', 'aplicando')
       OR (
         tipo IN ('01', '03')
         AND estado IN ('emitiendo', 'por_confirmar', 'no_registrado')
       )
       OR sunat_requiere_revision
  ) THEN
    RAISE EXCEPTION
      'Rollback abortado: existen CPE en consulta, postproceso o revision; resuelvelos antes de retirar las columnas';
  END IF;
END
$rollback$;

-- El codigo anterior comprende `error`, pero no los dos estados nuevos.
UPDATE comprobantes
SET estado = 'error',
    mensaje_sunat = CASE
      WHEN estado = 'no_registrado' THEN
        'SUNAT no encontró este número en las consultas realizadas. Reintenta el mismo comprobante; no emitas otro correlativo.'
      ELSE
        'No se pudo confirmar si SUNAT recibió el comprobante. Reintenta el mismo número con precaución; no emitas otro correlativo.'
    END
WHERE estado IN ('por_confirmar', 'no_registrado');

DROP INDEX IF EXISTS idx_pedidos_facturacion_cpe_claim;
DROP INDEX IF EXISTS uq_facturas_pedido_serie_cpe;
DROP INDEX IF EXISTS uq_facturas_comprobante_id_cpe;
DROP INDEX IF EXISTS idx_comprobantes_sunat_postproceso;
DROP INDEX IF EXISTS idx_comprobantes_sunat_cdr_pendiente;
DROP INDEX IF EXISTS idx_comprobantes_sunat_por_confirmar;

ALTER TABLE pedidos
  DROP COLUMN IF EXISTS facturacion_cpe_claim_at,
  DROP COLUMN IF EXISTS facturacion_cpe_claim_token;

ALTER TABLE comprobantes
  DROP COLUMN IF EXISTS cobranza_cliente_id,
  DROP COLUMN IF EXISTS sunat_postproceso_error,
  DROP COLUMN IF EXISTS sunat_postproceso_at,
  DROP COLUMN IF EXISTS sunat_postproceso_estado,
  DROP COLUMN IF EXISTS sunat_revision_motivo,
  DROP COLUMN IF EXISTS sunat_requiere_revision,
  DROP COLUMN IF EXISTS sunat_consulta_claim_at,
  DROP COLUMN IF EXISTS sunat_no_existe_consecutivos,
  DROP COLUMN IF EXISTS sunat_consultas_count,
  DROP COLUMN IF EXISTS sunat_siguiente_consulta_at,
  DROP COLUMN IF EXISTS sunat_ultima_consulta_at,
  DROP COLUMN IF EXISTS sunat_cdr_legible,
  DROP COLUMN IF EXISTS sunat_codigo_consulta,
  DROP COLUMN IF EXISTS sunat_mensaje_envio,
  DROP COLUMN IF EXISTS sunat_codigo_envio;

COMMIT;
