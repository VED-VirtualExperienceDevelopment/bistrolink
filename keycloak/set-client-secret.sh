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
fi

# 3. El proceso de Keycloak sigue siendo el que manda: si termina (o lo
#    matan), el contenedor entero termina con su mismo código de salida.
wait "$KC_PID"