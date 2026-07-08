-- scripts/migrate-proveedores-tipo-ruc-opcional-2026-07-07.sql
-- Ajustes de proveedores pedidos por Antonio (7 jul 2026):
--   1) Solo nombre (razon_social) y teléfono obligatorios; RUC y demás OPCIONALES
--      (hay proveedores secundarios informales sin RUC).
--   2) Clasificar proveedores como 'principal' o 'secundario'.
-- Idempotente y aditivo. Aplicar por psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-proveedores-tipo-ruc-opcional-2026-07-07.sql
-- A producción SIEMPRE ANTES del deploy (gotcha #17).

-- 1) RUC deja de ser obligatorio.
ALTER TABLE public.proveedores ALTER COLUMN ruc DROP NOT NULL;

-- 2) Quitar el UNIQUE total del RUC (chocaba si varios informales quedaban sin RUC)
--    y reemplazarlo por un índice UNIQUE PARCIAL: la unicidad solo aplica cuando hay
--    RUC de verdad. El nombre del constraint autogenerado suele ser proveedores_ruc_key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proveedores_ruc_key'
  ) THEN
    ALTER TABLE public.proveedores DROP CONSTRAINT proveedores_ruc_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_proveedores_ruc
  ON public.proveedores (ruc)
  WHERE ruc IS NOT NULL AND ruc <> '';

-- 3) Clasificación principal/secundario (default 'principal' para los ya existentes).
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'principal'
  CHECK (tipo IN ('principal', 'secundario'));

-- Verificación:
--   \d public.proveedores
