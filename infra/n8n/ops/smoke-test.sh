#!/usr/bin/env bash
set -euo pipefail

project_dir="${N8N_PROJECT_DIR:-/opt/tile-concept-automation}"
cd "${project_dir}"

docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml exec -T n8n \
  node -e "fetch('http://127.0.0.1:5678/healthz').then(async r => { process.stdout.write(await r.text()); if (!r.ok) process.exit(1) })"
docker compose --env-file .env -f compose.yaml exec -T intake-relay \
  node -e "fetch('http://127.0.0.1:3000/healthz').then(async r => { process.stdout.write(await r.text()); if (!r.ok) process.exit(1) })"

