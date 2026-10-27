#!/bin/bash
# ==============================================================================
# Rechnungs-Verwaltung (Rechnungs-LOG): Vollautomatisches Update aus GitHub
# Repository: https://github.com/kigg8230/Rechnungs-Verwaltung.git
# Aufruf auf dem Oracle-VPS: ./update-rechnungs-verwaltung.sh
# ==============================================================================
set -euo pipefail

APP_DIR="$HOME/rechnungs-verwaltung"
REPO_SLUG="kigg8230/Rechnungs-Verwaltung"

echo "=========================================================="
echo " Starte Update der Rechnungs-Verwaltung aus GitHub..."
echo " Datum: $(date)"
echo "=========================================================="

# Falls noch kein Git-Token in der Umgebung gesetzt ist, automatisch aus bestehenden
# Server-Skripten oder Git-Configs auf dem VPS ermitteln:
if [ -z "${GITHUB_TOKEN:-}" ]; then
    if [ -f "$HOME/create-praxis.sh" ]; then
        GITHUB_TOKEN=$(grep -oE 'ghp_[A-Za-z0-9]+' "$HOME/create-praxis.sh" | head -n 1 || true)
    fi
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
    EXISTING_CFG=$(ls "$HOME"/rechnungs-verwaltung/.git/config "$HOME"/praxen/*/custom_apps/klientenverwaltung/.git/config "$HOME"/homepage/.git/config 2>/dev/null | head -n 1 || true)
    if [ -n "$EXISTING_CFG" ]; then
        GITHUB_TOKEN=$(grep -oE 'ghp_[A-Za-z0-9]+' "$EXISTING_CFG" | head -n 1 || true)
    fi
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
    REMOTE_URL="https://kigg8230:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git"
else
    REMOTE_URL="https://github.com/${REPO_SLUG}.git"
fi

mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Automatische Sicherung der SQLite-Datenbank vor dem Update
if [ -f "$APP_DIR/data/rechnungs-log.db" ]; then
    mkdir -p "$APP_DIR/data/backups"
    BACKUP_FILE="$APP_DIR/data/backups/rechnungs-log_$(date +%Y%m%d_%H%M%S).db"
    cp "$APP_DIR/data/rechnungs-log.db" "$BACKUP_FILE"
    echo "--> Datenbank-Backup erstellt: $BACKUP_FILE"
fi

if [ ! -d ".git" ]; then
    echo "--> Initialisiere Git-Repository in $APP_DIR ..."
    git init
    git remote add origin "$REMOTE_URL"
    git fetch origin main
    git checkout -f -B main origin/main
else
    git remote set-url origin "$REMOTE_URL"
    echo "--> Hole aktuelle Änderungen von GitHub ($REPO_SLUG)..."
    git fetch origin main
    git checkout -f -B main origin/main
    git reset --hard origin/main
fi

chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

# Container mit neuem Stand neu bauen und starten (Daten in ./data bleiben erhalten!)
if [ -f "docker-compose.yml" ]; then
    echo "--> Aktualisiere und starte Docker-Container neu..."
    docker compose up -d --build
fi

echo "=========================================================="
echo " ✓ Rechnungs-Verwaltung erfolgreich aktualisiert!"
echo "   Aktueller Commit: $(git log -1 --format='%h - %s (%ci)')"
echo "=========================================================="
