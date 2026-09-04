# Tile Concept automation host

This stack runs self-hosted n8n Community Edition on the existing Hetzner server. It is deliberately separate from Metrimap: its own Compose project, PostgreSQL database, volumes, secrets, execution retention, and backups. Only the n8n service joins Metrimap's existing `deploy_default` network so the existing Caddy proxy can reach it.

## Services

- `n8n` — pinned workflow runtime and editor; no host port is published.
- `postgres` — private PostgreSQL database on an internal-only network.
- `intake-relay` — internal HMAC signer for the Tile Concept intake API. n8n never receives the signing secret.
- `task-runners` — matching-version distroless sidecar for isolated JavaScript and Python Code nodes.
- the existing `deploy-caddy-1` container — terminates HTTPS for `n8n.canvasm.app`.

## Initial server setup

1. Copy this directory to `/opt/tile-concept-automation`.
2. Copy `.env.example` to `.env` and keep it mode `0600`.
3. Replace `N8N_RUNNERS_AUTH_TOKEN` in `.env` with an independent random value, then generate three independent file secrets in `secrets/`:

   ```bash
   install -d -m 0700 secrets
   umask 077
   openssl rand -hex 32 | tr -d '\n' > secrets/postgres_password
   openssl rand -hex 32 | tr -d '\n' > secrets/n8n_encryption_key
   openssl rand -hex 32 | tr -d '\n' > secrets/tc_intake_secret
   chmod 0644 secrets/postgres_password secrets/n8n_encryption_key secrets/tc_intake_secret
   ```

   The `secrets/` directory remains mode `0700` and root-owned on the host. The
   files are `0644` because Docker Compose bind-mounts local secrets without
   remapping ownership, while the n8n and relay containers run as non-root.

4. Validate and start the isolated stack:

   ```bash
   docker compose --env-file .env config --quiet
   docker compose --env-file .env pull
   docker compose --env-file .env build --pull intake-relay
   docker compose --env-file .env up -d
   ./ops/smoke-test.sh
   docker run --rm --network tile-concept-automation_relay \
     -v /opt/tile-concept-automation/ops/verify-intake.mjs:/app/verify-intake.mjs:ro \
     node:24.19.0-alpine3.23 node /app/verify-intake.mjs
   ```

5. Point the `n8n.canvasm.app` A record to the server, add `Caddyfile.snippet` to the existing Metrimap Caddyfile, validate it, and reload Caddy.
6. Before removing the temporary source-IP restriction, create the n8n owner account and enable 2FA.
7. Install and enable the backup timer, then run one backup immediately:

   ```bash
   install -m 0644 ops/tile-concept-n8n-backup.service /etc/systemd/system/
   install -m 0644 ops/tile-concept-n8n-backup.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now tile-concept-n8n-backup.timer
   systemctl start tile-concept-n8n-backup.service
   ```

## Lead workflow boundary

n8n normalizes provider fields to the app contract, then posts the JSON to `http://intake-relay:3000/intake`. The relay signs the exact body with `x-tc-timestamp` and `x-tc-signature` and forwards it to `/api/intake/automation`. The app handles idempotency and returns `lead_url`, `whatsapp_url`, and `notification_text` for the notification step.

TikTok API credentials and WhatsApp provider credentials belong in n8n's encrypted credential store, never in this repository or workflow JSON. The TikTok app needs the `Lead Management > Leads Retrieval` permission and the advertiser account authorization before a production workflow can be activated.

## Backups and restore material

The timer keeps 14 days of local logical database dumps under `/var/backups/tile-concept-n8n`. A same-server dump protects against application mistakes, not server loss. Before calling this production-ready, copy backups off-server or enable Hetzner backups, and store the three secret files in the approved password manager. A database dump is not usable without the original n8n encryption key.

Do not auto-upgrade the images. Change the pinned versions in a pull request, back up first, then recreate the services and run the smoke test plus `n8n audit`.
