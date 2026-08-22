# Stage 1: dependencias
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/frontend/package*.json ./apps/frontend/
RUN npm pkg delete scripts.prepare && npm ci --workspace=apps/frontend

# Stage 2: compilación
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY apps/frontend/ ./apps/frontend/
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001
ARG NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
ARG NEXT_PUBLIC_KEYCLOAK_REALM=bistrolink
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=bistrolink-frontend
ARG NEXT_PUBLIC_APP_VERSION=unknown
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_KEYCLOAK_URL=$NEXT_PUBLIC_KEYCLOAK_URL
ENV NEXT_PUBLIC_KEYCLOAK_REALM=$NEXT_PUBLIC_KEYCLOAK_REALM
ENV NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
WORKDIR /app/apps/frontend
ARG CACHEBUST=1
RUN npm run build

# Stage 3: producción (standalone)
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S bistrolink && adduser -S bistrolink -G bistrolink

# Con outputFileTracingRoot apuntando a la raíz del monorepo, "standalone"
# replica la ruta completa desde esa raíz: server.js queda en
# standalone/apps/frontend/server.js, no en standalone/server.js.
# .next/static y public tampoco se incluyen automáticamente en standalone
# (documentado por Next.js) — hay que copiarlos a mano en la ruta anidada
# equivalente para que server.js los encuentre en runtime.
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

# node:22-alpine trae el CLI de npm empaquetado (con tar, sigstore,
# brace-expansion, ip-address como dependencias internas), aunque este stage
# nunca lo use — solo copiamos el build de Next.js standalone ya compilado y
# corremos "node server.js". Lo borramos para que Trivy deje de marcar CVEs
# de un binario que ni siquiera se ejecuta en runtime.
RUN rm -rf /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/bin/corepack

USER bistrolink
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/frontend/server.js"]