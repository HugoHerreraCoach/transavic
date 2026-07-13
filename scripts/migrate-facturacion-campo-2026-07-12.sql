-- scripts/migrate-facturacion-campo-2026-07-12.sql
-- Facturación SUNAT de la VENTA EN CAMPO (módulo Clientes Avícola).
--
-- Antonio (dueño/GG) hace la venta en campo. Ahora puede emitir factura/boleta/GRE/NC
-- de las ventas de campo que elija, REUTILIZANDO el mismo motor de las ejecutivas
-- (emitir-manual). Para no contaminar metas ni cartera de ejecutivas se agrega un
-- vínculo comprobante ↔ venta de campo y se excluye ese comprobante de la vista
-- `ventas_facturadas` (métrica de asesoras). El guard anti-cobranza vive en el código
-- (emitir-manual: esCampo, igual patrón que esPos del POS — gotcha #42).
--
-- Idempotente y aditivo. Aplicar por psql (gotcha #13 — los .mjs fallan con Node 26):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-facturacion-campo-2026-07-12.sql
-- A producción SIEMPRE ANTES del deploy con el código nuevo (gotcha #17).

-- 1. Vínculo comprobante ↔ venta de campo (único nexo; NO existía columna de origen).
--    Nullable: la enorme mayoría de comprobantes (ejecutivas/planta) lo dejan NULL.
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS venta_avicola_id UUID REFERENCES public.ventas_avicola(id);

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS nota_credito_claim_token UUID,
  ADD COLUMN IF NOT EXISTS nota_credito_claim_at TIMESTAMP WITH TIME ZONE;

-- Una venta de campo tiene UNA sola factura/boleta. Los errores/rechazos se
-- reintentan actualizando esa misma fila; nunca se consume otro correlativo.
-- La condición por tipo permite que la NC (07) herede venta_avicola_id sin
-- colisionar con el comprobante original.
DROP INDEX IF EXISTS idx_comprobantes_venta_avicola;
CREATE UNIQUE INDEX IF NOT EXISTS ux_comprobantes_venta_avicola_cpe
  ON public.comprobantes (venta_avicola_id)
  WHERE venta_avicola_id IS NOT NULL AND tipo IN ('01', '03');

-- Una factura/boleta solo puede tener UNA NC activa. Las NC rechazadas/error
-- quedan como auditoría pero liberan un nuevo intento, igual que el flujo actual.
-- La fila se reserva con estado `emitiendo` ANTES del SOAP, cerrando el doble clic.
CREATE UNIQUE INDEX IF NOT EXISTS ux_comprobantes_nc_referencia_activa
  ON public.comprobantes (referencia_comprobante_id)
  WHERE referencia_comprobante_id IS NOT NULL
    AND tipo = '07'
    AND estado NOT IN ('error', 'rechazado', 'anulado');

CREATE INDEX IF NOT EXISTS idx_comprobantes_nc_claim
  ON public.comprobantes (nota_credito_claim_at)
  WHERE nota_credito_claim_token IS NOT NULL;

-- 2. RUC/DNI del cliente de campo. `clientes_avicola` no lo tenía (los clientes de
--    mercado casi siempre reciben BOLETA sin documento). Para FACTURA se captura al
--    emitir (consulta SUNAT en el form) y se guarda aquí para reutilizarlo — mismo
--    patrón que `clientes.ruc_dni` de las ejecutivas.
ALTER TABLE public.clientes_avicola
  ADD COLUMN IF NOT EXISTS ruc_dni VARCHAR(20);

-- Claim corto para cerrar la carrera validar↔reservar: desde antes de leer los
-- ítems hasta que existe la fila CPE, ninguna otra pestaña puede editar/anular la
-- venta. El token evita que una solicitud vieja libere el claim de otra nueva.
ALTER TABLE public.ventas_avicola
  ADD COLUMN IF NOT EXISTS facturacion_claim_token UUID,
  ADD COLUMN IF NOT EXISTS facturacion_claim_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_ventas_avicola_facturacion_claim
  ON public.ventas_avicola (facturacion_claim_at)
  WHERE facturacion_claim_token IS NOT NULL;

-- 3. Recrear la vista `ventas_facturadas` (métrica de asesoras: metas/racha/ranking)
--    EXCLUYENDO los comprobantes de campo (venta_avicola_id IS NOT NULL). Un comprobante
--    de campo lo emite el admin (Antonio), sin pedido ni asesora → no debe sumar a
--    facturación de ejecutivas. Definición idéntica a migrate-ventas-facturadas-view.sql
--    salvo la condición extra del WHERE. Aditiva (CREATE OR REPLACE VIEW).
CREATE OR REPLACE VIEW ventas_facturadas AS
SELECT
  c.id   AS comprobante_id,
  c.tipo,                                                      -- '01' | '03' | '07'
  c.empresa,
  (c.created_at AT TIME ZONE 'America/Lima')::date AS fecha,   -- fecha de emisión
  COALESCE(ue.id, p.asesor_id, uref.id, pref.asesor_id) AS asesora_id,
  CASE WHEN c.tipo = '07' THEN -c.monto_total ELSE c.monto_total END AS monto_neto,
  CASE WHEN c.tipo = '07' THEN 0 ELSE 1 END AS es_venta
FROM comprobantes c
LEFT JOIN pedidos p   ON c.pedido_id = p.id
LEFT JOIN users   ue  ON ue.role = 'asesor'
                     AND LOWER(TRIM(ue.name)) = LOWER(TRIM(c.emitido_por))
LEFT JOIN comprobantes cref ON c.referencia_comprobante_id = cref.id   -- solo NC
LEFT JOIN pedidos pref ON cref.pedido_id = pref.id
LEFT JOIN users   uref ON uref.role = 'asesor'
                     AND LOWER(TRIM(uref.name)) = LOWER(TRIM(cref.emitido_por))
WHERE c.tipo IN ('01', '03', '07')
  AND c.estado IN ('aceptado', 'observado')
  AND c.venta_avicola_id IS NULL
  AND cref.venta_avicola_id IS NULL; -- ← NC de campo tampoco cuenta para metas

-- Verificación rápida post-migración:
--   \d public.comprobantes        (ver venta_avicola_id + índice único parcial)
--   \d public.clientes_avicola     (ver ruc_dni)
--   \d public.ventas_avicola       (ver facturacion_claim_*)
--   \d+ ventas_facturadas          (WHERE incluye venta_avicola_id IS NULL)
