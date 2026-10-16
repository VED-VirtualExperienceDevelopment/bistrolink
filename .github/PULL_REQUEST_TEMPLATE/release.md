<!--
Plantilla del PR de release develop → main (BL-220).
Se abre con: https://github.com/VED-VirtualExperienceDevelopment/bistrolink/compare/main...develop?template=release.md

Comandos útiles para completarla (desde la raíz del repo, con origin actualizado: git fetch origin):
  Cambios incluidos:  git log --oneline --no-merges origin/main..origin/develop
  Migraciones nuevas: git diff --name-only origin/main...origin/develop -- apps/backend/prisma/migrations
-->

# Release vX.Y.Z

**Capa / sprint:** <!-- ej.: cierre de Capa Núcleo -->
**Tag a crear después del merge:** `vX.Y.Z`
**Fecha prevista del deploy a production:** <!-- dd/mm/aaaa -->

## Historias y tickets incluidos

| Ticket | HU  | Descripción |
| ------ | --- | ----------- |
| BL-    |     |             |

## Migraciones de base de datos

- [ ] No hay migraciones nuevas.
- [ ] Hay migraciones nuevas (listarlas abajo). Todas siguen la política _expand/contract_: ninguna borra ni renombra columnas que la versión anterior todavía usa.

| Migración | Qué cambia | ¿Compatible con la versión anterior (rollback)? |
| --------- | ---------- | ----------------------------------------------- |
|           |            |                                                 |

## Variables y configuración nuevas en production

<!-- Variables de entorno, cambios en Keycloak, buckets, webhooks de proveedores, etc. Escribir "Ninguna" si no hay. -->

## Riesgos y plan de rollback

| Riesgo | Impacto | Mitigación |
| ------ | ------- | ---------- |
|        |         |            |

**Versión a la que se vuelve si hay rollback:** `vX.Y.Z` <!-- release anterior -->

## Regresión en staging

- [ ] Regresión de la capa en verde en staging (Anexo 11). Link a la corrida: <!-- Kiwi TCMS / Allure -->
- [ ] E2E (Playwright, 4 navegadores) en verde en la última corrida de `develop`. Link: <!-- corrida de Actions -->
- [ ] Sin alertas críticas o altas abiertas en Security (Trivy, CodeQL, Dependabot) o justificadas abajo.

## Checklist del release

**Antes del merge**

- [ ] Todos los checks obligatorios en verde.
- [ ] 2 aprobaciones.
- [ ] Merge con **Create a merge commit** (no _squash_).

**Después del merge**

- [ ] Respaldo de la base de production del día verificado (`db-backup` → _Run now_ y objeto en el bucket de respaldos de production).
- [ ] Tag `vX.Y.Z` creado sobre el commit de merge en `main`.
- [ ] Deploy aprobado en el environment `production` por un integrante distinto del que creó el tag.
- [ ] Smoke test de production en verde: `/health`, `/health/ready`, `/health/version` igual al tag, menú del tenant de demo y login de Keycloak.
- [ ] GitHub Release publicado con las notas.
- [ ] Back-merge de `main` a `develop`, si hubo cambios solo en `main`.

## Notas
