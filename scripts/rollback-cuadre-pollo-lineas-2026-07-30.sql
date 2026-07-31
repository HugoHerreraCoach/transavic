-- scripts/rollback-cuadre-pollo-lineas-2026-07-30.sql
-- Revierte migrate-cuadre-pollo-lineas-2026-07-30.sql.
--
-- ⚠️ DROP TABLE borra las líneas propias del día (corte, corte especial, pollo
-- entero y cualquier concepto que la usuaria haya agregado). Los totales del
-- sistema (compras, campo, planta) NO se tocan: se recalculan solos.
-- Respaldar antes si ya hay días cargados:
--   \copy (SELECT * FROM public.cuadre_pollo_lineas ORDER BY fecha, seccion, orden) TO 'cuadre_pollo_lineas.csv' CSV HEADER
--   \copy (SELECT fecha, kg_campo_ajustado, kg_campo_motivo, kg_planta_ajustado, kg_planta_motivo FROM public.cuadre_pollo_dia) TO 'cuadre_pollo_ajustes.csv' CSV HEADER
--
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-cuadre-pollo-lineas-2026-07-30.sql

DROP TABLE IF EXISTS public.cuadre_pollo_lineas;

ALTER TABLE public.cuadre_pollo_dia DROP CONSTRAINT IF EXISTS chk_cuadre_pollo_ajustes_con_motivo;
ALTER TABLE public.cuadre_pollo_dia
  DROP COLUMN IF EXISTS kg_campo_ajustado,
  DROP COLUMN IF EXISTS kg_campo_motivo,
  DROP COLUMN IF EXISTS kg_planta_ajustado,
  DROP COLUMN IF EXISTS kg_planta_motivo;
