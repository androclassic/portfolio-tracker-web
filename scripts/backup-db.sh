#!/bin/bash
# ──────────────────────────────────────────────────────────
# SQLite Database Backup Script (Docker + NAS)
#
# Usage:
#   ./scripts/backup-db.sh                  # backs up to NAS
#   BACKUP_DIR=/custom/path ./scripts/backup-db.sh
#
# Cron example (daily at 3 AM):
#   0 3 * * * /home/andrei/Develop/portfolio-tracker-web/scripts/backup-db.sh >> /home/andrei/logs/portfolio-backup.log 2>&1
# ──────────────────────────────────────────────────────────

set -euo pipefail

CONTAINER="${CONTAINER:-portfolio-tracker-web}"
DB_PATH="${DB_PATH:-/data/portfolio.db}"
BACKUP_DIR="${1:-${BACKUP_DIR:-/mnt/nas-backup/portfolio-db}}"
KEEP=${KEEP:-30}

# ──────────────────────────────────────────────────────────

# Check container is running
if ! docker inspect "$CONTAINER" &>/dev/null; then
  echo "ERROR: Container '$CONTAINER' not found or not running"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="portfolio_${TIMESTAMP}.db"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

# Use SQLite .backup inside the container for a consistent copy
docker exec "$CONTAINER" sh -c "sqlite3 '$DB_PATH' '.backup /tmp/backup.db'" 2>/dev/null || {
  # Fallback: docker cp (safe enough for SQLite in WAL mode if no mid-transaction write)
  echo "WARN: sqlite3 not in container, using docker cp"
  docker cp "$CONTAINER:$DB_PATH" "$BACKUP_PATH"
}

# If sqlite3 backup worked, copy it out
if [ ! -f "$BACKUP_PATH" ]; then
  docker cp "$CONTAINER:/tmp/backup.db" "$BACKUP_PATH"
  docker exec "$CONTAINER" rm -f /tmp/backup.db
fi

# Compress
gzip "$BACKUP_PATH"
BACKUP_PATH="${BACKUP_PATH}.gz"

# Prune old backups
ls -1t "$BACKUP_DIR"/portfolio_*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
echo "$(date '+%Y-%m-%d %H:%M:%S') Backup complete: $BACKUP_PATH ($SIZE)"
echo "Backups retained: $(ls -1 "$BACKUP_DIR"/portfolio_*.db.gz 2>/dev/null | wc -l)/$KEEP"
