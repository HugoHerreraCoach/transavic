-- Limpieza: aplicaciones y punteros de pagos YA ANULADOS (21 ago 2026).
--
-- Problema que salda: al anular un pago a proveedor, el sistema marcaba el pago
-- como 'anulado' y devolvia la plata, pero NO borraba sus filas de
-- pagos_proveedores_aplicaciones ni limpiaba pagos_proveedores.deuda_prioritaria_id.
-- Ambas apuntan a cuentas_por_pagar con FK ON DELETE RESTRICT, asi que la deuda
-- quedaba imposible de borrar: al intentar ANULAR la compra, Postgres abortaba con
--   "update or delete on table cuentas_por_pagar violates foreign key constraint
--    pagos_proveedores_aplicaciones_deuda_fk"
-- y ese texto crudo le aparecia a la usuaria en pantalla (caso de Marianela).
--
-- El codigo nuevo ya limpia al anular; esto salda el arrastre historico.
--
-- Es SEGURO: ningun calculo del sistema lee estas filas. Todos los SUM de
-- aplicaciones filtran por pagos_proveedores.estado = 'registrado'
-- (lib/proveedores/pagos.ts, api/proveedores/[id]/ficha/route.ts). Los saldos, la
-- caja y el estado de cuenta NO cambian. Lo unico que se pierde es el desglose de
-- "a que documentos se habia aplicado" de un pago ya anulado: decision de Hugo,
-- 21 ago 2026. El pago, su monto, quien lo anulo, cuando, el motivo y el
-- contraasiento en caja se conservan intactos.
--
-- Idempotente: correrlo dos veces no hace nada la segunda vez.
--
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/limpiar-aplicaciones-pagos-anulados-2026-08-21.sql

BEGIN;

-- ── ANTES: que se va a tocar y a quien afecta ────────────────────────────────
SELECT
  COUNT(*)                                AS aplicaciones_a_borrar,
  COUNT(DISTINCT a.pago_id)               AS pagos_anulados_involucrados,
  COUNT(DISTINCT a.deuda_id)              AS deudas_liberadas,
  COALESCE(SUM(a.monto), 0)               AS monto_total_desprendido
FROM pagos_proveedores_aplicaciones a
JOIN pagos_proveedores p ON p.id = a.pago_id
WHERE p.estado = 'anulado';

-- Detalle por proveedor, para reconocer el caso reportado.
SELECT
  pr.nombre                               AS proveedor,
  COUNT(*)                                AS aplicaciones,
  COALESCE(SUM(a.monto), 0)               AS monto
FROM pagos_proveedores_aplicaciones a
JOIN pagos_proveedores p ON p.id = a.pago_id
JOIN proveedores pr      ON pr.id = a.proveedor_id
WHERE p.estado = 'anulado'
GROUP BY pr.nombre
ORDER BY monto DESC;

-- ── LIMPIEZA ────────────────────────────────────────────────────────────────
-- 1) El reparto entre documentos de los pagos anulados.
DELETE FROM pagos_proveedores_aplicaciones a
USING pagos_proveedores p
WHERE a.pago_id = p.id
  AND p.estado = 'anulado';

-- 2) El segundo puntero a la deuda (bloquea aunque el pago nunca se haya aplicado).
UPDATE pagos_proveedores
SET deuda_prioritaria_id = NULL
WHERE estado = 'anulado'
  AND deuda_prioritaria_id IS NOT NULL;

-- ── DESPUES: ambos deben quedar en 0 ────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM pagos_proveedores_aplicaciones a
     JOIN pagos_proveedores p ON p.id = a.pago_id
    WHERE p.estado = 'anulado')                              AS aplicaciones_restantes,
  (SELECT COUNT(*) FROM pagos_proveedores
    WHERE estado = 'anulado' AND deuda_prioritaria_id IS NOT NULL) AS punteros_restantes;

-- Control: el caché de pagos NO deberia haber cambiado (ya excluia estas filas).
SELECT COUNT(*) AS deudas_con_cache_descuadrado
FROM cuentas_por_pagar cpp
WHERE ROUND(cpp.monto_pagado, 2) <> ROUND(LEAST(cpp.monto_deuda, COALESCE((
        SELECT SUM(a.monto)
        FROM pagos_proveedores_aplicaciones a
        JOIN pagos_proveedores p ON p.id = a.pago_id
        WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'), 0)), 2);

COMMIT;
