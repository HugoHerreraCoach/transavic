-- ============================================================================
-- migrate-guias-numeracion-2026-06-10.sql
-- ----------------------------------------------------------------------------
-- Separa la numeración de la "orden de pedido" INTERNA (no fiscal) de la
-- numeración de la GUÍA DE REMISIÓN ELECTRÓNICA LEGAL (T001/T002, SUNAT).
--
-- PROBLEMA QUE RESUELVE: hoy ambas comparten el correlativo `guia_remision`.
-- Cada vez que se ABRE una orden de pedido (`/pedidos/[id]/guia`) se consume un
-- número de la numeración LEGAL de las guías → las guías legales saltan de
-- número. En producción (2026-06-10): guia_remision=9, de los cuales 1..7 los
-- gastaron órdenes internas y 8..9 fueron guías legales T002 (rechazadas).
--
-- DESPUÉS de esta migración:
--   - La orden interna usa el correlativo NUEVO `orden_pedido` (continúa desde
--     el valor actual para no repetir números de órdenes ya impresas).
--   - La GRE legal usa un contador POR SERIE en `comprobantes_contador`
--     (la misma tabla que ya usan boletas/facturas), separado por RUC+serie.
--
-- Aditiva e idempotente. Aplicar a dev-hugo Y a producción ANTES del deploy
-- del código nuevo (gotcha #17): el código nuevo lee estos contadores.
--
-- CÓMO EJECUTAR:
--   PROD_URL=$(grep -E '^DATABASE_URL_UNPOOLED=' .env | head -1 | cut -d= -f2- | tr -d '"')
--   psql "$PROD_URL" -f scripts/migrate-guias-numeracion-2026-06-10.sql
-- ============================================================================

BEGIN;

-- 1) Correlativo propio para la ORDEN DE PEDIDO interna.
--    Se siembra con el valor ACTUAL del correlativo compartido `guia_remision`
--    para que la próxima orden continúe la numeración que ya vienen viendo
--    (no repite números de órdenes 1..7 ya impresas).
INSERT INTO correlativos (tipo, ultimo_numero, updated_at)
SELECT 'orden_pedido', ultimo_numero, NOW()
FROM correlativos
WHERE tipo = 'guia_remision'
ON CONFLICT (tipo) DO NOTHING;

-- Fallback defensivo (si `guia_remision` no existiera, arranca en 0).
INSERT INTO correlativos (tipo, ultimo_numero)
VALUES ('orden_pedido', 0)
ON CONFLICT (tipo) DO NOTHING;

-- 2) Contadores POR SERIE para la GRE legal, separados de la orden interna.
--    El RUC de cada empresa se deriva de su contador de boletas ya existente
--    (B001 = Transavic, B002 = Avícola) — más robusto que hardcodear.
--    Seed seguro = GREATEST(piso, MAX(numero) ya emitido en esa serie), para
--    NUNCA reusar un número que ya pudo enviarse a SUNAT (regla SUNAT):
--      T001 (Transavic): nunca emitida legalmente → piso 0  → próxima = 1.
--      T002 (Avícola):   8 y 9 rechazadas          → piso 9  → próxima = 10.
INSERT INTO comprobantes_contador (ruc, serie, ultimo_numero)
SELECT c.ruc, 'T001',
       GREATEST(0, COALESCE((SELECT MAX(numero) FROM comprobantes_guias WHERE serie = 'T001'), 0))
FROM comprobantes_contador c
WHERE c.serie = 'B001'
LIMIT 1
ON CONFLICT (ruc, serie) DO UPDATE
  SET ultimo_numero = GREATEST(comprobantes_contador.ultimo_numero, EXCLUDED.ultimo_numero);

INSERT INTO comprobantes_contador (ruc, serie, ultimo_numero)
SELECT c.ruc, 'T002',
       GREATEST(9, COALESCE((SELECT MAX(numero) FROM comprobantes_guias WHERE serie = 'T002'), 0))
FROM comprobantes_contador c
WHERE c.serie = 'B002'
LIMIT 1
ON CONFLICT (ruc, serie) DO UPDATE
  SET ultimo_numero = GREATEST(comprobantes_contador.ultimo_numero, EXCLUDED.ultimo_numero);

COMMIT;

-- Verificación (no transaccional):
--   SELECT * FROM correlativos;                              -- orden_pedido = 7, guia_remision = 9 (congelado)
--   SELECT * FROM comprobantes_contador WHERE serie IN ('T001','T002');  -- T001=0, T002=9
