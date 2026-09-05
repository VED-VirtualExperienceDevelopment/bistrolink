# Keycloak — realm BistroLink

Notas de diseño de `realm-export.json` que no entran en el campo `description`
de Keycloak (columna `CLIENT_SCOPE.DESCRIPTION`, `VARCHAR(255)` — un texto
más largo rompe el `--import-realm` con `Value too long for column`, ver
BL-044). Las descripciones dentro del JSON quedan cortas a propósito y
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

## Regla general para nuevos clientScopes

Si necesitás agregar contexto largo sobre un `clientScope`, `client` o
`protocolMapper` nuevo: el campo `description` del JSON debe quedar corto
(idealmente <120 caracteres) y el detalle va en este archivo, con un ancla
`#client-scope-<nombre>` para poder referenciarlo desde el JSON. Nunca
asumas que la columna de Keycloak tiene espacio de sobra — el límite real es
255 caracteres y no hay validación en build time que lo avise; se descubre
recién en runtime, al importar, y tira todo el contenedor en crash loop.