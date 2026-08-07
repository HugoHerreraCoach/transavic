-- scripts/migrate-asesoras-por-marca-2026-08-06.sql
-- Cada asesora atiende una marca (o las dos), y el reparto de leads la respeta.
--
-- Problema que resuelve: la rotación tomaba TODAS las asesoras con
-- activo_rotacion = TRUE sin mirar la marca, así que un lead que escribía a
-- La Avícola de Tony podía caerle a una asesora de Transavic y al revés.
-- (El contador del día ya era por marca; el POOL de candidatas no.)
--
-- Idempotente y aditivo. psql en dev-hugo primero, y en producción ANTES del
-- deploy del código nuevo (gotchas #13/#17). El flag -1 ya envuelve en transacción.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-asesoras-por-marca-2026-08-06.sql

-- Marcas que atiende la asesora, con los MISMOS valores que `leads.empresa` y
-- `pedidos.empresa` ('Transavic' | 'Avícola de Tony').
--
-- NULL o vacío = atiende TODAS las marcas. Ese default es deliberado: sin él, el
-- deploy dejaría a todo el mundo fuera del reparto hasta que alguien entre a
-- configurarlo, y el CRM se quedaría sin repartir leads en silencio.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS empresas TEXT[];

COMMENT ON COLUMN public.users.empresas IS
  'Marcas que atiende esta asesora en el reparto de leads del CRM. NULL o vacío = todas.';
