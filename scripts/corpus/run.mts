/**
 * Corpus migration orchestrator.
 *
 * Usage:
 *   # dry run — reads the corpus, writes nothing
 *   TILE_CORPUS_ROOT=... pnpm corpus:plan
 *
 *   # local rehearsal against the dev stack
 *   TILE_CORPUS_ROOT=... SUPABASE_LOCAL_SECRET_KEY=$(supabase status -o json | ...) \
 *     pnpm exec tsx scripts/corpus/run.mts --local
 *
 *   # hosted
 *   TILE_CORPUS_ROOT=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *     pnpm exec tsx scripts/corpus/run.mts --linked --workspace <id>
 *
 * Flags: --plan | --local | --linked, --workspace <id>, --corpus <path>,
 *        --only sources,shapes,candidates,visual,review, --skip-upload,
 *        --limit <n>, --allow-demo-workspace, --verbose
 *
 * The run is resumable: uploads are create-only and every write is an upsert on
 * a stable corpus key, so re-running after an interruption continues rather
 * than duplicating.
 */

import path from "node:path";
import { buildPlan, printPlan } from "./plan.mts";
import { importCorpus } from "./import-postgres.mts";
import { reconcile } from "./reconcile.mts";
import { uploadAll } from "./upload-storage.mts";
import {
  CORPUS_CUTOFF,
  PIPELINE_VERSION,
  announce,
  assertServerSide,
  client,
  fatal,
  heading,
  parseCli,
  resolveTarget,
  resolveWorkspace,
  writeState,
} from "./lib.mts";

assertServerSide();

const cli = parseCli(process.argv.slice(2));
const skipUpload = process.argv.includes("--skip-upload");

heading(`Tile Concept corpus migration · cutoff ${CORPUS_CUTOFF} · ${PIPELINE_VERSION}`);

// The plan is always built first: it is the reconciliation baseline, and it
// fails loudly if the corpus on disk no longer matches its own manifests.
const plan = await buildPlan(cli);
printPlan(plan);
await writeState(cli, "plan.json", plan);

if (plan.divergences.length) {
  fatal(
    "the corpus does not reconcile against its own manifests. Nothing was written.\n" +
      "  Resolve the divergences above before importing.",
  );
}

if (cli.target === "plan") {
  console.log("  plan only — nothing was written. Re-run with --local or --linked to import.\n");
  process.exit(0);
}

const target = resolveTarget(cli);
const supabase = client(target);
const workspace = await resolveWorkspace(supabase, cli);
announce(target, cli, workspace);

/**
 * The run ledger is written directly rather than through api.start_import_run.
 *
 * That function guards on core.require_permission, which needs an authenticated
 * member - correct for an operator triggering an import from the app, and
 * correctly refused for this tool, which holds the secret key and has no user
 * identity. The RPCs stay in place for the in-app path.
 */
const runKey = `corpus-${CORPUS_CUTOFF}-${target.projectRef}`;
const { data: runRow, error: runErr } = await supabase
  .from("import_runs")
  .upsert(
    {
      workspace_id: workspace.id,
      run_key: runKey,
      corpus_cutoff: CORPUS_CUTOFF,
      pipeline_version: PIPELINE_VERSION,
      parser_name: "discovery-corpus",
      parser_version: CORPUS_CUTOFF,
      target_env: target.env,
      status: "running",
      completed_at: null,
    },
    { onConflict: "workspace_id,run_key" },
  )
  .select("id")
  .single();
if (runErr || !runRow) fatal(`could not start the import run: ${runErr?.message ?? "no row"}`);
const runId = (runRow as { id: string }).id;
console.log("  import run  " + runId);
console.log("");

let status = "completed";
let errorCode: string | null = null;
let errorDetail: string | null = null;
const counts: Record<string, number> = {};

try {
  if (!skipUpload) {
    const uploaded = await uploadAll(supabase, target, cli, workspace.id);
    counts.objects_uploaded = uploaded.uploaded;
    counts.objects_already_present = uploaded.skippedExisting;
    counts.objects_failed = uploaded.failed.length;
    await writeState(cli, "upload.json", uploaded);
    if (uploaded.failed.length) {
      status = "failed_retryable";
      errorCode = "upload_incomplete";
      errorDetail = `${uploaded.failed.length} objects failed; see .local/corpus-import/upload.json`;
    }
  }

  Object.assign(counts, await importCorpus(supabase, cli, workspace.id, String(runId)));
} catch (err) {
  status = "failed_terminal";
  errorCode = "import_error";
  // Safe detail only: never a supplier value, a price row, or a document body.
  errorDetail = (err as Error).message?.slice(0, 500) ?? "unknown";
  console.error(`\n  import failed: ${errorDetail}\n`);
}

await supabase
  .from("import_runs")
  .update({
    status,
    completed_at: new Date().toISOString(),
    counts,
    warning_count: counts.objects_failed ?? 0,
    error_code: errorCode,
    error_detail_safe: errorDetail,
  })
  .eq("id", runId);

heading("Imported");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(34)} ${v.toLocaleString("en-US").padStart(10)}`);

const report = await reconcile(supabase, cli, workspace.id, `${target.env}:${target.projectRef}`, plan);
await writeState(cli, "reconciliation.json", report);
console.log(`  report written to ${path.join(cli.stateDir, "reconciliation.json")}\n`);

if (!report.ok || status !== "completed") process.exit(2);
