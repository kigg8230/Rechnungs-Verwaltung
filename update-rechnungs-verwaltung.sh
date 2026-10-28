#!/bin/bash
# ==============================================================================
# Rechnungs-Verwaltung (Rechnungs-LOG): Vollautomatisches Update aus GitHub
# Unterstützt Einzel-Instanz sowie Multi-Instanz-Verzeichnisse.
#
# Aufruf:
#   ./update-rechnungs-verwaltung.sh              (aktualisiert aktuelle / Standard-Instanz)
#   ./update-rechnungs-verwaltung.sh <slug|pfad>  (aktualisiert eine bestimmte Instanz)
#   ./update-rechnungs-verwaltung.sh --all        (aktualisiert ALLE Rechnungs-LOG Instanzen)
# ==============================================================================
set -euo pipefail

REPO_SLUG="kigg8230/Rechnungs-Verwaltung"
BASE_DIR="${BASE_DIR:-$HOME}"
TARGET="${1:-default}"

# GitHub-Token ermitteln (falls vorhanden)
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

update_instance() {
    local APP_DIR="$1"
    if [ ! -d "$APP_DIR" ]; then
        echo "⚠️ Verzeichnis $APP_DIR existiert nicht – überspringe."
        return 0
    fi

    echo "=========================================================="
    echo " Starte Update für Instanz in: $APP_DIR"
    echo " Datum: $(date)"
    echo "=========================================================="

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

    # Container-Name aus .env lesen (falls vorhanden), sonst Standard
    local COMPOSE_PROJECT="rechnungs-log"
    if [ -f "$APP_DIR/.env" ]; then
        source "$APP_DIR/.env"
        COMPOSE_PROJECT="${CONTAINER_NAME:-rechnungs-log}"
    fi

    if [ -f "docker-compose.yml" ]; then
        echo "--> Aktualisiere und starte Docker-Container ($COMPOSE_PROJECT) neu..."
        # Bestehenden Container gleichen Namens sauber stoppen/entfernen, um Namenskonflikte
        # (z.B. nach Wechsel des Compose-Projektnamens) zu vermeiden. Daten in ./data bleiben erhalten!
        docker rm -f "$COMPOSE_PROJECT" 2>/dev/null || true
        docker compose -p "$COMPOSE_PROJECT" up -d --build --remove-orphans
    fi

    echo "✓ Instanz $APP_DIR erfolgreich aktualisiert! Commit: $(git log -1 --format='%h - %s (%ci)')"
}

if [ "$TARGET" = "--all" ]; then
    # 1. Standard-Instanz aktualisieren
    if [ -d "$BASE_DIR/rechnungs-verwaltung" ]; then
        update_instance "$BASE_DIR/rechnungs-verwaltung"
    fi
    # 2. Alle weiteren Instanzen unter ~/rechnungs-logs/* aktualisieren
    if [ -d "$BASE_DIR/rechnungs-logs" ]; then
        for inst_dir in "$BASE_DIR/rechnungs-logs"/*; do
            [ -d "$inst_dir" ] && update_instance "$inst_dir"
        done
    fi
elif [ "$TARGET" = "default" ]; then
    update_instance "$BASE_DIR/rechnungs-verwaltung"
elif [ -d "$TARGET" ]; then
    update_instance "$TARGET"
else
    update_instance "$BASE_DIR/rechnungs-logs/$TARGET"
fi
