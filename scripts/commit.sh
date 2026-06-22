#!/bin/bash
# scripts/commit.sh — Asistente interactivo de commits BistroLink
# Uso: bash scripts/commit.sh   |   npm run commit
set -e
BLUE='\033[0;34m' ; GREEN='\033[0;32m' ; RED='\033[0;31m' ; YELLOW='\033[1;33m' ; NC='\033[0m'
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  BistroLink — Asistente de commits${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" && echo ""
git diff --cached --quiet && echo -e "${RED}No hay archivos en staging.${NC}" && exit 1


# Paso 1: tipo
TYPES=("feat" "fix" "chore" "ci" "docs" "test" "refactor" "perf" "revert")
declare -A TYPE_DESC=(["feat"]="Nueva funcionalidad" ["fix"]="Corrección de bug"
  ["chore"]="Dependencias/configuración" ["ci"]="Pipeline/scripts CI"
  ["docs"]="Documentación" ["test"]="Pruebas" ["refactor"]="Refactorización"
  ["perf"]="Rendimiento" ["revert"]="Revertir commit")
echo -e "${YELLOW}1. Tipo de cambio:${NC}"
for i in "${!TYPES[@]}"; do
  echo -e "   $((i+1)). ${GREEN}${TYPES[$i]}${NC} — ${TYPE_DESC[${TYPES[$i]}]}"
done && echo ""
read -p "   Seleccionar [1-${#TYPES[@]}]: " TYPE_NUM
TYPE="${TYPES[$((TYPE_NUM-1))]}"


# Paso 2: Linear ID
echo "" && echo -e "${YELLOW}2. ID de tarea en Linear (BL-NNN):${NC}"
read -p "   ID: " LINEAR_ID
echo "$LINEAR_ID" | grep -qE "^BL-[0-9]+$" || (echo -e "${RED}Inválido. Debe ser BL-NNN.${NC}" && exit 1)


# Paso 3: descripción
echo "" && echo -e "${YELLOW}3. Descripción en minúsculas (máx. 72 chars):${NC}"
read -p "   > " DESC
[ -z "$DESC" ] && echo -e "${RED}Descripción vacía.${NC}" && exit 1
FULL_MSG="${TYPE}(${LINEAR_ID}): ${DESC}"


# Previsualización y confirmación
echo "" && echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Commit: ${GREEN}${FULL_MSG}${NC}"
echo "" && echo "Archivos:" && git diff --cached --name-only | sed 's/^/  /'
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" && echo ""
read -p "¿Confirmar commit? [S/n]: " CONFIRM
[ "$CONFIRM" = "n" ] && echo "Cancelado." && exit 0
git commit -m "$FULL_MSG"
echo -e "${GREEN}✅ Commit creado. Linear actualizará ${LINEAR_ID} automáticamente.${NC}"
