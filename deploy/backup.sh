#!/usr/bin/env bash
# Padova Life SIM: database backup (M12). Writes a compressed pg_dump of the
# game's database to BACKUP_DIR and deletes copies older than BACKUP_KEEP_DAYS.
# If BACKUP_RCLONE_REMOTE is set (e.g. "oci:padova-backups"), the new copy is
# also uploaded with rclone, so a lost server doesn't take the backups with it.
#
#   DATABASE_URL=postgresql://... deploy/backup.sh
#
# On the server it runs every night from padova-life-backup.timer with the
# settings in /etc/padova-life/env. Never prints the database password.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/padova-life}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/padova-$stamp.dump"
partial="$target.partial"

# Custom format: compressed, and pg_restore can check and restore it.
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$partial"
pg_restore --list "$partial" > /dev/null   # fails if the file is unreadable
mv "$partial" "$target"
chmod 600 "$target"
echo "backup written: $target ($(du -h "$target" | cut -f1))"

find "$BACKUP_DIR" -maxdepth 1 -name 'padova-*.dump' -type f -mtime +"$BACKUP_KEEP_DAYS" -print -delete | sed 's/^/deleted old backup: /'

if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  rclone copy "$target" "$BACKUP_RCLONE_REMOTE" --no-traverse
  echo "uploaded to $BACKUP_RCLONE_REMOTE"
fi
