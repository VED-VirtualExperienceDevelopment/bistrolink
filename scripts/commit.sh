#!/bin/bash

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

SEPARATOR="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "${BOLD}  BistroLink — Asistente de commits${RESET}"
echo -e "${BOLD}${SEPARATOR}${RESET}"

# ── 1. Git status ─────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Estado actual del repositorio:${RESET}"
echo ""
git status
echo ""
echo -e "${SEPARATOR}"

read -rp "¿Continuar con el commit? [S/n]: " CONFIRM_STATUS
CONFIRM_STATUS="${CONFIRM_STATUS:-S}"
if [[ ! "$CONFIRM_STATUS" =~ ^[Ss]$ ]]; then
  echo -e "${YELLOW}Abortado.${RESET}"
  exit 0
fi

# ── 2. Verificar rama base ────────────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "develop" ]]; then
  echo ""
  echo -e "${RED}Error: debés estar en 'develop' para crear un commit.${RESET}"
  echo -e "  Rama actual: ${YELLOW}${CURRENT_BRANCH}${RESET}"
  echo -e "  Ejecutá:     ${CYAN}git checkout develop${RESET}"
  echo ""
  exit 1
fi
echo -e "${GREEN}✔ Rama base: develop${RESET}"

# ── 3. Pull con stash automático ──────────────────────────────────────────────
echo ""
echo -e "🔄 Actualizando develop desde origin..."

STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${YELLOW}  Hay cambios locales — guardando con stash...${RESET}"
  git stash push -u -m "bistrolink-commit-script-stash"
  STASHED=true
fi

if ! git pull origin develop --rebase; then
  echo -e "${RED}Error al hacer pull de develop. Resolvé los conflictos y volvé a intentar.${RESET}"
  [[ "$STASHED" == true ]] && git stash pop
  exit 1
fi

if [[ "$STASHED" == true ]]; then
  echo -e "${YELLOW}  Restaurando cambios locales...${RESET}"
  git stash pop
fi

echo -e "${GREEN}✔ develop actualizado.${RESET}"

# ── 4. Tipo de cambio ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}1. Tipo de cambio:${RESET}"
echo "   1. feat     — Nueva funcionalidad"
echo "   2. fix      — Corrección de bug"
echo "   3. chore    — Dependencias/configuración"
echo "   4. ci       — Pipeline/scripts CI"
echo "   5. docs     — Documentación"
echo "   6. test     — Pruebas"
echo "   7. refactor — Refactorización"
echo "   8. perf     — Rendimiento"
echo "   9. revert   — Revertir commit"
echo ""

while true; do
  read -rp "   Seleccionar [1-9]: " TYPE_NUM
  case "$TYPE_NUM" in
    1) TYPE="feat"     ; break ;;
    2) TYPE="fix"      ; break ;;
    3) TYPE="chore"    ; break ;;
    4) TYPE="ci"       ; break ;;
    5) TYPE="docs"     ; break ;;
    6) TYPE="test"     ; break ;;
    7) TYPE="refactor" ; break ;;
    8) TYPE="perf"     ; break ;;
    9) TYPE="revert"   ; break ;;
    *) echo -e "   ${RED}Opción inválida. Ingresá un número del 1 al 9.${RESET}" ;;
  esac
done

# ── 5. ID de Linear ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}2. ID de tarea en Linear (BL-NNN):${RESET}"
while true; do
  read -rp "   ID: " LINEAR_ID
  LINEAR_ID=$(echo "$LINEAR_ID" | tr -d '\r' | tr '[:lower:]' '[:upper:]')
  if echo "$LINEAR_ID" | grep -qE "^BL-[0-9]+$"; then
    break
  else
    echo -e "   ${RED}Formato inválido. Usá BL-NNN (ej: BL-042).${RESET}"
  fi
done

# ── 6. Descripción ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}3. Descripción en minúsculas (máx. 72 chars):${RESET}"
while true; do
  read -rp "   > " DESCRIPTION
  DESCRIPTION=$(echo "$DESCRIPTION" | tr -d '\r')
  if [[ -z "$DESCRIPTION" ]]; then
    echo -e "   ${RED}La descripción no puede estar vacía.${RESET}"
  elif [[ ${#DESCRIPTION} -gt 72 ]]; then
    echo -e "   ${RED}Demasiado largo (${#DESCRIPTION} chars). Máximo 72.${RESET}"
  else
    break
  fi
done

# ── 7. Construir nombres ──────────────────────────────────────────────────────
COMMIT_MSG="${TYPE}(${LINEAR_ID}): ${DESCRIPTION}"
SLUG=$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
BRANCH_NAME="${TYPE}/${LINEAR_ID}-${SLUG}"

# ── 8. Resumen ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "  Commit : ${GREEN}${COMMIT_MSG}${RESET}"
echo -e "  Rama   : ${CYAN}${BRANCH_NAME}${RESET}"
echo ""
echo "  Archivos a commitear:"
git diff --cached --name-only | sed 's/^/    /'
if ! git diff --cached --name-only | grep -q .; then
  echo -e "    ${YELLOW}(ninguno en staging — se hará git add -A)${RESET}"
fi
echo -e "${BOLD}${SEPARATOR}${RESET}"

read -rp "¿Confirmar commit y push? [S/n]: " CONFIRM
CONFIRM="${CONFIRM:-S}"
if [[ ! "$CONFIRM" =~ ^[Ss]$ ]]; then
  echo -e "${YELLOW}Abortado.${RESET}"
  exit 0
fi

# ── 9. Crear rama y checkout ──────────────────────────────────────────────────
echo ""
echo -e "🌿 Creando rama ${CYAN}${BRANCH_NAME}${RESET}..."
if ! git checkout -b "$BRANCH_NAME" 2>/dev/null; then
  echo -e "${RED}Error al crear la rama. ¿Ya existe?${RESET}"
  exit 1
fi

# ── 10. Stage y commit ────────────────────────────────────────────────────────
if ! git diff --cached --name-only | grep -q .; then
  git add -A
fi

if ! git commit -m "$COMMIT_MSG"; then
  echo -e "${RED}Error en el commit. Revisá el hook.${RESET}"
  exit 1
fi

# ── 11. Push ──────────────────────────────────────────────────────────────────
echo ""
echo -e "🚀 Pusheando ${CYAN}${BRANCH_NAME}${RESET} a origin..."
if git push -u origin "$BRANCH_NAME"; then
  echo ""
  echo -e "${GREEN}✅ Commit creado y rama pusheada.${RESET}"
  echo -e "${GREEN}   Linear actualizará ${LINEAR_ID} automáticamente.${RESET}"
  echo ""
  echo -e "   Abrí el PR en GitHub:"
  echo -e "   ${CYAN}https://github.com/VED-VirtualExperienceDevelopment/bistrolink/compare/${BRANCH_NAME}?expand=1${RESET}"
  echo ""
else
  echo -e "${RED}Error al pushear. Revisá tu conexión o permisos.${RESET}"
  exit 1
fi
