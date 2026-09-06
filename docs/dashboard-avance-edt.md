# 🚀 Dashboard de Avance del Proyecto

> **Nota de Control:** Las secciones marcadas con `<!-- AUTO -->` se actualizan automáticamente desde Linear mediante un GitHub Action (`scripts/update-dashboard-from-linear.mjs`). No edites esas tablas a mano — se sobrescriben en la próxima corrida. La distribución de sprints por capa y la línea base de planning se ajustan en `scripts/sprint-config.json`.

---

## 📊 Estado General del Proyecto

### Resumen ejecutivo

<!-- AUTO:resumen-ejecutivo:start -->
| Métrica | Valor |
|---|---|
| Período del proyecto | 03/08/2026 – 10/12/2026 |
| Sprints planificados | 9 Sprints (2 semanas c/u) + ciclo de cierre |
| Historias de Usuario totales (actual) | 135 |
| Story Points totales (actual) | 200 pts |
| **Sprint actual** | **9** |
| **Story Points completados a la fecha** | **39** |
| **% Avance global** | **20%** |

> Última actualización automática: `06/09/2026` — generado desde Linear por GitHub Action.

> ℹ️ El alcance actual (135 HU / 200 pts) difiere de la línea base de planning (26 HU / 202 pts) — se agregaron o quitaron historias después del kickoff.
<!-- AUTO:resumen-ejecutivo:end -->

### Avance por Capa

<!-- AUTO:avance-por-capa:start -->
| Capa | Sprints | HU totales | Story Points | HU completadas | % Avance |
|---|---|---|---|---|---|
| 🟩 Núcleo | 1–5 | 78 | 79 | 46 | 59% |
| 🟦 Integración | 6–8 | 40 | 77 | 0 | 0% |
| 🟪 Valor Agregado (cond.) | 9–9 | 16 | 44 | 0 | 0% |
| **Total** | **1–9** | **134** | **200** | **46** | **34%** |
<!-- AUTO:avance-por-capa:end -->

---

## 📈 Gráficos y Esquemas de Avance

### Cronograma general (Anexo 7 — Diagrama de Gantt)

```mermaid
%%{init: {'theme':'base', 'themeVariables': {
  'primaryColor': '#2b6cb0',
  'primaryTextColor': '#ffffff',
  'primaryBorderColor': '#63b3ed',
  'lineColor': '#a0aec0',
  'secondaryColor': '#805ad5',
  'tertiaryColor': '#1a202c',
  'textColor': '#f0f0f0',
  'taskTextColor': '#ffffff',
  'taskTextOutsideColor': '#f0f0f0',
  'activeTaskBkgColor': '#e05263',
  'activeTaskBorderColor': '#ffffff',
  'doneTaskBkgColor': '#38a169',
  'doneTaskBorderColor': '#ffffff',
  'critBkgColor': '#e53e3e',
  'critBorderColor': '#ffffff',
  'sectionBkgColor': '#2d3748',
  'sectionBkgColor2': '#1a202c',
  'gridColor': '#4a5568',
  'todayLineColor': '#f56565'
}}}%%
gantt
    title BistroLink — Cronograma del Proyecto (03/08 – 10/12/2026)
    dateFormat  YYYY-MM-DD
    axisFormat  %d/%m
    todayMarker on

    section Núcleo (Sprints 1-5)
    Sprint 1 · Setup + Menú QR/web         :s1, 2026-08-03, 2026-08-14
    Hito H1                                :milestone, h1, 2026-08-14, 0d
    Sprint 2 · Auth Keycloak + Pedido      :s2, 2026-08-17, 2026-08-28
    Hito H2                                :milestone, h2, 2026-08-28, 0d
    Sprint 3 · KDS + Seguimiento           :s3, 2026-08-31, 2026-09-11
    Hito H3                                :milestone, h3, 2026-09-11, 0d
    Sprint 4 · Carta + Mapa de mesas       :s4, 2026-09-14, 2026-09-25
    Hito H4                                :milestone, h4, 2026-09-25, 0d
    Sprint 5 · Gestión de sala             :s5, 2026-09-28, 2026-10-09
    Hito H5                                :milestone, h5, 2026-10-09, 0d

    section Integración (Sprints 6-8)
    Sprint 6 · Pagos Plexo/MP/Handy        :s6, 2026-10-12, 2026-10-23
    Hito H6                                :milestone, h6, 2026-10-23, 0d
    Sprint 7 · CFE + POS Add-on            :s7, 2026-10-26, 2026-11-06
    Hito H7                                :milestone, h7, 2026-11-06, 0d
    Sprint 8 · Reportes + pruebas finales  :s8, 2026-11-09, 2026-11-20
    Hito H8                                :milestone, h8, 2026-11-20, 0d

    section Valor Agregado (condicional)
    Sprint 9 · Voz PoC + Stock + Docs      :s9, 2026-11-23, 2026-12-04
    Hito H9                                :milestone, h9, 2026-12-04, 0d

    section Cierre
    Estabilización + defensa               :crit, cierre, 2026-12-07, 2026-12-10
    Entrega final                          :milestone, entrega, 2026-12-10, 0d
```

### Distribución de Story Points por prioridad (MoSCoW)

```mermaid
%%{init: {'theme':'base', 'themeVariables': {
  'pieOuterStrokeWidth': '2px',
  'pieOpacity': 1,
  'pieSectionTextColor': '#ffffff',
  'pieLegendTextColor': '#e6e6e6',
  'pieTitleTextColor': '#ffffff',
  'pieStrokeColor': '#1a202c',
  'pie1': '#e05263',
  'pie2': '#f2a541',
  'pie3': '#4ea8de'
}}}%%
pie title Story Points por Prioridad (202 pts totales)
    "Must (120 pts)" : 120
    "Should (38 pts)" : 38
    "Could (44 pts)" : 44
```

> ℹ️ Este gráfico refleja la distribución MoSCoW de la línea base de planning original. Si el equipo quiere que también se recalcule con Linear (requiere labels `Must` / `Should` / `Could` en los issues), se puede automatizar en una siguiente iteración.

### Story Points planificados vs. completados por Sprint

<!-- AUTO:sp-por-sprint-chart:start -->
%%{init: {'theme':'base', 'themeVariables': {
  'xyChart': {
    'backgroundColor': '#1a202c',
    'titleColor': '#ffffff',
    'xAxisLabelColor': '#e6e6e6',
    'xAxisTitleColor': '#e6e6e6',
    'xAxisTickColor': '#a0aec0',
    'xAxisLineColor': '#a0aec0',
    'yAxisLabelColor': '#e6e6e6',
    'yAxisTitleColor': '#e6e6e6',
    'yAxisTickColor': '#a0aec0',
    'yAxisLineColor': '#a0aec0',
    'plotColorPalette': '#e05263, #4ea8de'
  }
}}}%%
xychart-beta
    title "Story Points planificados vs. completados por Sprint"
    x-axis [Sprint1, Sprint2, Sprint3, Sprint4, Sprint5, Sprint6, Sprint7, Sprint8, "Sprint9(cond)"]
    y-axis "Story Points" 0 --> 50
    bar "Planificado" [18, 24, 5, 16, 13, 37, 37, 8, 44]
    bar "Completado" [5, 13, 21, 0, 0, 0, 0, 0, 0]
<!-- AUTO:sp-por-sprint-chart:end -->