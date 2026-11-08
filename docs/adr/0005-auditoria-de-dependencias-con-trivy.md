# ADR 0005 — Auditoría de dependencias con Trivy y dependency-review en lugar de Snyk

| Campo | Valor |
| --- | --- |
| Estado | Aceptada |
| Fecha | 10/10/2026 |
| Referencias | BL-300 (implementación); solicitud de cambio BL-301; BL-290 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

La auditoría de dependencias del pipeline usaba Snyk en el plan gratuito, y el deploy a staging dependía de ese job. En dos días Snyk cortó el pipeline tres veces por causas externas al código: la CLI falló con un error 404 (08/10), se agotó el cupo mensual de tests (10/10) y además el token era personal y tenía vencimiento. Mientras Snyk fallaba, ningún merge llegaba a staging.

## Decisión

- Un job **Dependencias (Trivy fs)** reemplaza al de Snyk: escanea los `package-lock.json` del repositorio con `severity: CRITICAL,HIGH`, falla el build ante un hallazgo y usa el mismo `.trivyignore` que el escaneo de imágenes.
- **`actions/dependency-review-action`** revisa cada PR y bloquea la incorporación de una dependencia nueva con vulnerabilidades altas.
- Dependabot sigue abriendo las alertas y los PRs de actualización.
- El criterio de seguridad no cambia: sin vulnerabilidades críticas ni altas en las dependencias.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Pasar a un plan pago de Snyk | Costo recurrente para cubrir lo mismo que herramientas gratuitas que ya estaban en el pipeline. |
| Quitar Snyk de las dependencias del deploy y dejarlo informativo | La auditoría seguiría fallando por cupo y dejaría de ser un control efectivo. |

## Consecuencias

- Sin token, sin cupo y sin servicio externo del que dependa el deploy.
- Una sola herramienta (Trivy) y una sola base de vulnerabilidades para dependencias e imágenes.
- Las excepciones se justifican por escrito en `.trivyignore`, con fecha y condición de revisión. Cuando aparece una vulnerabilidad nueva sin versión corregida en una imagen de terceros (por ejemplo, la base de Keycloak), el pipeline se frena hasta registrar la excepción.
- Cambio documentado como solicitud de cambio en los Anexos 4, 5 y 9 y en la Línea de Base.
