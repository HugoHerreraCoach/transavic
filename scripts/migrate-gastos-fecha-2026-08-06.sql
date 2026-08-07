-- scripts/migrate-gastos-fecha-2026-08-06.sql
-- Gastos con fecha real: índice para consultarlos por día y auditoría de correcciones.
--
-- Problema que resuelve: la pantalla de Caja mandaba SIEMPRE la fecha de hoy, así
-- que la administradora escribía la fecha verdadera DENTRO de la descripción
-- ("Gasto: Otros - PETER CON 13-07") — 14 de los 16 gastos cargados en producción
-- son así. La columna `gastos.fecha` ya existía y el API ya la aceptaba: lo que
-- faltaba era dejar elegirla, poder CORREGIRLA, y que consultar por día no
-- escanee la tabla entera.
--
-- Idempotente y aditivo. psql en dev-hugo primero, y en producción ANTES del
-- deploy del código nuevo (gotchas #13/#17). El flag -1 ya envuelve en transacción.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-gastos-fecha-2026-08-06.sql

-- Quién corrigió por última vez el gasto. `updated_at` ya existía pero nadie lo
-- escribía (no había forma de editar un gasto: un error era permanente).
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS updated_by UUID
  REFERENCES public.users(id) ON DELETE SET NULL;

-- La vista de Gastos filtra por rango de fechas (Desde/Hasta) y ordena por fecha;
-- sin índice eso es un seq scan sobre toda la tabla. DESC porque siempre se mira
-- lo más reciente primero.
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON public.gastos (fecha DESC);

-- El arqueo de caja y el detalle de un día leen `transacciones` por cuenta y por
-- fecha del movimiento. La columna `fecha` existe desde migrate-flexibilizacion
-- (10 jul) pero nunca se indexó.
CREATE INDEX IF NOT EXISTS idx_transacciones_cuenta_fecha
  ON public.transacciones (cuenta_id, fecha DESC);
