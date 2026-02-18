#!/bin/bash
# ──────────────────────────────────────────────────────────
# SQLite Database Backup Script
#
# Usage:
#   ./scripts/backup-db.sh                  # backs up to ./backups/
#   ./scripts/backup-db.sh /path/to/dir     # backs up to custom dir
#   BACKUP_DIR=/mnt/nas ./scripts/backup-db.sh  # via env var
#
# Cron example (daily at 3 AM):
#   0 3 * * * cd /path/to/portfolio-tracker-web && ./scripts/backup-db.sh
#
# For Docker deployments, the DB lives at /data/portfolio.db inside
# the container. Run from the host using the mounted volume:
#   0 3 * * * cd /path/to/portfolio-tracker-web && ./scripts/backup-db.sh
# ──────────────────────────────────────────────────────────

set -euo pipefail

# Resolve project root (parent of scripts/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Where the DB file lives — matches docker-compose volume mount
DB_FILE="${DB_FILE:-$PROJECT_ROOT/data/portfolio.db}"

# Backup destination
BACKUP_DIR="${1:-${BACKUP_DIR:-$PROJECT_ROOT/backups}}"

# How many backups to keep (older ones get deleted)
KEEP=${KEEP:-30}

# ──────────────────────────────────────────────────────────

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: Database file not found: $DB_FILE"
  echo "Set DB_FILE env var to point to your SQLite database."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="portfolio_${TIMESTAMP}.db"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

# Use SQLite's .backup command for a consistent copy (safe even while the app is running)
if command -v sqlite3 &>/dev/null; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_PATH'"
else
  # Fallback: plain copy (safe for SQLite in WAL mode if no write is mid-transaction)
  cp "$DB_FILE" "$BACKUP_PATH"
fi

# Compress the backup
gzip "$BACKUP_PATH"
BACKUP_PATH="${BACKUP_PATH}.gz"

# Prune old backups (keep only the most recent $KEEP)
ls -1t "$BACKUP_DIR"/portfolio_*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
echo "Backup complete: $BACKUP_PATH ($SIZE)"
echo "Backups retained: $(ls -1 "$BACKUP_DIR"/portfolio_*.db.gz 2>/dev/null | wc -l)/$KEEP"
