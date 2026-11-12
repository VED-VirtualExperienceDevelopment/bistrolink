# Informe del DAST con OWASP ZAP sobre staging

Resultados de las corridas del análisis dinámico (DAST), decisiones sobre cada hallazgo y riesgos aceptados. Cómo se corre el escaneo y qué se publica: [`dast.md`](dast.md).

## Control de versiones

| Versión | Fecha      | Autor          | Cambios                                                                                                      |
| ------- | ---------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| 1.0     | 12/11/2026 | Daiana Silvera | Primer informe: baseline de web, API y Keycloak, escaneo completo autenticado de la API y riesgos aceptados. |

## Resumen

- **Ninguna corrida encontró hallazgos de riesgo alto.** Se cumple el criterio de salida del DAST.
- Los hallazgos de riesgo medio y bajo son encabezados HTTP y la política de contenido (CSP). Se ven desde afuera sin atacar y ninguno es explotable por sí solo.
- Se corrigen en el código los que tienen solución. Los demás quedan como [riesgos aceptados](#riesgos-aceptados), con su mitigación.
- El escaneo activo de la API no reportó inyección, XSS, recorrido de rutas ni acceso a metadatos de la nube, y la API no respondió ningún error 5xx.

## Alcance y configuración

| Dato              | Valor                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Entorno           | Staging (web, API y Keycloak). Producción queda fuera.                                              |
| Herramienta       | OWASP ZAP 2.17.0 (imagen fija en el workflow)                                                       |
| Baseline (pasivo) | Web con spider de 3 minutos, API con su contrato OpenAPI sin atacar y pantalla de login de Keycloak |
| Completo (activo) | API con su contrato OpenAPI, autenticado con el Admin del tenant de testing B, hasta 13 minutos     |
| Reglas            | [`scripts/dast/reglas-zap.tsv`](../../scripts/dast/reglas-zap.tsv)                                  |

## Resultados del baseline (pasivo)

Primera corrida sobre staging, antes de las correcciones. Riesgo alto: ninguno en los tres objetivos.

### Web

| Alerta de ZAP                                                         | Riesgo | Decisión                                              |
| --------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| CSP sin `frame-ancestors`                                             | Medio  | Corregida (#493)                                      |
| CSP con `'unsafe-eval'` en producción                                 | Medio  | Corregida: solo en desarrollo (#493)                  |
| CSP con el comodín `https:` en `img-src`, `connect-src` y `frame-src` | Medio  | Corregida: orígenes concretos de cada entorno (#495)  |
| Hoja de estilos de terceros sin integridad (SRI)                      | Medio  | Corregida: íconos servidos desde la propia app (#496) |
| CSP con `'unsafe-inline'` en `script-src` y `style-src`               | Medio  | [Riesgo aceptado](#riesgos-aceptados)                 |
| Encabezado `X-Powered-By`                                             | Bajo   | Corregida (#493)                                      |
| Faltan `Cross-Origin-Resource-Policy` y `Cross-Origin-Opener-Policy`  | Bajo   | Corregida (#493)                                      |
| Falta `Cross-Origin-Embedder-Policy`                                  | Bajo   | [Riesgo aceptado](#riesgos-aceptados)                 |

### API

| Alerta de ZAP                                                        | Riesgo | Decisión                                                            |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| CSP con comodín y `style-src 'unsafe-inline'` (CSP para páginas web) | Medio  | Corregida: CSP propia para JSON y otra para la documentación (#498) |
| `GET /` responde texto en lugar de JSON                              | Bajo   | Corregida (#498)                                                    |
| Falta `Permissions-Policy`                                           | Bajo   | Corregida (#498)                                                    |
| Falta `Cross-Origin-Embedder-Policy`                                 | Bajo   | Corregida (#498)                                                    |

### Keycloak

| Alerta de ZAP                     | Riesgo | Decisión                              |
| --------------------------------- | ------ | ------------------------------------- |
| Falta `Permissions-Policy`        | Bajo   | [Riesgo aceptado](#riesgos-aceptados) |
| Falta `Strict-Transport-Security` | Bajo   | [Riesgo aceptado](#riesgos-aceptados) |

## Resultados del escaneo completo (activo y autenticado)

Corrida del 12/11/2026 sobre la API de staging. El detalle está en el informe cifrado de la corrida (ver [`dast.md`](dast.md#leer-el-informe-del-modo-completo)).

| Riesgo      | Alertas |
| ----------- | ------- |
| Alto        | 0       |
| Medio       | 2       |
| Bajo        | 3       |
| Informativo | 3       |

**Medio y bajo:** son las mismas alertas de encabezados del baseline de la API, en `GET /`. Staging todavía tenía la versión anterior a la corrección (#498). No hay hallazgos nuevos de riesgo medio, así que no se abren issues nuevos.

**Informativos:**

| Alerta                                              | Decisión                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La API respondió con errores 4xx                    | Comportamiento esperado: ZAP manda datos inválidos o de ataque y la API los rechaza por validación (400), por permisos (401 y 403) o por límite de pedidos (429). No hubo ningún error 5xx. |
| Respuestas que un caché compartido no puede guardar | Esperado: las respuestas autenticadas no se deben guardar en cachés compartidos.                                                                                                            |
| Encabezado `Cache-Control` a revisar                | Aparece en la raíz, el estado del servicio y el contrato OpenAPI, que no tienen datos sensibles. Sin acción.                                                                                |

**Qué no encontró:** ZAP no reportó alertas de inyección (SQL o de comandos), XSS, recorrido de rutas ni acceso a metadatos de la nube.

## Riesgos aceptados

| Riesgo                                                            | Por qué no se corrige                                                                                                                                                                                     | Mitigación                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web: `'unsafe-inline'` en `script-src` y `style-src`              | Next.js agrega scripts en línea para la hidratación de cada página. Quitarlo exige una CSP con un nonce por pedido, que obliga a generar todas las páginas en cada pedido y elimina el uso de caché.      | Sin `'unsafe-eval'` en producción. `script-src` limitado a la propia app y a Mercado Pago. `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` y `frame-ancestors 'none'`. React escapa todo lo que muestra y la app no inserta HTML sin escapar. |
| Web: sin `Cross-Origin-Embedder-Policy`                           | Con `require-corp`, el navegador bloquea los recursos de otros orígenes que no lo autorizan: el formulario de pago de Mercado Pago, las imágenes del menú y el iframe de Keycloak para renovar la sesión. | `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy` en `same-origin`. La app no usa funciones del navegador que requieran aislamiento entre orígenes.                                                                                            |
| Keycloak: sin `Permissions-Policy` ni `Strict-Transport-Security` | Keycloak arma sus propios encabezados y Railway no permite agregar encabezados en el borde. Agregarlos exige un proxy inverso delante de Keycloak, que suma un servicio más para mantener.                | El dominio de Keycloak se sirve por HTTPS. Sus pantallas no usan cámara, micrófono ni ubicación.                                                                                                                                                           |

Se revisan cuando cambie la versión de Next.js o de Keycloak, o la plataforma de despliegue.

## Falsos positivos

Ninguno. [`reglas-zap.tsv`](../../scripts/dast/reglas-zap.tsv) no tiene alertas ignoradas.

Los riesgos aceptados tampoco se ignoran ahí: las reglas se ignoran por número de regla, y la misma regla cubre otros problemas. Por ejemplo, la regla de CSP también avisa de comodines o directivas faltantes. Si se ignorara, un problema nuevo de CSP pasaría sin aviso.

## Limitaciones de la cobertura

- **Profundidad del escaneo activo:** el 97 % de las respuestas fueron 4xx y solo el 2 % fueron 2xx. ZAP completa los parámetros de las rutas con valores de ejemplo que no son identificadores válidos, y la validación los rechaza antes de llegar a la lógica de negocio. El escaneo prueba bien la validación de entrada y los permisos, pero llega poco a la lógica interna.
- **Duración:** el escaneo activo se corta a los 13 minutos porque el token del Admin dura 15.
- **Autorización entre tenants:** ZAP no prueba accesos indebidos a datos de otro tenant (IDOR). Lo cubren los tests de aislamiento entre tenants del pipeline y la revisión guiada por OWASP ASVS nivel 1.

## Verificación después del deploy

Pendiente: cuando las correcciones lleguen a staging, correr el baseline de los tres objetivos y el escaneo completo, y registrar el resultado en la versión 1.1 de este informe. Se espera que solo queden los riesgos aceptados.
