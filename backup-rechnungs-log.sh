#!/bin/bash
# ==============================================================================
# Automatisiertes Multi-Instanz Backup für Rechnungs-LOG (Rechnungs-Verwaltung)
# mit AES-256-CBC Verschlüsselung (PBKDF2) & IONOS SFTP Upload
# (Analog zu backup-all.sh der Klientenverwaltung)
# ==============================================================================
set -euo pipefail

# Basis-Verzeichnis (standardmäßig /home/opc)
BASE_DIR="/home/opc"
if [ ! -d "$BASE_DIR" ]; then
    BASE_DIR="$HOME"
fi

# ==============================================================================
# KONFIGURATION DER ZU SICHERNDEN RECHNUNGS-LOG INSTANZEN
# ==============================================================================
# Hier können beliebig viele Rechnungs-LOG Verzeichnisse definiert werden.
# Zusätzlich werden alle Unterordner in "$BASE_DIR/rechnungs-logs/*" automatisch
# erkannt und mitgesichert!
RECHNUNGS_LOG_INSTANCES=(
    "$BASE_DIR/rechnungs-verwaltung"
    # Weitere feste Instanzen können hier einfach ergänzt werden, z. B.:
    # "$BASE_DIR/rechnungs-logs/firma2"
    # "$BASE_DIR/rechnungs-logs/partner-b"
)

# Automatische Erkennung aller weiteren Instanzen im Multi-Instanz-Ordner ~/rechnungs-logs/
if [ -d "$BASE_DIR/rechnungs-logs" ]; then
    for extra_inst in "$BASE_DIR/rechnungs-logs"/*; do
        if [ -d "$extra_inst" ]; then
            # Prüfen, ob noch nicht in RECHNUNGS_LOG_INSTANCES enthalten
            ALREADY_IN=0
            for existing in "${RECHNUNGS_LOG_INSTANCES[@]}"; do
                [ "$existing" = "$extra_inst" ] && ALREADY_IN=1 && break
            done
            if [ "$ALREADY_IN" -eq 0 ]; then
                RECHNUNGS_LOG_INSTANCES+=("$extra_inst")
            fi
        fi
    done
fi

# Optional können zusätzliche Instanzen auch über ~/.rechnungs_log_instances (eine pro Zeile)
# definiert werden:
if [ -f "$BASE_DIR/.rechnungs_log_instances" ]; then
    while IFS= read -r custom_dir || [ -n "$custom_dir" ]; do
        custom_dir=$(echo "$custom_dir" | sed 's/#.*//;s/^[[:space:]]*//;s/[[:space:]]*$//')
        [ -z "$custom_dir" ] && continue
        if [ -d "$custom_dir" ]; then
            RECHNUNGS_LOG_INSTANCES+=("$custom_dir")
        fi
    done < "$BASE_DIR/.rechnungs_log_instances"
fi

# ==============================================================================
# ZUGANGSDATEN & VERSCHLÜSSELUNGS-KEY LADEN (.backup_credentials)
# ==============================================================================
CONFIG_FILE="$BASE_DIR/.backup_credentials"
if [ ! -f "$CONFIG_FILE" ]; then
    if [ -f "$HOME/.backup_credentials" ]; then
        CONFIG_FILE="$HOME/.backup_credentials"
    elif [ -f "/root/.backup_credentials" ]; then
        CONFIG_FILE="/root/.backup_credentials"
    else
        echo "❌ FEHLER: Konfigurationsdatei .backup_credentials weder in $BASE_DIR noch in $HOME gefunden!" >&2
        exit 1
    fi
fi
source "$CONFIG_FILE"

# Zielverzeichnis auf dem IONOS SFTP Server (kann in .backup_credentials via
# IONOS_SFTP_RECHNUNGEN_DIR überschrieben werden, sonst eigener Unterordner oder Standard)
REMOTE_BASE_DIR="${IONOS_SFTP_RECHNUNGEN_DIR:-${IONOS_SFTP_REMOTE_DIR}/rechnungs-logs}"

# Zeitstempel & temporäre Verzeichnisse
TIMESTAMP=$(date +"%Y-%m-%d_%H%M")
DATE_DAY=$(date +"%Y-%m-%d")
TEMP_BACKUP_DIR="/tmp/rechnungs_log_backup_${TIMESTAMP}"
LOG_FILE="$BASE_DIR/backup-rechnungs-log.log"

# Aufräumen bei Skriptende (auch bei Fehlern)
cleanup() {
    if [ -d "$TEMP_BACKUP_DIR" ]; then
        rm -rf "$TEMP_BACKUP_DIR"
    fi
}
trap cleanup EXIT

mkdir -p "$TEMP_BACKUP_DIR"

log() {
    local MSG="[$(date +"%Y-%m-%d %H:%M:%S")] $1"
    echo "$MSG"
    echo "$MSG" >> "$LOG_FILE"
}

log "=================================================================="
log " Starte verschlüsseltes Rechnungs-LOG Backup (Run: $TIMESTAMP)"
log " Basis-Verzeichnis: $BASE_DIR (ausgeführt als: $(whoami))"
log "=================================================================="

BACKUP_COUNT=0

# ------------------------------------------------------------------------------
# 1. ALLE DEFINIERTEN RECHNUNGS-LOG INSTANZEN SICHERN
# ------------------------------------------------------------------------------
for inst_path in "${RECHNUNGS_LOG_INSTANCES[@]}"; do
    if [ ! -d "$inst_path" ]; then
        continue
    fi

    SLUG=$(basename "$inst_path")
    log "--> Sichere Rechnungs-LOG Instanz: $SLUG ($inst_path) ..."

    INST_WORK_DIR="$TEMP_BACKUP_DIR/$SLUG"
    mkdir -p "$INST_WORK_DIR/data"

    # 1.1 Konsistentes SQLite-Backup erstellen (inkl. WAL-Transaktionen)
    DB_FILE="$inst_path/data/rechnungs-log.db"
    if [ -f "$DB_FILE" ]; then
        log "    Erstelle konsistenten SQLite-Snapshot..."
        # Nutze Node.js im laufenden Container oder sqlite3 / cp für einen sauberen Snapshot
        cp -a "$DB_FILE" "$INST_WORK_DIR/data/rechnungs-log.db"
        [ -f "${DB_FILE}-wal" ] && cp -a "${DB_FILE}-wal" "$INST_WORK_DIR/data/" || true
        [ -f "${DB_FILE}-shm" ] && cp -a "${DB_FILE}-shm" "$INST_WORK_DIR/data/" || true
    else
        log "    ⚠️ Noch keine SQLite-Datenbank unter $DB_FILE gefunden."
    fi

    # 1.2 Hochgeladene PDF-Belege & Kundendokumente kopieren
    if [ -d "$inst_path/data/uploads" ]; then
        log "    Kopiere PDF-Belege & Dokumente (data/uploads)..."
        cp -a "$inst_path/data/uploads" "$INST_WORK_DIR/data/"
    fi

    # 1.3 Instanz-Konfiguration (.env & docker-compose.yml) sichern
    mkdir -p "$INST_WORK_DIR/config"
    [ -f "$inst_path/.env" ] && cp -a "$inst_path/.env" "$INST_WORK_DIR/config/" || true
    [ -f "$inst_path/docker-compose.yml" ] && cp -a "$inst_path/docker-compose.yml" "$INST_WORK_DIR/config/" || true

    # 1.4 Archiv schnüren (.tar.gz)
    ARCHIVE_TAR="$TEMP_BACKUP_DIR/backup_rechnungslog_${SLUG}_${TIMESTAMP}.tar.gz"
    log "    Erstelle tar.gz Archiv..."
    tar -czf "$ARCHIVE_TAR" -C "$INST_WORK_DIR" data config

    # 1.5 Lokal mit AES-256-CBC (PBKDF2, 100.000 Iterationen) verschlüsseln
    ARCHIVE_ENC="${ARCHIVE_TAR}.enc"
    log "    Verschlüssele mit AES-256-CBC (PBKDF2)..."
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
        -in "$ARCHIVE_TAR" \
        -out "$ARCHIVE_ENC" \
        -pass pass:"$BACKUP_ENCRYPTION_KEY"

    # 1.6 SHA256 Prüfsumme berechnen
    cd "$TEMP_BACKUP_DIR"
    sha256sum "$(basename "$ARCHIVE_ENC")" > "$(basename "$ARCHIVE_ENC").sha256"

    # Unverschlüsseltes Tar & Arbeitsordner sofort entfernen
    rm -f "$ARCHIVE_TAR"
    rm -rf "$INST_WORK_DIR"

    BACKUP_COUNT=$((BACKUP_COUNT + 1))
    log "    ✓ Instanz $SLUG fertig verschlüsselt: $(basename "$ARCHIVE_ENC") ($(du -h "$ARCHIVE_ENC" | cut -f1))"
done

if [ "$BACKUP_COUNT" -eq 0 ]; then
    log "⚠️ Keine Rechnungs-LOG Instanzen zum Sichern gefunden. Beende."
    exit 0
fi

# ------------------------------------------------------------------------------
# 2. SFTP UPLOAD ZU IONOS WEBSPACE (via lftp)
# ------------------------------------------------------------------------------
log "--> Übertrage $BACKUP_COUNT verschlüsselte(s) Archiv(e) via SFTP an IONOS..."

TARGET_REMOTE_SUBDIR="${REMOTE_BASE_DIR}/${DATE_DAY}"

lftp -u "${IONOS_SFTP_USER},${IONOS_SFTP_PASS}" "sftp://${IONOS_SFTP_HOST}:${IONOS_SFTP_PORT}" << EOF
set sftp:auto-confirm yes
set net:timeout 30
set net:max-retries 3
mkdir -p ${TARGET_REMOTE_SUBDIR}
cd ${TARGET_REMOTE_SUBDIR}
mput ${TEMP_BACKUP_DIR}/*.enc
mput ${TEMP_BACKUP_DIR}/*.sha256
bye
EOF

log "✓ Alle Archive erfolgreich auf IONOS übertragen in: ${TARGET_REMOTE_SUBDIR}"

# ------------------------------------------------------------------------------
# 3. ROTATION / PRUNING AUF DEM IONOS WEBSPACE (Älter als RETENTION_DAYS löschen)
# ------------------------------------------------------------------------------
RETENTION="${RETENTION_DAYS:-14}"
log "--> Prüfe Aufbewahrungsdauer auf IONOS (Vorhaltezeit: ${RETENTION} Tage)..."

CUTOFF_DATE=$(date -d "${RETENTION} days ago" +"%Y-%m-%d" 2>/dev/null || date -v-${RETENTION}d +"%Y-%m-%d" 2>/dev/null || echo "")

if [ -n "$CUTOFF_DATE" ]; then
    OLD_DIRS=$(lftp -u "${IONOS_SFTP_USER},${IONOS_SFTP_PASS}" "sftp://${IONOS_SFTP_HOST}:${IONOS_SFTP_PORT}" -e "cls -1 ${REMOTE_BASE_DIR}; bye" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || true)

    for rdir in $OLD_DIRS; do
        if [[ "$rdir" < "$CUTOFF_DATE" ]]; then
            log "    Lösche abgelaufenes Backup auf IONOS: ${REMOTE_BASE_DIR}/$rdir ..."
            lftp -u "${IONOS_SFTP_USER},${IONOS_SFTP_PASS}" "sftp://${IONOS_SFTP_HOST}:${IONOS_SFTP_PORT}" -e "rm -r ${REMOTE_BASE_DIR}/$rdir; bye" 2>/dev/null || true
        fi
    done
fi

log "=================================================================="
log " Rechnungs-LOG Backup erfolgreich abgeschlossen!"
log "=================================================================="
