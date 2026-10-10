# Tile Concept OCR worker (TILE-22)

The app never runs OCR on Vercel (PRD §12.5). Scanned pages wait in `ingest.ingestion_jobs` (`job_type='ocr'`, `status='queued'`) until a worker leases them, reads them with Tesseract and stages proposals for human review. With no worker running, jobs stay queued: the UI says so, and the Source Library's **Enter rows by hand** works regardless.

This directory runs that worker for the hosted project, following the `infra/n8n` pattern:
- a separate Compose project
- file-based secrets
- a read-only container
- no published port
- a read-only smoke test

## Placement options (owner decision)

| | A. On demand from the owner's machine | B. Always-on container on the existing automation host |
| --- | --- | --- |
| Runtime | `pnpm ocr:worker --once` in WSL, which already has Tesseract | `infra/ocr-worker` Compose project beside `tile-concept-automation` |
| When jobs run | When someone runs it | Polls every 10 s |
| New cost | None | None: shares the existing server; no new service, licence or API |
| Where the originals go | Supabase → the owner's machine | Supabase → the automation host |
| Credentials | Hosted service-role key in the owner's shell for that run | Hosted service-role key in `secrets/supabase_secret_key` (`0600`-style, never in Git or `.env`) |

The service-role key bypasses RLS. That is why the database, not the worker, enforces the rules:
- the worker RPCs are `service_role`-only
- a job is never handed a storage path outside its own workspace
- nothing is approved or published by the worker

The two options differ in where a copy of each scanned original is processed. Neither sends it to an outside OCR service.

## B. Container setup (on the host, by the owner)

1. Copy this directory to `/opt/tile-concept-ocr`. Copy `.env.example` to `.env` (mode `0600`) and set `OCR_WORKER_TAG` to the commit being deployed.
2. Store the hosted service-role key:

   ```bash
   install -d -m 0700 secrets
   umask 077
   printf '%s' '<service-role key>' > secrets/supabase_secret_key
   chmod 0644 secrets/supabase_secret_key   # same reason as infra/n8n: bind-mounted secrets keep host ownership, and the container runs as `node`
   ```

3. Build the image from a checkout of that commit:

   ```bash
   docker build -f infra/ocr-worker/Dockerfile -t tile-concept-ocr-worker:<commit> .
   ```

4. Run the read-only check, then start the worker:

   ```bash
   ./ops/smoke-test.sh
   docker compose --env-file .env up -d
   docker compose --env-file .env logs -f worker
   ```

   The check claims nothing and writes nothing.

## Order of operations for a release

1. Apply the migrations on the hosted project in order: `20261009000001`, `20261009000002`, `20261010000001`.
2. Deploy the app.
3. Start the worker: option A, or option B steps 1–4.
4. Smoke-test at the owner entrypoint:
   1. Upload a **synthetic** scan, made with `tests/fixtures/ocr/synthetic-scan.ts`.
   2. Let the worker read it, and confirm the page outcomes in the Source Library drawer.
   3. Open one proposal and check the boxed source line.
   4. **Reject** it with a reason, so nothing synthetic is published.
   5. Archive the synthetic source.

## Rollback

- To stop OCR: `docker compose --env-file .env down` (or stop running option A). Queued jobs wait, and manual entry still works.
- The migration is additive and can stay in place when the app is reverted.

## Logs

The worker writes one JSON line per event: claimed, completed, failed, lease lost. Docker's `json-file` driver keeps 3 × 10 MB. Failures also appear as `ingest.data_quality_issues` (`ocr_low_confidence`) and in the Source Library drawer.
