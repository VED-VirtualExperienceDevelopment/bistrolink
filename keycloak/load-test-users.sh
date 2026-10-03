#!/bin/bash
set -eu

# BL-264 (BL-262 · R2): carga los usuarios de prueba en el realm "bistrolink".
#
# Por qué existe: antes los usuarios de prueba vivían dentro de
# realm-export.json y Dockerfile.auth les escribía las contraseñas en el build
# (envsubst con los secrets TEST_*). La misma imagen se usa en staging y en
# producción, así que producción nacía con usuarios y contraseñas de test, y
# esas contraseñas quedaban dentro de una capa de la imagen publicada en GHCR.
#
# Ahora realm-export.json tiene solo la configuración del realm, y este script
# agrega los usuarios de prueba en tiempo de ejecución, SOLO si el entorno lo
# pide con KC_LOAD_TEST_USERS=true (local y staging; nunca en producción).
# Las contraseñas llegan por variables de entorno y nunca se escriben en un
# archivo.
#
# Cómo funciona:
#   1. Usa la sesión de kcadm que ya abrió set-client-secret.sh (admin del
#      realm master). Este script lo llama set-client-secret.sh, no se usa solo.
#   2. Reemplaza los ${TEST_*_USERNAME} de test-users.json con los valores del
#      entorno (solo los usernames; el archivo no tiene contraseñas).
#   3. Importa los usuarios con la Admin API "partialImport" y
#      ifResourceExists=SKIP: crea los que faltan con sus IDs fijos (los mismos
#      que usan seed.ts y los tests) y no toca los que ya existen.
#   4. Fija la contraseña solo de los usuarios que se acaban de crear. A los
#      existentes no se la vuelve a fijar en cada arranque, para no chocar con
#      la política de "no reutilizar contraseñas" (BL-266) ni pisar un cambio
#      manual. Para rotar una contraseña de prueba: cambiarla en la consola de
#      Keycloak y en el secret correspondiente.

KCADM="${KCADM:-/opt/keycloak/bin/kcadm.sh}"
KC_REALM="${KC_REALM:-bistrolink}"
USERS_FILE="${KC_TEST_USERS_FILE:-/opt/keycloak/data/test-users/test-users.json}"
TMP_FILE="${TMPDIR:-/tmp}/test-users.resuelto.json"

log() { echo "[load-test-users] $*"; }

# ID fijo de Keycloak -> variable con su contraseña. Los IDs son los de
# test-users.json (y los de seed.ts / los tests de integración).
USUARIOS=(
  "c832535d-6122-449d-8b21-2371d8b7d9d0:TEST_ADMIN_PASSWORD"
  "d1a2b3c4-5566-4778-8899-aabbccddeeff:TEST_COCINA_PASSWORD"
  "e2b3c4d5-6677-4889-99aa-bbccddeeff00:TEST_NO_TENANT_PASSWORD"
  "f3c4d5e6-7788-4990-aabb-ccddeeff0011:TEST_TENANT_B_PASSWORD"
  "f552ec55-a5b5-44c3-a400-72ffc746c9b6:TEST_MOZO_PASSWORD"
  "aeb7e03f-8364-58a1-b31d-9aaed44a32cf:KEYCLOAK_COMENSAL_PASSWORD"
)
USERNAME_VARS=(
  TEST_ADMIN_USERNAME TEST_COCINA_USERNAME TEST_NO_TENANT_USERNAME
  TEST_TENANT_B_USERNAME TEST_MOZO_USERNAME
)

if [ ! -f "$USERS_FILE" ]; then
  log "ERROR: no existe $USERS_FILE" >&2
  exit 1
fi

# 1. Qué usuarios faltan (a esos, y solo a esos, se les fija la contraseña).
#    Si ya están todos no hace falta ninguna variable: el arranque normal de
#    staging o de un Keycloak local ya cargado termina acá.
nuevos=()
for par in "${USUARIOS[@]}"; do
  id="${par%%:*}"
  if ! "$KCADM" get "users/$id" -r "$KC_REALM" --fields id >/dev/null 2>&1; then
    nuevos+=("$par")
  fi
done

if [ "${#nuevos[@]}" -eq 0 ]; then
  log "Los ${#USUARIOS[@]} usuarios de prueba ya existen; no hay nada que cargar."
  exit 0
fi

# 2. Variables necesarias: todos los usernames (el import parcial recibe el
#    archivo completo) y la contraseña de cada usuario nuevo. Si falta alguna
#    no se carga nada: mejor ningún usuario que usuarios sin contraseña.
faltan=()
for var in "${USERNAME_VARS[@]}"; do
  [ -n "${!var:-}" ] || faltan+=("$var")
done
for par in "${nuevos[@]}"; do
  var="${par#*:}"
  [ -n "${!var:-}" ] || faltan+=("$var")
done
if [ "${#faltan[@]}" -gt 0 ]; then
  log "ERROR: faltan variables: ${faltan[*]}. No se cargó ningún usuario de prueba." >&2
  exit 1
fi

# 3. Reemplazar los usernames y hacer el import parcial. Se hace con bash
#    puro porque la imagen de Keycloak (UBI micro) no trae envsubst ni sed.
json="$(<"$USERS_FILE")"
for var in "${USERNAME_VARS[@]}"; do
  json="${json//"\${$var}"/"${!var}"}"
done
printf '%s\n' "$json" > "$TMP_FILE"
trap 'rm -f "$TMP_FILE"' EXIT

log "Importando usuarios de prueba (${#nuevos[@]} nuevos, los existentes se saltean)..."
"$KCADM" create partialImport -r "$KC_REALM" -f "$TMP_FILE" >/dev/null

# 4. Contraseña solo para los recién creados.
#    BL-266: el realm tiene política de contraseñas (mínimo 9 caracteres,
#    distinta del usuario). Si una contraseña de prueba no la cumple,
#    Keycloak la rechaza: en ese caso se borra el usuario recién creado, así
#    no queda un usuario sin contraseña y el próximo arranque lo vuelve a
#    intentar (con la variable ya corregida).
fallidos=()
for par in "${nuevos[@]}"; do
  id="${par%%:*}"
  var="${par#*:}"
  if "$KCADM" set-password -r "$KC_REALM" --userid "$id" --new-password "${!var}"; then
    log "Usuario $id creado, contraseña tomada de $var."
  else
    log "ERROR: Keycloak rechazó la contraseña de $var (¿no cumple la política del realm?). Se borra el usuario $id para reintentar en el próximo arranque." >&2
    "$KCADM" delete "users/$id" -r "$KC_REALM" || true
    fallidos+=("$var")
  fi
done

if [ "${#fallidos[@]}" -gt 0 ]; then
  log "ERROR: usuarios sin crear por contraseña inválida: ${fallidos[*]}." >&2
  exit 1
fi

log "Listo."
