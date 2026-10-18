#!/bin/bash
set -eu

# BL-185 (rediseño): Keycloak NO soporta expresiones ${vault.x} para el
# "secret" de un client propio del realm — solo están soportadas en 3
# lugares: password SMTP, bind credential de LDAP, y el client secret de un
# Identity Provider EXTERNO (cuando Keycloak actúa de broker hacia otro
# IdP). Confirmado contra la doc oficial: https://www.keycloak.org/server/vault
# El intento anterior (guardar "${vault.keycloak_client_secret}" como
# "secret" de bistrolink-backend) NO se resolvía — Keycloak lo guardaba
# literal y ESE string terminaba siendo el secret real, rompiendo la
# autenticación del backend.
#
# Solución: realm-export.json ya NO declara "secret" para bistrolink-backend
# (Keycloak genera uno random al importar, porque es un client confidencial
# con serviceAccountsEnabled=true). Este script arranca Keycloak, espera a
# que esté listo, y pisa ese secret random con el valor real vía la Admin
# REST API (kcadm.sh) — mismo mecanismo que ya usaba
# keycloak/setup-service-account.sh para los roles del service account,
# pero corriendo automáticamente al arrancar el contenedor.
#
# El valor real nunca queda escrito en el realm-export.json ni en ninguna
# capa de la imagen — solo vive en la env var en tiempo de ejecución
# (KEYCLOAK_CLIENT_SECRET_RUNTIME en Railway, o KEYCLOAK_CLIENT_SECRET en
# local vía apps/backend/.env).

: "${KEYCLOAK_CLIENT_SECRET_RUNTIME:=${KEYCLOAK_CLIENT_SECRET:-}}"
if [ -z "$KEYCLOAK_CLIENT_SECRET_RUNTIME" ]; then
  echo "[set-client-secret] ERROR: falta KEYCLOAK_CLIENT_SECRET_RUNTIME (o KEYCLOAK_CLIENT_SECRET) en el entorno" >&2
  exit 1
fi

KC_REALM="${KC_REALM:-bistrolink}"
KC_BACKEND_CLIENT_ID="${KC_BACKEND_CLIENT_ID:-bistrolink-backend}"

# Admin para kcadm: prioriza KC_BOOTSTRAP_ADMIN_* (Railway/producción,
# reemplaza el legacy KEYCLOAK_ADMIN/KEYCLOAK_ADMIN_PASSWORD) y cae a
# KEYCLOAK_ADMIN/KEYCLOAK_ADMIN_PASSWORD si no está (local, admin/admin).
KC_ADMIN_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-${KEYCLOAK_ADMIN:-admin}}"
KC_ADMIN_PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KEYCLOAK_ADMIN_PASSWORD:-admin}}"

# 1. Arranca Keycloak en background. "$@" son los args reales que definía
#    CMD/command antes (start-dev --import-realm, o start --http-port=8080
#    --import-realm en Railway) — este script los recibe y se los pasa tal
#    cual a kc.sh, no hace falta tocarlos en docker-compose.yml ni en el
#    Dockerfile más allá de apuntar el ENTRYPOINT acá.
/opt/keycloak/bin/kc.sh "$@" &
KC_PID=$!

# Railway (y docker stop) mandan SIGTERM a este script, que es el PID 1 del
# contenedor; kc.sh corre como hijo y no lo recibe solo. El trap se lo
# reenvía, y el bloque 3 espera a que Keycloak termine de apagarse (BL-228).
trap 'kill -TERM "$KC_PID" 2>/dev/null || true' TERM INT

# 2. Espera a que el endpoint de salud (management port 9000) responda 200
#    en /health/ready — mismo mecanismo que ya usa el healthcheck de
#    docker-compose.yml (bash + /dev/tcp), sin depender de curl (la imagen
#    final de Keycloak es la variante "micro" de UBI, sin gestor de
#    paquetes ni curl instalado).
echo "[set-client-secret] Esperando a que Keycloak esté listo..."
ready=""
for i in $(seq 1 60); do
  if bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000 && printf "GET /health/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3 && read -r line <&3 && [[ "$line" == *200* ]]' 2>/dev/null; then
    ready="1"
    break
  fi
  # Si Keycloak ya murió, no tiene sentido seguir esperando.
  kill -0 "$KC_PID" 2>/dev/null || { echo "[set-client-secret] Keycloak terminó antes de arrancar, aborto." >&2; exit 1; }
  sleep 3
done

if [ -z "$ready" ]; then
  echo "[set-client-secret] Timeout (180s) esperando a Keycloak — sigo sin setear el secret. El client va a quedar con el secret random que generó el import." >&2
else
  echo "[set-client-secret] Keycloak listo. Seteando client secret real de ${KC_BACKEND_CLIENT_ID}..."

  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080 --realm master \
    --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASS"

  CLIENT_UUID=$(/opt/keycloak/bin/kcadm.sh get clients -r "$KC_REALM" -q "clientId=$KC_BACKEND_CLIENT_ID" --fields id --format csv --noquotes | tail -n1)

  if [ -z "$CLIENT_UUID" ]; then
    echo "[set-client-secret] No encontré el client '$KC_BACKEND_CLIENT_ID' en el realm '$KC_REALM' — ¿falló el import?" >&2
  else
    /opt/keycloak/bin/kcadm.sh update "clients/${CLIENT_UUID}" -r "$KC_REALM" -s "secret=${KEYCLOAK_CLIENT_SECRET_RUNTIME}"
    echo "[set-client-secret] Client secret actualizado correctamente."
  fi

  # BL-266: el personal no usa la consola de cuenta de Keycloak
  # (/realms/bistrolink/account), así que se sacan sus roles
  # (account/manage-account y account/view-profile) de los roles por defecto
  # del realm. Va acá y no en realm-export.json porque Keycloak los agrega
  # solo al crear el realm y el JSON no puede quitarlos; además así se aplica
  # también a los realms que ya existen (staging). Es idempotente y afecta a
  # todos los usuarios que heredan los roles por defecto.
  /opt/keycloak/bin/kcadm.sh remove-roles -r "$KC_REALM" \
      --rname "default-roles-${KC_REALM}" --cclientid account \
      --rolename manage-account --rolename view-profile \
    && echo "[set-client-secret] Roles de la consola de cuenta fuera de los roles por defecto." \
    || echo "[set-client-secret] AVISO: no se pudieron quitar los roles de cuenta de los roles por defecto." >&2

  # BL-345: cambios de realm-export.json que --import-realm no aplica a un
  # realm que ya existe (staging y producción). Mismo criterio que BL-266:
  # van acá para que lleguen solos a cada entorno con el deploy, sin pasos a
  # mano ni credenciales de admin fuera de Railway. Es idempotente: en cada
  # arranque deja el realm igual que el JSON en estos puntos, y no toca
  # usuarios, roles, tenant_id ni la configuración de seguridad.
  aplicar_cambios_realm() {
    local kcadm=/opt/keycloak/bin/kcadm.sh

    # 1. Español (BL-343)
    "$kcadm" update "realms/${KC_REALM}" \
      -s internationalizationEnabled=true \
      -s 'supportedLocales=["es"]' \
      -s defaultLocale=es || return 1

    # 2. Client scope "profile" (BL-344): nombre y usuario en el token.
    #    Keycloak 26 no lo crea al importar; se crea solo si no existe, con
    #    los mismos mappers que realm-export.json.
    #    Sin awk ni grep: la imagen de Keycloak (UBI micro) no los trae.
    buscar_scope_profile() {
      "$kcadm" get client-scopes -r "$KC_REALM" --fields id,name --format csv --noquotes \
        | while IFS=, read -r id nombre; do
            if [ "$nombre" = "profile" ]; then
              echo "$id"
              break
            fi
          done
    }
    local scope_id
    scope_id=$(buscar_scope_profile)
    if [ -z "$scope_id" ]; then
      "$kcadm" create client-scopes -r "$KC_REALM" -f - <<'JSON' || return 1
{
  "name": "profile",
  "description": "Nombre y usuario en el token. Detalle: keycloak/README.md#client-scope-profile",
  "protocol": "openid-connect",
  "attributes": {
    "include.in.token.scope": "true",
    "display.on.consent.screen": "true",
    "consent.screen.text": "${profileScopeConsentText}"
  },
  "protocolMappers": [
    {
      "name": "username",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "username",
        "claim.name": "preferred_username",
        "jsonType.label": "String",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "introspection.token.claim": "true"
      }
    },
    {
      "name": "given name",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "firstName",
        "claim.name": "given_name",
        "jsonType.label": "String",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "introspection.token.claim": "true"
      }
    },
    {
      "name": "family name",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "consentRequired": false,
      "config": {
        "user.attribute": "lastName",
        "claim.name": "family_name",
        "jsonType.label": "String",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "introspection.token.claim": "true"
      }
    },
    {
      "name": "full name",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-full-name-mapper",
      "consentRequired": false,
      "config": {
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "introspection.token.claim": "true"
      }
    }
  ]
}
JSON
      scope_id=$(buscar_scope_profile)
      echo "[set-client-secret] Client scope 'profile' creado."
    fi
    [ -n "$scope_id" ] || return 1

    # 3. "profile" como scope por defecto del realm y de los dos clientes
    #    (igual que defaultDefaultClientScopes y defaultClientScopes del JSON).
    #    Asignarlo de nuevo no cambia nada.
    "$kcadm" update "default-default-client-scopes/${scope_id}" -r "$KC_REALM" || return 1
    local client_id client_uuid
    for client_id in bistrolink-frontend bistrolink-backend; do
      client_uuid=$("$kcadm" get clients -r "$KC_REALM" -q "clientId=${client_id}" --fields id --format csv --noquotes | tail -n1)
      if [ -n "$client_uuid" ]; then
        "$kcadm" update "clients/${client_uuid}/default-client-scopes/${scope_id}" -r "$KC_REALM" || return 1
      fi
    done
  }

  aplicar_cambios_realm \
    && echo "[set-client-secret] Realm al día: español y scope 'profile' (BL-345)." \
    || echo "[set-client-secret] AVISO: no se pudieron aplicar los cambios del realm de BL-345." >&2

  # BL-264: usuarios de prueba, solo donde el entorno lo pide (local y
  # staging con KC_LOAD_TEST_USERS=true; nunca en producción). Reusa la
  # sesión de kcadm abierta arriba. Si falla, se avisa en el log pero
  # Keycloak sigue arriba: sin usuarios de prueba la app funciona igual.
  if [ "${KC_LOAD_TEST_USERS:-false}" = "true" ]; then
    /bin/bash /opt/keycloak/bin/load-test-users.sh \
      || echo "[set-client-secret] AVISO: no se pudieron cargar los usuarios de prueba (ver [load-test-users] arriba)." >&2
  else
    echo "[set-client-secret] KC_LOAD_TEST_USERS no está en true: no se cargan usuarios de prueba."
  fi
fi

# 3. El proceso de Keycloak sigue siendo el que manda: si termina (o lo
#    matan), el contenedor entero termina con su mismo código de salida.
#
#    BL-228: con SIGTERM, el trap se lo reenvía a Keycloak y "wait" vuelve
#    enseguida con 143. Antes, con "set -e", el script terminaba ahí, el
#    contenedor se cerraba y Keycloak moría con SIGKILL a mitad del apagado
#    (sesiones y conexiones a keycloak-db sin cerrar). Ahora se vuelve a
#    esperar hasta que el proceso de Keycloak termine de verdad.
#    El aviso "Keycloak is running inside a container, but is not PID 1"
#    sigue apareciendo (kc.sh no es el PID 1), pero el apagado ya es ordenado.
set +e
wait "$KC_PID"
status=$?
while kill -0 "$KC_PID" 2>/dev/null; do
  wait "$KC_PID"
  status=$?
done
exit "$status"
