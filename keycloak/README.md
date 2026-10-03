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
2. `load-test-users.sh` mira cuáles de los 6 usuarios faltan (por su ID fijo).
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
`TEST_MOZO_USERNAME`, `TEST_MOZO_PASSWORD` y `KEYCLOAK_COMENSAL_PASSWORD`.

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
