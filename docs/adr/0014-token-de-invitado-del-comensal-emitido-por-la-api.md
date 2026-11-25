# ADR 0014 — Token de invitado del comensal emitido por la API

| Campo       | Valor                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Estado      | Aceptada; implementada en staging (18/11/2026), sin el comensal técnico desde BL-581 (19/11/2026), en producción desde v0.6.0 (24/11/2026) |
| Fecha       | 18/11/2026                                                                                                                                 |
| Referencias | HU-052 (BL-576: BL-577 a BL-582 y BL-584); BL-266; BL-271; BL-573; BL-574; RFC 9700 §2.4; ADR 0002; ADR 0003                               |
| Autores     | E. Arenas, V. Couto, D. Silvera                                                                                                            |

## Contexto

El comensal no tiene cuenta: abre la carta por el QR de la mesa, por el enlace web del restaurante o por un link de pago. Hasta HU-052, la API le pedía a Keycloak, con el _password grant_ de OAuth 2.0, un token de un **usuario técnico por restaurante** y se lo entregaba al navegador. La mesa y el pedido se validaban aparte, con el QR firmado de la mesa (`MesaQrGuard`) y el token del pedido o del link (`PedidoAccesoGuard`).

El riesgo de ese diseño está identificado desde el 03/10/2026, al revisar la configuración de seguridad de Keycloak (BL-266) y su seguimiento (BL-271):

- el RFC 9700 (_Best Current Practice for OAuth 2.0 Security_, IETF, enero de 2025), §2.4, establece que el _password grant_ **no debe usarse**; OAuth 2.1 ya no lo incluye;
- el token era el mismo para todos los comensales de un restaurante mientras duraba: no se podía revocar el de un solo comensal sin afectar al resto del local;
- la protección contra fuerza bruta de Keycloak podía bloquear al usuario técnico y dejar al restaurante sin pedidos. BL-271 hizo que su nombre no se pudiera deducir del `tenant_id`, pero el 15/11 los logins simultáneos de los E2E lo bloquearon igual y la protección del realm `bistrolink` tuvo que volver a apagarse (BL-573).

Los E2E confirmaron el problema antes de llegar a producción.

## Decisión

**La API emite su propio token de invitado para el comensal**, en los tres endpoints de `/auth/comensal` (retiro, mesa por QR y link de pago). Keycloak queda solo para el personal y la plataforma.

**El token:**

- JWT firmado con **HS256** y una clave que solo tiene la API (`COMENSAL_TOKEN_CLAVE`, al menos 32 bytes, en Infisical);
- emisor `bistrolink-api` y audiencia `bistrolink-comensal`, distintos de los de Keycloak;
- vida útil de **60 minutos**, la misma que tenía el token de Keycloak del comensal;
- `sub` y `jti` aleatorios: ya no identifica a un usuario compartido;
- rol **siempre `COMENSAL`**, puesto por la API al verificar: nunca se lee del token;
- `kid` derivado de la clave (los primeros 16 caracteres hexadecimales de su SHA-256), para rotar la clave sin cortar el servicio (`COMENSAL_TOKEN_CLAVE_ANTERIOR`);
- **atado al canal** por el que se emitió: la mesa y la sesión de la mesa, el pedido del link de pago o el restaurante del retiro.

**Verificación con dos emisores sin confusión entre ellos:**

- en HTTP, una estrategia propia (`jwt-invitado`) que solo usan los cinco controladores del comensal (`AuthGuardComensal`). El resto de la API sigue con la estrategia de Keycloak, así que el token de invitado no sirve en ningún endpoint del personal ni de la plataforma (401), por construcción;
- en el socket, el verificador se elige por el emisor del token. Un token que dice venir de Keycloak nunca se verifica con la clave de la API, y uno de la API nunca con las claves de Keycloak;
- la clave se elige por el `kid` sin salir a la red, y la suspensión del establecimiento (BL-413) se aplica igual a los dos emisores.

**El token solo sirve en su canal** (BL-580): el de una mesa, con el QR y la sesión abierta de esa mesa y con sus pedidos; el del link de pago, con su pedido y el resumen de su link, y no hace pedidos nuevos; el del retiro, en su restaurante, y nunca en una mesa. Lo mismo vale para el seguimiento por socket. Cerrar la mesa deja inservible el token del grupo anterior: es la **revocación por comensal** que antes no existía.

**Despliegue gradual y vuelta atrás:** `COMENSAL_TOKEN_EMISOR` elegía quién emite (`keycloak` por defecto, o `api`). La API verificaba los dos mientras convivían, así que volver a `keycloak` era un cambio de variable, sin deploy de código. Se usó para pasar staging a `api` el 18/11/2026. La API no arranca si la clave falta o está mal formada; el error nunca muestra la clave.

**Retiro del usuario técnico** (BL-581): se quitan el camino de Keycloak, el emisor configurable y el comensal técnico de cada restaurante; el alta de establecimientos deja de crearlo, y un token de Keycloak con el rol `COMENSAL` se rechaza en HTTP y en el socket. Los que ya existen se borran con `scripts/borrar-comensales-tecnicos.ts`. Después se activa la protección contra fuerza bruta en el realm `bistrolink` (BL-582), porque del lado del comensal ya no hay nada que bloquear.

**Cambio de orden (19/11/2026):** el plan era hacer BL-581 después de validar `api` en producción, para poder volver a `keycloak` con solo cambiar la variable. Se adelantó para que entre en el mismo release que el token de invitado: producción todavía no tiene establecimientos ni usuarios, staging está validado con `api` desde el 18/11, y el release es la primera vez que producción recibe HU-052. Lo que se pierde es la vuelta atrás por variable: si el token de invitado fallara en producción, se vuelve a la imagen anterior con el rollback del pipeline.

## Alternativas consideradas

| Alternativa                                                                   | Por qué se descartó                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mantener el _password grant_ con una cache del token por restaurante (BL-573) | Reducía los logins simultáneos que bloqueaban al usuario técnico, pero conservaba el _password grant_, el token compartido por todo el local y la imposibilidad de revocar el de un solo comensal. Era una mitigación, no una solución: se descartó al decidir este diseño.                                  |
| _Token exchange_ de Keycloak (RFC 8693)                                       | Para intercambiar hace falta un token de origen, así que seguía necesitando una identidad del comensal en Keycloak (el usuario técnico o un cliente por restaurante). Sumaba clientes y permisos en Keycloak sin sacar al comensal de ahí, y sin resolver la revocación por comensal.                        |
| _Client credentials_ de Keycloak                                              | Es un flujo para servicios, no para usuarios: el token representaría al cliente `bistrolink-backend`, con los mismos permisos para todos los comensales de todos los restaurantes. Obligaba a meter el restaurante y el canal como datos aparte, sin firma propia, y no resolvía la revocación por comensal. |
| Un usuario de Keycloak por comensal o por mesa                                | Crear y borrar usuarios en cada visita carga a Keycloak, deja basura si algo falla a mitad de camino y vuelve a exponer usuarios que la protección contra fuerza bruta puede bloquear.                                                                                                                       |
| Firmar el token con una clave asimétrica (RS256 o EdDSA)                      | Solo la API emite y verifica este token, así que una clave simétrica alcanza. Con dos emisores, el algoritmo distinto (HS256 para el comensal, RS256 para Keycloak) también ayuda a que uno no se pueda hacer pasar por el otro.                                                                             |

## Consecuencias

- **Lo que ganamos:**
  - Desaparecen el _password grant_ (RFC 9700 §2.4) y la contraseña compartida del comensal técnico.
  - Cada comensal tiene un token propio, atado a su canal, y el de la mesa se revoca al cerrarla.
  - Sin el usuario técnico (BL-581), la protección contra fuerza bruta del realm `bistrolink` se puede activar sin dejar a un restaurante sin pedidos (BL-582).
  - Pedir el token ya no depende de que Keycloak responda: el comensal puede abrir la carta aunque Keycloak esté lento o reiniciándose.
- **Una clave nueva que cuidar:** `COMENSAL_TOKEN_CLAVE`, con un valor distinto por entorno, en Infisical (ADR 0003). Quien la tenga puede firmar tokens de comensal de cualquier restaurante de ese entorno, con los permisos del rol `COMENSAL`. Se rota con la clave anterior en `COMENSAL_TOKEN_CLAVE_ANTERIOR` durante una vida útil del token (60 minutos), y ante una sospecha de filtración se reemplaza sin clave anterior: todos los tokens emitidos dejan de servir al instante. El procedimiento está en el runbook de gestión de secretos.
- **El token de retiro y el del link de pago no se revocan antes de vencer** (60 minutos como máximo): su alcance está limitado a su restaurante o a su pedido, y el acceso a un pedido existente sigue exigiendo el token del pedido o del link.
- **Mientras convivieron los dos emisores** (18/11 y 19/11, solo en staging), un token de Keycloak del comensal no tenía canal y seguía con las reglas de antes. BL-581 cerró esa puerta: ese token ya no se acepta.
- **Variables que sobran:** `COMENSAL_TOKEN_EMISOR`, `KEYCLOAK_COMENSAL_PASSWORD` y `KEYCLOAK_COMENSAL_USERNAME_SECRET` ya no se leen. Si siguen cargadas, la API arranca igual y avisa en el log para que se borren de Infisical.
- **Casos de prueba:** unitarios TC-U-591 a 640 (firma y verificación, confusión de emisores y algoritmos, emisión, arranque, reglas de canal en HTTP y en el socket y, con BL-581, el rechazo del token de Keycloak del comensal y el borrado de los comensales técnicos); integración TC-I-235 a 242 (token de invitado contra la base, el RLS y Keycloak reales, y los criterios de BL-580), con el CI de integración corriendo con el token de invitado. En staging, el 18/11/2026: token con emisor `bistrolink-api` y canal de la mesa, y los cuatro jobs de E2E con los flujos del comensal en verde.

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 18/11/2026 | Versión inicial (BL-584). Decisión implementada en BL-577 a BL-580 (PR #525 y #526).                                                              |
| 1.1     | 19/11/2026 | Retiro del comensal técnico (BL-581) y cambio de orden: se adelanta al release, antes de validar en producción, con el motivo y lo que se pierde. |
| 1.2     | 24/11/2026 | En producción desde el release v0.6.0, que incluye BL-577 a BL-581.                                                                               |
