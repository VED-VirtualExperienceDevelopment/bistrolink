# Informe del DAST con OWASP ZAP sobre staging

Resultados de las corridas del análisis dinámico (DAST), decisiones sobre cada hallazgo y riesgos aceptados. Cómo se corre el escaneo y qué se publica: [`dast.md`](dast.md).

## Control de versiones

| Versión | Fecha      | Autor          | Cambios                                                                                                                                                                                                                                                       |
| ------- | ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 12/11/2026 | Daiana Silvera | Primer informe: baseline de web, API y Keycloak, escaneo completo autenticado de la API y riesgos aceptados.                                                                                                                                                  |
| 1.1     | 21/11/2026 | Daiana Silvera | Verificación después del deploy de las correcciones: baseline de los tres objetivos y escaneo completo de la API. Página de inicio de Keycloak como riesgo aceptado (consola de administración apagada, verificado). Falso positivo de inyección SQL en el escaneo activo, acotado a sus dos rutas con `OUTOFSCOPE`. |

## Resumen

- **Las correcciones llegaron a staging y funcionan.** En la verificación del 21/11, la API no tiene alertas de riesgo medio ni bajo, y la web solo conserva los riesgos aceptados.
- **Ninguna alerta de riesgo alto abierta.** El escaneo completo del 21/11 reportó una alerta alta (inyección SQL, en dos endpoints) que, revisada contra el código, es un [falso positivo](#falsos-positivos). Se cumple el criterio de salida del DAST.
- Los hallazgos de riesgo medio y bajo que quedan son encabezados HTTP y la política de contenido (CSP) de la web y de Keycloak. Se ven desde afuera sin atacar, ninguno es explotable por sí solo y todos están en [riesgos aceptados](#riesgos-aceptados), con su mitigación.
- El escaneo activo de la API no reportó XSS, recorrido de rutas ni acceso a metadatos de la nube, y la API no respondió ningún error 5xx.

## Alcance y configuración

| Dato              | Valor                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Entorno           | Staging (web, API y Keycloak). Producción queda fuera.                                              |
| Herramienta       | OWASP ZAP 2.17.0 (imagen fija en el workflow)                                                       |
| Baseline (pasivo) | Web con spider de 3 minutos, API con su contrato OpenAPI sin atacar y pantalla de login de Keycloak |
| Completo (activo) | API con su contrato OpenAPI, autenticado con el Admin del tenant de testing B, hasta 13 minutos     |
| Reglas            | [`scripts/dast/reglas-zap.tsv`](../../scripts/dast/reglas-zap.tsv)                                  |

## Resultados del baseline (pasivo)

### Primera corrida (12/11/2026), antes de las correcciones

Riesgo alto: ninguno en los tres objetivos.

#### Web

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

#### API

| Alerta de ZAP                                                        | Riesgo | Decisión                                                            |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| CSP con comodín y `style-src 'unsafe-inline'` (CSP para páginas web) | Medio  | Corregida: CSP propia para JSON y otra para la documentación (#498) |
| `GET /` responde texto en lugar de JSON                              | Bajo   | Corregida (#498)                                                    |
| Falta `Permissions-Policy`                                           | Bajo   | Corregida (#498)                                                    |
| Falta `Cross-Origin-Embedder-Policy`                                 | Bajo   | Corregida (#498)                                                    |

#### Keycloak

| Alerta de ZAP                     | Riesgo | Decisión                              |
| --------------------------------- | ------ | ------------------------------------- |
| Falta `Permissions-Policy`        | Bajo   | [Riesgo aceptado](#riesgos-aceptados) |
| Falta `Strict-Transport-Security` | Bajo   | [Riesgo aceptado](#riesgos-aceptados) |

### Verificación después del deploy (21/11/2026)

Riesgo alto: ninguno en los tres objetivos.

| Objetivo | Alto | Medio | Bajo | Informativo | Resultado                                                                                                                                                         |
| -------- | ---- | ----- | ---- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web      | 0    | 2     | 1    | 5           | Solo quedan los riesgos aceptados: `'unsafe-inline'` en `script-src` y `style-src` (medio) y falta de `Cross-Origin-Embedder-Policy` (bajo). Las correcciones de #493, #495 y #496 se confirman |
| API      | 0    | 0     | 0    | 4           | Sin alertas de riesgo medio ni bajo: se confirman las correcciones de #498                                                                                        |
| Keycloak | 0    | 4     | 5    | 5           | Alertas nuevas en la página de inicio (`/`), que la corrida del 12/11 no había recorrido. Ver abajo                                                               |

**Keycloak, página de inicio.** Esta vez el spider llegó a la raíz del dominio de Keycloak. Esa página responde con la CSP que Keycloak trae por defecto (`frame-src 'self'; frame-ancestors 'self'; object-src 'none';`), que no define `default-src`, `script-src` ni `style-src`. De ahí salen las cuatro alertas medias (directiva sin fallback, comodín y `'unsafe-inline'` en scripts y estilos) y las bajas de `Cross-Origin-Resource-Policy`, `Cross-Origin-Embedder-Policy` y `Cross-Origin-Opener-Policy`. Siguen las dos bajas ya aceptadas (`Permissions-Policy` y `Strict-Transport-Security`).

Se verificó que la raíz no lleva a la consola de administración: responde 200 sin redirección, y `/admin/master/console/` responde 404 porque la consola está apagada en staging y producción (`KC_FEATURES_DISABLED=admin`, ver `keycloak/README.md`). Se suma a los [riesgos aceptados](#riesgos-aceptados).

## Resultados del escaneo completo (activo y autenticado)

### Primera corrida (12/11/2026)

Sobre la API de staging, antes de que se desplegaran las correcciones.

| Riesgo      | Alertas |
| ----------- | ------- |
| Alto        | 0       |
| Medio       | 2       |
| Bajo        | 3       |
| Informativo | 3       |

Las alertas medias y bajas eran las mismas de encabezados del baseline de la API, en `GET /`: staging todavía tenía la versión anterior a la corrección (#498). No hubo hallazgos nuevos de riesgo medio.

### Verificación (21/11/2026)

Sobre la API de staging con las correcciones desplegadas. El detalle está en el informe cifrado de la corrida (ver [`dast.md`](dast.md#leer-el-informe-del-modo-completo)).

| Riesgo      | Alertas | Decisión                                                                                         |
| ----------- | ------- | ------------------------------------------------------------------------------------------------ |
| Alto        | 1       | Inyección SQL (regla 40018), dos instancias: [falso positivo](#falsos-positivos), revisado contra el código y acotado a esas dos rutas en `reglas-zap.tsv` |
| Medio       | 0       | Se confirman las correcciones de #498                                                            |
| Bajo        | 0       | Se confirman las correcciones de #498                                                            |
| Informativo | 3       | Ver abajo                                                                                        |

**Informativos:**

| Alerta                                              | Decisión                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La API respondió con errores 4xx                    | Comportamiento esperado: ZAP manda datos inválidos o de ataque y la API los rechaza por validación (400), por permisos (401 y 403) o por límite de pedidos (429). No hubo ningún error 5xx. |
| Respuestas que un caché compartido no puede guardar | Esperado: las respuestas autenticadas no se deben guardar en cachés compartidos.                                                                                                            |
| Encabezado `Cache-Control` a revisar                | Aparece en la raíz, el estado del servicio y el contrato OpenAPI, que no tienen datos sensibles. Sin acción.                                                                                |

**Qué no encontró:** ZAP no reportó XSS, inyección de comandos, recorrido de rutas ni acceso a metadatos de la nube. La única alerta de inyección es el falso positivo descrito abajo.

## Riesgos aceptados

| Riesgo                                                                                                           | Por qué no se corrige                                                                                                                                                                                     | Mitigación                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web: `'unsafe-inline'` en `script-src` y `style-src`                                                             | Next.js agrega scripts en línea para la hidratación de cada página. Quitarlo exige una CSP con un nonce por pedido, que obliga a generar todas las páginas en cada pedido y elimina el uso de caché.      | Sin `'unsafe-eval'` en producción. `script-src` limitado a la propia app y a Mercado Pago. `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` y `frame-ancestors 'none'`. React escapa todo lo que muestra y la app no inserta HTML sin escapar. |
| Web: sin `Cross-Origin-Embedder-Policy`                                                                          | Con `require-corp`, el navegador bloquea los recursos de otros orígenes que no lo autorizan: el formulario de pago de Mercado Pago, las imágenes del menú y el iframe de Keycloak para renovar la sesión. | `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy` en `same-origin`. La app no usa funciones del navegador que requieran aislamiento entre orígenes.                                                                                            |
| Keycloak: sin `Permissions-Policy` ni `Strict-Transport-Security`                                                | Keycloak arma sus propios encabezados y Railway no permite agregar encabezados en el borde. Agregarlos exige un proxy inverso delante de Keycloak, que suma un servicio más para mantener.                | El dominio de Keycloak se sirve por HTTPS. Sus pantallas no usan cámara, micrófono ni ubicación.                                                                                                                                                           |
| Keycloak, página de inicio: CSP por defecto (sin `default-src`, `script-src` ni `style-src`) y sin CORP, COEP ni COOP | Es la página propia de Keycloak en la raíz del dominio; su CSP es la que define Keycloak para el realm. Endurecerla desde el código del realm es posible, pero las pantallas de login de Keycloak 26 y el tema propio usan scripts y estilos en línea, así que `'unsafe-inline'` seguiría siendo necesario, y un error en la CSP deja sin login a todos los roles. | La página no tiene formularios ni datos. La consola de administración está apagada (`/admin/master/console/` responde 404, verificado el 21/11/2026). El login conserva `frame-ancestors 'self'` y `object-src 'none'`. Se revisa con la mejora pendiente de definir la CSP del realm desde el código, que bajaría de cuatro a dos las alertas medias. |

Se revisan cuando cambie la versión de Next.js o de Keycloak, o la plataforma de despliegue.

## Falsos positivos

**Inyección SQL booleana (regla 40018), escaneo completo del 21/11/2026.** ZAP manda el mismo valor con `AND 1=1` y con `AND 1=2` y, si las respuestas difieren, supone que el valor llega a una consulta SQL. Confianza de ZAP: media.

| Endpoint                             | Parámetro | Por qué es un falso positivo                                                                                                                                                                                                                         |
| ------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/menu/categoria`         | `nombre`  | El valor se guarda con el cliente de Prisma (`create`), que siempre envía los valores como parámetros: el texto nunca forma parte del SQL. Es un endpoint que crea datos: cada pedido crea una categoría o choca con una existente, y cambian el identificador y el orden. Las respuestas difieren por el estado, no por el SQL. |
| `POST /admin/menu/imagenes/confirmar` | `key`     | No consulta la base de datos. La key se valida con un patrón y, si no coincide, se rechaza con 400. Las diferencias entre respuestas vienen del límite de pedidos por minuto del endpoint (400 o 429).                                                     |

Además se revisó todo el SQL escrito a mano del backend: usa consultas parametrizadas (`Prisma.sql` o parámetros posicionales) o consultas fijas. No hay SQL armado con texto del usuario.

**Se acota a estas dos rutas, sin ignorar la regla:** en [`reglas-zap.tsv`](../../scripts/dast/reglas-zap.tsv) van dos líneas `OUTOFSCOPE` para la regla 40018, una por ruta, con su motivo. Con `IGNORE` la regla quedaría apagada para toda la API y una inyección SQL real en otro endpoint pasaría sin aviso; con `OUTOFSCOPE` sigue activa en el resto. `resumen-zap.mjs` aplica las mismas rutas al informe JSON, así que la próxima corrida completa ya no cuenta esta alerta para el criterio de salida.

Los riesgos aceptados tampoco se ignoran en `reglas-zap.tsv`, por el mismo motivo: la misma regla cubre otros problemas. Por ejemplo, la regla de CSP también avisa de comodines o directivas faltantes, y si se ignorara, un problema nuevo de CSP pasaría sin aviso.

## Limitaciones de la cobertura

- **Profundidad del escaneo activo:** la gran mayoría de las respuestas son 4xx (323 en la corrida del 21/11). ZAP completa los parámetros de las rutas con valores de ejemplo que no son identificadores válidos, y la validación los rechaza antes de llegar a la lógica de negocio. El escaneo prueba bien la validación de entrada y los permisos, pero llega poco a la lógica interna.
- **Endpoints que crean datos:** el escaneo activo crea registros en el tenant de testing B (por ejemplo, categorías con los valores de ataque). Después de cada corrida se ejecuta «Limpieza de staging». Las diferencias de estado entre pedidos pueden generar falsos positivos como el de inyección SQL.
- **Duración:** el escaneo activo se corta a los 13 minutos porque el token del Admin dura 15.
- **Autorización entre tenants:** ZAP no prueba accesos indebidos a datos de otro tenant (IDOR). Lo cubren los tests de aislamiento entre tenants del pipeline y la revisión guiada por OWASP ASVS nivel 1.

## Verificación después del deploy

Hecha el 21/11/2026: baseline de web, API y Keycloak, y escaneo completo autenticado de la API, con las correcciones desplegadas en staging. Resultado: solo quedan los riesgos aceptados y un falso positivo documentado; ninguna alerta de riesgo alto abierta. Después del escaneo completo se ejecuta «Limpieza de staging» sobre el tenant de testing B.

La próxima verificación completa corresponde al cambiar la versión de Next.js o de Keycloak, la plataforma de despliegue, o antes de un release a producción.
