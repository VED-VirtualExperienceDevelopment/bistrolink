<p align="center">
  <img src="docs/assets/bistrolink-banner.svg" alt="BistroLink: menú digital, pedido por QR, pago y facturación electrónica" width="100%">
</p>

> **Copyright (c) 2026. Todos los derechos reservados.**
> Este código es propietario y confidencial. Queda estrictamente prohibida su copia, distribución, modificación o uso comercial sin autorización expresa de los autores.

<p align="center">
  <a href="https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/workflows/ci.yml"><img src="https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/workflows/ci.yml/badge.svg" alt="CI/CD BistroLink"></a>
  <a href="https://codecov.io/gh/VED-VirtualExperienceDevelopment/bistrolink/branch/develop"><img src="https://codecov.io/gh/VED-VirtualExperienceDevelopment/bistrolink/branch/develop/graph/badge.svg" alt="codecov"></a>
  <a href="https://ved-virtualexperiencedevelopment.github.io/bistrolink/"><img src="https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/workflows/publicar-dashboards.yml/badge.svg" alt="Dashboards"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-381e72?logo=nextdotjs&logoColor=white" alt="Next.js">
  <img src="https://img.shields.io/badge/NestJS-381e72?logo=nestjs&logoColor=white" alt="NestJS">
  <img src="https://img.shields.io/badge/PostgreSQL-381e72?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Prisma-381e72?logo=prisma&logoColor=white" alt="Prisma">
  <img src="https://img.shields.io/badge/Keycloak-381e72?logo=keycloak&logoColor=white" alt="Keycloak">
  <img src="https://img.shields.io/badge/Playwright-c9a74d?logo=playwright&logoColor=white" alt="Playwright">
</p>

Middleware que conecta el menú digital, el pedido autogestionado (QR/web), el pago electrónico y la facturación electrónica con el POS y el KDS ya instalados en el local, sin reemplazarlos. Pensado para restaurantes pequeños y medianos.

## Proyecto académico

Proyecto final de la **Licenciatura en Tecnologías de la Información (UTEC)**, 8.º semestre, 2026. Equipo **VED** (Grupo 2): Verónica Couto, Eric Arenas y Daiana Silvera.

El repositorio es público para la evaluación académica; el código sigue siendo propietario (ver [Licencia](#licencia)). La documentación del proyecto (Línea de Base y anexos) se entrega aparte; acá está la documentación técnica y la evidencia del trabajo.

### Evidencia del trabajo

| Qué                                                                                                       | Dónde                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Avance del MVP por capa y sprint, bugs y calidad del proceso (métricas DORA, plan de pruebas y cobertura) | [Dashboards en GitHub Pages](https://ved-virtualexperiencedevelopment.github.io/bistrolink/)                             |
| Resultados de los tests E2E                                                                               | [Reporte Allure](https://ved-virtualexperiencedevelopment.github.io/bistrolink/allure/e2e/)                              |
| Pipeline de CI/CD y sus corridas                                                                          | [Actions](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions) · [`ci.yml`](.github/workflows/ci.yml) |
| Versiones publicadas en producción                                                                        | [Releases](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/releases) · [procedimiento](docs/RELEASE.md)   |
| Decisiones de arquitectura (ADR)                                                                          | [Índice](docs/README.md#decisiones-de-arquitectura-adr)                                                                  |
| Seguridad: checklist OWASP ASVS nivel 1 e informe del DAST                                                | [ASVS](docs/security/asvs-nivel-1.md) · [DAST](docs/security/dast-informe.md)                                            |
| Informes de regresión por capa                                                                            | [`docs/informes`](docs/informes/README.md)                                                                               |
| Operación: respaldos, contingencia e incidentes                                                           | [Runbooks](docs/README.md#runbooks)                                                                                      |

## Stack

| Capa                       | Tecnología                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- |
| Frontend                   | Next.js + React                                                                  |
| Backend                    | NestJS                                                                           |
| Tiempo real                | Socket.io (WebSocket)                                                            |
| Base de datos              | PostgreSQL + Prisma (multi-tenant, RLS)                                          |
| Autenticación              | Keycloak (OAuth2/OIDC)                                                           |
| Testing                    | Jest (unitarios e integración), Playwright (E2E), k6 y Lighthouse (performance)  |
| Gestión de casos de prueba | Kiwi TCMS                                                                        |
| Integraciones              | Mercado Pago (pagos), Surtec (facturación electrónica), Evolution API (WhatsApp) |
| Hosting                    | Railway (staging y producción), Render (contingencia), imágenes en GHCR          |
| Respaldos                  | Amazon S3 y réplica en Cloudflare R2                                             |
| Secretos y monitoreo       | Infisical; Grafana Cloud (disponibilidad)                                        |

## Monorepo

```
apps/backend/     → API NestJS (Prisma en apps/backend/prisma)
apps/frontend/    → Web Next.js
keycloak/         → Imagen de Keycloak, realm y usuarios de prueba
e2e/              → Tests E2E con Playwright
k6/               → Pruebas de carga
testmgmt/docker/  → Imagen de Kiwi TCMS
infra/backup/     → Servicio de respaldo diario de las bases
infra/replica-r2/ → Réplica de los respaldos de producción en Cloudflare R2
scripts/          → Commits, dashboards, carga de casos en Kiwi, limpieza y utilidades
docs/             → ADR, runbooks, seguridad, informes y dashboards
.github/          → Workflows, acciones propias y plantillas de issues y PR
render.yaml       → Contingencia de producción en Render
```

## Entorno local

Requisitos: **Node.js 22** y **Docker**.

1. Instalar las dependencias (workspaces de npm):
   ```bash
   npm ci
   ```
2. Variables de entorno: copiar `.env.example` a `apps/backend/.env` y completarlo (Docker Compose lee ese mismo archivo). Las `NEXT_PUBLIC_*` del frontend van en `apps/frontend/.env.local` ([detalle](apps/frontend/README.md#desarrollo-local)). Los valores de staging nunca van en un `.env`: se cargan en la sesión de la terminal (ver [`docs/runbooks/migraciones-y-seed.md`](docs/runbooks/migraciones-y-seed.md)).
3. Levantar PostgreSQL y Keycloak:
   ```bash
   docker compose up -d
   ```
   La base local se inicializa con lo necesario para que la API respete el aislamiento entre restaurantes (RLS), y Keycloak importa el realm de desarrollo ([`keycloak/README.md`](keycloak/README.md)).
4. Migraciones y datos de prueba:
   ```bash
   cd apps/backend
   npx prisma migrate deploy
   npx prisma db seed
   ```
   `migrate deploy` aplica las migraciones del repositorio. `migrate dev` se usa solo para crear una migración nueva después de cambiar `schema.prisma`. El seed es idempotente y se puede volver a correr.
5. API y web juntas, desde la raíz:
   ```bash
   npm run dev
   ```
   La API queda en `http://localhost:3001` y la web en `http://localhost:3000`.

## Tests

| Qué                            | Comando (desde la raíz) | Detalle                                          |
| ------------------------------ | ----------------------- | ------------------------------------------------ |
| Unitarios (backend y frontend) | `npm test`              | Jest; cobertura con `npm run test:cov`           |
| E2E                            | `npm run test:e2e`      | Playwright; ver [`e2e/README.md`](e2e/README.md) |
| Carga                          | —                       | k6, con el workflow manual `performance.yml`     |

Los resultados de los tests automáticos se reportan a Kiwi TCMS desde el pipeline.

## CI/CD

Pipeline en GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Se dispara en push y PR a `develop` y `main`, en tags `v*.*.*` y a mano.

- 🔎 **Detectar cambios**: `dorny/paths-filter`. Los PRs que solo tocan documentación no construyen imágenes.
- 🔍 **Lint**: ESLint y Prettier.
- 🧪 **Tests unitarios (Jest)**: cobertura mínima del 80 %, cobertura a Codecov y resultados a Kiwi TCMS.
- 🔐 **Gitleaks**: secretos en todo el historial.
- 🛡️ **CodeQL** y 📊 **SonarCloud**: análisis estático (SAST).
- 📦 **Dependencias**: Trivy sobre el lockfile (vulnerabilidades críticas y altas de las dependencias de producción) y `dependency-review` en los PRs.
- 🐳 **Build + Escaneo**: imágenes de API, Web y Auth, escaneo con Trivy y publicación en GHCR.
- 🚀 **Deploy staging**: automático en cada push a `develop`. Railway aplica las migraciones de Prisma antes de arrancar la API (_pre-deploy_), y el pipeline hace un smoke test con reintentos.
- 🔦 **Lighthouse**: performance mobile contra staging.
- 🎭 **E2E (Playwright)**: cuatro navegadores contra staging. En `develop` es informativo y no corta el pipeline; en `main` y en los tags de release es bloqueante.

Las ramas `develop` y `main` están protegidas: solo se mergea por PR, con revisión de otro integrante y con los controles de calidad y seguridad en verde.

**Producción:** se despliega con un tag `vX.Y.Z` sobre `main`, con aprobación manual. Si el smoke test falla después del deploy, el pipeline vuelve solo a la versión anterior (rollback automático), abre un issue de incidente y avisa al equipo por correo. Después de un release, abre el PR que actualiza la contingencia en Render (`render.yaml`) y vuelve a publicar los dashboards.

### Otros workflows

| Workflow                                                                     | Qué hace                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`publicar-dashboards.yml`](.github/workflows/publicar-dashboards.yml)       | Genera los dashboards de avance (Linear), de bugs (GitHub Issues) y de calidad del proceso (métricas DORA, plan de pruebas y cobertura), los publica en GitHub Pages y manda el correo de estado al cierre de cada sprint |
| [`db-backup-check.yml`](.github/workflows/db-backup-check.yml)               | Todos los días: controla que exista el respaldo del día de las bases y que la réplica de producción en Cloudflare R2 esté al día                                                                                          |
| [`db-backup-restore-test.yml`](.github/workflows/db-backup-restore-test.yml) | Todos los meses: prueba la restauración del último respaldo en un entorno temporal                                                                                                                                        |
| [`dast.yml`](.github/workflows/dast.yml)                                     | Todas las noches: análisis dinámico de seguridad de staging con OWASP ZAP (pasivo). A mano, también el escaneo activo de la API                                                                                           |
| [`limpieza-staging.yml`](.github/workflows/limpieza-staging.yml)             | Todas las noches: deja los datos de prueba de staging como el seed. A mano, por defecto en dry-run                                                                                                                        |
| [`ghcr-cleanup.yml`](.github/workflows/ghcr-cleanup.yml)                     | Todas las semanas: limpia imágenes viejas de GHCR y conserva las de release                                                                                                                                               |
| [`actions-cache-cleanup.yml`](.github/workflows/actions-cache-cleanup.yml)   | Todos los días y al cerrar un PR: borra las cachés de Actions que ya no se usan                                                                                                                                           |
| [`performance.yml`](.github/workflows/performance.yml)                       | Manual: pruebas de carga con k6 y Lighthouse, con reporte a Kiwi TCMS                                                                                                                                                     |
| [`cleanup-test-runs.yml`](.github/workflows/cleanup-test-runs.yml)           | Manual: limpia corridas viejas en Kiwi TCMS (nunca las de evidencia `[REGRESION-HX]` o `[CIERRE]`)                                                                                                                        |

Acciones propias que usan los workflows: [`despertar-staging`](.github/actions/despertar-staging/action.yml) y [`revertir-railway`](.github/actions/revertir-railway/action.yml) (rollback de un entorno en Railway, manual o automático).

## Ambientes

| Servicio                                        | Staging                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Web                                             | https://bistrolink-web-staging.up.railway.app                  |
| Dashboards (avance, bugs y calidad del proceso) | https://ved-virtualexperiencedevelopment.github.io/bistrolink/ |

## Documentación

Índice completo en [`docs/README.md`](docs/README.md).

- Por componente: [`apps/backend`](apps/backend/README.md), [`apps/frontend`](apps/frontend/README.md), [`keycloak`](keycloak/README.md), [`e2e`](e2e/README.md), [`testmgmt`](testmgmt/README.md), [`infra/backup`](infra/backup/README.md), [`infra/replica-r2`](infra/replica-r2/README.md), [`scripts/dashboards`](scripts/dashboards/README.md), [`scripts/limpieza`](scripts/limpieza/README.md).
- Decisiones de arquitectura: [ADR 0001 a 0015](docs/README.md#decisiones-de-arquitectura-adr).
- Runbooks: [migraciones y seed](docs/runbooks/migraciones-y-seed.md), [respaldo y restauración](docs/runbooks/respaldo-y-restauracion.md), [contingencia en Render](docs/runbooks/contingencia-render.md), [respuesta a incidentes](docs/runbooks/respuesta-a-incidentes.md), [privacidad y datos personales](docs/runbooks/privacidad-y-datos-personales.md), [bot de WhatsApp](docs/runbooks/whatsapp-evolution.md).
- Seguridad: [endpoints públicos](docs/security/public-endpoints.md), [DAST](docs/security/dast.md) y su [informe](docs/security/dast-informe.md), [checklist OWASP ASVS](docs/security/asvs-nivel-1.md), [política de seguridad](SECURITY.md).

## Commits

Los commits siguen Conventional Commits con el ticket de Linear y se hacen con `npm run commit`, que crea la rama desde `develop`. Detalle en [`docs/COMMITS.md`](docs/COMMITS.md).

## Releases

Producción se despliega solo con un tag `vX.Y.Z`, con la aprobación de otro integrante. Si el deploy falla, el pipeline vuelve solo a la versión anterior; el rollback manual queda para los errores que aparecen después. Release, hotfix y rollback en [`docs/RELEASE.md`](docs/RELEASE.md).

## Licencia

**Copyright (c) 2026. Todos los derechos reservados.**

Este código es propietario y confidencial. Queda estrictamente prohibida su copia, distribución, modificación o uso comercial sin autorización expresa de los autores. No se otorga ninguna licencia de uso público.
