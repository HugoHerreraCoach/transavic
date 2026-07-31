-- scripts/migrate-cuadre-pollo-lineas-2026-07-30.sql
-- Cuadre de Pollo: flexibilidad de Excel sobre la automatización.
--
-- Dos piezas:
--   1) cuadre_pollo_lineas → líneas que la usuaria agrega a mano, de ENTRADA o de
--      SALIDA. Generaliza las columnas fijas kg_corte / kg_corte_especial /
--      kg_pollo_entero, que pasan a ser las 3 líneas sembradas por defecto.
--      En su Excel, CORTE y CORTES E. son exactamente eso: filas que ella inventó.
--   2) Cuatro columnas de OVERRIDE en cuadre_pollo_dia: poder corregir el total
--      que trae el sistema para Campo y Planta cuando sabe que está incompleto
--      (el 25 jul 2026 la compra se registró a medias y el cuadre daba −1 837 kg,
--      sin manera de avanzar).
--
-- CONTRATO del override: NULL = automático (manda el sistema). Con valor, manda
-- el valor y el MOTIVO es obligatorio; el delta se calcula, no se digita. Borrar
-- el valor vuelve a automático (mismo criterio que metas/override).
--
-- ⚠️ `seccion` es lo que impide duplicar el peso del delivery: la salida física a
-- corte y lo facturado por asesoras son dos medidas del MISMO flujo y nunca se
-- suman juntas (ver la regla crítica en src/lib/cuadre-pollo.ts).
--
-- Las columnas viejas (kg_corte, kg_corte_especial, kg_pollo_entero, expr_*) se
-- dejan en su lugar SIN USAR para que el rollback sea seguro; se limpian después.
-- En producción cuadre_pollo_dia tiene 0 filas, así que no se migra ningún dato.
--
-- Idempotente y ADITIVA. A producción por psql ANTES del deploy (gotcha #17):
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-cuadre-pollo-lineas-2026-07-30.sql
-- Rollback: scripts/rollback-cuadre-pollo-lineas-2026-07-30.sql

-- ---------------------------------------------------------------------------
-- 1. Líneas propias del día
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cuadre_pollo_lineas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha DATE NOT NULL REFERENCES public.cuadre_pollo_dia(fecha) ON DELETE CASCADE,
  -- De qué lado del cuadre suma. Sin esto, una línea podría sumarse al lado
  -- equivocado y falsear la merma.
  seccion VARCHAR(10) NOT NULL,
  concepto VARCHAR(120) NOT NULL,
  -- El desglose tal como se tecleó ("62+62.2+62.5…"), solo para poder reeditarlo.
  -- El número de `kilos` es la fuente de verdad; el servidor revalida que cuadren.
  expresion TEXT,
  kilos NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Solo tiene sentido en 'entrada' (jabas de una compra aún no registrada).
  jabas INTEGER NOT NULL DEFAULT 0,
  -- Entrada que todavía no está cargada en Compras: suma, pero se marca en ámbar
  -- y queda como recordatorio de que falta digitarla.
  pendiente_registrar BOOLEAN NOT NULL DEFAULT FALSE,
  orden INTEGER NOT NULL DEFAULT 0,
  usuario_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cuadre_pollo_lineas_seccion') THEN
    ALTER TABLE public.cuadre_pollo_lineas
      ADD CONSTRAINT chk_cuadre_pollo_lineas_seccion CHECK (seccion IN ('entrada', 'salida'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cuadre_pollo_lineas_no_negativos') THEN
    ALTER TABLE public.cuadre_pollo_lineas
      ADD CONSTRAINT chk_cuadre_pollo_lineas_no_negativos CHECK (kilos >= 0 AND jabas >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cuadre_pollo_lineas_fecha
  ON public.cuadre_pollo_lineas (fecha);

-- ---------------------------------------------------------------------------
-- 2. Corrección manual de los totales que trae el sistema
-- ---------------------------------------------------------------------------
ALTER TABLE public.cuadre_pollo_dia
  ADD COLUMN IF NOT EXISTS kg_campo_ajustado NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS kg_campo_motivo TEXT,
  ADD COLUMN IF NOT EXISTS kg_planta_ajustado NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS kg_planta_motivo TEXT;

-- Un ajuste sin motivo no es auditable: o van los dos, o no va ninguno.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cuadre_pollo_ajustes_con_motivo') THEN
    ALTER TABLE public.cuadre_pollo_dia
      ADD CONSTRAINT chk_cuadre_pollo_ajustes_con_motivo CHECK (
        (kg_campo_ajustado IS NULL OR (kg_campo_ajustado >= 0 AND COALESCE(TRIM(kg_campo_motivo), '') <> ''))
        AND
        (kg_planta_ajustado IS NULL OR (kg_planta_ajustado >= 0 AND COALESCE(TRIM(kg_planta_motivo), '') <> ''))
      );
  END IF;
END $$;
