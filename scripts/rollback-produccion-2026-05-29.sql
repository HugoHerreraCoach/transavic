-- ============================================================================
-- rollback-produccion-2026-05-29.sql
-- ----------------------------------------------------------------------------
-- Revierte migrate-produccion-2026-05-29.sql: elimina las 8 tablas nuevas y las
-- 13 columnas agregadas. Deja la base como estaba (6 tablas originales).
--
-- ⚠️⚠️⚠️ PELIGRO — SCRIPT HISTÓRICO, NO EJECUTAR EN PRODUCCIÓN ⚠️⚠️⚠️
--
--    USAR SOLO INMEDIATAMENTE DESPUÉS DE MIGRAR, ANTES DE QUE LA APP NUEVA
--    ESCRIBA DATOS en las tablas nuevas. Hoy YA hay comprobantes electrónicos
--    emitidos: este DROP TABLE borra `comprobantes_contador` y `correlativos`,
--    reiniciando la numeración de comprobantes SUNAT a 0 → el sistema
--    REUTILIZARÍA números ya ACEPTADOS por SUNAT (infracción tributaria: la
--    numeración de CPE JAMÁS se rebobina). Si necesitas revertir, restaurá
--    desde el backup de Neon (branch/point-in-time), NO uses este script.
--
--    GUARD: el bloque de abajo ABORTA con excepción si `comprobantes_contador`
--    o `correlativos` ya tienen numeración consumida (ultimo_numero > 0). Para
--    ejecutarlo igual (entorno limpio recién migrado), borrá el bloque guard.
--
-- CÓMO EJECUTAR (solo en base recién migrada y vacía):
--   PROD_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
--   psql "$PROD_URL" -f scripts/rollback-produccion-2026-05-29.sql
-- ============================================================================

BEGIN;

-- ── GUARD: abortar si ya hay numeración de comprobantes consumida ──────────
-- Protege contra el peor caso: dropear los contadores y reusar correlativos ya
-- aceptados por SUNAT. Corre antes de cualquier DROP; si dispara, el BEGIN se
-- revierte y no se toca nada.
DO $$
DECLARE
  v_max_contador  bigint := 0;
  v_max_correl    bigint := 0;
  v_comprobantes  bigint := 0;
BEGIN
  IF to_regclass('public.comprobantes_contador') IS NOT NULL THEN
    SELECT COALESCE(MAX(ultimo_numero), 0) INTO v_max_contador FROM public.comprobantes_contador;
  END IF;
  IF to_regclass('public.correlativos') IS NOT NULL THEN
    SELECT COALESCE(MAX(ultimo_numero), 0) INTO v_max_correl FROM public.correlativos;
  END IF;
  IF to_regclass('public.comprobantes') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_comprobantes FROM public.comprobantes;
  END IF;

  IF v_max_contador > 0 OR v_max_correl > 0 OR v_comprobantes > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTADO: ya hay numeración SUNAT consumida (comprobantes_contador.max=%, correlativos.max=%, comprobantes=%). Dropear estas tablas reutilizaría números ya aceptados por SUNAT (infracción). Restaurá desde backup de Neon, NO uses este script. Para forzar en una base limpia, borrá este bloque DO.',
      v_max_contador, v_max_correl, v_comprobantes;
  END IF;
END $$;

-- Tablas nuevas (CASCADE limpia FKs/índices asociados).
DROP TABLE IF EXISTS public.precios_productos  CASCADE;
DROP TABLE IF EXISTS public.resumenes_diarios  CASCADE;
DROP TABLE IF EXISTS public.notificaciones     CASCADE;
DROP TABLE IF EXISTS public.metas_asesoras     CASCADE;
DROP TABLE IF EXISTS public.facturas           CASCADE;  -- FK a comprobantes → dropear antes
DROP TABLE IF EXISTS public.comprobantes       CASCADE;
DROP TABLE IF EXISTS public.comprobantes_contador CASCADE;
DROP TABLE IF EXISTS public.correlativos       CASCADE;

-- Columnas agregadas a tablas existentes.
ALTER TABLE public.clientes     DROP COLUMN IF EXISTS plazo_pago_dias;
ALTER TABLE public.pedidos      DROP COLUMN IF EXISTS numero_guia;
ALTER TABLE public.pedidos      DROP COLUMN IF EXISTS guia_firmada_at;
ALTER TABLE public.pedidos      DROP COLUMN IF EXISTS guia_firmada_data;
ALTER TABLE public.pedidos      DROP COLUMN IF EXISTS guia_firmada_mime;
ALTER TABLE public.pedidos      DROP COLUMN IF EXISTS pesado_at;
ALTER TABLE public.pedidos      DROP COLUMN IF EXISTS pesado_por;
ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS precio_unitario;
ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS subtotal;
ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS cantidad_real;
ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS subtotal_real;
ALTER TABLE public.productos    DROP COLUMN IF EXISTS codigo;
ALTER TABLE public.productos    DROP COLUMN IF EXISTS precio_compra;
ALTER TABLE public.productos    DROP COLUMN IF EXISTS precio_venta;

COMMIT;
