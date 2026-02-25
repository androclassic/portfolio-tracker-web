#!/bin/bash
# deploy-webhook.sh — Lightweight webhook listener for auto-deploy.
#
# Listens on a port for POST requests from GitHub Actions, authenticates
# via a shared secret, then pulls the new Docker image and restarts.
#
# SETUP (on your server):
#   1. Copy this script to your server (e.g. /opt/portfolio-tracker/deploy-webhook.sh)
#   2. Set environment variables:
#        export DEPLOY_SECRET="your-random-secret"   # must match GitHub secret
#        export APP_DIR="/opt/portfolio-tracker"       # where docker-compose.yml lives
#        export PORT=9000                              # webhook listen port
#   3. Run:  bash deploy-webhook.sh
#   4. (Optional) Set up as a systemd service — see below.
#
# GITHUB SECRETS needed:
#   DEPLOY_WEBHOOK_URL    = http://your-server-ip:9000/deploy  (use real IP, not Cloudflare domain)
#   DEPLOY_WEBHOOK_SECRET = same value as DEPLOY_SECRET above
#
# SYSTEMD SERVICE (optional — keeps it running on reboot):
#   Save as /etc/systemd/system/deploy-webhook.service:
#     [Unit]
#     Description=Deploy webhook listener
#     After=network.target docker.service
#
#     [Service]
#     Type=simple
#     Environment=DEPLOY_SECRET=your-random-secret
#     Environment=APP_DIR=/opt/portfolio-tracker
#     Environment=PORT=9000
#     ExecStart=/bin/bash /opt/portfolio-tracker/deploy-webhook.sh
#     Restart=always
#     RestartSec=5
#
#     [Install]
#     WantedBy=multi-user.target
#
#   Then: systemctl enable deploy-webhook && systemctl start deploy-webhook

set -euo pipefail

DEPLOY_SECRET="${DEPLOY_SECRET:?Set DEPLOY_SECRET env var}"
APP_DIR="${APP_DIR:-/opt/portfolio-tracker}"
PORT="${PORT:-9000}"

echo "🚀 Deploy webhook listening on port $PORT..."

while true; do
  # Listen for one HTTP request using netcat
  RESPONSE=$(nc -l -p "$PORT" -q 1 2>/dev/null || nc -l "$PORT" 2>/dev/null) || true

  # Extract Authorization header
  AUTH=$(echo "$RESPONSE" | grep -i "^Authorization:" | sed 's/Authorization: Bearer //i' | tr -d '\r\n ')

  # Verify secret
  if [ "$AUTH" != "$DEPLOY_SECRET" ]; then
    echo "$(date): ❌ Unauthorized request"
    continue
  fi

  echo "$(date): ✅ Authorized deploy request received"

  # Pull and restart
  cd "$APP_DIR"
  docker compose pull 2>&1 | tail -5
  docker compose up -d 2>&1 | tail -5
  echo "$(date): ✅ Deploy complete"
  docker compose ps
done
