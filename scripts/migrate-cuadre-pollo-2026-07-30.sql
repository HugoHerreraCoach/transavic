-- scripts/migrate-cuadre-pollo-2026-07-30.sql
-- Módulo "Cuadre de Pollo": replica el cuadre diario que Marianela lleva en Excel.
--
-- Dos piezas:
--   1) cuadre_pollo_dia  → la captura manual del día (aves y kg que salieron a corte).
--   2) productos.origen_fisico → clasifica cada producto para saber QUÉ se cuadra y CÓMO:
--        'vivo'     = pollo vivo que entra a beneficio (alimenta la ENTRADA del cuadre)
--        'desposte' = corte que SALE del beneficio (no se cuadra por producto)
--        'reventa'  = entra y sale igual (sí se cuadra por producto, en Reportes)
--
-- Idempotente y ADITIVA. Aplicar por psql ANTES del deploy del código (gotcha #17):
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-cuadre-pollo-2026-07-30.sql
-- Rollback: scripts/rollback-cuadre-pollo-2026-07-30.sql

-- ---------------------------------------------------------------------------
-- 1. Captura manual del cuadre diario
-- ---------------------------------------------------------------------------
-- La PK por fecha da la idempotencia del upsert (un cuadre por día, se corrige
-- sobre la misma fila). Mismo criterio que ajustes_cuadre_fisico(fecha, producto).
CREATE TABLE IF NOT EXISTS public.cuadre_pollo_dia (
  fecha DATE PRIMARY KEY,
  -- Aves del día. Solo se usan cuando las compras no traen el desglose por sexo.
  aves_macho INTEGER NOT NULL DEFAULT 0,
  aves_hembra INTEGER NOT NULL DEFAULT 0,
  -- Peso que SALIÓ de planta hacia el acopio de delivery. En el Excel de
  -- Marianela son las filas CORTE, CORTES E. y el pollo entero.
  kg_corte NUMERIC(10,2) NOT NULL DEFAULT 0,
  kg_corte_especial NUMERIC(10,2) NOT NULL DEFAULT 0,
  kg_pollo_entero NUMERIC(10,2) NOT NULL DEFAULT 0,
  observaciones TEXT,
  usuario_id UUID REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima'),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'America/Lima')
);

-- No se aceptan negativos: un peso que sale nunca es negativo (las devoluciones
-- viven en compra_items.tipo='devolucion', no aquí).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cuadre_pollo_dia_no_negativos'
  ) THEN
    ALTER TABLE public.cuadre_pollo_dia
      ADD CONSTRAINT chk_cuadre_pollo_dia_no_negativos CHECK (
        aves_macho >= 0 AND aves_hembra >= 0
        AND kg_corte >= 0 AND kg_corte_especial >= 0 AND kg_pollo_entero >= 0
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Clasificación física del producto
-- ---------------------------------------------------------------------------
-- Default 'reventa' = comportamiento neutro: un producto no clasificado se sigue
-- cuadrando por producto como hasta hoy.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS origen_fisico VARCHAR(12) NOT NULL DEFAULT 'reventa';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_productos_origen_fisico'
  ) THEN
    ALTER TABLE public.productos
      ADD CONSTRAINT chk_productos_origen_fisico
      CHECK (origen_fisico IN ('vivo', 'desposte', 'reventa'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_productos_origen_fisico
  ON public.productos (origen_fisico);

-- ---------------------------------------------------------------------------
-- 3. Seed de la clasificación
-- ---------------------------------------------------------------------------
-- VIVO: lo que Antonio compra en jabas a los proveedores (Renato, Karol, Flores...)
-- y entra a beneficio. Es la CARGA del cuadre.
UPDATE public.productos SET origen_fisico = 'vivo'
WHERE categoria = 'Pollo'
  AND nombre IN ('Pollo entero con menudencia', 'Pollo entero sin menudencia');

-- DESPOSTE: los cortes que salen del beneficio de ese pollo vivo. Compararlos
-- uno a uno contra la compra es imposible (se compra 1 producto y se venden ~20),
-- por eso se cuadran en bloque dentro del Cuadre de Pollo.
-- Si además se compran a terceros (pasa con Alas y Espinazo), esa compra suma a
-- la ENTRADA del cuadre.
UPDATE public.productos SET origen_fisico = 'desposte'
WHERE categoria = 'Pollo'
  AND origen_fisico <> 'vivo'
  AND (
       nombre ILIKE '%pechuga%'
    OR nombre ILIKE '%pierna%'
    OR nombre ILIKE '%piernit%'   -- "Piernitas bouchet" NO matchea '%pierna%'
    OR nombre ILIKE '%milanesa%'
    OR nombre ILIKE '%brasa%'     -- "Pollo Brasa o blanco": se vende entero, pero sale del beneficio
    OR nombre ILIKE '%muslo%'
    OR nombre ILIKE '%encuentro%'
    OR nombre ILIKE '%ala%'
    OR nombre ILIKE '%espinazo%'
    OR nombre ILIKE '%cartilago%'
    OR nombre ILIKE '%menudencia%'
    OR nombre ILIKE '%molido de pollo%'
    OR nombre ILIKE '%sasami%'
    OR nombre ILIKE '%carcasa%'
    OR nombre ILIKE '%filete%'
    OR nombre ILIKE '%molleja%'
    OR nombre ILIKE '%pata%'
    OR nombre ILIKE '%cuello%'
    OR nombre ILIKE '%hueso%'
    OR nombre ILIKE '%suprema%'
    OR nombre ILIKE '%corazón de pollo%'
    OR nombre ILIKE '%higado de pollo%'
    OR nombre ILIKE '%hígado de pollo%'
  )
  -- Las aves que se compran y revenden ENTERAS no son desposte, aunque su nombre
  -- matchee alguno de los patrones de arriba (ej. "Gallina doble pechuga").
  AND nombre NOT ILIKE '%gallina%'
  AND nombre NOT ILIKE '%pavo%'
  AND nombre NOT ILIKE '%pavita%'
  AND nombre NOT ILIKE '%pato%'
  AND nombre NOT ILIKE '%cuy%';

-- El resto (gallinas, pavita, pato, cuy y TODAS las Carnes de res/cerdo) se queda
-- en 'reventa' por el DEFAULT: entran y salen iguales, así que su cuadre por
-- producto sí tiene sentido (es el mini-cuadre DOBLES/ROJAS del Excel).
