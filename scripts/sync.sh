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
echo -e "${BOLD}  BistroLink — Sync post-merge${RESET}"
echo -e "${BOLD}${SEPARATOR}${RESET}"

# ── 1. SSH en WSL (Windows) ───────────────────────────────────────────────────
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

# ── 2. Detectar rama actual ───────────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT_BRANCH" != "develop" ]]; then
  echo ""
  echo -e "${YELLOW}Rama actual: ${BOLD}${CURRENT_BRANCH}${RESET}"
  echo -e "  Cambiando a develop..."
  if ! git checkout develop; then
    echo -e "${RED}Error al cambiar a develop. Puede haber cambios sin commitear.${RESET}"
    exit 1
  fi
fi

# ── 3. Pull develop ───────────────────────────────────────────────────────────
echo ""
echo -e "🔄 Actualizando develop desde origin..."
if ! git pull origin develop; then
  echo -e "${RED}Error al hacer pull. Resolvé los conflictos y volvé a intentar.${RESET}"
  exit 1
fi

# ── 4. Limpiar rama mergeada ──────────────────────────────────────────────────
if [[ "$CURRENT_BRANCH" != "develop" ]]; then
  echo ""
  echo -e "${YELLOW}¿Eliminar la rama local '${CURRENT_BRANCH}' ya mergeada? [S/n]: ${RESET}"
  read -rp "" DELETE_BRANCH
  DELETE_BRANCH="${DELETE_BRANCH:-S}"
  if [[ "$DELETE_BRANCH" =~ ^[Ss]$ ]]; then
    if git branch -d "$CURRENT_BRANCH" 2>/dev/null; then
      echo -e "${GREEN}✔ Rama '${CURRENT_BRANCH}' eliminada localmente.${RESET}"
    else
      echo -e "${YELLOW}⚠ No se pudo eliminar '${CURRENT_BRANCH}' — puede tener commits sin mergear.${RESET}"
      echo -e "  Para forzar: ${CYAN}git branch -D ${CURRENT_BRANCH}${RESET}"
    fi
  fi
fi

# ── 5. Limpiar ramas remotas eliminadas ───────────────────────────────────────
echo ""
echo -e "🧹 Limpiando referencias a ramas remotas eliminadas..."
git fetch --prune origin
echo -e "${GREEN}✔ Referencias limpiadas.${RESET}"

# ── 6. Resumen ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo -e "${GREEN}✅ develop actualizado y listo para el próximo commit.${RESET}"
echo ""
git log --oneline -5
echo -e "${BOLD}${SEPARATOR}${RESET}"
echo ""
