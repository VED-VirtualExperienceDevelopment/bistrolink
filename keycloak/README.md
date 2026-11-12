<p align="center">
  <img src="../docs/assets/banner-keycloak.svg" alt="BistroLink · Autenticación" width="100%">
</p>

<p align="center">
  <a href="../README.md">← BistroLink</a> ·
  <img src="https://img.shields.io/badge/Keycloak-381e72?logo=keycloak&logoColor=white" alt="Keycloak">
  <img src="https://img.shields.io/badge/OAuth2%20%2F%20OIDC-381e72" alt="OAuth2 / OIDC">
</p>

## Realm `bistrolink`: notas de diseño

Notas de diseño de `realm-export.json` que no entran en el campo `description`
de Keycloak (columna `CLIENT_SCOPE.DESCRIPTION`, `VARCHAR(255)`: un texto
más largo rompe el `--import-realm` con `Value too long for column`). Las
descripciones dentro del JSON quedan cortas a propósito y apuntan acá.

## Client Scope: `tenant`

Incluye también el mapper de `sub` (Subject/ID del usuario).

**Motivo:** al importar el realm con `--import-realm`, Keycloak no recrea el
client scope interno `basic` (que trae `sub` por defecto) salvo que esté
definido explícitamente acá; es el mismo problema de fondo que el scope
`roles` (ver abajo). Sin esto, los tokens quedan sin claim `sub` y se rompe
cualquier flujo que identifique al usuario, por ejemplo el WebSocket de la
cocina.

## Client Scope: `roles`

Scope OpenID Connect que agrega los roles del usuario al token.

**Motivo:** Keycloak no lo crea automáticamente al importar un realm con
`--import-realm` (solo cuando el realm se crea desde la consola de
administración), así que se define acá.

## Client Scope: `profile`

Scope OpenID Connect que agrega al token el usuario y el nombre de la
persona: `preferred_username`, `given_name`, `family_name` y `name`. La app
los usa para mostrar quién está logueado.

**Motivo:** igual que `roles`, Keycloak no lo crea al importar un realm con
`--import-realm`. El cliente `bistrolink-frontend` lo pide como default
scope, pero si el realm no lo define, Keycloak lo descarta en silencio y el
token sale sin nombre ni usuario.

**El correo no se incluye a propósito:** el scope `email` no está definido,
porque la app no necesita el correo en el token. Cuantos menos datos
personales viajen en el token, mejor. Si en el futuro hace falta, se define
como un scope aparte.

**Entornos existentes:** como `--import-realm` no actualiza un realm que ya
existe, `set-client-secret.sh` crea este scope al arrancar si falta y lo deja
como scope por defecto (ver [Cambios del realm en entornos existentes](#cambios-del-realm-en-entornos-existentes)).

## Service account de `bistrolink-backend`: permisos declarados en el JSON

El usuario `service-account-bistrolink-backend` tiene sus `clientRoles` de
`realm-management` (`manage-users`, `view-users`, `query-users`,
`view-realm`, `view-events`) declarados directamente en la sección `users` de
este archivo. No dependen de correr `setup-service-account.sh` a mano después
de importar el realm.

- `setup-service-account.sh` queda en el repo como alternativa manual de
  emergencia, pero no hace falta correrlo en un entorno nuevo.
- `view-events` es de solo lectura: el backend lee los eventos `LOGIN` para
  mostrar el último ingreso de cada usuario en Admin → Usuarios.

Si la cuenta de servicio necesita un permiso nuevo: agregarlo acá, en
`clientRoles.realm-management`, y no como un paso manual aparte. Un paso
manual se olvida al recrear un entorno, y la cuenta queda sin el permiso. Como
el import no toca un realm que ya existe, agregarlo también en
`set-client-secret.sh`.

## Regla general para nuevos clientScopes

Si hace falta agregar contexto largo sobre un `clientScope`, `client` o
`protocolMapper` nuevo: el campo `description` del JSON queda corto
(idealmente menos de 120 caracteres) y el detalle va en este archivo, con un
ancla `#client-scope-<nombre>` para referenciarlo desde el JSON. El límite real
es de 255 caracteres y no hay validación al construir la imagen que lo avise:
se descubre recién al importar, y el contenedor queda reiniciándose.

## User profile: atributo `tenant_id`

`tenant_id` tiene `view` y `edit` **solo para `admin`** en el user profile
declarativo. Si también lo tuviera `user`, cualquier usuario con
`account/manage-account` podría cambiarse el tenant por la API de cuenta, y su
próximo token saldría con el `tenant_id` nuevo.

El backend no se ve afectado: lee y escribe el atributo con la cuenta de
servicio de `bistrolink-backend`, que opera como admin, y el mapper
`tenant-id-mapper` lo sigue agregando al token.

Nunca darle permiso `user` a este atributo: es la base del aislamiento entre
restaurantes.

## Usuarios de prueba: fuera de `realm-export.json`

`realm-export.json` tiene solo la **configuración** del realm (roles,
clientes, scopes, mappers, user profile y la cuenta de servicio de
`bistrolink-backend`). Los usuarios de prueba están en `test-users.json`, sin
contraseñas, y los carga `load-test-users.sh` al arrancar el contenedor
**solo si `KC_LOAD_TEST_USERS=true`**.

**Motivo:** staging y producción usan la misma imagen. Si los usuarios de
prueba vinieran en `realm-export.json`, con sus contraseñas escritas al
construir la imagen, las contraseñas quedarían dentro de una capa publicada y
producción nacería con esos usuarios. Así, las contraseñas llegan solo por
variables de entorno al arrancar y producción no carga ningún usuario de
prueba.

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
tests de integración. Para agregar un usuario de prueba: agregarlo en
`test-users.json` con un ID fijo y en la lista `USUARIOS` de
`load-test-users.sh` con la variable de su contraseña.

### Usuarios por tenant

Hay dos tenants de testing. Los datos de la base (tenants, restaurantes,
mesas, carta y filas de `usuario`) están en `apps/backend/prisma/seed.ts`.

| Tenant                          | Para qué                                                | Usuarios de prueba (variables)                                                            |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **A** · «Restaurante Testing A» | Todos los flujos: pedidos, KDS, carta, layout, usuarios | Admin (`TEST_ADMIN_*`), cocina (`TEST_COCINA_*`), mozo (`TEST_MOZO_*`) y comensal técnico |
| **B** · «Restaurante Testing B» | El «otro tenant» de los tests de aislamiento            | Admin (`TEST_TENANT_B_*`), cocina (`TEST_COCINA_B_*`) y comensal técnico                  |
| — (sin `tenant_id`)             | Token sin tenant                                        | Usuario sin tenant (`TEST_NO_TENANT_*`)                                                   |

Los nombres de usuario y las contraseñas salen de esas variables: no se escriben en el repositorio.

- El comensal técnico de cada tenant lo usa solo la API, para pedir el token
  del comensal; su contraseña sale de `KEYCLOAK_COMENSAL_PASSWORD`.
- `test-users.json` es **solo para testing** (local y staging). Los tenants
  de desarrollo (`dev-<nombre>-…`) y el de demo se crean desde `/plataforma`
  y no van acá.
- El tenant «Ejemplo» se fusionó en A. En una base o un Keycloak anteriores a
  ese cambio hay que cambiar a mano el `tenant_id` de los usuarios admin y
  cocina del tenant A, correr el seed y retirar Ejemplo con
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
- **Rotar una contraseña de prueba:** cambiarla con la Admin API (ver
  [Cambiar la configuración](#cambiar-la-configuración)) y en la variable
  correspondiente. El script no vuelve a fijar contraseñas de usuarios
  existentes, para no chocar con la política de contraseñas ni pisar cambios
  manuales.
- **`test-users.json` no va en `data/import/`:** `--import-realm` lo trataría
  como un realm completo. En la imagen vive en `/opt/keycloak/data/test-users/`.
- **Producción:** verificar que el servicio de autenticación de producción
  **no** tenga `KC_LOAD_TEST_USERS` ni las variables `TEST_*`.

## Configuración de seguridad del realm

Valores declarados en `realm-export.json` (realms nuevos, por ejemplo producción). En un realm que ya existe se aplican una sola vez con la Admin API, porque el import no lo actualiza; la quita de los roles de cuenta la hace el arranque del contenedor.

| Control                                       | Valor                                                                  | Motivo                                                                                                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token (realm)                          | 900 s (15 min)                                                         | Achica la ventana de un token robado. El frontend (`keycloak-js`) lo renueva solo 30 s antes de que venza; el KDS y el mapa de mesas recrean el socket con el token nuevo.                                |
| Access token del cliente `bistrolink-backend` | 3600 s (atributo `access.token.lifespan`)                              | Lo usan el comensal (password grant) y la cuenta de servicio. El comensal no renueva su token durante el pedido, así que se mantiene una hora.                                                            |
| SSO Session Idle / Max                        | 7200 s (2 h) / 43200 s (12 h)                                          | Acorde a un turno de restaurante.                                                                                                                                                                         |
| Refresh token                                 | Rotación activa (`revokeRefreshToken: true`, reuso 0)                  | Un refresh token se usa una sola vez.                                                                                                                                                                     |
| Política de contraseñas                       | `length(9) and notUsername(undefined) and passwordHistory(3)`          | Mínimo 9 caracteres, distinta del usuario, sin repetir las últimas 3. Solo se valida al fijar una contraseña: las de prueba (`TEST_*`, `KEYCLOAK_COMENSAL_PASSWORD`) tienen que tener 9 o más.            |
| Eventos de usuario                            | Guardados 90 días (`eventsExpiration: 7776000`), todos los tipos       | Auditoría de logins y fallos.                                                                                                                                                                             |
| Eventos de administración                     | Guardados, **sin** representación (`adminEventsDetailsEnabled: false`) | Registra quién creó, cambió o borró qué; sin el cuerpo, para no guardar datos sensibles.                                                                                                                  |
| Roles por defecto                             | Sin `account/manage-account` ni `account/view-profile`                 | El personal no usa la consola de cuenta de Keycloak. Los quita `set-client-secret.sh` en cada arranque (Keycloak los agrega al crear el realm y el JSON no puede sacarlos); así también aplica a staging. |

`load-test-users.sh`: si Keycloak rechaza la contraseña de un usuario de prueba por la política, el usuario recién creado se borra y el error queda en el log; el próximo arranque lo vuelve a intentar.

## Cambios del realm en entornos existentes

`--import-realm` no actualiza un realm que ya existe, así que algunos valores de `realm-export.json` se aplican en cada arranque desde `set-client-secret.sh` (idempotente):

- Español: `internationalizationEnabled`, `supportedLocales: ["es"]`, `defaultLocale: es`.
- Client scope `profile` (se crea si falta) y scope por defecto del realm, de `bistrolink-frontend` y de `bistrolink-backend`.
- Rol `realm-management/view-events` de la cuenta de servicio de `bistrolink-backend`.

Si se cambia alguno de estos valores en `realm-export.json`, cambiarlo también en el script.

## Administrador y consola de administración

### Variables del administrador

El administrador inicial del realm `master` se define con `KC_BOOTSTRAP_ADMIN_USERNAME` y `KC_BOOTSTRAP_ADMIN_PASSWORD` (desde Keycloak 26; las anteriores, `KEYCLOAK_ADMIN` y `KEYCLOAK_ADMIN_PASSWORD`, están deprecadas y generan una advertencia al arrancar).

- Keycloak usa esas variables **solo la primera vez**, para crear el administrador de `master` si no hay ninguno. En un entorno que ya existe, cambiar el nombre de la variable no cambia el usuario.
- `set-client-secret.sh` las usa en cada arranque para iniciar sesión con `kcadm.sh` contra `localhost`. Lee primero `KC_BOOTSTRAP_ADMIN_*` y, si no están, las anteriores.
- En local son `admin`/`admin` (`docker-compose.yml`). En Railway llegan desde el gestor de secretos del equipo.

### Consola web por entorno

La consola de administración (`/admin/master/console/`) no se publica en los entornos de Railway. Railway expone un solo dominio por servicio y no permite bloquear rutas, así que se apaga la funcionalidad en Keycloak con `KC_FEATURES_DISABLED`:

| Entorno           | `KC_FEATURES_DISABLED` | Consola                        |
| ----------------- | ---------------------- | ------------------------------ |
| Local y CI        | (sin definir)          | Disponible en `localhost:8080` |
| Staging (Railway) | `admin`                | Apagada                        |
| Producción        | `admin`                | Apagada                        |

- Solo se apaga la **consola** (funcionalidad `admin`). La **Admin REST API** (`admin-api`) sigue activa: la usan el backend (usuarios y establecimientos) y `set-client-secret.sh`, y la protege el token de cada llamada.
- La aplicación no usa la consola: el login, los tokens y la Admin REST API funcionan igual con la consola apagada.
- Es una opción de build: como el contenedor arranca con `start` (sin `--optimized`), Keycloak la aplica al iniciar.
- Es configuración, no un secreto: va en las variables del servicio en Railway.

### Cambiar la configuración

En orden de preferencia:

1. **Como código.** Para cualquier cambio de configuración del realm que tenga que quedar: en `realm-export.json` (realms nuevos) y en `set-client-secret.sh` (realms que ya existen, ver [Cambios del realm en entornos existentes](#cambios-del-realm-en-entornos-existentes)). Queda versionado, revisado en un PR y aplicado igual en todos los entornos.
2. **Desde la aplicación.** Usuarios, roles, contraseñas, sesiones y establecimientos se manejan desde Admin → Usuarios y desde Plataforma.
3. **Con `kcadm.sh` o la Admin REST API.** Para una consulta o un cambio puntual, con el administrador de `master`. Desde el contenedor del servicio (las variables del administrador ya están cargadas):

   ```bash
   /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 \
     --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"
   /opt/keycloak/bin/kcadm.sh get realms/bistrolink --fields ssoSessionIdleTimeout
   ```

   O desde una máquina del equipo, con la imagen de Keycloak, contra el dominio público del servicio (`--server https://…` y la contraseña cuando la pide). Si el cambio tiene que quedar, pasarlo después al punto 1.

4. **Encender la consola por un rato.** Para algo que solo se entiende mirando la pantalla: quitar `KC_FEATURES_DISABLED` del servicio, esperar el deploy, hacer la consulta o el cambio, volver a agregar la variable y esperar el deploy. Registrar la ventana (fecha, quién y para qué) en el registro de cambios del equipo.

## Tema de login (`themes/bistrolink/login`)

- `template.ftl` es una copia del de Keycloak 26.7.2 (`theme/base/login/template.ftl`), con los cambios propios marcados con comentarios: panel de marca, `<main>` para el formulario y un script de accesibilidad.
- **Al actualizar Keycloak** (`Dockerfile.auth`), comparar este archivo con el `template.ftl` de la versión nueva y pasar los cambios de Keycloak a la copia. Si no, el login puede perder arreglos o romperse.
- Los textos están en `messages/messages_es.properties`. Solo están las claves que cambian; el resto sale del español de Keycloak.
- La tipografía está en `resources/fonts` (la misma que usa la app, con licencia OFL). El tema no hace pedidos a dominios externos.
- **Caché del CSS en staging y producción.** Keycloak le dice al navegador que guarde los archivos del tema por 30 días, con una URL que solo cambia al cambiar la versión de Keycloak. Por eso `Dockerfile.auth` renombra `styles.css` a `styles.<hash>.css` (y ajusta `theme.properties`) al construir la imagen: cada cambio del CSS llega con una URL nueva. En el repo y en local el archivo sigue llamándose `styles.css`. La tipografía no se renombra: si se cambia el `.woff2`, cambiarle también el nombre.
