/**
 * Reconcile the corpus against what actually landed in Supabase.
 *
 * Compares three independent things — the corpus manifests, the Storage object
 * listing, and the database rows — and reports every divergence with the source
 * id, the expected value, the actual value, and the next action. A divergence
 * is an exception to be resolved, never a rounding difference to be waved
 * through.
 */

import {
  BUCKET_ARTIFACTS,
  BUCKET_MEDIA,
  BUCKET_SOURCE,
  DEFERRED_SOURCE_IDS,
  EXCLUDED_SOURCE_IDS,
  heading,
  row,
  type ApiClient,
  type Cli,
} from "./lib.mts";
import type { CorpusPlan } from "./plan.mts";

export interface Exception {
  scope: string;
  sourceId?: string;
  expected: string | number;
  actual: string | number;
  nextAction: string;
}

export interface ReconciliationReport {
  workspaceId: string;
  target: string;
  checkedAt: string;
  database: Record<string, number>;
  storage: Record<string, number>;
  exceptions: Exception[];
  ok: boolean;
}

async function countObjects(supabase: ApiClient, bucket: string, prefix: string): Promise<number> {
  // Storage list() is paged and does not recurse, so walk the prefixes we own.
  let total = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) throw new Error(`${bucket}/${dir}: ${error.message}`);
      const entries = data ?? [];
      for (const e of entries) {
        // A folder placeholder has no id; a real object does.
        if (e.id) total++;
        else await walk(dir ? `${dir}/${e.name}` : e.name, depth + 1);
      }
      if (entries.length < 1000) break;
    }
  };
  await walk(prefix, 0);
  return total;
}

export async function reconcile(
  supabase: ApiClient,
  cli: Cli,
  workspaceId: string,
  target: string,
  plan: CorpusPlan,
): Promise<ReconciliationReport> {
  const exceptions: Exception[] = [];
  const expect = (scope: string, expected: number, actual: number, nextAction: string, sourceId?: string) => {
    if (expected !== actual) exceptions.push({ scope, sourceId, expected, actual, nextAction });
  };

  const { data, error } = await supabase.from("corpus_reconciliation").select("*").eq("workspace_id", workspaceId).single();
  if (error) throw new Error(`corpus_reconciliation: ${error.message}`);
  const db = data as unknown as Record<string, number>;

  // -- Row counts ------------------------------------------------------------
  expect("source assets", plan.drive.files, db.source_assets, "re-run the sources stage");
  expect("versions uploaded", plan.staged.pdfs + plan.staged.images, db.versions_uploaded, "re-run upload-storage");
  expect("versions deferred", plan.exceptions.deferredBinaries.length, db.versions_deferred, "confirm both large PDFs are still deferred");
  expect("versions excluded", plan.exceptions.credentialDocuments.length, db.versions_excluded, "the credentials document must remain excluded_by_policy");
  expect("media assets", plan.visual.mediaAssets, db.media_assets, "re-run the visual stage");
  expect("page renders", plan.visual.byKind.pdf_page_render ?? 0, db.page_renders, "only manifest-indexed renders may exist");
  expect("standalone images", plan.visual.byKind.standalone_image ?? 0, db.standalone_images, "re-run the visual stage");
  expect("source pdfs", plan.visual.byKind.source_pdf ?? 0, db.source_pdfs, "re-run the visual stage");
  expect(
    "visual observations",
    plan.visual.visualObservations + plan.visual.semanticObservations,
    db.visual_observations,
    "re-run the visual stage",
  );
  expect("media-variant links", plan.visual.assetVariantLinks, db.media_links, "re-run the visual stage");
  expect("variant candidates", plan.candidates.variants, db.variant_candidates, "re-run the candidates stage");
  expect("price candidates", plan.candidates.prices, db.price_candidates, "re-run the candidates stage");
  expect("certificate candidates", plan.candidates.certificates, db.certificate_candidates, "re-run the candidates stage");
  expect("catalog edition candidates", plan.candidates.catalogEditions, db.catalog_edition_candidates, "re-run the candidates stage");
  expect("commercial amounts", plan.candidates.amounts, db.commercial_amount_observations, "re-run the candidates stage");
  expect("duplicate code groups", plan.candidates.duplicates, db.duplicate_code_groups, "re-run the candidates stage");
  expect("shape profiles", plan.candidates.shapeProfiles - plan.exceptions.credentialDocuments.length, db.shape_profiles, "the credentials profile must not be imported");
  expect(
    "review tasks",
    plan.review.generalTasks + plan.review.visualTasks,
    db.corpus_review_tasks,
    "re-run the review stage",
  );

  // -- The safety invariant: nothing published ------------------------------
  expect("variant candidates still pending", 0, db.variant_candidates_not_pending, "a variant candidate was published — investigate before continuing");
  expect("price candidates still pending", 0, db.price_candidates_not_pending, "a price candidate was published — investigate before continuing");
  expect("certificate candidates still pending", 0, db.certificate_candidates_not_pending, "a certificate was published — investigate before continuing");

  // -- The excluded and deferred sources ------------------------------------
  for (const id of EXCLUDED_SOURCE_IDS) {
    const { count } = await supabase
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("source_asset_id", id);
    if (count) {
      exceptions.push({
        scope: "credential document",
        sourceId: id,
        expected: 0,
        actual: count,
        nextAction: "delete these rows; the credentials document must never be ingested",
      });
    }
  }

  const { data: deferredRows } = await supabase
    .from("source_asset_versions")
    .select("id, snapshot_state, storage_path, source_asset_id")
    .eq("workspace_id", workspaceId)
    .eq("snapshot_state", "binary_not_staged");
  for (const r of (deferredRows ?? []) as { storage_path: string | null }[]) {
    if (r.storage_path) {
      exceptions.push({
        scope: "deferred binary",
        expected: "no object",
        actual: r.storage_path,
        nextAction: "a deferred source must have no Storage object and no placeholder",
      });
    }
  }
  if ((deferredRows ?? []).length !== DEFERRED_SOURCE_IDS.size) {
    exceptions.push({
      scope: "deferred binaries",
      expected: DEFERRED_SOURCE_IDS.size,
      actual: (deferredRows ?? []).length,
      nextAction: "Alpha and Belleza must both remain binary_not_staged",
    });
  }

  // -- Storage --------------------------------------------------------------
  const storage: Record<string, number> = {};
  try {
    storage.sourceAssets = await countObjects(supabase, BUCKET_SOURCE, `${workspaceId}/drive`);
    storage.productMedia = await countObjects(supabase, BUCKET_MEDIA, `${workspaceId}/sources`);
    storage.artifacts = await countObjects(supabase, BUCKET_ARTIFACTS, `${workspaceId}`);
  } catch (err) {
    exceptions.push({
      scope: "storage listing",
      expected: "readable",
      actual: (err as Error).message,
      nextAction: "check the bucket policies",
    });
  }

  expect("storage: originals", plan.upload.originals.count, storage.sourceAssets ?? 0, "re-run upload-storage");
  expect(
    "storage: renders + images",
    plan.upload.pageRenders.count + plan.upload.standaloneImages.count,
    storage.productMedia ?? 0,
    "re-run upload-storage",
  );

  // -- Anonymous access must be refused -------------------------------------
  const anonBlocked = await anonymousAccessBlocked(supabase, workspaceId);
  if (!anonBlocked) {
    exceptions.push({
      scope: "anonymous access",
      expected: "denied",
      actual: "an object was readable without credentials",
      nextAction: "the bucket is not private — stop and fix the policy before continuing",
    });
  }

  const report: ReconciliationReport = {
    workspaceId,
    target,
    checkedAt: new Date().toISOString(),
    database: db,
    storage,
    exceptions,
    ok: exceptions.length === 0,
  };

  printReport(report);
  return report;
}

/** A public URL for a private bucket must not resolve. */
async function anonymousAccessBlocked(supabase: ApiClient, workspaceId: string): Promise<boolean> {
  const { data } = await supabase.storage.from(BUCKET_SOURCE).list(`${workspaceId}/drive`, { limit: 1 });
  const first = (data ?? [])[0];
  if (!first) return true;
  const { data: pub } = supabase.storage.from(BUCKET_SOURCE).getPublicUrl(`${workspaceId}/drive/${first.name}`);
  try {
    const res = await fetch(pub.publicUrl, { method: "HEAD" });
    return !res.ok;
  } catch {
    return true;
  }
}

function printReport(report: ReconciliationReport): void {
  heading("Database");
  for (const [k, v] of Object.entries(report.database)) {
    if (k === "workspace_id") continue;
    row(k, v as number);
  }

  heading("Storage objects");
  for (const [k, v] of Object.entries(report.storage)) row(k, v);

  heading("Reconciliation");
  if (report.ok) {
    console.log("  every count reconciles; nothing is published; the excluded and deferred sources are absent");
  } else {
    for (const e of report.exceptions) {
      console.log(`  EXCEPTION  ${e.scope}${e.sourceId ? ` [${e.sourceId}]` : ""}`);
      console.log(`             expected ${e.expected}, actual ${e.actual}`);
      console.log(`             next: ${e.nextAction}`);
    }
  }
  console.log("");
}
