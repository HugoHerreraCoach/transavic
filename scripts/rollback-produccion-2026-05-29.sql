-- ============================================================================
-- rollback-produccion-2026-05-29.sql
-- ----------------------------------------------------------------------------
-- Revierte migrate-produccion-2026-05-29.sql: elimina las 8 tablas nuevas y las
-- 13 columnas agregadas. Deja la base como estaba (6 tablas originales).
--
-- ⚠️ USAR SOLO INMEDIATAMENTE DESPUÉS DE MIGRAR, ANTES DE QUE LA APP NUEVA
--    ESCRIBA DATOS en las tablas nuevas. Si ya hay comprobantes/facturas/etc.
--    emitidos, DROP TABLE los borra: en ese caso restaurar desde el backup de
--    Neon (branch/point-in-time), no usar este script.
--
-- CÓMO EJECUTAR:
--   PROD_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
--   psql "$PROD_URL" -f scripts/rollback-produccion-2026-05-29.sql
-- ============================================================================

BEGIN;

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
