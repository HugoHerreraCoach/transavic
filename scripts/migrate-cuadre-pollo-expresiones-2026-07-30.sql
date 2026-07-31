-- scripts/migrate-cuadre-pollo-expresiones-2026-07-30.sql
-- Cuadre de Pollo: guardar la EXPRESIÓN tal como la teclea la usuaria.
--
-- En el Excel de Marianela el 23% de las celdas de peso son sumas de varias
-- pesadas — en "CORTE" pasa 29 de 32 días, con hasta 11 pesadas seguidas
-- ("62+62.2+62.5+61.75+…"), y las aves las cuenta con "70+15+55*7+15".
-- Guardando solo el total, para corregir UNA pesada tendría que volver a
-- teclear las otras diez. Con la expresión guardada, reabre el día y la edita.
--
-- CONTRATO: las columnas NUMÉRICAS siguen siendo la fuente de verdad del
-- cálculo. La expresión es únicamente para poder reeditarla; el servidor la
-- revalida y rechaza (400) si no coincide con el número. NULL = se digitó un
-- número suelto, sin desglose.
--
-- Idempotente y ADITIVA. A producción por psql ANTES del deploy (gotcha #17):
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-cuadre-pollo-expresiones-2026-07-30.sql
-- Rollback: scripts/rollback-cuadre-pollo-expresiones-2026-07-30.sql

ALTER TABLE public.cuadre_pollo_dia
  ADD COLUMN IF NOT EXISTS expr_corte TEXT,
  ADD COLUMN IF NOT EXISTS expr_corte_especial TEXT,
  ADD COLUMN IF NOT EXISTS expr_pollo_entero TEXT,
  ADD COLUMN IF NOT EXISTS expr_aves_macho TEXT,
  ADD COLUMN IF NOT EXISTS expr_aves_hembra TEXT;
