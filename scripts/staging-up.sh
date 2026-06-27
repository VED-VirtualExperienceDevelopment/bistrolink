#!/bin/bash

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"
SEPARATOR="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SERVICES_INFRA=("bistrolink-db" "bistrolink-auth")
SERVICES_APP=("bistrolink-api" "bistrolink-web")
ENVIRONMENT="staging"

echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "${BOLD}  BistroLink — Scale Up Staging${RESET}"
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo ""
echo -e "${CYAN}Esto encenderá todos los servicios de staging.${RESET}"
echo ""
read -rp "¿Continuar? [S/n]: " CONFIRM
CONFIRM="${CONFIRM:-S}"
if [[ ! "$CONFIRM" =~ ^[Ss]$ ]]; then
  echo -e "${YELLOW}Abortado.${RESET}"
  exit 0
fi

echo ""

# ── 1. Encender infraestructura primero ───────────────────────────────────────
echo -e "${BOLD}1. Levantando infraestructura...${RESET}"
for SERVICE in "${SERVICES_INFRA[@]}"; do
  echo -e "🔼 Encendiendo ${CYAN}${SERVICE}${RESET}..."
  if railway scale --service "$SERVICE" --environment "$ENVIRONMENT" --replicas 1 2>/dev/null; then
    echo -e "${GREEN}✔ ${SERVICE} encendido.${RESET}"
  else
    echo -e "${RED}✘ Error al encender ${SERVICE}.${RESET}"
  fi
done

# ── 2. Esperar a que DB y Auth estén listos ───────────────────────────────────
echo ""
echo -e "${YELLOW}⏳ Esperando 20s para que la DB y Keycloak inicialicen...${RESET}"
sleep 20

# ── 3. Encender servicios de app ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}2. Levantando servicios de app...${RESET}"
for SERVICE in "${SERVICES_APP[@]}"; do
  echo -e "🔼 Encendiendo ${CYAN}${SERVICE}${RESET}..."
  if railway scale --service "$SERVICE" --environment "$ENVIRONMENT" --replicas 1 2>/dev/null; then
    echo -e "${GREEN}✔ ${SERVICE} encendido.${RESET}"
  else
    echo -e "${RED}✘ Error al encender ${SERVICE}.${RESET}"
  fi
done

# ── 4. Health check ───────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}⏳ Esperando 30s para el health check...${RESET}"
sleep 30

echo ""
echo -e "${BOLD}3. Verificando salud de la API...${RESET}"
if curl -sf https://bistrolink-api-staging.up.railway.app/health > /dev/null; then
  echo -e "${GREEN}✔ API respondiendo correctamente.${RESET}"
else
  echo -e "${RED}✘ La API no responde. Puede estar tardando más en inicializar.${RESET}"
  echo -e "   Verificá manualmente: ${CYAN}https://bistrolink-api-staging.up.railway.app/health${RESET}"
fi

echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "${GREEN}✅ Staging encendido y listo.${RESET}"
echo -e ""
echo -e "   API:  ${CYAN}https://bistrolink-api-staging.up.railway.app${RESET}"
echo -e "   Web:  ${CYAN}https://bistrolink-web-staging.up.railway.app${RESET}"
echo -e "   Auth: ${CYAN}https://bistrolink-auth-staging.up.railway.app${RESET}"
echo ""
echo -e "${YELLOW}  Acordate de apagar cuando termines: ${BOLD}npm run staging:down${RESET}"
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo ""