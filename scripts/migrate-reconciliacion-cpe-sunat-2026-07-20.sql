-- Reconciliacion segura de facturas/boletas con respuesta temporal de SUNAT.
--
-- Alcance deliberadamente acotado:
--   * CPE 01/03 emitidos por SOAP (la conciliacion posterior usa SOAP para 01
--     y Consulta Integrada REST para 03; no modifica XML, firma ni correlativos).
--   * Conserva el codigo/mensaje del envio y registra las consultas posteriores.
--   * Agrega un claim por pedido para impedir un segundo correlativo mientras el
--     primer comprobante sigue en envio o pendiente de confirmacion.
--   * NO toca comprobantes_guias ni el flujo REST/OAuth de GRE.

BEGIN;

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS sunat_codigo_envio VARCHAR(10),
  ADD COLUMN IF NOT EXISTS sunat_mensaje_envio TEXT,
  ADD COLUMN IF NOT EXISTS sunat_codigo_consulta VARCHAR(10),
  ADD COLUMN IF NOT EXISTS sunat_cdr_legible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sunat_ultima_consulta_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sunat_siguiente_consulta_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sunat_consultas_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sunat_no_existe_consecutivos SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sunat_consulta_claim_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sunat_requiere_revision BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sunat_revision_motivo TEXT,
  ADD COLUMN IF NOT EXISTS sunat_postproceso_estado VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sunat_postproceso_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sunat_postproceso_error TEXT,
  ADD COLUMN IF NOT EXISTS cobranza_cliente_id UUID
    REFERENCES clientes(id) ON DELETE SET NULL;

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS facturacion_cpe_claim_token UUID,
  ADD COLUMN IF NOT EXISTS facturacion_cpe_claim_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_comprobantes_sunat_por_confirmar
  ON comprobantes (sunat_siguiente_consulta_at, created_at)
  WHERE estado = 'por_confirmar' AND tipo IN ('01', '03');

CREATE INDEX IF NOT EXISTS idx_comprobantes_sunat_cdr_pendiente
  ON comprobantes (sunat_siguiente_consulta_at, created_at)
  WHERE estado IN ('aceptado', 'observado')
    AND tipo IN ('01', '03')
    AND NOT sunat_cdr_legible;

DROP INDEX IF EXISTS idx_comprobantes_sunat_postproceso;
CREATE INDEX idx_comprobantes_sunat_postproceso
  ON comprobantes (created_at)
  WHERE sunat_postproceso_estado IN ('pendiente', 'aplicando')
    AND estado IN ('aceptado', 'observado')
    AND tipo IN ('01', '03');

CREATE INDEX IF NOT EXISTS idx_pedidos_facturacion_cpe_claim
  ON pedidos (facturacion_cpe_claim_at)
  WHERE facturacion_cpe_claim_token IS NOT NULL;

-- Defensa final de idempotencia financiera. El claim de postproceso evita la
-- concurrencia normal; estos indices impiden una deuda doble incluso si una
-- funcion muere justo despues del INSERT y otro runtime intenta recuperarla.
-- Si existen duplicados historicos, la migracion falla y obliga a auditarlos en
-- vez de ocultarlos o borrar datos automaticamente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_comprobante_id_cpe
  ON facturas (comprobante_id)
  WHERE comprobante_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_pedido_serie_cpe
  ON facturas (pedido_id, numero_comprobante)
  WHERE pedido_id IS NOT NULL
    AND COALESCE(numero_comprobante, '') <> '';

-- Backfill intencionalmente estricto: solo el caso exacto 0140 ya comprobado.
-- No reclasifica en masa los demas errores/rechazos historicos.
UPDATE comprobantes
SET sunat_cdr_legible = TRUE
WHERE cdr_base64 IS NOT NULL
  AND estado IN ('aceptado', 'observado', 'rechazado');

UPDATE comprobantes
SET estado = 'por_confirmar',
    sunat_codigo_envio = COALESCE(sunat_codigo_envio, '0140'),
    sunat_mensaje_envio = COALESCE(sunat_mensaje_envio, mensaje_sunat),
    mensaje_sunat =
      'SUNAT informó que el comprobante seguía en proceso. No emitas otro; el sistema verificará este mismo número automáticamente.',
    sunat_siguiente_consulta_at = COALESCE(sunat_siguiente_consulta_at, NOW()),
    sunat_no_existe_consecutivos = 0
WHERE tipo IN ('01', '03')
  AND estado IN ('error', 'rechazado')
  AND xml_firmado_base64 IS NOT NULL
  AND (
    mensaje_sunat ILIKE '%Existe un Documento igual en Proceso%'
    OR mensaje_sunat ILIKE '%documento igual en proceso%'
  );

COMMIT;
