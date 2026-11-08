# BistroLink — Release, hotfix y rollback

Cómo se pasa una versión de `develop` a producción, cómo se corrige un error urgente en producción y cómo se vuelve a una versión anterior. El pipeline está en `.github/workflows/ci.yml` (jobs `build`, `deploy-prod` y `rollback`).

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 07/11/2026 | Primera versión: release por tag, aprobación, smoke test, rollback y hotfix (BL-220). |

---

## Conceptos

- **Producción** es un entorno productivo con integraciones en *sandbox* y sin operaciones reales (decisión del 30/09/2026).
- **Staging** se despliega por SHA en cada push a `develop`. **Producción** se despliega solo por **tag semántico** (`vX.Y.Z`), nunca por SHA ni por `latest`.
- En un tag, el job `build` compila las tres imágenes con la versión adentro (la Web, además, con las URLs de producción) y las publica en GHCR con el tag. Por eso `/health/version` y el badge de la Web muestran `vX.Y.Z`.
- **Versionado:** una versión menor por capa o sprint (`v0.5.0`, `v0.6.0`…), parches para los hotfix (`v0.5.1`) y `-rc.N` para los ensayos (`v0.5.0-rc.1`, publicado como *pre-release*).
- El environment `production` de GitHub **exige la aprobación de un integrante distinto del que creó el tag** y solo admite tags `v*.*.*` y la rama `main`. Cada aprobación queda registrada (quién y cuándo) y cada deploy cuenta para las métricas DORA.
- Las **migraciones** las aplica el *pre-deploy* de la API dentro de Railway. GitHub no tiene acceso a la base. El equipo trabaja con el patrón *expand/contract*: una migración nunca rompe la versión anterior del código, así que un rollback de imagen no necesita revertir la base.

---

## 1. Release

### 1.1 Antes (en `develop`)

1. Todo lo que entra en la versión está mergeado en `develop` y desplegado en staging.
2. La última corrida de `develop` tiene los E2E (Playwright, 4 navegadores) en verde.
3. La regresión de la capa en staging está en verde (Anexo 11).

### 1.2 Ensayo (opcional, recomendado antes de una versión menor)

1. En Railway, entorno `production`, servicio de respaldo → **Run now**. Esperar a que termine (las dos bases con `resultado=ok`).
2. Crear el tag de ensayo sobre el último commit de `develop`:
   ```bash
   git fetch origin
   git tag v0.5.0-rc.1 origin/develop
   git push origin v0.5.0-rc.1
   ```
3. En Actions, la corrida del tag queda esperando la aprobación en el job **Deploy producción**. Otro integrante la aprueba (**Review deployments → production → Approve and deploy**).
4. Revisar que el job termine en verde (respaldo, API, Web, Keycloak, smoke test y *pre-release*) y probar la Web de producción.

### 1.3 PR de release

1. Abrir el PR `develop` → `main` con la plantilla de release:
   `https://github.com/VED-VirtualExperienceDevelopment/bistrolink/compare/main...develop?template=release.md`
2. Completar la plantilla: tickets, migraciones, variables nuevas, riesgos y links a la regresión.
3. **2 aprobaciones** y todos los checks obligatorios en verde.
4. Mergear con **Create a merge commit** (no *squash*), para que los commits originales lleguen a `main` y se pueda medir el *lead time*.

### 1.4 Deploy

1. **Respaldo:** Railway → `production` → servicio de respaldo → **Run now**. El job de deploy exige un respaldo de las dos bases de menos de 120 minutos; si no lo encuentra, se corta antes de tocar nada.
2. **Tag** sobre el commit de merge en `main`:
   ```bash
   git fetch origin
   git tag v0.5.0 origin/main
   git push origin v0.5.0
   ```
   Crear tags `v*` está restringido a los administradores del repositorio.
3. **Aprobación:** otro integrante aprueba el deploy en Actions.
4. El job hace, en orden:
   1. Verifica el respaldo de producción.
   2. Despliega la API y espera a que `/health/version` devuelva el tag con `upToDate: true`. Si el *pre-deploy* (migraciones) falla, Railway deja la versión anterior y el job se corta sin tocar la Web ni Keycloak.
   3. Despliega la Web y Keycloak.
   4. Smoke test de solo lectura: health de la API y de la Web, configuración y emisor de Keycloak, y la ruta de limpieza de datos de prueba respondiendo 404.
   5. Publica el GitHub Release con notas generadas a partir de los PRs.

### 1.5 Después

- [ ] Probar a mano el login, el menú del tenant de demo y el panel de administración.
- [ ] Revisar los logs de la API en Railway (sin errores al arrancar).
- [ ] Si hubo cambios solo en `main`, hacer el *back-merge* de `main` a `develop`.
- [ ] Registrar el release en el Anexo 12 (registro de verificaciones).

---

## 2. Hotfix

Para corregir un error en producción sin llevar lo que todavía está en `develop`.

1. Crear la rama desde `main`: `hotfix/BL-NNN-descripcion`.
2. Corregir, con su test, y abrir el PR a `main` (2 aprobaciones, *merge commit*).
3. Respaldo (**Run now**) y tag de parche sobre el merge: por ejemplo `v0.5.1`.
4. Aprobación y deploy, igual que en 1.4.
5. **Back-merge** de `main` a `develop`, para que el arreglo no se pierda en la próxima versión.

---

## 3. Rollback

Vuelve los tres servicios (API, Web y Keycloak) a una imagen ya publicada en GHCR, sin reconstruir nada. **No revierte la base de datos** (ver *expand/contract* en Conceptos).

### 3.1 Producción

1. Actions → workflow **CI/CD BistroLink** → **Run workflow**.
2. **Use workflow from:** `main`.
3. **rollback_environment:** `production`.
4. **rollback_version:** el tag al que se vuelve, por ejemplo `v0.5.0`. Tiene que ser un tag ya publicado; un SHA no sirve, porque esa imagen de Web tiene las URLs de staging.
5. Otro integrante aprueba en el environment `production`.
6. El job verifica que existan las tres imágenes y que la API tenga el *pre-deploy*, despliega, hace el health check y confirma que `/health/version` quedó en ese tag.

### 3.2 Staging

Igual que 3.1, con **Use workflow from:** `develop`, **rollback_environment:** `staging` y **rollback_version:** el SHA completo (40 caracteres) del commit al que se vuelve.

### 3.3 Después de un rollback

- Abrir un issue con el error que lo motivó.
- La corrección sale como hotfix (sección 2) o en la próxima versión.
- Una migración que haya que deshacer se corrige con una migración nueva hacia adelante, nunca a mano en la base.

---

## 4. Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El job se corta en «Verificar el respaldo de producción» | No hay un respaldo de menos de 120 min | Railway → servicio de respaldo → **Run now** y volver a correr el job (*Re-run failed jobs*) |
| «A los 10 minutos la API sigue sin la versión» | Falló el *pre-deploy* (migraciones) o la API no arranca | Railway → API de producción → Deployments → logs del deploy de ese tag. Producción sigue con la versión anterior |
| «upToDate=false» | La última migración de la base no coincide con la de la imagen | Revisar las migraciones del release antes de reintentar |
| Smoke test: issuer de Keycloak distinto | `KC_HOSTNAME` mal configurado | Revisar las variables de Keycloak de producción |
| Smoke test: `/testing/limpieza` no da 404 | La API de producción tiene habilitada la limpieza de datos de prueba | Quitar esa variable de la API de producción y redesplegar |
| El deploy no arranca y queda «Waiting» | Falta la aprobación | Otro integrante aprueba en Actions (no puede ser quien creó el tag) |
