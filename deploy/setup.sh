#!/usr/bin/env bash
# Padova Life SIM: set up a fresh Ubuntu 24.04 server (M12, D-047): an
# Oracle Cloud Always Free VM or any small VPS, x86 or Arm.
#
# Installs Node.js 22, PostgreSQL 16 and Caddy; creates the database and its
# password (kept in /etc/padova-life/env); builds the game; runs it as the
# `padova` system user behind Caddy, which serves it over HTTPS on the
# domain; schedules a nightly database backup; opens ports 80 and 443 in the
# server's own firewall. Safe to run again: it keeps the existing database
# and password.
#
# Before: the domain's DNS points at this server, ports 80 and 443 are open
# in the cloud provider's firewall, and the repository is cloned here
# (README → "Putting the game online"). Then, from the repository folder:
#
#   sudo bash deploy/setup.sh play.example.com
#
# Written 2026-10-28 and checked with shellcheck; NOT YET RUN ON A REAL
# SERVER. Run it the first time with the output copied back to Claude.
set -euo pipefail

DOMAIN="${1:-}"
if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "usage: sudo bash deploy/setup.sh <domain>   e.g. sudo bash deploy/setup.sh play.example.com" >&2
  exit 1
fi
[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 1; }
ADMIN="${SUDO_USER:-}"
[[ -n "$ADMIN" && "$ADMIN" != "root" ]] || { echo "Run it with sudo from your normal user (the one that cloned the repository)." >&2; exit 1; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR=/etc/padova-life
ENV_FILE="$ENV_DIR/env"
BACKUP_DIR=/var/backups/padova-life
step() { printf '\n== %s\n' "$*"; }
as_admin() { sudo -u "$ADMIN" -H bash -c "cd '$APP_DIR' && $1"; }

step "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git openssl postgresql debian-keyring debian-archive-keyring apt-transport-https

if ! node --version 2> /dev/null | grep -q '^v22\.'; then
  step "Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node --version), npm $(npm --version)"

if ! command -v caddy > /dev/null; then
  step "Caddy (official repository)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
caddy version

step "The padova user"
id -u padova > /dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin padova

step "Database"
systemctl enable --now postgresql
role_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'padova'")"
if [[ "$role_exists" != "1" ]]; then
  password="$(openssl rand -hex 24)"
  # Through stdin, so the password never appears in the process list.
  sudo -u postgres psql -v ON_ERROR_STOP=1 > /dev/null <<SQL
CREATE ROLE padova LOGIN CREATEDB PASSWORD '$password';
CREATE DATABASE padova OWNER padova;
SQL
  install -d -m 750 -o root -g padova "$ENV_DIR"
  umask 027
  cat > "$ENV_FILE" <<ENV
# Padova Life SIM server settings (deploy/setup.sh). Secret: readable by root and padova only.
NODE_ENV=production
PORT=2567
HOST=127.0.0.1
CLIENT_DIST=client/dist
LOG_FORMAT=json
DATABASE_URL=postgresql://padova:$password@127.0.0.1:5432/padova
BACKUP_DIR=$BACKUP_DIR
BACKUP_KEEP_DAYS=14
# BACKUP_RCLONE_REMOTE=oci:padova-backups   (off-site copies, README → "Backups")
ENV
  chown root:padova "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  unset password
  echo "created the database and $ENV_FILE"
elif [[ ! -f "$ENV_FILE" ]]; then
  echo "The database role exists but $ENV_FILE is missing; restore that file (it holds the password) and run this again." >&2
  exit 1
else
  echo "keeping the existing database and $ENV_FILE"
fi
install -d -m 700 -o padova -g padova "$BACKUP_DIR"

step "Building the game (as $ADMIN)"
as_admin "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund && npm run build"

step "Services"
for unit in padova-life.service padova-life-backup.service padova-life-backup.timer; do
  sed "s|@APP_DIR@|$APP_DIR|g" "$APP_DIR/deploy/$unit" > "/etc/systemd/system/$unit"
done
[[ -f /etc/caddy/Caddyfile.orig ]] || cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.orig 2> /dev/null || true
sed "s|@DOMAIN@|$DOMAIN|g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now padova-life.service padova-life-backup.timer
systemctl restart padova-life.service
systemctl enable caddy
systemctl reload-or-restart caddy

step "Firewall on this server (ports 80 and 443)"
if command -v iptables > /dev/null && iptables -S INPUT | grep -q -- '-j REJECT'; then
  # Oracle's Ubuntu images reject everything but SSH; open the web ports before that rule.
  for port in 80 443; do
    if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2> /dev/null; then
      line="$(iptables -L INPUT --line-numbers | awk '$2 == "REJECT" { print $1; exit }')"
      iptables -I INPUT "$line" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  done
  if command -v netfilter-persistent > /dev/null; then netfilter-persistent save; fi
  echo "opened 80 and 443"
else
  echo "no rejecting firewall rules found; nothing to open here (the cloud provider's firewall still needs 80 and 443)"
fi

step "Checking"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:2567/health > /dev/null 2>&1; then break; fi
  sleep 1
done
if curl -fsS http://127.0.0.1:2567/health; then
  echo
  echo "The game server is running. In a minute or two Caddy has its certificate:"
  echo "  https://$DOMAIN"
  echo "Status: https://$DOMAIN/status · logs: journalctl -u padova-life -f"
else
  echo "The game server didn't answer. Its last log lines:" >&2
  journalctl -u padova-life -n 40 --no-pager >&2
  exit 1
fi
