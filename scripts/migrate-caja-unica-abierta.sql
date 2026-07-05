-- Garantiza que solo pueda existir UNA caja abierta a la vez.
-- Cierra la race condition de POST /api/caja-diaria (SELECT-then-INSERT):
-- dos requests simultáneos podían abrir dos cajas. Con este índice único
-- parcial, el segundo INSERT falla con 23505 y el endpoint devuelve 409.
--
-- Aplicar por psql (los .mjs fallan con Node 26 — gotcha #13 de CLAUDE.md):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-caja-unica-abierta.sql
-- Primero en dev-hugo; a producción recién cuando la expansión ERP se despliegue
-- (junto con migrate-produccion-fase-2-3-consolidado.sql, que crea la tabla).

CREATE UNIQUE INDEX IF NOT EXISTS ux_caja_diaria_unica_abierta
  ON caja_diaria ((estado))
  WHERE estado = 'Abierta';
