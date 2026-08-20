-- scripts/cerrar-alertas-arribo-huerfanas-2026-08-20.sql
--
-- Data-op: cierra las alertas de arribo que quedaron pendientes para siempre.
--
-- Contexto (reporte de Yesica, 20 ago 2026): "los pedidos que ya se entregaron
-- ayer o antes de ayer me siguen llegando las notificaciones". Una notificación
-- NO leída no caduca nunca (`limpiarNotificacionesAntiguas` solo borra leídas) y
-- hasta hoy nadie cerraba la alerta cuando el pedido salía de `En_Camino`, así
-- que el popup las resucitaba en cada sesión nueva.
--
-- El código ya no las genera huérfanas (`cerrarAlertasArriboDePedido` corre al
-- entregar, fallar, cancelar viaje y reprogramar), pero el backlog histórico
-- sigue en la tabla: esto lo salda.
--
-- Alcance ACOTADO a propósito:
--   * solo tipos de arribo (`pedido_por_llegar` / `pedido_llegado`),
--   * solo NO leídas,
--   * solo si su pedido YA NO está en camino (o el pedido ya no existe).
-- Una alerta de un reparto vivo NO se toca: el motorizado puede estar llegando
-- ahora mismo.
--
-- Idempotente (re-ejecutarlo no hace nada). No borra: marcar leída conserva la
-- fila en la campana como historial.
--
-- Uso:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/cerrar-alertas-arribo-huerfanas-2026-08-20.sql

BEGIN;

-- Antes: cuántas quedan huérfanas y desde cuándo.
SELECT
  COUNT(*)                                   AS alertas_a_cerrar,
  COUNT(DISTINCT n.user_id)                  AS asesoras_afectadas,
  MIN(n.created_at)                          AS mas_antigua,
  MAX(n.created_at)                          AS mas_reciente
FROM notificaciones n
LEFT JOIN pedidos p ON p.id = n.pedido_id
WHERE n.tipo IN ('pedido_por_llegar', 'pedido_llegado')
  AND n.leida = FALSE
  AND (p.id IS NULL OR p.estado <> 'En_Camino');

UPDATE notificaciones n
SET leida = TRUE
FROM (
  SELECT n2.id
  FROM notificaciones n2
  LEFT JOIN pedidos p ON p.id = n2.pedido_id
  WHERE n2.tipo IN ('pedido_por_llegar', 'pedido_llegado')
    AND n2.leida = FALSE
    AND (p.id IS NULL OR p.estado <> 'En_Camino')
) obsoletas
WHERE n.id = obsoletas.id;

-- Después: debe quedar en 0.
SELECT COUNT(*) AS restantes
FROM notificaciones n
LEFT JOIN pedidos p ON p.id = n.pedido_id
WHERE n.tipo IN ('pedido_por_llegar', 'pedido_llegado')
  AND n.leida = FALSE
  AND (p.id IS NULL OR p.estado <> 'En_Camino');

COMMIT;
