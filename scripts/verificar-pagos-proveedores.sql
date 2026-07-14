-- Auditoria de solo lectura posterior a la migracion de pagos de proveedores.
-- Debe devolver cero en las cuatro columnas de errores.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/verificar-pagos-proveedores.sql

WITH cache_incorrecto AS (
  SELECT cpp.id
  FROM cuentas_por_pagar cpp
  WHERE ABS(
    cpp.monto_pagado - COALESCE((
      SELECT SUM(a.monto)
      FROM pagos_proveedores_aplicaciones a
      JOIN pagos_proveedores p ON p.id = a.pago_id
      WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
    ), 0)
  ) > 0.01
), cruces_proveedor AS (
  SELECT a.id
  FROM pagos_proveedores_aplicaciones a
  JOIN pagos_proveedores p ON p.id = a.pago_id
  JOIN cuentas_por_pagar cpp ON cpp.id = a.deuda_id
  WHERE a.proveedor_id <> p.proveedor_id
     OR a.proveedor_id <> cpp.proveedor_id
), movimientos_duplicados AS (
  SELECT pago_proveedor_id, tipo
  FROM transacciones
  WHERE pago_proveedor_id IS NOT NULL
  GROUP BY pago_proveedor_id, tipo
  HAVING COUNT(*) > 1
), pagos_sobreaplicados AS (
  SELECT p.id
  FROM pagos_proveedores p
  LEFT JOIN pagos_proveedores_aplicaciones a ON a.pago_id = p.id
  GROUP BY p.id, p.monto
  HAVING COALESCE(SUM(a.monto), 0) > p.monto
)
SELECT
  (SELECT COUNT(*) FROM cache_incorrecto) AS caches_incorrectos,
  (SELECT COUNT(*) FROM cruces_proveedor) AS cruces_proveedor,
  (SELECT COUNT(*) FROM movimientos_duplicados) AS movimientos_duplicados,
  (SELECT COUNT(*) FROM pagos_sobreaplicados) AS pagos_sobreaplicados;

-- Resumen operativo: cada fila es un proveedor; el credito nunca se netea con
-- la deuda de otro proveedor.
WITH movimientos AS (
  SELECT proveedor_id, monto_deuda AS monto FROM cuentas_por_pagar
  UNION ALL
  SELECT proveedor_id, -monto FROM pagos_proveedores WHERE estado = 'registrado'
)
SELECT
  p.razon_social,
  GREATEST(COALESCE(SUM(m.monto), 0), 0) AS deuda_pendiente,
  GREATEST(-COALESCE(SUM(m.monto), 0), 0) AS saldo_favor
FROM proveedores p
LEFT JOIN movimientos m ON m.proveedor_id = p.id
GROUP BY p.id, p.razon_social
ORDER BY p.razon_social;
