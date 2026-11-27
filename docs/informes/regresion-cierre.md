# Informe de regresión — Cierre del proyecto

## Control de versiones

| Versión | Fecha | Autores | Cambio | Aprobación |
| ------- | ----- | ------- | ------ | ---------- |
| 1.0 | 26/11/2026 | V. Couto, E. Arenas, D. Silvera | Informe de la regresión de cierre: pruebas manuales y automatizadas, ensayo del rollback, release `v0.6.1` y métricas del proceso al cierre. | Pendiente (Product Owner) |
| 1.1 | 26/11/2026 | V. Couto, E. Arenas, D. Silvera | Sección 3.3: RTO y RPO de la activación de la contingencia en Render del 22/11/2026 (BL-217). | Pendiente (Product Owner) |

## 1. Datos de la regresión

| Dato | Valor |
| --- | --- |
| Hito y capa | Cierre — Capas Núcleo e Integración (entrega final 27/11/2026) |
| Fecha de la regresión | 23/11/2026 al 26/11/2026 |
| Versión probada | Staging en `abfe63f` (`develop`). El código de las apps es el mismo que el release `v0.6.1` (`78ba44b`), en producción desde el 26/11/2026 |
| Corrida del CI | [Corrida completa del 26/11/2026](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/runs/45816803443) (E2E y Lighthouse con reporte a Kiwi) y la corrida #1700 del tag `v0.6.1` (unitarias, contrato e integración) |
| Test Runs en Kiwi (marcados `[CIERRE]`) | **Manuales:** TR-1297 (TP-8 Capa Núcleo, 23 al 26/11) · TR-1305 (TP-10 Capa Integración, 23 al 25/11). **Automatizados:** TR-1333 (TP-6 E2E-Playwright, `abfe63f`) · TR-1345 (TP-1 Integration tests, `v0.6.1`) · TR-1344 (TP-9 Contract-PactJS, `v0.6.1`) · TR-1300 (TP-7 Performance-k6-Lighthouse, `9398d8b`, 23/11) |
| Responsables | Equipo |

## 2. Números (foto del día)

Copiados del dashboard [Calidad del proceso](https://ved-virtualexperiencedevelopment.github.io/bistrolink/calidad-proceso.html) y del de [Bugs](https://ved-virtualexperiencedevelopment.github.io/bistrolink/bugs.html), publicados el 26/11/2026 a las 17:59.

### 2.1 Pruebas por suite

| Suite | Casos | Ejecutados | Aprobados | Fallidos | Aprobación | Nunca ejecutados |
| --- | --- | --- | --- | --- | --- | --- |
| Unitarias (Jest) · backend 2.940 y frontend 1.263 | — | 4.203 | 4.203 | 0 | 100 % | — |
| Integración (TC-I) · TR-1345 | 253 | 253 | 253 | 0 | 100 % | 0 |
| Contrato (TC-C) · TR-1344 | 27 | 27 | 27 | 0 | 100 % | 0 |
| E2E (TC-E, 5 proyectos) · TR-1333 | 131 | 131 | 131 | 0 | 100 % | 0 |
| Performance (TC-P) · TR-1300 | 4 | 4 | 4 | 0 | 100 % | 0 |
| Manuales · TP-8 Capa Núcleo (TR-1297) | 119 | 119 | 110 | 3 (y 6 bloqueados) | 92 % | 0 |
| Manuales · TP-10 Capa Integración (TR-1305) | 182 | 148 | 148 | 0 | 100 % | 34 (24 en pausa y 10 *waived*) |

### 2.2 Cobertura, seguridad y entrega

| Métrica | Valor | Meta | Cumple |
| --- | --- | --- | --- |
| Cobertura del backend (Codecov) | 99,9 % (frontend 37,3 %; total 62,5 %) | ≥ 80 % en el backend | ✅ |
| Hallazgos críticos o altos (CodeQL, SonarCloud, Trivy, ZAP) | **0 abiertos.** Trivy y Gitleaks: 0 (sus jobs pasaron en la corrida del release `v0.6.1`, y un hallazgo crítico o alto los hace fallar). Dependabot: 0 alertas abiertas (137 cerradas). CodeQL (Code scanning): 0 alertas abiertas. SonarCloud: quality gate aprobado. ZAP (verificación del 21/11/2026 sobre staging, `docs/security/dast-informe.md`): 0 altos abiertos; la única alerta alta es un falso positivo de inyección SQL revisado contra el código, y los medios y bajos que quedan son encabezados HTTP y CSP registrados como riesgos aceptados. | 0 | ✅ |
| Frecuencia de despliegue a producción | 3 releases · 0,5 por sprint cerrado | ≥ 1 por sprint | ❌ |
| Lead time de cambios (producción) | Mediana 8,4 días · p85 14,5 días (104 PR) | ≤ 1 sprint (14 días) | ✅ |
| Tasa de fallas en cambios (producción) | 33 % (1 de 3) | < 15 % | ❌ |
| Tiempo de recuperación (producción) | Mediana 2,4 días | < 1 día hábil | ❌ |
| Deploys a staging | 11,5 por semana (46 deploys exitosos en 4 semanas, 0 fallidos) | ≥ 3 por semana | ✅ |
| Lighthouse del menú (mobile) | Performance 89 (corrida representativa; las otras dos, 93) · [job](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/runs/45816803443/job/139901762166) (el umbral de 0,8 corta el job) | ≥ 80 | ✅ |

### 2.3 Defectos

| Severidad | Abiertos | Cerrados en la capa | Regresiones (`regresion`) |
| --- | --- | --- | --- |
| Crítica | 0 | — | 0 |
| Alta | 0 | — | 0 |
| Media | 2 | — | 0 |
| Baja | 3 | — | 0 |
| **Total** | **5** | **60** | **0** |

Los abiertos, por severidad, salen de los issues de GitHub con la etiqueta `bug` (26/11/2026): dos medios en el alta de establecimientos (#574 y #575) y tres bajos de interfaz (#400, #500 y #506). El dashboard de Bugs no separa los cerrados por severidad. En total hay 65 registrados: 60 cerrados (92 %) y 5 abiertos, con un tiempo de resolución de 2,5 días en promedio y 0,1 días de mediana. La semana del 9/11, la de más carga del cierre de la Capa Integración, se abrieron y se cerraron 16.

## 3. Análisis

### 3.1 Pruebas manuales

La regresión manual de la Capa Núcleo (TP-8, TR-1297) se ejecutó del 23 al 26/11/2026 en staging: de 119 casos, 110 aprobados, **3 fallidos** y **6 bloqueados**. En el dashboard figura con 92 % de aprobación, porque cuenta los bloqueados como ejecutados. Ninguno impide la entrega: quedan como defectos conocidos y pruebas pendientes para después del 27/11.

La regresión manual de la Capa Integración (TP-10, TR-1305) se ejecutó del 23 al 25/11/2026: de 182 casos, 148 aprobados, 10 *waived* y **ningún fallo**. Quedaron **24 casos en pausa**, que pasan a la próxima regresión.

La Capa Valor Agregado queda fuera de la regresión manual de esta entrega. Su plan de pruebas manuales existe (TP-11, 17 casos), con la ejecución prevista para después del 27/11. Las historias que entraron a la entrega por la solicitud de cambio BL-550 (HU-043 a HU-046, HU-050, HU-051, BL-378 y HU-010) están cubiertas por las pruebas automatizadas de la sección 3.2.

### 3.2 Pruebas automatizadas

Todas las suites automatizadas quedaron **sin fallos**:

- **Unitarias** (Jest, no van a Kiwi): 4.203 de 4.203 (backend 2.940 y frontend 1.263), sin pruebas salteadas, según el resumen de la corrida #1700 de *CI/CD BistroLink* (tag `v0.6.1`, el código que está en producción).
- **E2E** (TR-1333): 131 de 131 aprobados, sobre `abfe63f`, el mismo código de las apps que `v0.6.1`. Incluyen el control de accesibilidad con axe-core (WCAG 2.1 A y AA): un caso falla si aparece una violación *critical* o *serious*.
- **Integración** (TR-1345): 253 de 253, en la corrida del tag `v0.6.1`.
- **Contrato** (TR-1344): 27 de 27, en la corrida del tag `v0.6.1`.
- **Performance** (TR-1300): 4 de 4, del 23/11/2026 sobre `9398d8b`.
- **Pipeline:** mediana de 5,3 minutos hasta staging en 46 corridas (meta < 10 min). En staging, el lead time de cambios tiene mediana de 0,5 h (meta < 48 h).
- **Lighthouse** (celular, menú por el link web del local, staging en `abfe63f`, 26/11/2026): tres corridas con performance 93, 93 y 89 (representativa), accesibilidad 100, buenas prácticas 79 y SEO 100. Buenas prácticas no tiene meta en la Línea de Base; queda como oportunidad de mejora.

### 3.3 Ensayo del rollback (26/11/2026)

Antes del release `v0.6.1` se ensayó el rollback manual en staging, que usa la misma acción de reversión (`revertir-railway`) que el rollback automático de producción (BL-622).

| Corrida | Qué se probó | Resultado |
| --- | --- | --- |
| [45816803443](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/runs/45816803443) | Rollback de `eb4a923` a `8a1cb67` | Reversión, health check y versión confirmados. **Hallazgo:** el deploy de la misma corrida volvió a desplegar `develop` y deshizo el rollback (BL-626) |
| [45823710027](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/runs/45823710027) | Ida a `8a1cb67`, con la corrección de BL-626 | Deploy de staging salteado; al terminar la corrida, staging siguió en `8a1cb67` |
| [45825265950](https://github.com/VED-VirtualExperienceDevelopment/bistrolink/actions/runs/45825265950) | Vuelta a `abfe63f` | Versión confirmada |

Producción no se tocó durante el ensayo: siguió en `v0.6.0` y el deploy de producción quedó salteado en las tres corridas. La decisión automática del rollback y el aviso por mail solo se ejercitan en producción.

**Contingencia en Render (BL-217).** La activación completa de producción en Render se midió el 22/11/2026, con el respaldo de S3 de ese día (SHA-256 verificado en las dos bases): **RTO de 55 min** (objetivo ≤ 4 h) y **RPO de 13 h 43 min** (objetivo ≤ 24 h). Se restauraron las dos bases con RLS forzado y el rol de la API sin bypass; Keycloak, la API y la Web levantaron, y el login de punta a punta funcionó en Render sin depender de Railway. Es una cota superior: incluye resolver los problemas de la primera activación. El detalle por paso está en BL-217.

### 3.4 Release `v0.6.1`

Se liberó el 26/11/2026 con el procedimiento de `docs/RELEASE.md`: respaldo de las dos bases de producción con `resultado=ok`, tag sobre el merge en `main`, aprobación del deploy por otra integrante, smoke test, GitHub Release y PR automático de la contingencia en Render (`render.yaml` en `v0.6.1`). Sin migraciones nuevas. `/health/version` de producción: `v0.6.1`, `upToDate: true`.

### 3.5 Métricas DORA al cierre

- **Tasa de fallas (1 de 3):** `v0.6.0` llegó a producción con un defecto de permisos: al bajar el rol de un usuario, Keycloak le dejaba el anterior (BL-615). Se corrigió con su prueba de integración (TC-I-249) y se desplegó en `v0.6.1`, que el cálculo toma como hotfix.
- **Tiempo de recuperación (2,4 días):** se mide desde el deploy de `v0.6.0` y no desde que se detectó el defecto, así que incluye el tiempo en que nadie lo había visto todavía.
- **Lead time:** bajó de 8,6 días (`v0.6.0`, 95 PR) a 2,1 días (`v0.6.1`, 9 PR). La revisión de los PR es rápida en los dos (mediana de 0,4 h y 0,2 h): casi todo el tiempo es la espera entre el merge a `develop` y el release (8,5 días en `v0.6.0`, 43,5 h en `v0.6.1`).
- **Frecuencia (0,5 por sprint):** los releases se concentraron en los hitos de capa (`v0.5.0` el 08/11, `v0.6.0` el 24/11).
- Con 3 releases, una sola falla mueve la tasa al 33 %: la muestra es chica, y los números se leen como tendencia, no como cumplimiento.
- El ensayo de rollback del 08/11/2026 y el candidato `v0.5.0-rc.1` no cuentan como fallas: están registrados como ensayos (`scripts/dashboards/dora-ensayos-rollback.json`).

## 4. Objetivos de calidad (Línea de Base, Tabla 23)

| Característica | Objetivo | Resultado | Cumple |
| --- | --- | --- | --- |
| Adecuación funcional | 100 % de los criterios de aceptación verificados | TP-8: 110 de 119 aprobados, 3 fallidos y 6 bloqueados. TP-10: 148 de 182 aprobados, 10 *waived* y 24 en pausa. Automatizadas: 415 de 415 (E2E, integración y contrato). | Parcial: sin fallos en lo automatizado; quedan defectos conocidos y casos pendientes en lo manual (sección 6) |
| Fiabilidad | 0 defectos críticos abiertos; 0 cobros o pedidos duplicados | 0 regresiones; incidentes: 0 abiertos y 2 cerrados; producción sin rollbacks reales (2 ensayos); staging con 0 deploys fallidos en 4 semanas. **0 defectos críticos o altos abiertos** (5 bugs abiertos: 2 medios y 3 bajos) | ✅ |
| Seguridad | 0 vulnerabilidades críticas o altas; aislamiento en verde | BL-615 (permisos) corregido en `v0.6.1`. Trivy y Gitleaks sin hallazgos críticos ni altos en el release; DAST sin altos abiertos (21/11/2026); quality gate de SonarCloud aprobado. Dependabot y CodeQL sin alertas abiertas. | ✅ |
| Eficiencia de desempeño | Menú < 3 s; KDS < 500 ms; dashboard < 2 s | Pruebas de performance (TP-7, TR-1300): 4 de 4 aprobadas. Menú en celular: Lighthouse 89. Sin medición nueva al cierre de los tiempos del KDS y del dashboard | ✅ en lo medido |
| Usabilidad y accesibilidad | WCAG 2.1 AA sin violaciones critical/serious; Lighthouse ≥ 80 | axe-core (WCAG 2.1 A y AA, violaciones *critical* y *serious*) en 33 archivos de E2E de los cuatro roles: sin violaciones en TR-1333 (131 de 131). Navegación por teclado y lector de pantalla, fuera del alcance de axe-core (Anexo 11, sección 9.10): checklist manual pendiente para después de la entrega (BL-609). Lighthouse en celular sobre el menú: performance 89 y **accesibilidad 100** en las tres corridas | ✅ en lo automatizado; checklist manual pendiente |
| Mantenibilidad | Cobertura ≥ 80 %; quality gate de SonarCloud aprobado | Cobertura del backend, donde está la lógica de negocio: 99,9 %. El frontend (37,3 %) se sigue como evolución: sus pruebas unitarias empezaron con BL-160 y sus pantallas las cubren los E2E. Quality gate de SonarCloud: **Passed** (todas las condiciones), en el análisis del 26/11/2026 sobre unas 61 mil líneas de código | ✅ |

## 5. No conformidades y acciones

| # | No conformidad | Causa | Acción correctiva | Responsable | Ticket |
| --- | --- | --- | --- | --- | --- |
| 1 | `v0.6.0` llegó a producción con un defecto de permisos al cambiar el rol de un usuario | El cambio de rol agregaba el rol nuevo en Keycloak sin quitar el anterior, y ninguna prueba lo cubría | Corrección con prueba de integración (TC-I-249) y release `v0.6.1` | Equipo | BL-615 |
| 2 | El rollback manual de staging se deshacía con el deploy de la misma corrida | El deploy a staging se disparaba con cualquier *Run workflow* en `develop`, incluido el de rollback | Condición nueva en `deploy-staging`, verificada con el mismo ensayo (sección 3.3) | Equipo | BL-626 |
| 3 | Back-merge de `main` a `develop` pendiente después de `v0.5.0` y `v0.6.0` | El paso de `RELEASE.md` no se hizo al terminar esos releases | Back-merge en el PR #584 antes de `v0.6.1`; se hace al cerrar cada release | Equipo | — |
| 4 | Frecuencia de despliegue y tasa de fallas fuera de meta | Releases concentrados en los hitos de capa; muestra de 3 releases | Releases más chicos y más seguidos después de la entrega | Equipo | — |
| 5 | 3 casos fallidos y 6 bloqueados en la Capa Núcleo (TR-1297) y 24 casos en pausa en la Capa Integración (TR-1305) | Defectos conocidos y casos que no se completaron en la ventana de cierre | Pasan al backlog y a la próxima regresión; no impiden la entrega | Equipo | — |

## 6. Decisiones

- **Release `v0.6.1` liberado** el 26/11/2026 con el procedimiento completo, el rollback ensayado y la contingencia en Render actualizada.
- **Se entrega con defectos conocidos**, como corresponde a un producto en evolución: los 3 fallidos y 6 bloqueados de la Capa Núcleo y los 24 casos en pausa de la Capa Integración no afectan el recorrido crítico (menú → pedido → pago → cocina), cubierto por las pruebas automatizadas sin fallos. Riesgo aceptado por el equipo.
- **Pendientes para después de la entrega:** los defectos y casos anteriores, el checklist manual de accesibilidad de teclado y lector de pantalla, que complementa a axe-core (BL-609) y la regresión manual de la Capa Valor Agregado (TP-11), con su ticket en Linear.
