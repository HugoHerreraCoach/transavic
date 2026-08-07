-- scripts/rollback-asesoras-por-marca-2026-08-06.sql
-- Revierte migrate-asesoras-por-marca-2026-08-06.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-asesoras-por-marca-2026-08-06.sql
--
-- ⚠️ BORRA DATOS: se pierde qué marca atiende cada asesora y el reparto vuelve a
-- ser común a las dos (un lead de una marca puede caerle a quien atiende la otra).
-- Antes de correrlo conviene anotar la asignación:
--   SELECT name, empresas FROM users WHERE empresas IS NOT NULL;
--
-- Solo tiene sentido con el código VIEJO desplegado: la rotación nueva lee esta
-- columna y sin ella devuelve 42703 al crear un lead.

ALTER TABLE public.users DROP COLUMN IF EXISTS empresas;
