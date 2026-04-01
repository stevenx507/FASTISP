#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
DATABASE_URL="${DATABASE_URL:-}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/ispfast_${STAMP}.dump"

echo "[backup] creating dump: $DUMP_FILE"
pg_dump --format=custom --dbname "$DATABASE_URL" --file "$DUMP_FILE"

if [[ ! -s "$DUMP_FILE" ]]; then
  echo "backup file is empty" >&2
  exit 1
fi

echo "[verify] validating dump metadata"
pg_restore --list "$DUMP_FILE" >/dev/null

echo "Backup and verification completed: $DUMP_FILE"
