-- scripts/migrate-compras-mejoras-2026-07-09.sql
-- Mejoras del módulo de Compras pedidas por Nelita (9 jul 2026):
--   1) Filas de DEVOLUCIÓN al proveedor dentro de la guía (restan deuda + inventario)
--      → compra_items.tipo ('ingreso' | 'devolucion').
--   2) Deuda MANUAL / saldo anterior del proveedor (cuentas_por_pagar con compra_id NULL)
--      → cuentas_por_pagar.concepto (rótulo visible, ej. "Saldo anterior").
--   3) Ítem de SERVICIO "Pelada de pollo" (el proveedor cobra por pelar; suma a la deuda,
--      NO mueve inventario) → seed idempotente en el catálogo, categoría 'Servicios'.
-- Idempotente y aditivo; inerte para el código viejo (defaults). Aplicar por psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-compras-mejoras-2026-07-09.sql
-- A producción SIEMPRE ANTES del deploy (gotcha #17).

-- 1) Tipo de fila en compra_items.
ALTER TABLE public.compra_items
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(15) NOT NULL DEFAULT 'ingreso';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compra_items_tipo_chk'
  ) THEN
    ALTER TABLE public.compra_items
      ADD CONSTRAINT compra_items_tipo_chk CHECK (tipo IN ('ingreso', 'devolucion'));
  END IF;
END $$;

-- 2) Concepto de la deuda (para deudas manuales sin compra: "Saldo anterior", etc.).
ALTER TABLE public.cuentas_por_pagar
  ADD COLUMN IF NOT EXISTS concepto TEXT;

-- 3) Seed del servicio "Pelada de pollo" (solo si no existe; codigo es nullable).
INSERT INTO public.productos (nombre, categoria, unidad, activo, codigo)
SELECT 'Pelada de pollo', 'Servicios', 'uni', TRUE, 'SRV001'
WHERE NOT EXISTS (
  SELECT 1 FROM public.productos WHERE nombre ILIKE 'pelada de pollo'
);

-- Verificación:
--   \d public.compra_items
--   \d public.cuentas_por_pagar
--   SELECT nombre, categoria FROM productos WHERE categoria ILIKE '%servicio%';
