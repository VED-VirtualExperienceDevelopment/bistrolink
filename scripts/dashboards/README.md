# Dashboards de avance, bugs y calidad del proceso (GitHub Pages)

BL-298, BL-493, BL-221. Los scripts de esta carpeta generan los tres dashboards publicados en https://ved-virtualexperiencedevelopment.github.io/bistrolink/ y el email de estado del cierre de cada Sprint. Los corre el workflow [`publicar-dashboards.yml`](../../.github/workflows/publicar-dashboards.yml); no se commitea nada.

| Archivo                            | Qué hace                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `backlog-hu.json`                  | Historias del MVP (Anexo 5 v2.3 + solicitudes de cambio) con su issue de Linear, SP, prioridad, nivel y grupo; las que quedan fuera del MVP. |
| `sprint-config.json`               | Calendario y plan de la Línea de Base (Tabla 17, Gantt v2.0): Sprints, hitos y SP planificados.                                               |
| `avance-mvp.mjs`                   | Cálculo del avance desde Linear, compartido por el dashboard y el email.                                                                      |
| `update-dashboard-from-linear.mjs` | Llena los bloques `AUTO` de `docs/dashboard-avance-edt.md`.                                                                                   |
| `update-github-bugs-dashboard.mjs` | Llena los bloques `AUTO` de `docs/dashboard-bugs-github.md` desde GitHub Issues (configuración en `github-bugs-config.json`).                 |
| `metricas-dora.mjs`                | Llena los bloques `AUTO` de `docs/dashboard-calidad-proceso.md` con las métricas DORA de producción (deployments, PR y corridas del CI).        |
| `publicar-dashboards.mjs`          | Convierte los tres `.md` a HTML con los colores de la app y arma el sitio.                                                                     |
| `send-status-email.mjs`            | Arma el email de estado (avance + bugs); el asunto sale de `email-config.json`.                                                               |
| `*.test.mjs`                       | Tests sin dependencias: `npm run test:dashboards`.                                                                                            |

## Cómo se mide el avance

- **Avance del MVP:** solo las historias de `backlog-hu.json`, con los SP y la prioridad del backlog (no las etiquetas de Linear). Una HU está terminada cuando **todos** los issues de su lista `linear` están Done.
- **Plan:** el de la Línea de Base (`sprint-config.json`). Lo cerrado en un fin de semana cuenta para el Sprint que terminó el viernes; las fechas van en hora de Uruguay.
- **Trabajo técnico:** todo lo demás que se cierra en Linear (pipeline, seguridad, testing, defectos, documentación). Se muestra aparte, por Sprint. Los sub-issues de una HU cuentan como trabajo de la historia.

## Cómo se miden las métricas DORA

Se muestran dos vistas de las mismas cuatro métricas: **producción**, la medición oficial (Anexo 9 §10.2, ADR 0004), y **staging**, la integración continua, con las metas de la Línea de Base (Tabla 24). No se suman. Las definiciones están al final de `docs/dashboard-calidad-proceso.md`:

- **Release:** deploy exitoso del job «Deploy producción» con un tag `vX.Y.Z`. Los ensayos (`-rc.N`) no cuentan.
- **Falla:** el release necesitó un rollback de producción (job «Rollback manual») o un hotfix (el release siguiente es un parche).
- **Lead time:** por PR mergeado a `develop` que entró en el release, desde su primer commit hasta el deploy. El primer release (v0.5.0) es la línea base y no se mide.
- **Staging:** los jobs «Deploy staging» de las últimas 4 semanas. El lead time va desde que se abre el PR hasta que su merge queda desplegado; la recuperación, desde un deploy fallido hasta el siguiente exitoso.
- El workflow no se dispara con un deploy a producción: después de un release o un rollback, correr **Publicar dashboards** a mano (`docs/RELEASE.md`).

## Cuándo hay que tocar `backlog-hu.json`

- **Se aprueba una solicitud de cambio con una historia nueva:** agregarla en `historias` con `"grupo": "cambio"` y `origen`, y sumarla en `alcance.solicitudesDeCambio`.
- **Una historia sale del MVP:** pasarla de `historias` a `fueraDelMvp` con su `motivo`, y ajustar `alcance`.
- **Una historia se reparte en otro issue que no es sub-issue:** sumar ese issue a su lista `linear`.
- **Un issue tiene «HU» en el título y no es una historia del backlog:** agregarlo en `reclasificados`.

Si algo no coincide, la sección «Control del backlog» del dashboard lo avisa, y la corrida del workflow lo muestra como advertencia.

## Probar en tu PC

```powershell
npm run test:dashboards

$env:LINEAR_API_KEY="tu-api-key"; $env:LINEAR_TEAM_KEY="BL"
node scripts/dashboards/update-dashboard-from-linear.mjs
git restore docs/dashboard-avance-edt.md   # el script llena la plantilla: no se commitea

$env:GITHUB_TOKEN="tu-token"; $env:GITHUB_REPOSITORY="VED-VirtualExperienceDevelopment/bistrolink"
node scripts/dashboards/metricas-dora.mjs
git restore docs/dashboard-calidad-proceso.md
```
