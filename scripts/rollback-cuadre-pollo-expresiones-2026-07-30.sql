-- scripts/rollback-cuadre-pollo-expresiones-2026-07-30.sql
-- Revierte migrate-cuadre-pollo-expresiones-2026-07-30.sql.
--
-- Se pierde el desglose de pesadas ("62+62.2+62.5…"), NO los totales: las
-- columnas numéricas del cuadre quedan intactas. Para conservarlo:
--   \copy (SELECT fecha, expr_corte, expr_corte_especial, expr_pollo_entero,
--                 expr_aves_macho, expr_aves_hembra
--          FROM public.cuadre_pollo_dia ORDER BY fecha) TO 'expresiones.csv' CSV HEADER
--
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-cuadre-pollo-expresiones-2026-07-30.sql

ALTER TABLE public.cuadre_pollo_dia
  DROP COLUMN IF EXISTS expr_corte,
  DROP COLUMN IF EXISTS expr_corte_especial,
  DROP COLUMN IF EXISTS expr_pollo_entero,
  DROP COLUMN IF EXISTS expr_aves_macho,
  DROP COLUMN IF EXISTS expr_aves_hembra;
