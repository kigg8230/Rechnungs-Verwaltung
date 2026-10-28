#!/bin/bash
# ==============================================================================
# Rechnungs-Verwaltung (Rechnungs-LOG): Multi-Instanz fähiges Rollout-Skript
# Repository: https://github.com/kigg8230/Rechnungs-Verwaltung.git
#
# Aufruf (Standard / 1. Instanz):
#   ./deploy-vps.sh
#
# Aufruf für weitere Rechnungs-LOG Instanzen:
#   ./deploy-vps.sh <slug> <port> [admin_user] [admin_password]
#   Beispiel: ./deploy-vps.sh firma2 3001 admin geheim123
#
# Oder per Umgebungsvariablen:
#   INSTANCE_SLUG=firma2 HOST_PORT=3001 ./deploy-vps.sh
# ==============================================================================
set -euo pipefail

# Variablen für Multi-Instanz-Betrieb
INSTANCE_SLUG="${1:-${INSTANCE_SLUG:-default}}"
HOST_PORT="${2:-${HOST_PORT:-3000}}"
ADMIN_USER="${3:-${ADMIN_USER:-admin}}"
ADMIN_PASSWORD="${4:-${ADMIN_PASSWORD:-rechnungen2026}}"

REPO_SLUG="kigg8230/Rechnungs-Verwaltung"
BASE_DIR="${BASE_DIR:-$HOME}"

# Pfad & Container-Name anhand des Slugs festlegen:
# - "default" -> ~/rechnungs-verwaltung (Container: rechnungs-log)
# - weiterer Slug (z.B. "firma2") -> ~/rechnungs-logs/firma2 (Container: rechnungs-log-firma2)
if [ "$INSTANCE_SLUG" = "default" ] || [ "$INSTANCE_SLUG" = "rechnungs-verwaltung" ]; then
    APP_DIR="${APP_DIR:-$BASE_DIR/rechnungs-verwaltung}"
    CONTAINER_NAME="${CONTAINER_NAME:-rechnungs-log}"
else
    APP_DIR="${APP_DIR:-$BASE_DIR/rechnungs-logs/$INSTANCE_SLUG}"
    CONTAINER_NAME="${CONTAINER_NAME:-rechnungs-log-$INSTANCE_SLUG}"
fi

echo "=========================================================="
echo " Starte Rollout der Rechnungs-Verwaltung auf Oracle-VPS..."
echo " Instanz-Slug:   $INSTANCE_SLUG"
echo " Zielordner:     $APP_DIR"
echo " Container-Name: $CONTAINER_NAME"
echo " Host-Port:      $HOST_PORT"
echo " Datum:          $(date)"
echo "=========================================================="

# Falls noch kein Git-Token in der Umgebung gesetzt ist, automatisch aus bestehenden
# Server-Skripten oder Git-Configs auf dem VPS ermitteln:
if [ -z "${GITHUB_TOKEN:-}" ]; then
    if [ -f "$BASE_DIR/create-praxis.sh" ]; then
        GITHUB_TOKEN=$(grep -oE 'ghp_[A-Za-z0-9]+' "$BASE_DIR/create-praxis.sh" | head -n 1 || true)
    fi
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
    EXISTING_CFG=$(ls "$BASE_DIR"/rechnungs-verwaltung/.git/config "$BASE_DIR"/praxen/*/custom_apps/klientenverwaltung/.git/config "$BASE_DIR"/homepage/.git/config 2>/dev/null | head -n 1 || true)
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
    echo "--> Aktualisiere bestehendes Repository in $APP_DIR ..."
    git fetch origin main
    git checkout -f -B main origin/main
    git reset --hard origin/main
fi

chmod +x "$APP_DIR"/*.sh 2>/dev/null || true

# .env Datei für Docker Compose erzeugen (falls noch nicht vorhanden)
if [ ! -f "$APP_DIR/.env" ]; then
    cat << EOF > "$APP_DIR/.env"
INSTANCE_SLUG=${INSTANCE_SLUG}
CONTAINER_NAME=${CONTAINER_NAME}
HOST_PORT=${HOST_PORT}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
    chmod 600 "$APP_DIR/.env"
    echo "--> Instanz-Konfiguration (.env) erstellt."
fi

# Persistente Ordner für SQLite-Datenbank und PDF-Uploads sicherstellen
mkdir -p "$APP_DIR/data/uploads"

# Sicherstellen, dass das externe Docker-Netzwerk proxy-network (für Nginx Proxy Manager) existiert
docker network inspect proxy-network >/dev/null 2>&1 || docker network create proxy-network

# Docker Container bauen und im Hintergrund starten
echo "--> Baue und starte Docker-Container ($CONTAINER_NAME)..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
docker compose -p "$CONTAINER_NAME" up -d --build --remove-orphans

echo "=========================================================="
echo " ✓ Rechnungs-Verwaltung ($INSTANCE_SLUG) erfolgreich ausgerollt!"
echo "   Ordner:                 $APP_DIR"
echo "   Daten & PDFs:           $APP_DIR/data"
echo "   Container-Name (NPM):   $CONTAINER_NAME (Interner Port: 3000)"
echo "   Lokal erreichbar unter: http://localhost:$HOST_PORT"
echo "   Aktueller Commit:       $(git log -1 --format='%h - %s (%ci)')"
echo "=========================================================="
