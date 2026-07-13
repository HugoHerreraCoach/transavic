-- scripts/rollback-facturacion-campo-2026-07-12.sql
-- Revierte migrate-facturacion-campo-2026-07-12.sql.
-- Aplicar por psql: psql "$DATABASE_URL_UNPOOLED" -f scripts/rollback-facturacion-campo-2026-07-12.sql
--
-- OJO: si ya se emitieron comprobantes de campo, quitar venta_avicola_id pierde el
-- vínculo (los comprobantes quedan, pero se re-cuentan en ventas_facturadas y podrían
-- re-facturarse). Solo revertir si NO se emitió ningún comprobante de campo aún.

-- Guardas ejecutables: el orden correcto es revertir primero la migración de
-- reemisión y este rollback no debe borrar el origen de CPE de Campo existentes.
DO $$
DECLARE
  hay_cpe_campo BOOLEAN := FALSE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comprobantes'
      AND column_name = 'reemplaza_comprobante_id'
  ) THEN
    RAISE EXCEPTION
      'Rollback cancelado: ejecuta primero rollback-reemision-cpe-campo-rechazado-2026-07-12.sql.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comprobantes'
      AND column_name = 'venta_avicola_id'
  ) THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.comprobantes WHERE venta_avicola_id IS NOT NULL)'
      INTO hay_cpe_campo;
    IF hay_cpe_campo THEN
      RAISE EXCEPTION
        'Rollback cancelado: existen CPE de Campo y no se perderá su clasificación.';
    END IF;
  END IF;
END $$;

-- 1. Restaurar la vista SIN la exclusión de campo (definición original).
CREATE OR REPLACE VIEW ventas_facturadas AS
SELECT
  c.id   AS comprobante_id,
  c.tipo,
  c.empresa,
  (c.created_at AT TIME ZONE 'America/Lima')::date AS fecha,
  COALESCE(ue.id, p.asesor_id, uref.id, pref.asesor_id) AS asesora_id,
  CASE WHEN c.tipo = '07' THEN -c.monto_total ELSE c.monto_total END AS monto_neto,
  CASE WHEN c.tipo = '07' THEN 0 ELSE 1 END AS es_venta
FROM comprobantes c
LEFT JOIN pedidos p   ON c.pedido_id = p.id
LEFT JOIN users   ue  ON ue.role = 'asesor'
                     AND LOWER(TRIM(ue.name)) = LOWER(TRIM(c.emitido_por))
LEFT JOIN comprobantes cref ON c.referencia_comprobante_id = cref.id
LEFT JOIN pedidos pref ON cref.pedido_id = pref.id
LEFT JOIN users   uref ON uref.role = 'asesor'
                     AND LOWER(TRIM(uref.name)) = LOWER(TRIM(cref.emitido_por))
WHERE c.tipo IN ('01', '03', '07')
  AND c.estado IN ('aceptado', 'observado');

-- 2. Quitar columnas.
DROP INDEX IF EXISTS ux_comprobantes_venta_avicola_cpe;
DROP INDEX IF EXISTS ux_comprobantes_nc_referencia_activa;
DROP INDEX IF EXISTS idx_comprobantes_venta_avicola;
DROP INDEX IF EXISTS idx_ventas_avicola_facturacion_claim;
DROP INDEX IF EXISTS idx_comprobantes_nc_claim;
ALTER TABLE public.comprobantes   DROP COLUMN IF EXISTS venta_avicola_id;
ALTER TABLE public.comprobantes
  DROP COLUMN IF EXISTS nota_credito_claim_token,
  DROP COLUMN IF EXISTS nota_credito_claim_at;
ALTER TABLE public.clientes_avicola DROP COLUMN IF EXISTS ruc_dni;
ALTER TABLE public.ventas_avicola
  DROP COLUMN IF EXISTS facturacion_claim_token,
  DROP COLUMN IF EXISTS facturacion_claim_at;
