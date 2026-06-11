-- migrate-guias-reintento-2026-06-10.sql
-- Persistir en comprobantes_guias TODO lo necesario para poder REINTENTAR una
-- guía cuya emisión se interrumpió (función muerta a mitad del polling SUNAT →
-- fila atascada en 'emitiendo', caso T002-00000010 del 10 jun 2026) reusando el
-- MISMO serie-número, y para que el PDF refleje fielmente lo enviado.
-- Aditiva e idempotente. Aplicar por psql a dev-hugo Y producción ANTES del
-- deploy del código que la usa (gotcha #17):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-guias-reintento-2026-06-10.sql

ALTER TABLE comprobantes_guias
  ADD COLUMN IF NOT EXISTS direccion_llegada TEXT,
  ADD COLUMN IF NOT EXISTS distrito_llegada  TEXT,
  ADD COLUMN IF NOT EXISTS indicador_m1l     BOOLEAN,
  ADD COLUMN IF NOT EXISTS chofer_nombres    TEXT,
  ADD COLUMN IF NOT EXISTS chofer_apellidos  TEXT,
  ADD COLUMN IF NOT EXISTS items_json        JSONB,
  -- 🔴 CAUSA RAÍZ del atascamiento de T002-00000010: el flujo de reserva (fix de
  -- numeración del 10 jun) hace UPDATE ... SET updated_at = NOW(), pero la tabla
  -- NUNCA tuvo esta columna → el UPDATE post-SUNAT fallaba ("column does not
  -- exist"), el catch que marca 'error' fallaba por lo mismo, y la fila quedaba
  -- en 'emitiendo' para siempre aunque SUNAT sí hubiera procesado la guía.
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN comprobantes_guias.items_json IS
  'Bienes enviados en el XML de la guía (producto_nombre, cantidad, unidad) — fuente para reintentar con el mismo número';
