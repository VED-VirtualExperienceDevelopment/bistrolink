# BistroLink — Release, hotfix y rollback

Cómo se pasa una versión de `develop` a producción, cómo se corrige un error urgente en producción y cómo se vuelve a una versión anterior. El pipeline está en `.github/workflows/ci.yml` (jobs `build`, `deploy-prod` y `rollback`).

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 07/11/2026 | Primera versión: release por tag, aprobación, smoke test, rollback y hotfix (BL-220). |
| 1.1 | 21/11/2026 | «Después» del release: actualizar el tag de la contingencia en Render (BL-217). |
| 1.2 | 22/11/2026 | Después de un release o un rollback de producción: publicar los dashboards para actualizar las métricas DORA (BL-221). |
| 1.3 | 24/11/2026 | Pasos automáticos del pipeline (BL-617): rollback automático de producción si falla el deploy, PR de `render.yaml` y «Publicar dashboards» después del release, y Test Runs de Kiwi con el nombre del tag. |

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
2. La última corrida de `develop` tiene los E2E (Playwright, 4 navegadores y `chromium-configuracion`) en verde.
3. La regresión de la capa en staging está en verde (Anexo 11).
4. La última corrida de `develop` tiene Lighthouse del menú en celular ≥ 80 (job «Lighthouse Performance»).

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
   6. Solo en una versión final (`vX.Y.Z`, no en los `-rc.N`): abre un PR a `develop` que pasa `render.yaml` al tag nuevo (contingencia en Render). Lo abre una GitHub App del equipo, para que corran los checks; el merge lo hace una persona.
   7. Después del job, otro job lanza **Publicar dashboards** (rama `develop`) para las métricas DORA.
5. **Si algo falla después de desplegar la API** (Web, Keycloak o el smoke test), el mismo job vuelve solo los tres servicios al último release y termina en rojo. Ver sección 3.0.
6. Los resultados de contrato e integración de la corrida del tag quedan en Kiwi con el build `vX.Y.Z-contract` y `vX.Y.Z-integration`, en la misma versión de producto que los planes (`develop`).

### 1.5 Después

- [ ] Probar a mano el login, el menú del tenant de demo y el panel de administración.
- [ ] Revisar los logs de la API en Railway (sin errores al arrancar).
- [ ] Si hubo cambios solo en `main`, hacer el *back-merge* de `main` a `develop`.
- [ ] Contingencia en Render: revisar y mergear el PR que abrió el pipeline (`chore(BL-217): contingencia en render con las imagenes de vX.Y.Z`). Cambia solo 3 líneas de `render.yaml`. Después del merge, comprobar en Render que API y Auth quedaron con el tag nuevo (`runbooks/contingencia-render.md`, sección 7). Si el *Summary* de la corrida dice que no se pudo abrir, abrirlo a mano.
- [ ] Comprobar en Actions que corrió **Publicar dashboards** en `develop`, lanzado por el pipeline. Si no aparece: **Run workflow** a mano (rama `develop`).
- [ ] Registrar el release en el ticket de Linear del release.

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

### 3.0 Rollback automático (solo producción)

El job de deploy a producción revierte solo cuando:

- la API nueva ya se mandó a desplegar, **y**
- después falla algo antes de que pase el smoke test (Web, Keycloak o el propio smoke test), **y**
- la API quedó con la versión nueva o no responde.

Vuelve los tres servicios al **último GitHub Release que no es pre-release**, con los mismos controles que el rollback manual, sin pedir otra aprobación. El job termina en rojo igual y el *Summary* indica a qué versión volvió.

**No** revierte si falló el respaldo (no se tocó nada), si fallaron las migraciones (Railway dejó la versión anterior) ni si el smoke test pasó y falló algo posterior. Staging no tiene rollback automático.

Si el *Summary* dice que **el rollback automático también falló**, revertir a mano ya (3.1).

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
- **Publicar dashboards** se lanza solo después de un rollback de producción, manual o automático: el rollback cuenta como falla del release en las métricas DORA. Comprobar que corrió; si no, **Run workflow** a mano.
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
| *Summary*: «production volvió a vX.Y.Z» | Falló el deploy después de desplegar la API y el rollback automático salió bien | Abrir un issue con el error (3.3). La corrección sale como hotfix o en la próxima versión |
| *Summary*: «el rollback a vX.Y.Z también falló» | El rollback automático no pudo dejar la versión anterior | Revertir a mano ya (3.1) y revisar los logs de Railway |
| *Summary*: «No se pudo abrir el PR automático» | Falló el token de la GitHub App o el cambio en `render.yaml` no era el esperado | Abrir el PR de `render.yaml` a mano (`runbooks/contingencia-render.md`, sección 7) |
