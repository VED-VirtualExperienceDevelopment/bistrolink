# ADR 0004 — Producción como entorno productivo con integraciones en sandbox

| Campo | Valor |
| --- | --- |
| Estado | Aceptada; se aplica con el release v0.5.0 |
| Fecha | 30/09/2026 |
| Referencias | Solicitud de cambio BL-240; BL-220 (release); Anexo 4 §1.2.3; Anexo 9 §10.2 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

La documentación decía que el entorno de producción estaba «definido pero no activado en esta etapa», mientras el plan de release (BL-220) preveía desplegar a producción en Railway. Además, las métricas DORA del Plan de Calidad necesitan deploys reales a un entorno de producción para tener sentido. El proyecto no tiene comensales ni pagos reales, ni dominio propio.

## Decisión

El entorno `production` se activa desde el release v0.5.0 como **entorno productivo con integraciones en sandbox y sin operaciones reales**:

- el mismo proceso que una producción real: PR de release de `develop` a `main`, tag semántico, aprobación manual en el GitHub Environment `production` por un integrante distinto del que creó el tag, health check, smoke test de solo lectura y rollback a la imagen anterior;
- las imágenes de la API y de Keycloak validadas en staging se promueven sin reconstruir; el frontend se compila por entorno, porque sus variables públicas quedan fijas al compilar;
- integraciones de pago y facturación en sus sandboxes, con aplicaciones de prueba propias de producción y webhooks separados de staging;
- sin dominio propio (subdominios del proveedor con TLS gestionado) y sin datos personales reales;
- las métricas DORA se miden sobre los deploys a `production`.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| No activar producción y medir DORA sobre staging | Staging se despliega en cada push: la frecuencia y la tasa de fallas no reflejarían un proceso de release. |
| Producción real con credenciales de pago reales | Fuera del alcance académico: exige operación real, alta disponibilidad, plan de continuidad y política de privacidad con datos reales. |

## Consecuencias

- El proceso de release, el rollback y las métricas DORA se ejercitan de verdad antes de la entrega.
- El paso a operación real queda como una lista acotada: credenciales reales, dominio propio, alta disponibilidad, plan de continuidad del negocio y política de privacidad con datos reales (Anexo 4 §1.2.3).
- Cada recurso de infraestructura existe dos veces (staging y producción), con su configuración propia (por ejemplo, la distribución de CloudFront de las imágenes y el rol restringido de la base).
- La validación funcional sigue haciéndose en staging; en producción solo corre el smoke test de solo lectura.
