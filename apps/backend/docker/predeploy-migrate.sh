#!/bin/sh
# Pre-deploy command de bistrolink-api en Railway (BL-231).
#
# Railway lo ejecuta con la imagen NUEVA, en un contenedor aparte, dentro de
# la red privada y con las variables del servicio (DATABASE_URL apunta a
# *.railway.internal). Si termina con un código distinto de 0, el deploy no
# sigue y queda en línea la versión anterior.
#
# Configuración en Railway (staging y production): bistrolink-api → Settings
# → Deploy → Pre-deploy Command = /app/migrate/predeploy-migrate.sh
#
# "migrate deploy" solo aplica las migraciones pendientes de la carpeta
# prisma/migrations de esta imagen: en un rollback a una imagen anterior no
# hay nada pendiente y no toca la base (patrón expand/contract).
set -eu
: "${DATABASE_URL:?falta DATABASE_URL en las variables del servicio}"
cd /app/migrate

# Motores horneados en el build (stage "migrate" del Dockerfile): con estas
# variables el CLI no intenta descargarlos. Se setean solo acá, no en la
# imagen, para no afectar al cliente de Prisma de la aplicación.
export PRISMA_SCHEMA_ENGINE_BINARY=/app/migrate/engines/schema-engine
export PRISMA_QUERY_ENGINE_LIBRARY=/app/migrate/engines/libquery_engine.so.node
echo "[predeploy] versión de la imagen: ${APP_VERSION:-desconocida}"
echo "[predeploy] aplicando migraciones pendientes..."
exec node node_modules/prisma/build/index.js migrate deploy \
  --schema /app/apps/backend/prisma/schema.prisma
