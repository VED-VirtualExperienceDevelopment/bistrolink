# Keycloak — realm BistroLink

Notas de diseño de `realm-export.json` que no entran en el campo `description`
de Keycloak (columna `CLIENT_SCOPE.DESCRIPTION`, `VARCHAR(255)` — un texto
más largo rompe el `--import-realm` con `Value too long for column`, ver
BL-161). Las descripciones dentro del JSON quedan cortas a propósito y
apuntan acá.

## Client Scope: `tenant`

Incluye también el mapper de `sub` (Subject/ID del usuario).

**Motivo:** al importar el realm vía `--import-realm`, Keycloak NO recrea el
client scope interno `basic` (que trae `sub` por defecto) salvo que esté
definido explícitamente acá — mismo problema de fondo que el scope `roles`
(ver abajo). Sin esto, los tokens emitidos quedan sin claim `sub`, rompiendo
cualquier flujo que dependa de identificar al usuario (ej. WebSocket del
KDS, HU-004).

## Client Scope: `roles`

Scope OpenID Connect que agrega los roles del usuario al token.

**Motivo:** Keycloak no lo crea automáticamente al importar un realm vía
`--import-realm` (solo cuando el realm se crea desde la consola de admin),
así que hay que definirlo a mano acá.

## Service account de `bistrolink-backend`: permisos declarados en el JSON

El usuario `service-account-bistrolink-backend` tiene sus `clientRoles` de
`realm-management` (`manage-users`, `view-users`, `query-users`,
`view-realm`) declarados directamente en la sección `users` de este archivo
— **no** dependen de correr `setup-service-account.sh` a mano después de
importar el realm.

**Historial:** originalmente solo estaban declarados los primeros 3 roles
acá, y `view-realm` se agregaba con `setup-service-account.sh` como paso
manual post-import. Eso causó un bug real (ver BL-162): al resetear el
volumen de Keycloak en staging, el service account quedó sin `view-realm`
porque el script solo se había corrido en local, y `assignRealmRole()`
(que necesita `GET /admin/realms/{realm}/roles/{roleName}`) empezó a fallar
con 403 — mientras que `createUser()` seguía funcionando porque
`manage-users` sí estaba declarado en el JSON. `setup-service-account.sh`
queda en el repo como fallback manual/de emergencia, pero ya no debería ser
necesario correrlo en un ambiente nuevo.

Si en el futuro el service account necesita un permiso nuevo: agregalo acá,
en `clientRoles.realm-management`, no como un paso manual aparte — el
patrón manual es exactamente lo que causó este bug.

## Regla general para nuevos clientScopes

Si necesitás agregar contexto largo sobre un `clientScope`, `client` o
`protocolMapper` nuevo: el campo `description` del JSON debe quedar corto
(idealmente <120 caracteres) y el detalle va en este archivo, con un ancla
`#client-scope-<nombre>` para poder referenciarlo desde el JSON. Nunca
asumas que la columna de Keycloak tiene espacio de sobra — el límite real es
255 caracteres y no hay validación en build time que lo avise; se descubre
recién en runtime, al importar, y tira todo el contenedor en crash loop.

## User profile: atributo `tenant_id` (BL-262, R1)

`tenant_id` tiene `view` y `edit` **solo para `admin`** en el user profile
declarativo. Antes estaba abierto también a `user`, y como los roles por
defecto del realm (`default-roles-bistrolink`) incluyen
`account/manage-account`, cualquier usuario creado por la Admin API (mozos y
admins de `/usuarios`, el comensal técnico) podía cambiarse el tenant por la
API de cuenta y su próximo token salía con el `tenant_id` nuevo.

El backend no se ve afectado: lee y escribe el atributo con la cuenta de
servicio de `bistrolink-backend`, que opera como admin, y el mapper
`tenant-id-mapper` lo sigue agregando al token igual.

Nunca volver a darle permiso `user` a este atributo: es la base del
aislamiento multi-tenant (RD.07).

## Usuarios de prueba: fuera de `realm-export.json` (BL-264, R2)

`realm-export.json` tiene solo la **configuración** del realm (roles,
clientes, scopes, mappers, user profile y la cuenta de servicio de
`bistrolink-backend`). Los usuarios de prueba están en `test-users.json`, sin
contraseñas, y los carga `load-test-users.sh` al arrancar el contenedor
**solo si `KC_LOAD_TEST_USERS=true`**.

**Motivo:** antes los usuarios de prueba venían en `realm-export.json` y
`Dockerfile.auth` les escribía las contraseñas en el build (build-args
`TEST_*`). Las contraseñas quedaban dentro de una capa de la imagen publicada
en GHCR, y como staging y producción usan la misma imagen, producción nacía con
usuarios de prueba y contraseñas conocidas.

### Cómo funciona

1. `set-client-secret.sh` arranca Keycloak, fija el client secret y, si
   `KC_LOAD_TEST_USERS=true`, llama a `load-test-users.sh` con la misma sesión
   de `kcadm` (admin del realm `master`).
2. `load-test-users.sh` mira cuáles de los 8 usuarios faltan (por su ID fijo).
   Si están todos, termina sin hacer nada y no necesita ninguna variable.
3. Si falta alguno, reemplaza los `${TEST_*_USERNAME}` de `test-users.json`,
   importa con la Admin API `partialImport` (`ifResourceExists: SKIP`: crea
   los que faltan con su ID fijo y no toca los existentes) y le fija la
   contraseña **solo a los recién creados**, desde las variables de entorno.
4. Si falla, queda un aviso en el log y Keycloak sigue arriba.

Los IDs fijos son los mismos que usan `apps/backend/prisma/seed.ts` y los
tests de integración (`c832535d-…` admin, `f552ec55-…` mozo, etc.). Si se
agrega un usuario de prueba: agregarlo en `test-users.json` con un ID fijo y en
la lista `USUARIOS` de `load-test-users.sh` con la variable de su contraseña.

### Usuarios por tenant (BL-197)

Hay dos tenants de testing. Los datos de la base (tenants, restaurantes,
mesas, carta y filas de `usuario`) están en `apps/backend/prisma/seed.ts`.

| Tenant                                       | Para qué                                                | Admin                              | Cocina                              | Mozo              | Comensal técnico      |
| -------------------------------------------- | ------------------------------------------------------- | ---------------------------------- | ----------------------------------- | ----------------- | --------------------- |
| **A** · «Restaurante Testing A» `11111111-…` | Todos los flujos: pedidos, KDS, carta, layout, usuarios | `admin-test`                       | `cocina-test`                       | `mozo-test`       | `comensal-11111111-…` |
| **B** · «Restaurante Testing B» `b02579f2-…` | El «otro tenant» de los tests de aislamiento            | `admin-b-test` (`TEST_TENANT_B_*`) | `cocina-b-test` (`TEST_COCINA_B_*`) | —                 | `comensal-b02579f2-…` |
| — (sin `tenant_id`)                          | Token sin tenant (RD.07)                                | —                                  | —                                   | `sin-tenant-test` | —                     |

- Todos los comensales técnicos usan la misma contraseña,
  `KEYCLOAK_COMENSAL_PASSWORD`: es con la que la API pide el token de
  `comensal-<tenantId>`.
- `test-users.json` es **solo para testing** (local y staging). Los tenants
  de desarrollo (`dev-<nombre>-…`) y el de demo se crean con el alta de
  HU-027 desde `/plataforma` y no van acá.
- El tenant «Ejemplo» (`554915d0-…`) se fusionó en A. En una base o un
  Keycloak anteriores a BL-197 hay que cambiar a mano el `tenant_id` de
  `admin-test` y `cocina-test`, correr el seed y retirar Ejemplo con
  `apps/backend/scripts/retirar-tenant-ejemplo.sql` (runbook
  `docs/runbooks/migraciones-y-seed.md`).

### Por entorno

| Entorno                              | `KC_LOAD_TEST_USERS`             | De dónde salen las variables                          |
| ------------------------------------ | -------------------------------- | ----------------------------------------------------- |
| Local (`docker compose`)             | `true` (en `docker-compose.yml`) | `apps/backend/.env`                                   |
| Staging (Railway, `bistrolink-auth`) | `true`                           | Variables del servicio en Railway                     |
| Producción (Railway)                 | **no se define**                 | — (no se carga ningún usuario de prueba)              |
| CI                                   | —                                | El CI no levanta Keycloak; los E2E usan el de staging |

Variables: `TEST_ADMIN_USERNAME`, `TEST_ADMIN_PASSWORD`,
`TEST_COCINA_USERNAME`, `TEST_COCINA_PASSWORD`, `TEST_NO_TENANT_USERNAME`,
`TEST_NO_TENANT_PASSWORD`, `TEST_TENANT_B_USERNAME`, `TEST_TENANT_B_PASSWORD`,
`TEST_MOZO_USERNAME`, `TEST_MOZO_PASSWORD`, `TEST_COCINA_B_USERNAME`,
`TEST_COCINA_B_PASSWORD` y `KEYCLOAK_COMENSAL_PASSWORD`.

### Cosas a tener en cuenta

- **Un realm que ya existe no se toca.** `--import-realm` no actualiza un realm
  existente; sacar los usuarios del JSON no los borra de staging ni de un
  Keycloak local ya levantado.
- **Rotar una contraseña de prueba:** cambiarla en la consola de Keycloak y en
  la variable o secret correspondiente. El script no vuelve a fijar
  contraseñas de usuarios existentes (para no chocar con la política de
  contraseñas de BL-266 ni pisar cambios manuales).
- **`test-users.json` no va en `data/import/`:** `--import-realm` lo trataría
  como un realm completo. En la imagen vive en `/opt/keycloak/data/test-users/`.
- **Producción:** verificar que el servicio de Auth de producción **no** tenga
  `KC_LOAD_TEST_USERS` ni las variables `TEST_*` (checklist de BL-220 y
  BL-232).

## Configuración de seguridad del realm (BL-266)

Valores declarados en `realm-export.json` (realms nuevos, por ejemplo producción). En staging se aplican una sola vez por la Admin API (script del PR de BL-266), porque el import no actualiza un realm que ya existe; la quita de los roles de cuenta la hace el arranque del contenedor.

| Control                                       | Valor                                                                  | Motivo                                                                                                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token (realm)                          | 900 s (15 min)                                                         | Achica la ventana de un token robado. El frontend (`keycloak-js`) lo renueva solo 30 s antes de que venza; el KDS y el mapa de mesas recrean el socket con el token nuevo.                                |
| Access token del cliente `bistrolink-backend` | 3600 s (atributo `access.token.lifespan`)                              | Lo usan el comensal (password grant) y la cuenta de servicio. El comensal no renueva su token durante el pedido (`SeguimientoPedido`), así que se mantiene la hora que tenía.                             |
| SSO Session Idle / Max                        | 7200 s (2 h) / 43200 s (12 h)                                          | Acorde a un turno de restaurante.                                                                                                                                                                         |
| Refresh token                                 | Rotación activa (`revokeRefreshToken: true`, reuso 0)                  | Ya estaba (HU-013).                                                                                                                                                                                       |
| Política de contraseñas                       | `length(9) and notUsername(undefined) and passwordHistory(3)`          | Mínimo 9 caracteres, distinta del usuario, sin repetir las últimas 3. Solo se valida al fijar una contraseña: las de prueba (`TEST_*`, `KEYCLOAK_COMENSAL_PASSWORD`) tienen que tener 9 o más.            |
| Eventos de usuario                            | Guardados 90 días (`eventsExpiration: 7776000`), todos los tipos       | Auditoría de logins y fallos (RF.19, HU-035). Se ven en la consola, _Events → User events_.                                                                                                               |
| Eventos de administración                     | Guardados, **sin** representación (`adminEventsDetailsEnabled: false`) | Registra quién creó, cambió o borró qué; sin el cuerpo, para no guardar datos sensibles.                                                                                                                  |
| Roles por defecto                             | Sin `account/manage-account` ni `account/view-profile`                 | El personal no usa la consola de cuenta de Keycloak. Los quita `set-client-secret.sh` en cada arranque (Keycloak los agrega al crear el realm y el JSON no puede sacarlos); así también aplica a staging. |
| Detección de fuerza bruta                     | **Pendiente (BL-271)**                                                 | Activarla hoy permitiría bloquear al comensal técnico de un restaurante (su nombre se deduce del `tenantId`) y dejarlo sin pedidos por QR. Primero hay que hacer que ese nombre no se pueda adivinar.     |

`load-test-users.sh`: si Keycloak rechaza la contraseña de un usuario de prueba por la política, el usuario recién creado se borra y el error queda en el log; el próximo arranque lo vuelve a intentar.
