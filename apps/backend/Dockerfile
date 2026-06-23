# Stage 1: compilación
FROM node:22-alpine AS builder
WORKDIR /app

# Copiar lockfile y package.json raíz + workspace backend
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/

RUN  npm pkg delete scripts.prepare && npm ci --workspace=apps/backend

COPY apps/backend/ ./apps/backend/

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
  node_modules/multer \
  node_modules/picomatch
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma
RUN npx prisma@5.19.1 generate
RUN addgroup -S bistrolink && adduser -S bistrolink -G bistrolink
USER bistrolink
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/main.js"]
