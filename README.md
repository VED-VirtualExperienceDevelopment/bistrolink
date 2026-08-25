# bistrolink

Middleware que conecta el menú digital, el pedido autogestionado (QR/web), el pago electrónico y la facturación electrónica con el POS y el KDS ya instalados en el local — sin reemplazarlos.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js + React |
| Backend | NestJS |
| Tiempo real | Socket.io (WebSocket) |
| Base de datos | PostgreSQL + Prisma (multi-tenant, RLS) |
| Autenticación | Keycloak (OAuth2/OIDC) |
| Testing | Jest (unitarios/integración) |
| Gestión de casos de prueba | Kiwi TCMS |

## Monorepo

```
apps/backend/    → API NestJS
apps/frontend/   → Web Next.js
keycloak/        → Dockerfile.auth (Keycloak)
testmgmt/docker/ → Imagen custom de Kiwi TCMS
```

## CI/CD

Pipeline en GitHub Actions (`.github/workflows/ci.yml`), disparado en push/PR a `develop`/`main` y en tags `v*.*.*`:

- 🔎 **Detectar cambios** — `dorny/paths-filter`, evita correr jobs de más cuando el cambio no toca `apps/` o `testmgmt/`.
- 🔍 **Lint** — ESLint + Prettier.
- 🧪 **Tests unitarios (Jest)** — cobertura mínima 80%, resultados a Kiwi TCMS, cobertura a Codecov + artifact.
- 🐳 **Build + Escaneo** — build en matrix (API / Web / Auth), escaneo de vulnerabilidades con Trivy, publicación en GHCR.
- 🔐 **Gitleaks** — escaneo de secretos.
- 🛡️ **CodeQL** / 📊 **SonarCloud** — SAST.
- 📦 **Snyk** — auditoría de dependencias.
- 🚀 **Deploy staging** — Railway (API, Web, Auth), migraciones de Prisma, health check.
- 🔦 **Lighthouse** — performance mobile en staging (solo `develop`).

## Ambientes

| Servicio | Staging |
|---|---|
| API | https://bistrolink-api-staging.up.railway.app |
| Web | https://bistrolink-web-staging.up.railway.app |
| Auth (Keycloak) | https://bistrolink-auth-staging.up.railway.app |
| Testing (Kiwi TCMS) | https://testmgmt-staging.up.railway.app |

---

[![CI/CD BistroLink](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/workflows/ci.yml/badge.svg)](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/VED-VirtualExperienceDevelopment/bistrolink/branch/develop/graph/badge.svg)](https://codecov.io/gh/VED-VirtualExperienceDevelopment/bistrolink/branch/develop)
