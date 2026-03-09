#!/usr/bin/env bash
# Create and import PostgreSQL credential in N8N.
# Run on server: ./scripts/n8n-setup-postgres-cred.sh
# Or: ssh -i ~/.ssh/boyig.pem root@47.108.85.216 'bash -s' < scripts/n8n-setup-postgres-cred.sh
# Requires: /opt/careloop/.env with POSTGRES_PASSWORD, POSTGRES_USER, POSTGRES_DB

set -e

# When run via ssh 'bash -s' < script, $0 is bash; use APP_DIR if set
APP_DIR="${APP_DIR:-/opt/careloop/app}"
cd "$APP_DIR" 2>/dev/null || cd "$(dirname "$0")/.."

# Load env
if [[ -f /opt/careloop/.env ]]; then
  set -a
  source /opt/careloop/.env
  set +a
fi

PG_USER="${POSTGRES_USER:-careloop}"
PG_DB="${POSTGRES_DB:-careloop}"
PG_PASS="${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in /opt/careloop/.env}"

CRED_FILE="/tmp/careloop-n8n-postgres-cred-$$.json"
cat > "$CRED_FILE" << CREDEOF
[
  {
    "id": "postgres-cred-new",
    "name": "CareLoop PostgreSQL New",
    "type": "postgres",
    "data": {
      "host": "db",
      "database": "$PG_DB",
      "user": "$PG_USER",
      "password": "$PG_PASS",
      "port": 5432,
      "ignoreSSL": true
    }
  }
]
CREDEOF

echo "==> Importing PostgreSQL credential into N8N..."
docker-compose -f infra/docker/docker-compose.deploy-prebuilt.yml --env-file /opt/careloop/.env run --rm \
  -v "$CRED_FILE:/tmp/cred.json:ro" -v docker_n8n_data:/home/node/.n8n \
  n8n import:credentials --input=/tmp/cred.json 2>&1

rm -f "$CRED_FILE"
echo "==> Done. Restart N8N if it was running: docker-compose -f infra/docker/docker-compose.deploy-prebuilt.yml --env-file /opt/careloop/.env restart n8n"
