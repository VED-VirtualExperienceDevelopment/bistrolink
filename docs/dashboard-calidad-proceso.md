# 📈 Calidad del proceso (métricas DORA)

<!-- SOLO-REPO:start -->

> 📌 **La versión al día de este dashboard está publicada en GitHub Pages:** https://ved-virtualexperiencedevelopment.github.io/bistrolink/calidad-proceso.html (BL-221). Este archivo es la plantilla que usa el workflow «Publicar dashboards»: los bloques `AUTO` de acá no se actualizan en el repositorio.

<!-- SOLO-REPO:end -->

> **Nota de control:** las secciones marcadas con `<!-- AUTO -->` las llena `scripts/dashboards/metricas-dora.mjs` desde GitHub (deployments, PR y corridas del CI). No se editan a mano.

**Por qué se mide sobre producción.** Las métricas DORA miden el proceso de release: con qué frecuencia llega un cambio a producción, cuánto tarda, cuántas veces sale mal y cuánto lleva recuperarse. Staging se despliega con cada push a `develop`, así que ahí solo se muestra como contexto (ADR 0004 y Anexo 9 §10.2).

**Nota metodológica.** El equipo es de 3 personas y producción existe desde el release v0.5.0 (08/11/2026): hay pocos releases hasta la entrega. Los porcentajes y las medianas se leen junto con las cantidades.

---

## 📊 Resumen

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

## 🧭 Contexto: staging y pipeline

<!-- AUTO:dora-contexto:start -->

_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._

<!-- AUTO:dora-contexto:end -->

---

## 📖 Cómo se calcula

| Métrica | Definición | Fuente | Meta (Anexo 9 §10.2) |
| --- | --- | --- | --- |
| Frecuencia de despliegue | Releases exitosos a `production` por sprint. Un release es el deploy de un tag `vX.Y.Z`; los ensayos (`vX.Y.Z-rc.N`) se muestran pero no cuentan. El promedio usa solo los sprints cerrados | Deployments del environment `production` (job «Deploy producción») | ≥ 1 por sprint |
| Lead time de cambios | Por cada PR que entra en un release: desde su primer commit hasta el deploy en producción. Mediana y percentil 85, separando revisión (apertura del PR → merge a `develop`) y release (merge → producción). El primer release no se mide, porque incluye todo el historial del proyecto | Comparación entre el tag anterior y el nuevo, y los PR mergeados a `develop` | Mediana ≤ 1 sprint (14 días) |
| Tasa de fallas en cambios | Releases que necesitaron un rollback de producción o un hotfix (el release siguiente es un parche, `vX.Y.Z` con Z > 0), sobre el total de releases | Deployments del job «Rollback manual» y tags de parche | < 15 % |
| Tiempo de recuperación | Desde el deploy del release fallido hasta el rollback o el hotfix exitoso | Deployments | < 1 día hábil (24 h) |

- **Un deploy fallido** (por ejemplo, porque falló el *pre-deploy* de migraciones) no es una falla en producción: Railway deja la versión anterior. Se muestra en la tabla de releases, pero no cuenta en la tasa de fallas.
- **Incidentes:** los issues con la etiqueta `incidente` se cuentan como contexto. Si un incidente de producción termina en un rollback o un hotfix, ya queda medido por esa vía.
- **Duración del pipeline:** desde que empieza la corrida del CI en `develop` hasta que termina «Deploy staging». No incluye los E2E ni el reporte, que corren después del deploy.

Runbook del release, hotfix y rollback: [`docs/RELEASE.md`](RELEASE.md).
