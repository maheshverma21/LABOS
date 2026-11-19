#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04 / 24.04 server (Hostinger VPS, AWS Lightsail, DigitalOcean...).
# Run from the deploy/ folder of the project:
#   sudo bash setup.sh
# Safe to run again: it keeps an existing .env and only rebuilds what changed.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash setup.sh"
  exit 1
fi

say "1/5  Installing Docker (if needed)"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker.io docker-compose-v2 openssl
  systemctl enable --now docker
else
  echo "Docker is already installed."
fi
docker compose version >/dev/null || { echo "docker compose is missing: apt-get install docker-compose-v2"; exit 1; }

say "2/5  Firewall: allowing SSH, HTTP and HTTPS only"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  ufw status | sed -n '1,12p'
else
  echo "ufw not found; make sure only ports 22, 80 and 443 are open in your provider's firewall."
fi

say "3/5  Settings (.env)"
if [ ! -f .env ]; then
  read -rp "Domain for the app (e.g. app.yourlab.in): " DOMAIN
  read -rp "Your email (for HTTPS certificate notices): " ACME_EMAIL
  rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  sed -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" \
      -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$ACME_EMAIL|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 32)|" \
      -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(rand 32)|" \
      -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(rand 64)|" \
      -e "s|^SECRETS_KEY=.*|SECRETS_KEY=$(rand 48)|" \
      -e "s|^MAIL_FROM=.*|MAIL_FROM=LabOS <no-reply@$DOMAIN>|" \
      .env.example > .env
  chmod 600 .env
  echo "Created .env with new random secrets. Add SMTP_URL to it for password-reset emails (see .env.example)."
else
  echo ".env already exists; keeping it."
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

say "4/5  Building and starting (the first build takes a few minutes)"
mkdir -p backups
docker compose up -d --build

echo "Waiting for the API to be healthy..."
for i in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo starting)
  [ "$status" = "healthy" ] && break
  sleep 5
done
if [ "$status" != "healthy" ]; then
  echo "The API didn't start. See: docker compose logs api"
  exit 1
fi
echo "API is up."

say "5/5  Your first platform admin"
existing=$(docker compose exec -T postgres psql -U labos -d labos -tAc 'SELECT count(*) FROM "PlatformAdmin"' 2>/dev/null || echo 0)
if [ "${existing// /}" = "0" ]; then
  read -rp "Your email for the admin console: " ADMIN_EMAIL
  read -rp "Your name: " ADMIN_NAME
  docker compose exec -T api npx tsx scripts/create-admin.ts "$ADMIN_EMAIL" "$ADMIN_NAME"
  echo "Save that password now. At first sign-in you'll set up two-step sign-in with an authenticator app."
else
  echo "A platform admin already exists."
fi

cat <<EOF

Done.
  Labs sign up at:     https://$DOMAIN/signup
  Admin console:       https://$DOMAIN/admin
  Backups:             $(pwd)/backups (nightly, kept ${BACKUP_KEEP_DAYS:-14} days)
  Logs:                docker compose logs -f api
  Update after a code change:  git pull && docker compose up -d --build

If HTTPS isn't working yet, check the domain's DNS A record points at this server's IP,
then: docker compose restart caddy
EOF
