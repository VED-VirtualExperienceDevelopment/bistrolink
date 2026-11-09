# 🚀 Dashboard de Avance del Proyecto

<!-- SOLO-REPO:start -->

> 📌 **La versión al día de este dashboard está publicada en GitHub Pages:** https://ved-virtualexperiencedevelopment.github.io/bistrolink/avance-edt.html (BL-298). Este archivo es la plantilla que usa el workflow «Publicar dashboards»: los bloques `AUTO` de acá no se actualizan en el repositorio.

<!-- SOLO-REPO:end -->

> **Nota de Control:** Las secciones marcadas con `<!-- AUTO -->` se generan desde Linear con `scripts/dashboards/update-dashboard-from-linear.mjs`. El avance del MVP se mide contra el backlog (`scripts/dashboards/backlog-hu.json`: Anexo 5 v2.3 más las solicitudes de cambio) y contra el plan de la Línea de Base (`scripts/dashboards/sprint-config.json`: Tabla 17 y Gantt v2.0). El resto de lo cerrado en Linear se muestra aparte, como trabajo técnico. Al aprobar una solicitud de cambio, se agrega la historia en `backlog-hu.json`.

---

## 📊 Estado general del proyecto

### Resumen ejecutivo

<!-- AUTO:resumen-ejecutivo:start -->
<!-- AUTO:resumen-ejecutivo:end -->

### Avance del MVP por grupo del backlog

<!-- AUTO:avance-por-grupo:start -->
<!-- AUTO:avance-por-grupo:end -->

### Avance del MVP por prioridad (MoSCoW)

<!-- AUTO:avance-por-prioridad:start -->
<!-- AUTO:avance-por-prioridad:end -->

---

## 📈 Avance contra la Línea de Base

### Burn-up del MVP

<!-- AUTO:burnup-mvp:start -->
<!-- AUTO:burnup-mvp:end -->

### Hitos: plan vs. real

<!-- AUTO:hitos-plan-vs-real:start -->
<!-- AUTO:hitos-plan-vs-real:end -->

### Cronograma (Anexo 8 — Gantt v2.0)

```mermaid
gantt
    title BistroLink — Cronograma de la Línea de Base (03/08 – 27/11/2026)
    dateFormat  YYYY-MM-DD
    axisFormat  %d/%m
    todayMarker on

    section Núcleo (S1–S5)
    S1 · Entorno, pipeline, HU-013               :done, s1, 2026-08-03, 2026-08-14
    Hito H1                                      :milestone, h1, 2026-08-14, 0d
    S2 · Menú QR y web, carrito, Railway         :done, s2, 2026-08-17, 2026-08-28
    Hito H2                                      :milestone, h2, 2026-08-28, 0d
    S3 · KDS y seguimiento, Línea de Base        :done, s3, 2026-08-31, 2026-09-11
    Hito H3                                      :milestone, h3, 2026-09-11, 0d
    S4 · Notificaciones, rollback, Playwright    :done, s4, 2026-09-14, 2026-09-25
    Hito H4                                      :milestone, h4, 2026-09-25, 0d
    S5 · Carta, mesas, respaldo S3, prototipo    :done, s5, 2026-09-28, 2026-10-09
    Hito H5 · Capa Núcleo                        :milestone, h5, 2026-10-09, 0d

    section Integración (S6–S8)
    S6 · Configuración, pagos, réplica R2        :done, s6, 2026-10-12, 2026-10-23
    Hito H6                                      :milestone, h6, 2026-10-23, 0d
    S7 · CFE, POS, cancelaciones, portafolio     :done, s7, 2026-10-26, 2026-11-06
    Hito H7                                      :milestone, h7, 2026-11-06, 0d
    S8 · Reportes, E2E, k6, DAST, predefensa     :s8, 2026-11-09, 2026-11-20
    Hito H8 · Capa Integración                   :milestone, h8, 2026-11-20, 0d

    section Cierre
    Estabilización, regresión final e informe    :crit, cierre, 2026-11-23, 2026-11-27
    Entrega final                                :milestone, entrega, 2026-11-27, 0d
```

---

## 📋 Detalle de historias

### Historias del MVP pendientes

<!-- AUTO:historias-pendientes:start -->
<!-- AUTO:historias-pendientes:end -->

### Fuera del MVP

<!-- AUTO:fuera-del-mvp:start -->
<!-- AUTO:fuera-del-mvp:end -->

---

## ⚙️ Trabajo cerrado por Sprint (historias y trabajo técnico)

<!-- AUTO:throughput-por-sprint:start -->
<!-- AUTO:throughput-por-sprint:end -->

---

## 🔎 Control del backlog

<!-- AUTO:control-del-backlog:start -->
<!-- AUTO:control-del-backlog:end -->
