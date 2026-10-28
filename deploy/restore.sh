#!/usr/bin/env bash
# Padova Life SIM: restore a database backup (M12).
#
# Drill (the default, changes nothing): restores the backup into a new,
# temporary database, compares its row counts with the live database, and
# drops the temporary database. Run it after setting up backups, and now and
# then, so we know the backups work.
#
#   DATABASE_URL=postgresql://... deploy/restore.sh /var/backups/padova-life/padova-20261028-033000.dump
#
# Replacing the live database (after losing data) stops the game, replaces
# every table with the backup's contents and starts the game again. It asks
# you to type the database name first. Everything saved after the backup is lost.
#
#   DATABASE_URL=postgresql://... deploy/restore.sh --replace-live <backup file>
set -euo pipefail

mode="drill"
if [[ "${1:-}" == "--replace-live" ]]; then mode="replace"; shift; fi
backup="${1:?usage: restore.sh [--replace-live] <backup file>}"
: "${DATABASE_URL:?DATABASE_URL is not set}"
[[ -f "$backup" ]] || { echo "no such file: $backup" >&2; exit 1; }
pg_restore --list "$backup" > /dev/null

# The URL without its database name, to reach a scratch database on the same server.
base="${DATABASE_URL%/*}"
live_db="${DATABASE_URL##*/}"; live_db="${live_db%%\?*}"
query() { psql --no-psqlrc --quiet --tuples-only --no-align --dbname="$1" --command="$2"; }

# Row counts of every game table, one "table count" line each.
counts() {
  local db="$1" tables
  tables="$(query "$db" "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")"
  for t in $tables; do echo "$t $(query "$db" "SELECT count(*) FROM \"$t\"")"; done
}

if [[ "$mode" == "drill" ]]; then
  scratch="padova_restore_drill_$(date -u +%Y%m%d%H%M%S)"
  query "$base/postgres" "CREATE DATABASE $scratch" || query "$DATABASE_URL" "CREATE DATABASE $scratch"
  trap 'query "$base/postgres" "DROP DATABASE IF EXISTS $scratch" 2>/dev/null || query "$DATABASE_URL" "DROP DATABASE IF EXISTS $scratch"' EXIT
  pg_restore --no-owner --no-privileges --exit-on-error --dbname="$base/$scratch" "$backup"
  echo "restored $(basename "$backup") into $scratch; rows per table (backup | live now):"
  join -a1 -a2 -e "-" -o 0,1.2,2.2 <(counts "$base/$scratch" | sort) <(counts "$DATABASE_URL" | sort) | awk '{ printf "  %-28s %10s %10s\n", $1, $2, $3 }'
  echo "Drill finished: the backup restores. Rows saved since the backup explain any differences."
  exit 0
fi

read -r -p "This replaces every table in '$live_db' with the backup. Type the database name to go on: " typed
[[ "$typed" == "$live_db" ]] || { echo "Cancelled."; exit 1; }
if command -v systemctl > /dev/null && systemctl is-active --quiet padova-life 2> /dev/null; then
  systemctl stop padova-life
  restart=1
fi
pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error --single-transaction --dbname="$DATABASE_URL" "$backup"
echo "Restored $(basename "$backup") into $live_db."
if [[ "${restart:-}" == "1" ]]; then systemctl start padova-life; echo "The game is running again."; fi
