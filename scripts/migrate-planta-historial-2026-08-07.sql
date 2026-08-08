-- scripts/migrate-planta-historial-2026-08-07.sql
-- La ficha del cliente de planta puede mostrar QUÉ se llevó, no solo cuánto debe.
--
-- Problema que resuelve (pedido de Ariana, video del 7 ago 2026): al abrir un
-- cliente de planta con deuda se ve el monto total (ej. Cabezón Acopio S/ 220.20)
-- pero NO qué productos ni qué cantidades se llevó en cada compra. La causa es
-- estructural: el POS inserta el pedido con `cliente_id = NULL` (la FK apunta a
-- `clientes`, que es de ejecutivas) y solo denormaliza razon_social/ruc_dni. El
-- ÚNICO puente pedido↔cliente de planta es `cobranzas_planta.pedido_id`, que solo
-- existe en ventas a CRÉDITO — una compra al contado del mismo cliente hoy es
-- invisible desde su ficha, y ni siquiera cuenta como "última compra".
--
-- `cliente_planta_id` ya viaja en el body del POS y ya se valida contra la tabla
-- incluso en contado; simplemente nunca se persistía en el pedido.
--
-- Idempotente y aditivo. psql en dev-hugo primero, y en producción ANTES del
-- deploy del código nuevo (gotchas #13/#17). El flag -1 ya envuelve en transacción.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-planta-historial-2026-08-07.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El vínculo que faltaba: pedido → cliente de planta
-- ─────────────────────────────────────────────────────────────────────────────

-- ON DELETE SET NULL y no CASCADE: borrar un cliente jamás debe borrar el
-- histórico de ventas (los movimientos de dinero e inventario siguen siendo
-- reales). Mismo criterio que `cobranzas_planta.pedido_id`.
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS cliente_planta_id UUID
  REFERENCES public.clientes_planta(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pedidos.cliente_planta_id IS
  'Cliente de planta (operacion POS). NULL en pedidos de asesoras y en ventas al paso. El cliente de ejecutivas va en cliente_id.';

-- Índice PARCIAL: solo los pedidos del POS con cliente lo tienen, que son una
-- fracción de la tabla. La ficha filtra exactamente por esta columna.
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_planta
  ON public.pedidos (cliente_planta_id) WHERE cliente_planta_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Deuda previa al sistema (paridad con clientes_avicola.saldo_anterior)
-- ─────────────────────────────────────────────────────────────────────────────

-- Sin esta columna, cargar la deuda que un cliente traía de antes obligaría a
-- inventar una venta falsa. DEFAULT 0 => inocuo para los datos existentes: el
-- saldo de todos los clientes actuales no cambia ni un céntimo.
ALTER TABLE public.clientes_planta ADD COLUMN IF NOT EXISTS saldo_anterior
  NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.clientes_planta.saldo_anterior IS
  'Deuda que el cliente traia de ANTES del sistema. saldo_actual = saldo_anterior + total_deuda - total_abonado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill del vínculo (idempotente: el guard IS NULL lo hace re-ejecutable)
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. CRÉDITO — recupera el 100 %: la cobranza ya guarda ambos extremos.
UPDATE public.pedidos p
SET cliente_planta_id = co.cliente_planta_id
FROM public.cobranzas_planta co
WHERE co.pedido_id = p.id
  AND p.cliente_planta_id IS NULL;

-- 3b. CONTADO — por RUC/DNI. Es determinista porque `ux_clientes_planta_ruc`
-- (índice único parcial creado en migrate-planta-clientes-cobranzas-2026-07-08)
-- garantiza como máximo UN cliente de planta por documento.
-- Solo aplica a ventas del POS con documento cargado; las ventas al paso sin
-- documento quedan sin vincular a propósito (no hay a quién atribuirlas).
UPDATE public.pedidos p
SET cliente_planta_id = c.id
FROM public.clientes_planta c
WHERE p.cliente_planta_id IS NULL
  AND p.origen = 'pos_planta'
  AND TRIM(COALESCE(p.ruc_dni, '')) <> ''
  AND TRIM(COALESCE(c.ruc_dni, '')) = TRIM(p.ruc_dni);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación: cuánto quedó vinculado y cuánto no.
-- Las "sin vincular" esperadas son las ventas al paso (sin cliente ni documento).
-- Si el número sorprende, revisar ANTES de correr esto en producción.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                                        AS ventas_pos_total,
  COUNT(cliente_planta_id)                                        AS vinculadas,
  COUNT(*) - COUNT(cliente_planta_id)                             AS sin_vincular,
  COUNT(*) FILTER (
    WHERE cliente_planta_id IS NULL
      AND TRIM(COALESCE(ruc_dni, '')) <> ''
  )                                                               AS sin_vincular_pero_con_documento
FROM public.pedidos
WHERE origen = 'pos_planta';
