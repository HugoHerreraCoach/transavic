-- scripts/migrate-caja-operacion-2026-07-08.sql
-- Caja por operación: hoy hay UNA sola caja global (planta). Antonio quiere caja de PLANTA y caja de
-- CAMPO independientes (cada una abre/cierra por separado el mismo día). Ejecutivas NO tiene caja.
-- Se agrega la dimensión `operacion` y se reemplazan los dos candados que fuerzan una sola caja.
-- Idempotente y aditivo. Aplicar por psql (gotcha #13); a producción ANTES del deploy (gotcha #17).

-- 1. Columna discriminadora (backfill 'planta' a lo existente vía DEFAULT).
ALTER TABLE public.caja_diaria
  ADD COLUMN IF NOT EXISTS operacion VARCHAR(20) NOT NULL DEFAULT 'planta'
  CHECK (operacion IN ('planta', 'campo'));

-- Asegura que las filas previas queden como 'planta' (por si la columna existía sin default aplicado).
UPDATE public.caja_diaria SET operacion = 'planta' WHERE operacion IS NULL;

-- 2. Quitar el candado global "una caja por DÍA" (fecha UNIQUE) y reemplazarlo por (fecha, operacion),
--    así planta y campo pueden tener su propia caja el mismo día.
ALTER TABLE public.caja_diaria DROP CONSTRAINT IF EXISTS caja_diaria_fecha_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_caja_diaria_fecha_operacion
  ON public.caja_diaria (fecha, operacion);

-- 3. Quitar el candado "una sola ABIERTA global" y reemplazarlo por "una abierta POR operación".
DROP INDEX IF EXISTS ux_caja_diaria_unica_abierta;
CREATE UNIQUE INDEX IF NOT EXISTS ux_caja_diaria_unica_abierta_op
  ON public.caja_diaria (operacion) WHERE estado = 'Abierta';

-- La cuenta de efectivo de campo ('Caja Efectivo Campo') se crea al abrir por primera vez
-- (get-or-create por nombre en el endpoint), igual que hoy hace planta con 'Caja Efectivo Planta'.

-- Verificación:
--   \d public.caja_diaria
--   SELECT indexname FROM pg_indexes WHERE tablename='caja_diaria';
