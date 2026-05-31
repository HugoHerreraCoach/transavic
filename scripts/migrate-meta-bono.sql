-- scripts/migrate-meta-bono.sql
-- #157 — Bono personalizado por asesora al cumplir su meta individual del mes.
--
-- (1) `bono` (TEXT, opcional): premio en texto libre que el admin define por
--     asesora y mes. La asesora lo ve en su panel y se celebra al alcanzar su meta.
-- (2) `monto_meta` pasa a NULLABLE: así el admin puede fijar SOLO un bono sin
--     forzar un override de meta (la meta sigue siendo automática). El código
--     trata `monto_meta IS NULL` como "sin override" → usa la meta automática.
--
-- Idempotente y aditiva. Aplicar con psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-meta-bono.sql

ALTER TABLE metas_asesoras ADD COLUMN IF NOT EXISTS bono TEXT;
ALTER TABLE metas_asesoras ALTER COLUMN monto_meta DROP NOT NULL;
