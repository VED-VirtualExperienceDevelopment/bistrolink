# Stage 1: compilación
FROM node:22-alpine AS builder
WORKDIR /app

# Copiar lockfile y package.json raíz + workspace backend
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/

# npm ci SIN --omit=dev acá: necesitamos prisma (devDependency) para generar el cliente
RUN npm pkg delete scripts.prepare && npm ci --workspace=apps/backend

COPY apps/backend/ ./apps/backend/

# Generar el cliente de Prisma UNA VEZ, acá en el builder. El resultado (node_modules/.prisma) se
# copia después al stage de producción — ahí nunca se vuelve a invocar npx/prisma.
RUN npx prisma@5.19.1 generate --schema=apps/backend/prisma/schema.prisma

RUN npm run build --workspace=apps/backend

# Stage 2: producción
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
RUN npm pkg delete scripts.prepare && \
  npm ci --workspace=apps/backend --omit=dev && \
  npm cache clean --force && \
  rm -rf node_modules/.cache \
  node_modules/lodash \
  node_modules/picomatch
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma

# Cliente de Prisma ya generado en el builder — reemplaza el antiguo
# `RUN npx prisma@5.19.1 generate` que se ejecutaba acá y arrastraba el CLI
# completo de npm (tar, sigstore, adm-zip, brace-expansion) a la imagen final.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

RUN addgroup -S bistrolink && adduser -S bistrolink -G bistrolink
USER bistrolink
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/main.js"]