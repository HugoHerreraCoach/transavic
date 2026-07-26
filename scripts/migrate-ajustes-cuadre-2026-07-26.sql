-- Migración: Crear tabla de ajustes de cuadre físico
-- Idempotente y seguro

CREATE TABLE IF NOT EXISTS public.ajustes_cuadre_fisico (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Lima')::date),
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  kilos_ajuste DECIMAL(10,2) NOT NULL,
  motivo VARCHAR(255) NOT NULL,
  usuario_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ajustes_fecha_producto ON public.ajustes_cuadre_fisico(fecha, producto_id);
