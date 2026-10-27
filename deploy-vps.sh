#!/bin/bash
# ==============================================================================
# Rechnungs-Verwaltung (Rechnungs-LOG): Erstinstallation / Rollout auf Oracle-VPS
# Repository: https://github.com/kigg8230/Rechnungs-Verwaltung.git
# ==============================================================================
set -euo pipefail

APP_DIR="$HOME/rechnungs-verwaltung"
REPO_SLUG="kigg8230/Rechnungs-Verwaltung"
PORT="${1:-3000}"

echo "=========================================================="
echo " Starte Rollout der Rechnungs-Verwaltung auf Oracle-VPS..."
echo " Zielordner: $APP_DIR | Port: $PORT"
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
    EXISTING_CFG=$(ls "$HOME"/praxen/*/custom_apps/klientenverwaltung/.git/config "$HOME"/homepage/.git/config 2>/dev/null | head -n 1 || true)
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

if [ ! -d ".git" ]; then
    echo "--> Klone Git-Repository ($REPO_SLUG) nach $APP_DIR ..."
    git init
    git remote add origin "$REMOTE_URL"
    git fetch origin main
    git checkout -f -B main origin/main
else
    git remote set-url origin "$REMOTE_URL"
    echo "--> Aktualisiere bestehendes Repository..."
    git fetch origin main
    git checkout -f -B main origin/main
    git reset --hard origin/main
fi

# Persistente Ordner für SQLite-Datenbank und PDF-Uploads sicherstellen
mkdir -p "$APP_DIR/data/uploads"

# Docker Container bauen und im Hintergrund starten
echo "--> Baue und starte Docker-Container (rechnungs-log)..."
docker compose up -d --build

echo "=========================================================="
echo " ✓ Rechnungs-Verwaltung erfolgreich auf dem VPS ausgerollt!"
echo "   Ordner:         $APP_DIR"
echo "   Daten & PDFs:   $APP_DIR/data"
echo "   Lokal erreichbar unter: http://localhost:$PORT"
echo "   Aktueller Commit: $(git log -1 --format='%h - %s (%ci)')"
echo "=========================================================="
