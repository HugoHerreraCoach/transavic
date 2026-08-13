-- scripts/reasignar-leads-mateo-2026-08-13.sql
-- Saca del admin los leads que le cayeron por el fallback de timeout y los
-- reparte entre las asesoras de SU MISMA marca, buscando dejar las cargas parejas.
--
-- Por qué existe: hasta el 13 ago 2026 un lead que nadie reclamaba en 2 minutos
-- (15+45+60) se asignaba al primer admin. Como ninguna asesora alcanza a tocar
-- "Atender" en ese lapso, TODOS terminaban ahí: Mateo tenía 10 leads (5 de cada
-- marca) mientras Jhoselyn y Saraí tenían CERO. El código ya está arreglado
-- (ahora el fallback se lo queda la asesora de turno); esto limpia lo acumulado.
--
-- Reparto elegido, mirando la carga que YA tenían:
--   Avícola de Tony — Jhoselyn 0 / Saraí 0  → 5 leads: 3 y 2
--   Transavic       — Yali 9 / Yesica 4     → los 5 a Yesica, para dejar 9 y 9
--
-- NO toca conversaciones: solo cambia el responsable. Los mensajes, el estado y
-- el historial del lead quedan intactos.
--
-- Idempotente: el WHERE exige que el lead siga siendo de Mateo, así que
-- re-ejecutarlo no mueve nada.
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/reasignar-leads-mateo-2026-08-13.sql

-- ── Antes ────────────────────────────────────────────────────────────────────
SELECT 'ANTES' AS momento, u.name AS asesora, l.empresa, COUNT(*) AS leads
FROM leads l JOIN users u ON u.id = l.vendedor_id
GROUP BY 1, 2, 3 ORDER BY l.empresa, 4 DESC;

-- ── Reparto ──────────────────────────────────────────────────────────────────
WITH mateo AS (
  SELECT l.id, l.empresa,
         ROW_NUMBER() OVER (PARTITION BY l.empresa ORDER BY l.created_at) AS pos
  FROM leads l
  JOIN users u ON u.id = l.vendedor_id
  WHERE u.name = 'Mateo' AND u.role = 'admin'
),
destino AS (
  SELECT m.id AS lead_id,
         CASE
           -- Transavic: todo a la que va atrás, para emparejar con la otra.
           WHEN m.empresa = 'Transavic' THEN
             (SELECT id FROM users WHERE name = 'Yesica')
           -- Avícola: las dos arrancan en cero, así que se alternan.
           WHEN m.empresa = 'Avícola de Tony' AND m.pos % 2 = 1 THEN
             (SELECT id FROM users WHERE name = 'Jhoselyn')
           WHEN m.empresa = 'Avícola de Tony' THEN
             (SELECT id FROM users WHERE name = 'Saraí')
         END AS asesora_id
  FROM mateo m
)
UPDATE leads l
SET vendedor_id = d.asesora_id,
    updated_at  = NOW()
FROM destino d
WHERE l.id = d.lead_id
  AND d.asesora_id IS NOT NULL;

-- ── Después ──────────────────────────────────────────────────────────────────
SELECT 'DESPUES' AS momento, u.name AS asesora, l.empresa, COUNT(*) AS leads
FROM leads l JOIN users u ON u.id = l.vendedor_id
GROUP BY 1, 2, 3 ORDER BY l.empresa, 4 DESC;

-- Verificación: ninguna asesora debe tener leads de una marca que no atiende.
SELECT 'CRUZADOS (debe dar 0)' AS chequeo, COUNT(*) AS filas
FROM leads l JOIN users u ON u.id = l.vendedor_id
WHERE u.empresas IS NOT NULL
  AND cardinality(u.empresas) > 0
  AND NOT (l.empresa = ANY(u.empresas));
