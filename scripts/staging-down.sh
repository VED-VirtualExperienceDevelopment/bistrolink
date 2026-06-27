#!/bin/bash

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"
SEPARATOR="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SERVICES=("bistrolink-api" "bistrolink-web" "bistrolink-db" "bistrolink-auth")
ENVIRONMENT="staging"

echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "${BOLD}  BistroLink — Scale Down Staging${RESET}"
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo ""
echo -e "${YELLOW}⚠ Esto apagará todos los servicios de staging.${RESET}"
echo -e "${YELLOW}  Los datos en la DB se conservan.${RESET}"
echo ""
read -rp "¿Continuar? [S/n]: " CONFIRM
CONFIRM="${CONFIRM:-S}"
if [[ ! "$CONFIRM" =~ ^[Ss]$ ]]; then
  echo -e "${YELLOW}Abortado.${RESET}"
  exit 0
fi

echo ""

for SERVICE in "${SERVICES[@]}"; do
  echo -e "🔽 Bajando ${CYAN}${SERVICE}${RESET}..."
if railway service scale --service "$SERVICE" --environment "$ENVIRONMENT" us-west=0 ; then
    echo -e "${GREEN}✔ ${SERVICE} apagado.${RESET}"
  else
    echo -e "${RED}✘ Error al apagar ${SERVICE}. Verificá el nombre o el token.${RESET}"
  fi
done

echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "${GREEN}✅ Staging apagado. Para encenderlo: npm run staging:up${RESET}"
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo ""