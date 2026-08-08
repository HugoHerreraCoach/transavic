-- scripts/rollback-planta-historial-2026-08-07.sql
-- Revierte migrate-planta-historial-2026-08-07.sql.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/rollback-planta-historial-2026-08-07.sql
--
-- ⚠️ BORRA DATOS. Dos cosas se pierden y NO se recuperan solas:
--   1. `pedidos.cliente_planta_id` — el vínculo de cada venta del POS con su
--      cliente. El de CRÉDITO se puede reconstruir desde `cobranzas_planta`
--      (paso 3a de la migración), pero el de CONTADO solo se recupera si el
--      pedido conserva el RUC/DNI (paso 3b). Las ventas al paso, nunca.
--   2. `clientes_planta.saldo_anterior` — la deuda previa al sistema que alguien
--      haya cargado a mano. Eso NO está en ninguna otra tabla.
--
-- Respaldo sugerido antes de ejecutar:
--   \copy (SELECT id, cliente_planta_id FROM public.pedidos WHERE cliente_planta_id IS NOT NULL) TO 'backup-pedidos-cliente-planta.csv' CSV HEADER
--   \copy (SELECT id, nombre, saldo_anterior FROM public.clientes_planta WHERE saldo_anterior <> 0) TO 'backup-clientes-planta-saldo-anterior.csv' CSV HEADER
--
-- Solo tiene sentido con el código VIEJO desplegado: si el código nuevo sigue
-- activo, las queries que leen estas columnas fallan con 42703 (gotcha #58).

DROP INDEX IF EXISTS public.idx_pedidos_cliente_planta;

ALTER TABLE public.clientes_planta DROP COLUMN IF EXISTS saldo_anterior;

ALTER TABLE public.pedidos DROP COLUMN IF EXISTS cliente_planta_id;
