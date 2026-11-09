# Dashboards de avance y de bugs (GitHub Pages)

BL-298, BL-493. Los scripts de esta carpeta generan los dos dashboards publicados en https://ved-virtualexperiencedevelopment.github.io/bistrolink/ y el email de estado del cierre de cada Sprint. Los corre el workflow [`publicar-dashboards.yml`](../../.github/workflows/publicar-dashboards.yml); no se commitea nada.

| Archivo                            | Qué hace                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `backlog-hu.json`                  | Historias del MVP (Anexo 5 v2.3 + solicitudes de cambio) con su issue de Linear, SP, prioridad, nivel y grupo; las que quedan fuera del MVP. |
| `sprint-config.json`               | Calendario y plan de la Línea de Base (Tabla 17, Gantt v2.0): Sprints, hitos y SP planificados.                                               |
| `avance-mvp.mjs`                   | Cálculo del avance desde Linear, compartido por el dashboard y el email.                                                                      |
| `update-dashboard-from-linear.mjs` | Llena los bloques `AUTO` de `docs/dashboard-avance-edt.md`.                                                                                   |
| `update-github-bugs-dashboard.mjs` | Llena los bloques `AUTO` de `docs/dashboard-bugs-github.md` desde GitHub Issues (configuración en `github-bugs-config.json`).                 |
| `publicar-dashboards.mjs`          | Convierte los dos `.md` a HTML con los colores de la app y arma el sitio.                                                                     |
| `send-status-email.mjs`            | Arma el email de estado (avance + bugs); el asunto sale de `email-config.json`.                                                               |
| `*.test.mjs`                       | Tests sin dependencias: `npm run test:dashboards`.                                                                                            |

## Cómo se mide el avance

- **Avance del MVP:** solo las historias de `backlog-hu.json`, con los SP y la prioridad del backlog (no las etiquetas de Linear). Una HU está terminada cuando **todos** los issues de su lista `linear` están Done.
- **Plan:** el de la Línea de Base (`sprint-config.json`). Lo cerrado en un fin de semana cuenta para el Sprint que terminó el viernes; las fechas van en hora de Uruguay.
- **Trabajo técnico:** todo lo demás que se cierra en Linear (pipeline, seguridad, testing, defectos, documentación). Se muestra aparte, por Sprint. Los sub-issues de una HU cuentan como trabajo de la historia.

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
```
