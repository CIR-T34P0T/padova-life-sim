#!/usr/bin/env bash
# Padova Life SIM: update the server to the latest `main` (M12, D-047).
# Backs up the database first, pulls, installs, builds and restarts the game
# (new migrations run when it starts). Players online are disconnected for a
# few seconds, so update when the square is quiet.
#
#   sudo bash deploy/update.sh
#
# Written 2026-10-28 and checked with shellcheck; NOT YET RUN ON A REAL SERVER.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 1; }
ADMIN="${SUDO_USER:-}"
[[ -n "$ADMIN" && "$ADMIN" != "root" ]] || { echo "Run it with sudo from your normal user." >&2; exit 1; }
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
as_admin() { sudo -u "$ADMIN" -H bash -c "cd '$APP_DIR' && $1"; }

echo "== Backing up the database"
systemctl start padova-life-backup.service
journalctl -u padova-life-backup -n 3 --no-pager

echo "== Getting the latest version"
before="$(as_admin "git rev-parse --short HEAD")"
as_admin "git pull --ff-only"
after="$(as_admin "git rev-parse --short HEAD")"
echo "$before → $after"

echo "== Installing and building"
as_admin "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund && npm run build"
for unit in padova-life.service padova-life-backup.service padova-life-backup.timer; do
  sed "s|@APP_DIR@|$APP_DIR|g" "$APP_DIR/deploy/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload

echo "== Restarting"
systemctl restart padova-life.service
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:2567/health > /dev/null 2>&1; then
    echo "Running $after."
    exit 0
  fi
  sleep 1
done
echo "The game server didn't come back. Its last log lines:" >&2
journalctl -u padova-life -n 40 --no-pager >&2
exit 1
