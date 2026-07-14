-- Diagnóstico SOLO LECTURA de Ventas de Ejecutivas. No corrige ni elimina.
-- Default 12/07/2026. Otra fecha: psql "$DATABASE_URL_UNPOOLED" \
--   -v fecha=2026-07-13 -f scripts/diagnostico-ventas-ejecutivas-duplicadas.sql
\if :{?fecha}
\else
  \set fecha '2026-07-12'
\endif

BEGIN TRANSACTION READ ONLY;

\echo '1) Conciliación: registrado vs confirmado (cifra oficial nueva)'
WITH items_por_pedido AS (
  SELECT pi.pedido_id, COUNT(pi.id)::int AS items,
    COUNT(pi.id) FILTER (WHERE pi.subtotal_real IS NULL)::int AS pendientes,
    SUM(pi.cantidad * pi.precio_unitario)::numeric(14, 2) AS formula_anterior,
    CASE WHEN COUNT(pi.id) > 0 AND COUNT(pi.subtotal_real) = COUNT(pi.id)
      THEN SUM(pi.subtotal_real)::numeric(14, 2) END AS monto_confirmado
  FROM pedido_items pi GROUP BY pi.pedido_id
), pedidos_dia AS (
  SELECT p.id, ip.formula_anterior, ip.monto_confirmado,
    COALESCE(ip.items, 0) > 0 AND COALESCE(ip.pendientes, 0) = 0 AS valorizado
  FROM pedidos p LEFT JOIN items_por_pedido ip ON ip.pedido_id = p.id
  WHERE (p.created_at AT TIME ZONE 'America/Lima')::date = :'fecha'::date
    AND COALESCE(p.origen, 'asesor') = 'asesor'
    AND p.estado <> 'Fallido' AND NOT COALESCE(p.anulada, FALSE)
)
SELECT COUNT(*)::int AS ventas_registradas,
  COUNT(*) FILTER (WHERE valorizado)::int AS ventas_valorizadas,
  COUNT(*) FILTER (WHERE NOT valorizado)::int AS ventas_por_valorizar,
  COALESCE(SUM(monto_confirmado) FILTER (WHERE valorizado), 0)::numeric(14, 2)
    AS total_confirmado,
  COALESCE(SUM(formula_anterior), 0)::numeric(14, 2) AS total_formula_anterior
FROM pedidos_dia;

\echo '2) Cada fila debe corresponder a un pedido distinto'
SELECT COUNT(*)::int AS filas, COUNT(DISTINCT p.id)::int AS pedidos_distintos,
  COUNT(*) - COUNT(DISTINCT p.id) AS diferencia
FROM pedidos p
WHERE (p.created_at AT TIME ZONE 'America/Lima')::date = :'fecha'::date
  AND COALESCE(p.origen, 'asesor') = 'asesor'
  AND p.estado <> 'Fallido' AND NOT COALESCE(p.anulada, FALSE);

\echo '3) Números de orden repetidos (debe devolver cero filas)'
SELECT p.numero_guia, COUNT(*) AS repeticiones,
  ARRAY_AGG(p.id ORDER BY p.created_at) AS pedidos
FROM pedidos p WHERE p.numero_guia IS NOT NULL
GROUP BY p.numero_guia HAVING COUNT(*) > 1
ORDER BY repeticiones DESC, p.numero_guia;

\echo '4) Posibles dobles registros con igual huella en menos de 10 minutos'
SELECT a.id AS pedido_1, b.id AS pedido_2, a.cliente,
  BTRIM(u.name) AS ejecutiva,
  a.created_at AT TIME ZONE 'America/Lima' AS registrado_1,
  b.created_at AT TIME ZONE 'America/Lima' AS registrado_2, a.detalle
FROM pedidos a
JOIN pedidos b ON (b.created_at, b.id) > (a.created_at, a.id)
 AND b.asesor_id IS NOT DISTINCT FROM a.asesor_id
 AND b.cliente = a.cliente AND b.detalle = a.detalle
 AND b.fecha_pedido = a.fecha_pedido
 AND b.created_at BETWEEN a.created_at AND a.created_at + INTERVAL '10 minutes'
LEFT JOIN users u ON u.id = a.asesor_id
WHERE (a.created_at AT TIME ZONE 'America/Lima')::date = :'fecha'::date
  AND (b.created_at AT TIME ZONE 'America/Lima')::date = :'fecha'::date
  AND COALESCE(a.origen, 'asesor') = 'asesor'
  AND COALESCE(b.origen, 'asesor') = 'asesor'
ORDER BY a.created_at;

\echo '5) Comprobantes vinculados (informativo: NO se suman al indicador)'
SELECT COUNT(*)::int AS comprobantes,
  COUNT(DISTINCT c.pedido_id)::int AS pedidos_con_comprobante,
  COALESCE(SUM(c.monto_total), 0)::numeric(14, 2) AS total_comprobantes
FROM comprobantes c JOIN pedidos p ON p.id = c.pedido_id
WHERE (p.created_at AT TIME ZONE 'America/Lima')::date = :'fecha'::date
  AND COALESCE(p.origen, 'asesor') = 'asesor'
  AND c.tipo IN ('01', '03')
  AND LOWER(c.estado) NOT IN ('rechazada', 'error');

\echo '6) Detalle que debe sumar exactamente el total confirmado'
WITH items_por_pedido AS (
  SELECT pi.pedido_id, COUNT(pi.id)::int AS items,
    COUNT(pi.id) FILTER (WHERE pi.subtotal_real IS NULL)::int AS pendientes,
    CASE WHEN COUNT(pi.id) > 0 AND COUNT(pi.subtotal_real) = COUNT(pi.id)
      THEN SUM(pi.subtotal_real)::numeric(14, 2) END AS monto_confirmado
  FROM pedido_items pi GROUP BY pi.pedido_id
)
SELECT p.id, p.created_at AT TIME ZONE 'America/Lima' AS registrado_lima,
  p.cliente, BTRIM(u.name) AS ejecutiva, p.fecha_pedido AS entrega,
  p.estado, p.numero_guia,
  CASE WHEN COALESCE(ip.items, 0) > 0 AND COALESCE(ip.pendientes, 0) = 0
    THEN ip.monto_confirmado END AS monto_confirmado,
  CASE WHEN COALESCE(ip.items, 0) > 0 AND COALESCE(ip.pendientes, 0) = 0
    THEN 'Confirmada' ELSE 'Por pesar' END AS valoracion
FROM pedidos p LEFT JOIN items_por_pedido ip ON ip.pedido_id = p.id
LEFT JOIN users u ON u.id = p.asesor_id
WHERE (p.created_at AT TIME ZONE 'America/Lima')::date = :'fecha'::date
  AND COALESCE(p.origen, 'asesor') = 'asesor'
  AND p.estado <> 'Fallido' AND NOT COALESCE(p.anulada, FALSE)
ORDER BY p.created_at, p.id;

ROLLBACK;
