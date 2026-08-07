-- scripts/rollback-gastos-fecha-2026-08-06.sql
-- Revierte migrate-gastos-fecha-2026-08-06.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-gastos-fecha-2026-08-06.sql
--
-- Los índices se pueden borrar sin consecuencias (solo se pierde velocidad).
-- `updated_by` sí borra información: quién corrigió cada gasto.

DROP INDEX IF EXISTS public.idx_transacciones_cuenta_fecha;
DROP INDEX IF EXISTS public.idx_gastos_fecha;

ALTER TABLE public.gastos DROP COLUMN IF EXISTS updated_by;
