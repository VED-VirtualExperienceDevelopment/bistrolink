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

# ── 2. SSH en WSL (Windows) ───────────────────────────────────────────────────
if grep -qi microsoft /proc/version 2>/dev/null; then
  WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
  WIN_SSH="/mnt/c/Users/${WIN_USER}/.ssh"
  if [[ -f "${WIN_SSH}/id_ed25519" && ! -f "${HOME}/.ssh/id_ed25519" ]]; then
    mkdir -p ~/.ssh
    cp "${WIN_SSH}/id_ed25519" ~/.ssh/
    cp "${WIN_SSH}/id_ed25519.pub" ~/.ssh/
    chmod 600 ~/.ssh/id_ed25519
    chmod 644 ~/.ssh/id_ed25519.pub
    echo -e "${GREEN}✔ Clave SSH copiada desde Windows.${RESET}"
  fi
fi

# ── 3. Detectar contexto de rama ──────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
IS_FEATURE_BRANCH=false
FEATURE_LINEAR_ID=""
FEATURE_TYPE=""

if [[ "$CURRENT_BRANCH" =~ ^(feat|fix|chore|ci|docs|test|refactor|perf|revert)/(BL-[0-9]+)-.+$ ]]; then
  IS_FEATURE_BRANCH=true
  FEATURE_TYPE="${BASH_REMATCH[1]}"
  FEATURE_LINEAR_ID="${BASH_REMATCH[2]}"
fi

if [[ "$IS_FEATURE_BRANCH" == true ]]; then
  echo ""
  echo -e "${CYAN}Rama de feature detectada: ${BOLD}${CURRENT_BRANCH}${RESET}"
  echo ""
  echo -e "  1. Agregar commit a esta rama ${GREEN}(${CURRENT_BRANCH})${RESET}"
  echo -e "  2. Volver a develop y crear rama nueva"
  echo ""
  read -rp "  Seleccionar [1/2]: " BRANCH_MODE
  BRANCH_MODE="${BRANCH_MODE:-1}"
  if [[ "$BRANCH_MODE" == "2" ]]; then
    git checkout develop
    IS_FEATURE_BRANCH=false
    CURRENT_BRANCH="develop"
  fi
elif [[ "$CURRENT_BRANCH" != "develop" ]]; then
  echo ""
  echo -e "${RED}Error: debés estar en 'develop' o en una rama de feature para commitear.${RESET}"
  echo -e "  Rama actual: ${YELLOW}${CURRENT_BRANCH}${RESET}"
  echo -e "  Ejecutá:     ${CYAN}git checkout develop${RESET}"
  echo ""
  exit 1
fi

# ── 4. Pull y sync ────────────────────────────────────────────────────────────
echo ""

STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${YELLOW}  Hay cambios locales — guardando con stash...${RESET}"
  git stash push -u -m "bistrolink-commit-script-stash"
  STASHED=true
fi

if [[ "$IS_FEATURE_BRANCH" == true ]]; then
  # Verificar si la rama feature está desactualizada respecto a develop
  git fetch origin develop --quiet
  BEHIND=$(git rev-list --count HEAD..origin/develop 2>/dev/null || echo 0)
  if [[ "$BEHIND" -gt 0 ]]; then
    echo -e "${YELLOW}⚠ Tu rama está $BEHIND commit(s) detrás de develop.${RESET}"
    read -rp "  ¿Hacer rebase con develop antes de continuar? [S/n]: " DO_REBASE
    DO_REBASE="${DO_REBASE:-S}"
    if [[ "$DO_REBASE" =~ ^[Ss]$ ]]; then
      if ! git rebase origin/develop; then
        echo -e "${RED}Error en el rebase. Resolvé los conflictos y volvé a intentar.${RESET}"
        [[ "$STASHED" == true ]] && git stash pop
        exit 1
      fi
      echo -e "${GREEN}✔ Rebase completado.${RESET}"
    fi
  else
    echo -e "${GREEN}✔ Rama actualizada respecto a develop.${RESET}"
  fi
else
  echo -e "🔄 Actualizando develop desde origin..."
  if ! git pull origin develop --rebase; then
    echo -e "${RED}Error al hacer pull de develop. Resolvé los conflictos y volvé a intentar.${RESET}"
    [[ "$STASHED" == true ]] && git stash pop
    exit 1
  fi
  echo -e "${GREEN}✔ develop actualizado.${RESET}"
fi

if [[ "$STASHED" == true ]]; then
  echo -e "${YELLOW}  Restaurando cambios locales...${RESET}"
  git stash pop
fi

# ── 5. Tipo de cambio ─────────────────────────────────────────────────────────
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

if [[ "$IS_FEATURE_BRANCH" == true ]]; then
  echo -e "   ${CYAN}(rama actual: ${FEATURE_TYPE} — Enter para mantener)${RESET}"
fi

while true; do
  read -rp "   Seleccionar [1-9]: " TYPE_NUM
  if [[ -z "$TYPE_NUM" && "$IS_FEATURE_BRANCH" == true ]]; then
    TYPE="$FEATURE_TYPE"
    break
  fi
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

# ── 6. ID de Linear ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}2. ID de tarea en Linear (BL-NNN):${RESET}"

if [[ "$IS_FEATURE_BRANCH" == true ]]; then
  echo -e "   ${CYAN}(rama actual: ${FEATURE_LINEAR_ID} — Enter para mantener)${RESET}"
fi

while true; do
  read -rp "   ID: " LINEAR_ID
  if [[ -z "$LINEAR_ID" && "$IS_FEATURE_BRANCH" == true ]]; then
    LINEAR_ID="$FEATURE_LINEAR_ID"
    break
  fi
  LINEAR_ID=$(echo "$LINEAR_ID" | tr -d '\r' | tr '[:lower:]' '[:upper:]')
  if echo "$LINEAR_ID" | grep -qE "^BL-[0-9]+$"; then
    break
  else
    echo -e "   ${RED}Formato inválido. Usá BL-NNN (ej: BL-042).${RESET}"
  fi
done

# ── 7. Descripción ────────────────────────────────────────────────────────────
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

# ── 8. Construir nombres ──────────────────────────────────────────────────────
COMMIT_MSG="${TYPE}(${LINEAR_ID}): ${DESCRIPTION}"
SLUG=$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
BRANCH_NAME="${TYPE}/${LINEAR_ID}-${SLUG}"

# ── 9. Resumen ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "  Commit : ${GREEN}${COMMIT_MSG}${RESET}"
if [[ "$IS_FEATURE_BRANCH" == true ]]; then
  echo -e "  Rama   : ${CYAN}${CURRENT_BRANCH}${RESET} ${YELLOW}(existente)${RESET}"
else
  echo -e "  Rama   : ${CYAN}${BRANCH_NAME}${RESET} ${YELLOW}(nueva)${RESET}"
fi
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

# ── 10. Crear rama si es nueva, o verificar si ya existe ─────────────────────
if [[ "$IS_FEATURE_BRANCH" == false ]]; then
  echo ""
  # Verificar si la rama ya existe localmente
  if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
    echo -e "${YELLOW}⚠ La rama '${BRANCH_NAME}' ya existe localmente.${RESET}"
    read -rp "  ¿Hacer checkout y continuar en esa rama? [S/n]: " USE_EXISTING
    USE_EXISTING="${USE_EXISTING:-S}"
    if [[ "$USE_EXISTING" =~ ^[Ss]$ ]]; then
      git checkout "$BRANCH_NAME"
    else
      echo -e "${YELLOW}Abortado.${RESET}"
      exit 0
    fi
  else
    echo -e "🌿 Creando rama ${CYAN}${BRANCH_NAME}${RESET}..."
    git checkout -b "$BRANCH_NAME"
  fi
fi

# ── 11. Stage y commit ────────────────────────────────────────────────────────
if ! git diff --cached --name-only | grep -q .; then
  git add -A
fi

if ! git commit -m "$COMMIT_MSG"; then
  echo -e "${RED}Error en el commit. Revisá el hook.${RESET}"
  exit 1
fi

# ── 12. Push ──────────────────────────────────────────────────────────────────
TARGET_BRANCH="${IS_FEATURE_BRANCH:+$CURRENT_BRANCH}"
TARGET_BRANCH="${TARGET_BRANCH:-$BRANCH_NAME}"

echo ""
echo -e "🚀 Pusheando ${CYAN}${TARGET_BRANCH}${RESET} a origin..."
if git push -u origin "$TARGET_BRANCH"; then
  echo ""
  echo -e "${GREEN}✅ Commit creado y rama pusheada.${RESET}"
  echo -e "${GREEN}   Linear actualizará ${LINEAR_ID} automáticamente.${RESET}"
  echo ""
  echo -e "   Abrí el PR en GitHub:"
  echo -e "   ${CYAN}https://github.com/VED-VirtualExperienceDevelopment/bistrolink/compare/${TARGET_BRANCH}?expand=1${RESET}"
  echo ""
else
  echo -e "${RED}Error al pushear. Revisá tu conexión o permisos.${RESET}"
  exit 1
fi
