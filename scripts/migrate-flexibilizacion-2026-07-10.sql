-- scripts/migrate-flexibilizacion-2026-07-10.sql
-- Flexibilización v1 (auditoría 10 jul 2026): columnas para que admin gestione el
-- sistema desde el frontend sin programador.
--   1) users.activo          → desactivar ex-empleados (el login lo rechaza; JAMÁS DELETE).
--   2) proveedores.activo    → ocultar proveedores viejos de los selects (histórico intacto).
--   3) proveedores.plazo_pago_dias → vencimiento de la deuda POR proveedor (antes: +30 fijo).
--   4) transacciones.fecha   → fecha REAL del movimiento (el usuario la elegía y se descartaba
--                              — bug fechaPago); default hoy Lima para las filas nuevas.
-- Idempotente y aditivo; inerte para el código viejo (defaults). Aplicar por psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-flexibilizacion-2026-07-10.sql
-- A producción SIEMPRE ANTES del deploy (gotcha #17).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER NOT NULL DEFAULT 30;

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date;

-- Verificación:
--   \d public.users  \d public.proveedores  \d public.transacciones
