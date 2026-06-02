-- scripts/migrate-comprobante-emisor.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Registra QUIÉN emite cada comprobante (atribución), ahora que todas las
-- asesoras ven todos los comprobantes. Antes no se guardaba: solo se podía
-- inferir vía el pedido, y los comprobantes "sueltos" (sin pedido) no tenían
-- forma de saberlo.
--
-- `emitido_por` = nombre de la persona que lo emitió (denormalizado, mismo
-- patrón que `pedidos.entregado_por`). Lo llena cada endpoint de emisión desde
-- `session.user.name`.
--
-- Backfill (best-effort) para los ya emitidos: se usa el nombre de la asesora
-- DUEÑA del pedido como mejor proxy disponible. Los comprobantes sueltos viejos
-- (sin pedido) quedan en NULL → la UI muestra "—".
--
-- Idempotente y aditivo. Aplicar con psql (gotcha #13):
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-comprobante-emisor.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS emitido_por TEXT;

UPDATE comprobantes c
SET emitido_por = NULLIF(TRIM(u.name), '')
FROM pedidos p
JOIN users u ON p.asesor_id = u.id
WHERE c.pedido_id = p.id
  AND c.emitido_por IS NULL
  AND p.asesor_id IS NOT NULL;
