-- scripts/rollback-cuadre-pollo-2026-07-30.sql
-- Revierte migrate-cuadre-pollo-2026-07-30.sql.
--
-- OJO: DROP TABLE borra la captura manual del cuadre (aves y kg a corte de cada
-- día). Si hay días ya cargados, respaldar antes:
--   \copy (SELECT * FROM public.cuadre_pollo_dia ORDER BY fecha) TO 'cuadre_pollo_dia.csv' CSV HEADER
--
-- Aplicar con:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-cuadre-pollo-2026-07-30.sql

DROP TABLE IF EXISTS public.cuadre_pollo_dia;

ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS chk_productos_origen_fisico;
DROP INDEX IF EXISTS public.idx_productos_origen_fisico;
ALTER TABLE public.productos DROP COLUMN IF EXISTS origen_fisico;
