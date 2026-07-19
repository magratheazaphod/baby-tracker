#!/bin/sh
# Pull an off-site backup (SQLite database + photos) from the deployed app.
#
# Usage:
#   APP_URL=https://your-app.fly.dev APP_SECRET=your-secret ./scripts/backup.sh [dest-dir]
#
# Keeps the newest 30 backups in dest-dir (default ~/baby-tracker-backups).
set -eu

: "${APP_URL:?set APP_URL to your deployed app URL}"
: "${APP_SECRET:?set APP_SECRET to the family secret}"
DEST="${1:-$HOME/baby-tracker-backups}"

mkdir -p "$DEST"
STAMP=$(date +%Y-%m-%d-%H%M)
OUT="$DEST/backup-$STAMP.tar.gz"

curl -fsS -H "Authorization: Bearer $APP_SECRET" "$APP_URL/api/export" -o "$OUT"
ls -1t "$DEST"/backup-*.tar.gz 2>/dev/null | tail -n +31 | xargs rm -f
echo "saved $OUT ($(du -h "$OUT" | cut -f1))"
