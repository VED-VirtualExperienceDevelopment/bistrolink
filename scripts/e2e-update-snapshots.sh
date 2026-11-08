#!/bin/bash
set -euo pipefail

BOLD="\033[1m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

# BL-181: los baselines de regresión visual (e2e/comensal/menu-publico.spec.ts)
# SIEMPRE se regeneran acá adentro — nunca corriendo Playwright a mano en la
# laptop de cada dev. El nombre de archivo que genera Playwright incluye la
# plataforma (ej. "menu-qr-chromium-darwin.png" vs "...-linux.png"), y el job
# de CI corre en ubuntu-latest — un baseline de macOS o Windows nunca va a
# matchear ahí por diferencias de fuentes/antialiasing, no por bugs reales.
#
# La versión de la imagen está pineada a la de @playwright/test en
# package.json — si se actualiza una, hay que actualizar la otra. Ojo:
# package.json declara "^1.47.0" (rango caret), así que "npm install" puede
# resolver una versión más nueva sin que nadie la vea acá — si este script
# tira "Please update docker image as well", correr
# "npx playwright --version" y actualizar este tag para que coincida
# (o fijar @playwright/test a una versión exacta en package.json).
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.63.0-jammy"

# Por default apunta al staging ya desplegado (mismo BASE_URL que usará el
# job de CI de JOB 10 en ci.yml) — así el contenedor sale a internet como
# cualquier otro, sin depender de la red del host. Para apuntar a un backend
# local en cambio (localhost:3000/3001, con datos del seed cargados), pasá
# BASE_URL/API_URL explícitos al invocar el script.
BASE_URL="${BASE_URL:-https://bistrolink-web-staging.up.railway.app}"
API_URL="${API_URL:-https://bistrolink-api-staging.up.railway.app}"

echo -e "${BOLD}Regenerando baselines de regresión visual (${PLAYWRIGHT_IMAGE})${RESET}"
echo "BASE_URL=${BASE_URL}"
echo "API_URL=${API_URL}"
echo ""

if ! command -v docker &> /dev/null; then
  echo -e "${RED}Docker no está instalado o no está en PATH.${RESET}"
  exit 1
fi

# --network host solo hace falta para alcanzar un BASE_URL en localhost del
# host (típico en Linux; en macOS/Windows con Docker Desktop ese flag no
# funciona igual — ahí conviene WSL2, o apuntar a staging como hace el
# default de arriba). Contra una URL remota (staging/producción) el
# contenedor sale a internet normalmente y el flag no aplica ni hace falta.
NETWORK_ARGS=()
if [[ "${BASE_URL}" == *"localhost"* || "${BASE_URL}" == *"127.0.0.1"* ]]; then
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo -e "${YELLOW}Advertencia: --network host solo funciona confiablemente en Linux.${RESET}"
    echo -e "${YELLOW}En macOS/Windows, corré esto en WSL2, o pasá un BASE_URL remoto (staging).${RESET}"
    echo ""
  fi
  NETWORK_ARGS=(--network host)
fi

# MSYS_NO_PATHCONV: en Git Bash (Windows) cualquier argumento que empiece
# con "/" se reescribe automáticamente como un path de Windows antes de
# llegar a Docker — eso corrompe el "-v .../work" y el "-w /work" de abajo
# (típicamente se manifiesta como un críptico "unable to upgrade to tcp,
# received 404" en vez de un error de mount claro). No tiene efecto en
# Linux/macOS, donde esta variable no existe.
MSYS_NO_PATHCONV=1 docker run --rm \
  "${NETWORK_ARGS[@]}" \
  -e BASE_URL="${BASE_URL}" \
  -e API_URL="${API_URL}" \
  -v "$(pwd)":/work \
  -w /work \
  "${PLAYWRIGHT_IMAGE}" \
  npx playwright test e2e/comensal/menu-publico.spec.ts --update-snapshots

echo ""
echo -e "${BOLD}Listo.${RESET} Revisá el diff de e2e/comensal/menu-publico.spec.ts-snapshots/ antes de commitear:"
echo "  git status e2e/comensal/menu-publico.spec.ts-snapshots/"