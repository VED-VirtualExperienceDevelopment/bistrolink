# 📈 Calidad del proceso

<!-- SOLO-REPO:start -->

> 📌 **La versión al día de este dashboard está publicada en GitHub Pages:** https://ved-virtualexperiencedevelopment.github.io/bistrolink/calidad-proceso.html (BL-221). Este archivo es la plantilla que usa el workflow «Publicar dashboards»: los bloques `AUTO` de acá no se actualizan en el repositorio.

<!-- SOLO-REPO:end -->

> **Nota de control:** las secciones marcadas con `<!-- AUTO -->` las llena `scripts/dashboards/metricas-dora.mjs` desde GitHub (deployments, PR y corridas del CI). No se editan a mano.

**Dos vistas de las mismas cuatro métricas.** Las métricas DORA miden con qué frecuencia llega un cambio, cuánto tarda, cuántas veces sale mal y cuánto lleva recuperarse.

- **Producción (medición oficial, Anexo 9 §10.2 y ADR 0004):** mide el proceso de release. Producción existe desde v0.5.0 (08/11/2026), así que hasta la entrega hay pocos releases.
- **Staging (integración continua, Línea de Base, Tabla 24):** cada merge a `develop` que cambia la aplicación se despliega solo en staging. Tiene muchos más datos y muestra el ritmo de trabajo del equipo. Antes de que existiera producción, era la única medición.

Las dos no se suman: miden cosas distintas. **Nota metodológica:** el equipo es de 3 personas y el historial es corto; los porcentajes y las medianas se leen junto con las cantidades.

---

## 📊 Producción: resumen (medición oficial)

<!-- AUTO:dora-resumen:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:dora-resumen:end -->

---

## 🚀 Releases a producción

<!-- AUTO:dora-releases:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:dora-releases:end -->

---

## 📅 Frecuencia de despliegue

<!-- AUTO:dora-frecuencia:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:dora-frecuencia:end -->

---

## ⏱️ Lead time de cambios

<!-- AUTO:dora-lead-time:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:dora-lead-time:end -->

---

## 🔁 Integración continua (staging)

<!-- AUTO:dora-staging:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:dora-staging:end -->

---

## 🧭 Contexto: pipeline e incidentes

<!-- AUTO:dora-contexto:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:dora-contexto:end -->

---

## 🧪 Plan de pruebas (Kiwi TCMS)

<!-- AUTO:pruebas-kiwi:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:pruebas-kiwi:end -->

---

## 🎯 Cobertura de código (Codecov)

<!-- AUTO:pruebas-cobertura:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:pruebas-cobertura:end -->

---

## 🔐 Hallazgos de seguridad

Meta del Anexo 9 §10.2: **0 hallazgos críticos o altos abiertos**. Cada herramienta actúa en un momento distinto:

| Herramienta | Qué revisa | Ante un hallazgo crítico o alto | Dónde se ve |
| --- | --- | --- | --- |
| Trivy | Dependencias, Dockerfile e imágenes | El job falla: no se publica la imagen ni se despliega | Log de los jobs «Dependencias (Trivy)» y «Build + Escaneo» del CI |
| Revisión de dependencias | Dependencias nuevas o actualizadas en un PR | El check del PR falla | En el PR |
| Gitleaks | Secretos en el código | El job falla | Log del job y [Security → Code scanning](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/security/code-scanning) |
| CodeQL | Análisis estático del código | Alerta en el PR; se corrige antes del merge | [Security → Code scanning](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/security/code-scanning) |
| SonarCloud | Análisis estático y calidad | El *Quality Gate* del PR no pasa | [Proyecto en SonarCloud](https://sonarcloud.io/project/overview?id=VED-VirtualExperienceDevelopment_bistrolink) |
| Dependabot | Avisos sobre las dependencias ya instaladas | Alerta y PR de actualización | [Security → Dependabot](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/security/dependabot) |
| DAST (OWASP ZAP) | La aplicación en staging, de noche | La corrida diaria de `dast.yml` falla y bloquea el release | [Criterio de salida](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/blob/develop/docs/security/dast.md#criterio-de-salida) |

---

## 📖 Cómo se calcula

| Métrica | Definición | Fuente | Meta (Anexo 9 §10.2) |
| --- | --- | --- | --- |
| Frecuencia de despliegue | Releases exitosos a `production` por sprint. Un release es el deploy de un tag `vX.Y.Z`; los ensayos (`vX.Y.Z-rc.N`) se muestran pero no cuentan. El promedio usa solo los sprints cerrados | Deployments del environment `production` (job «Deploy producción») | ≥ 1 por sprint |
| Lead time de cambios | Por cada PR que entra en un release: desde su primer commit hasta el deploy en producción. Mediana y percentil 85, separando revisión (apertura del PR → merge a `develop`) y release (merge → producción). El primer release no se mide, porque incluye todo el historial del proyecto | Comparación entre el tag anterior y el nuevo, y los PR mergeados a `develop` | Mediana ≤ 1 sprint (14 días) |
| Tasa de fallas en cambios | Releases que necesitaron un rollback de producción o un hotfix (el release siguiente es un parche, `vX.Y.Z` con Z > 0), sobre el total de releases | Deployments del job «Rollback manual» y tags de parche | < 15 % |
| Tiempo de recuperación | Desde el deploy del release fallido hasta el rollback o el hotfix exitoso | Deployments | < 1 día hábil (24 h) |

- **Staging (Línea de Base, Tabla 24):** las mismas cuatro métricas sobre los jobs «Deploy staging» de las últimas 4 semanas. Frecuencia: deploys exitosos por semana (meta ≥ 3). Lead time: desde que se abre el PR hasta que su merge queda desplegado en staging (meta < 2 días hábiles, 48 h). Tasa de fallas: deploys fallidos sobre el total (meta < 15 %). Recuperación: desde un deploy fallido hasta el siguiente exitoso (meta < 1 día hábil, 24 h).
- **Un deploy fallido** (por ejemplo, porque falló el *pre-deploy* de migraciones) no es una falla en producción: Railway deja la versión anterior. Se muestra en la tabla de releases, pero no cuenta en la tasa de fallas.
- **Plan de pruebas (Kiwi TCMS):** por cada Test Plan activo del producto Bistrolink en la versión `develop` (los de otras versiones no se cuentan), los casos confirmados y los últimos 10 Test Runs (los que conserva la limpieza de `cleanup-test-runs.yml`). Aprobación: aprobados sobre ejecutados del último run. «Nunca ejecutados»: casos sin ninguna ejecución terminada en esos runs. El resumen de cada corrida (aprobados, fallidos, salteados y duración) está en el Summary de la corrida del CI.
- **Cobertura (Codecov):** del último commit de `develop`, la misma rama de los Test Plans de Kiwi (`main` cambia recién con cada release). Total, backend y frontend. La meta del Anexo 9 (≥ 80 % en la lógica de negocio) se aplica al backend; el frontend se muestra para seguir su evolución y en cada PR tiene un check informativo de Codecov que no frena el merge.
- **Regresiones:** bugs con la etiqueta `regresion`: algo que ya funcionaba y dejó de funcionar después de un cambio. La plantilla de bug pide en qué release o PR apareció.
- **Incidentes:** los issues con la etiqueta `incidente` se cuentan como contexto. Si un incidente de producción termina en un rollback o un hotfix, ya queda medido por esa vía.
- **Duración del pipeline:** desde que empieza la corrida del CI en `develop` hasta que termina «Deploy staging». No incluye los E2E ni el reporte, que corren después del deploy.

Runbook del release, hotfix y rollback: [`docs/RELEASE.md`](RELEASE.md).

---

## 🔗 Otras métricas del proceso

Estas métricas ya se publican en otras páginas del sitio y no se repiten acá:

| Página | Qué aporta a la calidad del proceso |
| --- | --- |
| [Bugs (GitHub Issues)](https://ved-virtualexperiencedevelopment.github.io/bistrolink/bugs.html) | Bugs abiertos y cerrados, por severidad y por semana, y su tiempo de resolución |
| [Reporte E2E (Allure)](https://ved-virtualexperiencedevelopment.github.io/bistrolink/allure/e2e/) | Resultado de los E2E de la última corrida de `develop`, por área y navegador |
| [Avance del proyecto (EDT)](https://ved-virtualexperiencedevelopment.github.io/bistrolink/avance-edt.html) | Avance del MVP contra la Línea de Base y trabajo cerrado por sprint |
| Estado del servicio (desde el [índice](https://ved-virtualexperiencedevelopment.github.io/bistrolink/)) | Disponibilidad y tiempo de respuesta de la API y Keycloak (Grafana) |
