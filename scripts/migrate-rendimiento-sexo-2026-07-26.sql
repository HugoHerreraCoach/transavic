-- scripts/migrate-rendimiento-sexo-2026-07-26.sql
-- Agregar campos de desglose de sexo a compra_items
ALTER TABLE public.compra_items ADD COLUMN IF NOT EXISTS jabas_macho INTEGER DEFAULT 0;
ALTER TABLE public.compra_items ADD COLUMN IF NOT EXISTS jabas_hembra INTEGER DEFAULT 0;
ALTER TABLE public.compra_items ADD COLUMN IF NOT EXISTS sueltos_macho INTEGER DEFAULT 0;
ALTER TABLE public.compra_items ADD COLUMN IF NOT EXISTS sueltos_hembra INTEGER DEFAULT 0;
ALTER TABLE public.compra_items ADD COLUMN IF NOT EXISTS total_pollos INTEGER DEFAULT 0;

-- Registrar índices de velocidad
CREATE INDEX IF NOT EXISTS idx_compra_items_sexo ON public.compra_items (jabas_macho, jabas_hembra);
