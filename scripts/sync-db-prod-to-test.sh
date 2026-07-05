#!/usr/bin/env bash

set -euo pipefail

echo "=========================================================="
echo "Sincronizando Base de Datos: PRODUCCIÓN -> PRUEBAS LOCALES"
echo "=========================================================="

# 1. Obtener URL de Producción (.env)
PROD_URL=$(grep '^DATABASE_URL_UNPOOLED=' .env | cut -d '=' -f2- | tr -d '"' || grep '^DATABASE_URL=' .env | cut -d '=' -f2- | tr -d '"')

# 2. Obtener URL de Pruebas (.env.local)
TEST_URL=$(grep '^DATABASE_URL_UNPOOLED=' .env.local | cut -d '=' -f2- | tr -d '"' || grep '^DATABASE_URL=' .env.local | cut -d '=' -f2- | tr -d '"')

if [[ -z "$PROD_URL" || -z "$TEST_URL" ]]; then
  echo "❌ Error: No se pudieron encontrar las URLs de base de datos en .env o .env.local"
  exit 1
fi

# Nos aseguramos de que exista la carpeta backups
mkdir -p backups
BACKUP_FILE="backups/backup_prod_$(date +%Y%m%d_%H%M%S).sql"

echo "⏳ 1/3 Descargando copia de seguridad de Producción..."
# Se usa pg_dump con --clean para que el script incluya DROP TABLE antes de crear
pg_dump "$PROD_URL" --clean --if-exists --no-owner --no-privileges > "$BACKUP_FILE"
echo "✅ Copia guardada en: $BACKUP_FILE"

echo "⏳ 2/3 Limpiando la base de datos de Pruebas (Fase Beta)..."
psql "$TEST_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" > /dev/null
echo "✅ Base de datos de pruebas limpia."

echo "⏳ 3/3 Restaurando datos reales en la base de datos de Pruebas..."
psql "$TEST_URL" < "$BACKUP_FILE" > /dev/null
echo "✅ Restauración completa."

echo "=========================================================="
echo "🎉 ¡LISTO! Tu entorno local ahora tiene los datos reales de hoy."
echo "=========================================================="
