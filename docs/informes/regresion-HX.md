# Informe de regresión — HX (capa …)

> **Plantilla.** Copiar a `regresion-H8.md` o `regresion-cierre.md` y completar. Procedimiento en [`README.md`](README.md). Lo que está entre `<…>` se reemplaza.

## Control de versiones

| Versión | Fecha | Autores | Cambio | Aprobación |
| ------- | ----- | ------- | ------ | ---------- |
| 1.0 | <dd/mm/aaaa> | <integrantes> | Informe de la regresión de HX. | Pendiente (Product Owner) |

## 1. Datos de la regresión

| Dato | Valor |
| --- | --- |
| Hito y capa | <H8 — Capa Integración / Cierre> |
| Fecha de la regresión | <dd/mm/aaaa> |
| Versión probada | <SHA de `develop` o tag `vX.Y.Z`> |
| Corrida del CI | <link a la corrida> |
| Test Runs en Kiwi (marcados `[REGRESION-HX]`) | <TR-NNN, TR-NNN…> |
| Responsables | <QA Engineer del sprint y quien revisa> |

## 2. Números (foto del día)

Copiados del dashboard [Calidad del proceso](https://ved-virtualexperiencedevelopment.github.io/bistrolink/calidad-proceso.html) y del de [Bugs](https://ved-virtualexperiencedevelopment.github.io/bistrolink/bugs.html), publicados el <dd/mm/aaaa hh:mm>.

### 2.1 Pruebas por suite

| Suite | Casos | Ejecutados | Aprobados | Fallidos | Aprobación | Nunca ejecutados |
| --- | --- | --- | --- | --- | --- | --- |
| Unitarias (Jest) | — | <n> | <n> | <n> | <%> | — |
| Integración (TC-I) | <n> | <n> | <n> | <n> | <%> | <n> |
| Contrato (TC-C) | <n> | <n> | <n> | <n> | <%> | <n> |
| E2E (TC-E, 4 navegadores) | <n> | <n> | <n> | <n> | <%> | <n> |
| Performance (TC-P) | <n> | <n> | <n> | <n> | <%> | <n> |
| Manuales (plan de la capa) | <n> | <n> | <n> | <n> | <%> | <n> |

### 2.2 Cobertura, seguridad y entrega

| Métrica | Valor | Meta | Cumple |
| --- | --- | --- | --- |
| Cobertura del backend (Codecov) | <%> | ≥ 80 % | <✅/❌> |
| Hallazgos críticos o altos (CodeQL, SonarCloud, Trivy, ZAP) | <n> | 0 | <✅/❌> |
| Frecuencia de despliegue a producción | <n por sprint> | ≥ 1 por sprint | <✅/❌> |
| Lead time de cambios (producción) | <mediana> | ≤ 1 sprint | <✅/❌> |
| Tasa de fallas en cambios (producción) | <% (n de m)> | < 15 % | <✅/❌> |
| Tiempo de recuperación (producción) | <mediana o «sin fallas»> | < 1 día hábil | <✅/❌> |
| Deploys a staging | <n por semana> | ≥ 3 por semana | <✅/❌> |
| Lighthouse del menú (mobile) | <puntaje> | ≥ 80 | <✅/❌> |

### 2.3 Defectos

| Severidad | Abiertos | Cerrados en la capa | Regresiones (`regresion`) |
| --- | --- | --- | --- |
| Crítica | <n> | <n> | <n> |
| Alta | <n> | <n> | <n> |
| Media | <n> | <n> | <n> |
| Baja | <n> | <n> | <n> |

## 3. Análisis

<Qué muestran los números: suites con fallos y su causa (por título de caso e issue), casos nunca ejecutados y por qué, tendencia respecto de la capa anterior, métricas fuera de meta.>

## 4. Objetivos de calidad (Línea de Base, Tabla 23)

| Característica | Objetivo | Resultado | Cumple |
| --- | --- | --- | --- |
| Adecuación funcional | 100 % de los criterios de aceptación verificados | <…> | <✅/❌> |
| Fiabilidad | 0 defectos críticos abiertos; 0 cobros o pedidos duplicados | <…> | <✅/❌> |
| Seguridad | 0 vulnerabilidades críticas o altas; aislamiento en verde | <…> | <✅/❌> |
| Eficiencia de desempeño | Menú < 3 s; KDS < 500 ms; dashboard < 2 s | <…> | <✅/❌> |
| Usabilidad y accesibilidad | WCAG 2.1 AA sin violaciones critical/serious; Lighthouse ≥ 80 | <…> | <✅/❌> |
| Mantenibilidad | Cobertura ≥ 80 %; quality gate de SonarCloud aprobado | <…> | <✅/❌> |

## 5. No conformidades y acciones

| # | No conformidad | Causa | Acción correctiva | Responsable | Ticket |
| --- | --- | --- | --- | --- | --- |
| 1 | <…> | <…> | <…> | <…> | <BL-NNN> |

## 6. Decisiones

- <Se libera / no se libera la capa; riesgos aceptados por escrito y por quién; pendientes que pasan al próximo sprint.>
