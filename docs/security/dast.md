# Seguridad: análisis dinámico (DAST) con OWASP ZAP

BL-218 · Línea de Base §3.4.4 · Anexo 4 §1.8.7 · Anexo 11 «Seguridad dinámica».

El análisis estático (CodeQL, SonarCloud, Gitleaks, Trivy) revisa el código y las dependencias. El DAST ataca la aplicación ya desplegada en staging, como lo haría alguien de afuera: mira los encabezados, las cookies y los mensajes de error, y en el modo completo prueba inyección, XSS y otros ataques sobre la API.

## Alcance

| Dentro | Fuera |
|---|---|
| Web, API y Keycloak de **staging** | Producción |
| Endpoints REST de la API (contrato OpenAPI en `/api/docs-json`) | Pasarelas de pago y proveedores de CFE (sandboxes de terceros) |
| Pantallas públicas de la web y login de Keycloak | La plataforma Railway |
| Tenant de testing B, con su Admin | Pruebas de carga o de denegación de servicio |

La revisión de autorización (IDOR, saltar el RLS, acceso entre tenants) no la cubre ZAP: va en la revisión guiada por OWASP ASVS nivel 1, junto con los tests de aislamiento entre tenants que ya corren en el pipeline.

## Cómo corre

El workflow es [`.github/workflows/dast.yml`](../../.github/workflows/dast.yml). No bloquea el deploy: corre aparte, después.

| Modo | Cuándo | Qué hace |
|---|---|---|
| **baseline** | Solo, después de cada deploy a staging (push a `develop` con el CI en verde). También a mano. | Escaneo **pasivo** de la web (spider de 3 minutos), de la API (importa el contrato OpenAPI sin atacar) y de la pantalla de login de Keycloak. |
| **completo** | Solo a mano. Al menos una vez antes de H8 (20/11). | Escaneo **activo** de la API con su contrato OpenAPI, autenticado con el Admin del tenant de testing B. |

**Para correrlo a mano:** Actions → «DAST (OWASP ZAP)» → Run workflow → rama `develop` → elegir el modo.

**Antes y después del modo completo:**
- No correrlo mientras corren los E2E de staging.
- El escaneo activo manda datos de ataque a los endpoints y puede crear o cambiar registros del tenant B. Al terminar, correr «Limpieza de staging» con `dry_run` sin tildar y `antiguedad_horas` en 0.
- El token del Admin dura 15 minutos (configuración del realm), por eso el escaneo activo se corta a los 13.

La versión de ZAP está fija en el workflow (`ZAP_IMAGEN`). Una versión nueva puede traer reglas nuevas y cambiar el resultado sin que cambie el código: se actualiza a mano y se compara contra la corrida anterior.

## Criterio de salida

| Riesgo de ZAP | Qué pasa | Qué hacer |
|---|---|---|
| **Alto** | El job falla. | Corregir antes del cierre del Sprint 8. Se registra como defecto en GitHub Issues y bloquea el release (Anexo 11 §9.5). |
| **Medio** | El job pasa, pero la alerta aparece en el resumen con un aviso. | Registrar un issue con la etiqueta `bug`, la severidad y el plazo del Anexo 11 §9.5. |
| Bajo e informativo | Solo en el informe. | Revisar en el informe de la corrida; se registran si corresponde. |

Cada corrida deja en el resumen del job la tabla de alertas por riesgo, y sube los informes (HTML, JSON y Markdown) como artifact: `dast-baseline-<objetivo>` (30 días) o `dast-completo-api` (90 días).

## Falsos positivos y riesgos aceptados

Las alertas revisadas y descartadas van en [`scripts/dast/reglas-zap.tsv`](../../scripts/dast/reglas-zap.tsv):

```text
<id>	IGNORE	<motivo: qué se revisó y dónde quedó la evidencia>
```

- El separador es un **TAB**, no espacios.
- El motivo es obligatorio. Lo controla el test `npm run test:dast`.
- Ignorar una alerta de riesgo alto necesita la aprobación del Security Engineer y la evidencia en el issue.

## Archivos

| Archivo | Qué hace |
|---|---|
| `.github/workflows/dast.yml` | Los dos modos del escaneo. |
| `scripts/dast/resumen-zap.mjs` | Lee el informe JSON de ZAP, arma el resumen del job y decide si pasa (sin riesgo alto). |
| `scripts/dast/resumen-zap.test.mjs` | Tests del resumen: `npm run test:dast`. |
| `scripts/dast/reglas-zap.tsv` | Alertas revisadas e ignoradas, con su motivo. |
