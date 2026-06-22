# Stage 1: dependencias
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./ && RUN npm ci


# Stage 2: compilación
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Variables NEXT_PUBLIC_ son públicas (no son secretos)
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001
ARG NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
ARG NEXT_PUBLIC_KEYCLOAK_REALM=bistrolink
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=bistrolink-frontend
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_KEYCLOAK_URL=$NEXT_PUBLIC_KEYCLOAK_URL
ENV NEXT_PUBLIC_KEYCLOAK_REALM=$NEXT_PUBLIC_KEYCLOAK_REALM
ENV NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
RUN npm run build


# Stage 3: producción (standalone)
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S bistrolink && adduser -S bistrolink -G bistrolink
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER bistrolink
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
