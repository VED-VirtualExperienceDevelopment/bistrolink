# Stage 1: compilación
FROM node:22-alpine AS builder
WORKDIR /app

# Copiar lockfile y package.json raíz + workspace backend
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/

# npm ci SIN --omit=dev acá: necesitamos prisma (devDependency) para generar el cliente
RUN npm pkg delete scripts.prepare && npm ci --workspace=apps/backend --ignore-scripts

COPY apps/backend/ ./apps/backend/

# Generar el cliente de Prisma UNA VEZ, acá en el builder (que sí tiene el CLI de
# Prisma instalado como devDependency). El resultado (node_modules/.prisma) se
# copia después al stage de producción.
RUN npx prisma@5.19.1 generate --schema=apps/backend/prisma/schema.prisma

RUN npm run build --workspace=apps/backend

# Stage 2: CLI de Prisma para las migraciones (BL-231)
# Railway aplica las migraciones con el pre-deploy command de bistrolink-api
# (docker/predeploy-migrate.sh): corre con esta misma imagen, dentro de la red
# privada y antes de ponerla en línea. Así la base no necesita acceso público.
# La imagen final no tiene npm ni npx, así que el CLI va armado acá, aparte de
# las dependencias de la app:
# - Misma versión de prisma que el lockfile, leída en el build para que no se
#   desincronice cuando se actualice.
# - Mismos "overrides" que el package.json raíz: sin ellos, el CLI trae
#   dependencias que el proyecto ya fuerza a versiones corregidas (por
#   ejemplo deepmerge-ts, HIGH en 7.x) y Trivy corta el build.
# - Los motores se descargan ACÁ (postinstall de @prisma/engines). Si faltan,
#   el CLI los baja recién al ejecutarse: en cada pre-deploy, desde
#   binaries.prisma.sh.
# - Target forzado a linux-musl-openssl-3.0.x: en Alpine la detección
#   automática de OpenSSL falla (ver binaryTargets en schema.prisma).
FROM node:22-alpine AS migrate
WORKDIR /migrate
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x
COPY package.json package-lock.json /tmp/root/
RUN set -eux; \
  node -e " \
  const root = require('/tmp/root/package.json'); \
  const lock = require('/tmp/root/package-lock.json'); \
  const version = lock.packages['node_modules/prisma'].version; \
  require('fs').writeFileSync('package.json', JSON.stringify({ \
  name: 'bistrolink-migrate', private: true, \
  dependencies: { prisma: version }, \
  overrides: root.overrides || {} \
  }, null, 2)); \
  console.log('prisma', version); \
  "; \
  npm install --omit=dev --no-audit --no-fund; \
  # El postinstall falla en silencio si no puede descargar: "mv" corta el
  # build si los motores no están.
  mkdir engines; \
  mv node_modules/@prisma/engines/schema-engine-linux-musl-openssl-3.0.x engines/schema-engine; \
  mv node_modules/@prisma/engines/libquery_engine-linux-musl-openssl-3.0.x.so.node engines/libquery_engine.so.node; \
  # Comprobación: el CLI usa los motores horneados (no descarga nada) y el
  # binario del schema engine y la librería del query engine cargan en Alpine.
  PRISMA_SCHEMA_ENGINE_BINARY=/migrate/engines/schema-engine \
  PRISMA_QUERY_ENGINE_LIBRARY=/migrate/engines/libquery_engine.so.node \
  node node_modules/prisma/build/index.js --version; \
  rm -rf /tmp/root; \
  npm cache clean --force

# Stage 3: producción
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk update && apk upgrade --no-cache libcrypto3 libssl3 && rm -rf /var/cache/apk/*
# SHA del commit horneado en build time (pasado por el CI vía --build-arg).
# Se expone como env var en runtime para que /version pueda devolverlo sin
# depender de variables que Railway ya no inyecta al pasar a "Docker Image"
# como source (RAILWAY_GIT_COMMIT_SHA solo existe si el source es un repo).
ARG GIT_SHA=unknown
ENV APP_VERSION=$GIT_SHA

COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
RUN npm pkg delete scripts.prepare && \
  npm ci --workspace=apps/backend --omit=dev --ignore-scripts && \
  npm cache clean --force && \
  rm -rf node_modules/.cache \
  node_modules/lodash \
  node_modules/picomatch && \
  # El backend corre con "node dist/main.js" — nunca necesita npm en runtime.
  # node:22-alpine trae el CLI de npm empaquetado (con sus propias dependencias
  # internas: tar, sigstore, brace-expansion, ip-address), que es justo lo que
  # Trivy venía marcando como CRITICAL/HIGH. Una vez que npm ci terminó de
  # instalar, borramos npm y corepack de la imagen final por completo.
  rm -rf /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/bin/corepack

# El backend se ejecuta desde apps/backend (no desde /app): npm ci con
# --workspace puede dejar dependencias del backend en apps/backend/node_modules
# (cuando su versión choca con la que quedó hoisteada en la raíz). Desde
# apps/backend/dist, Node las encuentra ahí y también en /app/node_modules;
# desde /app/dist solo vería la raíz y fallaría con "Cannot find module".
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# CLI de Prisma y script del pre-deploy de Railway (BL-231). Usa el schema y
# las migraciones de apps/backend/prisma, copiados arriba.

COPY --from=migrate /migrate /app/migrate
COPY --chmod=0755 apps/backend/docker/predeploy-migrate.sh /app/migrate/predeploy-migrate.sh
RUN addgroup -S bistrolink && adduser -S bistrolink -G bistrolink
WORKDIR /app/apps/backend
USER bistrolink
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/main.js"]
