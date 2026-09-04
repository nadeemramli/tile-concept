#!/usr/bin/env bash
set -euo pipefail

project_dir="${N8N_PROJECT_DIR:-/opt/tile-concept-automation}"
backup_dir="${N8N_BACKUP_DIR:-/var/backups/tile-concept-n8n}"
retention_days="${N8N_BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary_path="${backup_dir}/.${timestamp}.dump.partial"
backup_path="${backup_dir}/n8n-${timestamp}.dump"

umask 077
install -d -m 0700 "${backup_dir}"
trap 'rm -f "${temporary_path}"' EXIT

cd "${project_dir}"
docker compose --env-file .env -f compose.yaml exec -T postgres \
  sh -lc 'exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --compress=zstd:6' \
  > "${temporary_path}"

docker compose --env-file .env -f compose.yaml exec -T postgres \
  sh -lc 'exec pg_restore --list' < "${temporary_path}" > /dev/null

mv "${temporary_path}" "${backup_path}"
chmod 0600 "${backup_path}"
find "${backup_dir}" -type f -name 'n8n-*.dump' -mtime "+${retention_days}" -delete

printf 'Created %s\n' "${backup_path}"

