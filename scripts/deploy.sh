#!/usr/bin/env bash
# Deploy CareLoop to remote server
# Usage: ./scripts/deploy.sh

set -e

SERVER="root@47.108.85.216"
KEY="$HOME/.ssh/boyig.pem"
REMOTE_DIR="/opt/careloop/app"
REMOTE_ENV="/opt/careloop/.env"
COMPOSE_FILE="infra/docker/docker-compose.deploy.yml"

# Ensure we're in CareLoop root
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ ! -f "$KEY" ]]; then
  echo "Error: SSH key not found at $KEY"
  exit 1
fi

echo "==> Syncing files to $SERVER..."
rsync -avz --delete \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude "*.log" \
  --exclude data/venv \
  "$ROOT/" "$SERVER:$REMOTE_DIR/"

echo "==> Starting Docker Compose on server..."
ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && docker-compose -f $COMPOSE_FILE --env-file $REMOTE_ENV up --build -d"

echo "==> Deploy complete. App: https://careloop.boyig.com"
echo "    Health: https://careloop.boyig.com/api/health"
