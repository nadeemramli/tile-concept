/**
 * OCR worker (TILE-22, PRD §12.5): leases queued OCR jobs, reads the scanned
 * pages with the locally installed Tesseract, stores the page image and raw
 * TSV as evidence in `ingest-artifacts`, and stages proposals for human
 * review. It never approves or publishes anything.
 *
 *   SUPABASE_URL=http://127.0.0.1:56321 SUPABASE_SECRET_KEY=… pnpm ocr:worker --once
 *
 * Flags: --once (drain due jobs, then exit) · --poll=<ms> (default 5000)
 *        --max-jobs=<n> · --worker=<name>
 *        --check (engine + read-only database check, claims nothing)
 * SUPABASE_SECRET_KEY_FILE reads the key from a file (a container secret).
 * Hosted placement: infra/ocr-worker/README.md.
 *
 * The document never leaves this machine: OCR is a local subprocess, with no
 * hosted provider, key or cost. The worker refuses a non-local Supabase URL
 * unless OCR_WORKER_ALLOW_REMOTE=1 is set deliberately by the operator.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { OcrFailure, detectEngine, runOcr, type EngineInfo } from "../../src/lib/ocr/engine";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  }),
);
const once = args.has("once");
const pollMs = Number(args.get("poll") ?? 5000);
const maxJobs = Number(args.get("max-jobs") ?? Infinity);
const workerName = args.get("worker") ?? `ocr-worker@${hostname()}:${process.pid}`;

const check = args.has("check");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
// A container reads the key from a mounted secret file (infra/ocr-worker).
const keyFile = process.env.SUPABASE_SECRET_KEY_FILE;
const key = keyFile ? readFileSync(keyFile, "utf8").trim() : (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required (the worker is a trusted server consumer).");
  process.exit(2);
}
const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(url);
if (!local && process.env.OCR_WORKER_ALLOW_REMOTE !== "1") {
  console.error(`Refusing to process jobs on ${new URL(url).host}: set OCR_WORKER_ALLOW_REMOTE=1 to run against a non-local project.`);
  process.exit(2);
}

const db = createClient(url, key, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });

interface ClaimedJob {
  job_id: string;
  lease_token: string;
  attempt: number;
  max_attempts: number;
  workspace_id: string;
  source_asset_id: string;
  name: string;
  kind: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_bucket: string;
  storage_path: string | null;
  pages: number[] | null;
  limits: { max_bytes: number; max_pages: number };
}

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), worker: workerName, msg, ...extra }));
}

async function fail(job: ClaimedJob, kind: string, error: string) {
  const { data, error: e } = await db.rpc("ocr_fail_job", { p_job_id: job.job_id, p_lease_token: job.lease_token, p_error: error, p_failure_kind: kind });
  if (e) log("could not record failure", { job: job.job_id, error: e.message });
  else log("job failed", { job: job.job_id, kind, error, result: data });
}

async function processJob(job: ClaimedJob, engine: EngineInfo | null) {
  log("claimed", { job: job.job_id, attempt: job.attempt, source: job.source_asset_id });
  if (!engine) return fail(job, "engine_unavailable", "Tesseract is not installed on the OCR worker");
  if (!job.storage_path) return fail(job, "source_missing", "The source has no stored original");
  // The service role can read any object, so the row's path is checked here:
  // a job only ever reads a file inside its own workspace's folder.
  if (!job.storage_path.startsWith(`${job.workspace_id}/`) || job.storage_path.split("/").includes("..")) {
    return fail(job, "source_missing", "The stored path is outside this workspace, so it was not read");
  }

  const dl = await db.storage.from(job.storage_bucket).download(job.storage_path);
  if (dl.error || !dl.data) return fail(job, "transient", `The original could not be downloaded (${dl.error?.message ?? "empty"})`);
  const bytes = new Uint8Array(await dl.data.arrayBuffer());

  let result;
  try {
    result = await runOcr({
      data: bytes,
      kind: job.kind,
      mimeType: job.mime_type,
      pages: job.pages,
      maxPages: job.limits.max_pages,
      maxBytes: job.limits.max_bytes,
      engineLabel: `tesseract ${engine.version}`,
    });
  } catch (e) {
    if (e instanceof OcrFailure) return fail(job, e.kind, e.message);
    return fail(job, "transient", e instanceof Error ? e.message : String(e));
  }

  // Evidence first: the page image a reviewer compares against, and the raw
  // engine output. Same key on a retry, so a re-run overwrites, not piles up.
  const pages = [];
  for (const p of result.pages) {
    const { png, tsv, ...row } = p;
    const base = `${job.workspace_id}/ocr/${job.job_id}/page-${p.page_no}`;
    let image_path: string | null = null;
    let tsv_path: string | null = null;
    if (png) {
      const up = await db.storage.from("ingest-artifacts").upload(`${base}.png`, png, { contentType: "image/png", upsert: true });
      if (up.error) return fail(job, "transient", `Page image upload failed: ${up.error.message}`);
      image_path = `${base}.png`;
    }
    if (tsv) {
      const up = await db.storage.from("ingest-artifacts").upload(`${base}.tsv.txt`, Buffer.from(tsv, "utf8"), { contentType: "text/plain", upsert: true });
      if (up.error) return fail(job, "transient", `OCR output upload failed: ${up.error.message}`);
      tsv_path = `${base}.tsv.txt`;
    }
    pages.push({ ...row, image_path, tsv_path });
  }

  const { data, error } = await db.rpc("ocr_complete_job", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
    p_records: result.records,
    p_pages: pages,
    p_stats: result.stats,
    p_engine: engine.engine,
    p_engine_version: engine.version,
  });
  if (error) {
    // A stale lease means another attempt owns the job now; anything else is
    // worth another try.
    if (error.code === "40001") return log("lease lost; result discarded", { job: job.job_id });
    return fail(job, "transient", `Storing the result failed: ${error.message}`);
  }
  log("job completed", { job: job.job_id, result: data, stats: result.stats });
}

async function main() {
  let engine: EngineInfo | null = null;
  try {
    engine = await detectEngine();
    log("engine ready", { engine: engine.engine, version: engine.version, languages: engine.languages });
  } catch (e) {
    log("engine unavailable — jobs will fail to manual entry", { error: e instanceof Error ? e.message : String(e) });
  }

  // --check: prove the engine and a read-only database round trip, claim nothing.
  if (check) {
    const { count, error } = await db.from("ocr_jobs").select("id", { count: "exact", head: true }).eq("status", "queued");
    log("check", { engine: engine ? `${engine.engine} ${engine.version}` : null, database: error ? `error: ${error.message}` : "ok", queued_jobs: count ?? null });
    process.exit(engine && !error ? 0 : 1);
  }

  let done = 0;
  for (;;) {
    const { data, error } = await db.rpc("ocr_claim_job", { p_worker: workerName, p_lease_seconds: 600 });
    if (error) {
      log("claim failed", { error: error.message });
      if (once) process.exit(1);
    } else if (data) {
      await processJob(data as ClaimedJob, engine);
      done += 1;
      if (done >= maxJobs) break;
      continue;
    } else if (once) {
      break;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  log("exiting", { processed: done });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
