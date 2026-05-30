#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Crear branch Neon "dev-hugo" via API y obtener su DATABASE_URL.
# ═══════════════════════════════════════════════════════════════════════
# Uso: NEON_API_KEY=napi_xxx ./scripts/create-neon-branch.sh
#
# Output: imprime la DATABASE_URL pooled y unpooled del branch.
# Guarda los resultados en .env.local
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

if [[ -z "${NEON_API_KEY:-}" ]]; then
  echo "❌ Falta NEON_API_KEY. Ejemplo: NEON_API_KEY=napi_xxx $0" >&2
  exit 1
fi

API="https://console.neon.tech/api/v2"
AUTH="Authorization: Bearer $NEON_API_KEY"

echo "🔍 1/4  Listando proyectos accesibles con esta key..."
PROJECTS_JSON=$(curl -s -H "$AUTH" "$API/projects")
echo "$PROJECTS_JSON" | jq -r '.projects[] | "   • \(.id)  →  \(.name)  (region \(.region_id))"' || {
  echo "❌ Respuesta no parseable. Body:" >&2
  echo "$PROJECTS_JSON" >&2
  exit 1
}

# Identificamos el proyecto Transavic por su endpoint host (ep-cool-sound-adxrsjt5)
PROJECT_ID=$(echo "$PROJECTS_JSON" | jq -r '
  .projects[]
  | select(.name | test("transavic"; "i") or .id | test("cool-sound"; "i"))
  | .id' | head -1)

# Fallback: si no lo identifica por nombre, buscar por endpoint
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
  echo "   ⚠️  No identifiqué proyecto por nombre 'transavic'. Buscando por endpoint..."
  for pid in $(echo "$PROJECTS_JSON" | jq -r '.projects[].id'); do
    EPS=$(curl -s -H "$AUTH" "$API/projects/$pid/endpoints" | jq -r '.endpoints[].host' 2>/dev/null || true)
    if echo "$EPS" | grep -q "cool-sound-adxrsjt5"; then
      PROJECT_ID=$pid
      break
    fi
  done
fi

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
  echo "❌ No encontré ningún proyecto con endpoint 'ep-cool-sound-adxrsjt5' en esta cuenta." >&2
  echo "   ¿Estás seguro de que la API key es de la cuenta dueña del proyecto Transavic?" >&2
  exit 1
fi

echo "   ✅ Proyecto identificado: $PROJECT_ID"

echo ""
echo "🌱 2/4  Creando branch 'dev-hugo' desde la rama main..."

# ¿Ya existe la branch dev-hugo?
EXISTING=$(curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/branches" | jq -r '.branches[] | select(.name=="dev-hugo") | .id' | head -1)

if [[ -n "$EXISTING" && "$EXISTING" != "null" ]]; then
  echo "   ⚠️  Ya existe branch dev-hugo (id=$EXISTING). Reutilizando."
  BRANCH_ID=$EXISTING
else
  CREATE_RES=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"branch":{"name":"dev-hugo"},"endpoints":[{"type":"read_write"}]}' \
    "$API/projects/$PROJECT_ID/branches")
  BRANCH_ID=$(echo "$CREATE_RES" | jq -r '.branch.id')
  if [[ -z "$BRANCH_ID" || "$BRANCH_ID" == "null" ]]; then
    echo "❌ Error creando branch. Respuesta:" >&2
    echo "$CREATE_RES" | jq '.' >&2
    exit 1
  fi
  echo "   ✅ Branch creada: $BRANCH_ID"
fi

echo ""
echo "⏳ 3/4  Esperando 5 segundos a que el endpoint esté ready..."
sleep 5

echo ""
echo "🔌 4/4  Obteniendo connection strings de la branch..."

# Obtener role + db + endpoint host de la branch
ROLE=$(curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/branches/$BRANCH_ID/roles" | jq -r '.roles[0].name')
DB=$(curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/branches/$BRANCH_ID/databases" | jq -r '.databases[0].name')

# Obtener password reveal del role
ROLE_PASS=$(curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/branches/$BRANCH_ID/roles/$ROLE/reveal_password" | jq -r '.password')

# Obtener endpoint host
ENDPOINTS_JSON=$(curl -s -H "$AUTH" "$API/projects/$PROJECT_ID/branches/$BRANCH_ID/endpoints")
HOST_UNPOOLED=$(echo "$ENDPOINTS_JSON" | jq -r '.endpoints[] | select(.type=="read_write") | .host' | head -1)
HOST_POOLED="${HOST_UNPOOLED/.c-/-pooler.c-}"

DATABASE_URL_BRANCH="postgresql://$ROLE:$ROLE_PASS@$HOST_POOLED/$DB?sslmode=require"
DATABASE_URL_UNPOOLED_BRANCH="postgresql://$ROLE:$ROLE_PASS@$HOST_UNPOOLED/$DB?sslmode=require"

echo "   ✅ Branch lista"
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "CONNECTION STRINGS DEL BRANCH dev-hugo:"
echo "═══════════════════════════════════════════════════════════════════════"
echo "DATABASE_URL=$DATABASE_URL_BRANCH"
echo "DATABASE_URL_UNPOOLED=$DATABASE_URL_UNPOOLED_BRANCH"
echo "═══════════════════════════════════════════════════════════════════════"

# Guardar en .env.local (no toca .env de producción)
cat > .env.local <<EOF
# ═══════════════════════════════════════════════════════════════════════
# Branch Neon "dev-hugo" para testing — NO COMMITEAR
# Generado: $(date -u +'%Y-%m-%dT%H:%M:%SZ')
# Project: $PROJECT_ID
# Branch: $BRANCH_ID
# ═══════════════════════════════════════════════════════════════════════
DATABASE_URL=$DATABASE_URL_BRANCH
DATABASE_URL_UNPOOLED=$DATABASE_URL_UNPOOLED_BRANCH
EOF

echo ""
echo "📝 Connection strings guardadas en .env.local"
echo "   El branch se activa automáticamente para los scripts (que ya leen .env.local primero)."
echo ""
echo "🚀 Siguientes pasos:"
echo "   psql \"\$DATABASE_URL\" -f scripts/migrations-fase-ab.sql"
