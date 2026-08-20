/**
 * Shared plumbing for the discovery-corpus migration.
 *
 * Usage (from WSL, Node 24):
 *   TILE_CORPUS_ROOT="/mnt/c/.../Discovery Corpus/_local" \
 *   pnpm exec tsx scripts/corpus/run.ts --plan
 *
 * Rules this file exists to enforce:
 *  - the corpus root is explicit; nothing defaults to a machine-specific path
 *  - the target Supabase project is named out loud before anything is written
 *  - decimals stay exact decimal strings and never become JS floats
 *  - excluded sources are excluded by id, not by hoping they are unreadable
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

/** Every client here talks to the exposed `api` schema, never `public`. */
export type ApiClient = ReturnType<typeof client>;

// ---------------------------------------------------------------------------
// Corpus constants
// ---------------------------------------------------------------------------

/** Dated Drive cutoff this corpus was frozen at. */
export const CORPUS_CUTOFF = "2026-08-21";
export const PIPELINE_VERSION = "corpus-import/1.0.0";

/**
 * Google Drive file id of the Guocera credentials document.
 *
 * Excluded by id, deliberately: it also has a shape profile on disk, so
 * "skip anything without extracted text" would not have caught it. Its content
 * is never read, copied, uploaded, logged, or imported.
 */
export const EXCLUDED_SOURCE_IDS = new Set(["1TlyRsUiIPUp8a6tbdIrXTamgplJxca47cTXU95yR8h8"]);

/**
 * Source binaries not staged locally. Metadata and connector text are imported;
 * no object is uploaded and no placeholder is fabricated.
 */
export const DEFERRED_SOURCE_IDS = new Map<string, { name: string; sizeBytes: number }>([
  ["1DBnAxZPjvfTM1FWOCCwprFd6qm5EmGHq", { name: "Alpha Catalogoue 5th Edition", sizeBytes: 174_006_407 }],
  ["1qQT38waL5vbOmP8OpRt6FE74_TZKvzxJ", { name: "Large Format Bellezza Catalogue 2026", sizeBytes: 382_335_899 }],
]);

/** The seeded demo workspace. Never a target for real supplier content. */
export const DEMO_WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";

export const BUCKET_SOURCE = "source-assets";
export const BUCKET_MEDIA = "product-media";
export const BUCKET_ARTIFACTS = "ingest-artifacts";

/** Above this, the standard upload path stops being reliable; use TUS. */
export const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

export const REL = {
  driveInventory: "00 Source Manifests/drive-inventory-2026-08-21.jsonl",
  snapshotPdfs: "01 Source Snapshots/pdfs",
  snapshotImages: "01 Source Snapshots/images",
  rawDriveText: "02 Raw Extractions/drive-text",
  rawPdfOcr: "02 Raw Extractions/pdf-ocr",
  rawImageOcr: "02 Raw Extractions/images",
  shapeProfiles: "03 Shape Profiles/profiles.jsonl",
  shapeClusters: "04 Provisional Records/shape-clusters.jsonl",
  representativeSources: "04 Provisional Records/representative-sources.jsonl",
  catalogEditions: "04 Provisional Records/catalog-edition-candidates.jsonl",
  variants: "04 Provisional Records/product-variant-candidates.jsonl",
  prices: "04 Provisional Records/price-entry-candidates.jsonl",
  certificates: "04 Provisional Records/certificate-candidates.jsonl",
  amounts: "04 Provisional Records/commercial-amount-observations.jsonl",
  duplicates: "04 Provisional Records/duplicate-code-groups.jsonl",
  validationIssues: "04 Provisional Records/validation-issues.jsonl",
  mediaAssets: "05 Visual Corpus/records/media-assets.jsonl",
  visualObservations: "05 Visual Corpus/records/visual-observations.jsonl",
  semanticObservations: "05 Visual Corpus/records/semantic-visual-observations.jsonl",
  assetVariantLinks: "05 Visual Corpus/records/asset-variant-links.jsonl",
  contactSheetIndex: "05 Visual Corpus/records/contact-sheet-index.jsonl",
  contactSheets: "05 Visual Corpus/contact-sheets",
  reviewQueue: "06 Review Decisions/review-queue.jsonl",
  visualReviewQueue: "06 Review Decisions/visual-review-queue.jsonl",
} as const;

// ---------------------------------------------------------------------------
// CLI + environment
// ---------------------------------------------------------------------------

export type TargetEnv = "plan" | "local" | "linked";

export interface Cli {
  target: TargetEnv;
  corpusRoot: string;
  stateDir: string;
  workspaceId?: string;
  allowDemoWorkspace: boolean;
  only?: string;
  limit?: number;
  verbose: boolean;
}

export function parseCli(argv: string[]): Cli {
  const flag = (n: string) => argv.includes(`--${n}`);
  const val = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const target: TargetEnv = flag("linked") ? "linked" : flag("local") ? "local" : "plan";

  const corpusRoot = val("corpus") ?? process.env.TILE_CORPUS_ROOT ?? "";
  if (!corpusRoot) {
    fatal(
      "the corpus root is required: pass --corpus <path> or set TILE_CORPUS_ROOT.\n" +
        "It is never defaulted, because a wrong default would silently import the wrong tree.",
    );
  }

  return {
    target,
    corpusRoot,
    stateDir: val("state") ?? path.resolve(".local/corpus-import"),
    workspaceId: val("workspace") ?? process.env.TILE_WORKSPACE_ID,
    allowDemoWorkspace: flag("allow-demo-workspace") || target === "local",
    only: val("only"),
    limit: val("limit") ? Number(val("limit")) : undefined,
    verbose: flag("verbose"),
  };
}

export interface Target {
  env: TargetEnv;
  url: string;
  secretKey: string;
  projectRef: string;
}

const LOCAL_URL = "http://127.0.0.1:56321";

export function resolveTarget(cli: Cli): Target {
  if (cli.target === "local") {
    const key = process.env.SUPABASE_LOCAL_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (!key) fatal("SUPABASE_LOCAL_SECRET_KEY (or SUPABASE_SECRET_KEY) is required for --local.\nRead it from `supabase status`.");
    return { env: "local", url: process.env.SUPABASE_LOCAL_URL ?? LOCAL_URL, secretKey: key!, projectRef: "local" };
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fatal("SUPABASE_URL and SUPABASE_SECRET_KEY are required for --linked.");
  if (url!.includes("127.0.0.1") || url!.includes("localhost")) {
    fatal("--linked was given a local URL. Refusing: the target must be stated unambiguously.");
  }
  const ref = /https:\/\/([a-z0-9]+)\.supabase\./.exec(url!)?.[1];
  if (!ref) fatal(`could not read a project ref out of ${url}`);
  return { env: "linked", url: url!, secretKey: key!, projectRef: ref! };
}

/**
 * Server-side only. The secret key must never reach a browser bundle, so refuse
 * to run anywhere that looks like one.
 */
export function assertServerSide(): void {
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    fatal("this tool writes with the secret key and must only run server-side");
  }
}

export function client(target: Target) {
  // db.schema "api" matches the app: PostgREST exposes `api`, never `public`.
  return createClient(target.url, target.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "api" },
  });
}

/** Announce the target before anything is written. */
export function announce(target: Target, cli: Cli, workspace: { id: string; name: string; slug: string } | null): void {
  console.log("");
  console.log("  target      " + (target.env === "plan" ? "plan only — nothing will be written" : `${target.env} · ${target.url}`));
  if (target.env !== "plan") console.log("  project ref " + target.projectRef);
  if (workspace) console.log(`  workspace   ${workspace.name} (${workspace.slug}) ${workspace.id}`);
  console.log("  corpus      " + cli.corpusRoot);
  console.log("  state       " + cli.stateDir);
  console.log("");
}

export async function resolveWorkspace(
  supabase: ApiClient,
  cli: Cli,
): Promise<{ id: string; name: string; slug: string }> {
  const { data, error } = await supabase.from("workspaces").select("id, name, slug");
  if (error) fatal(`could not read workspaces: ${error.message}`);
  const rows = (data ?? []) as { id: string; name: string; slug: string }[];
  if (rows.length === 0) fatal("the target has no workspace");

  const chosen = cli.workspaceId ? rows.find((w) => w.id === cli.workspaceId) : rows.length === 1 ? rows[0] : undefined;
  if (!chosen) {
    fatal(
      `the workspace is ambiguous. Pass --workspace <id>. Available:\n` +
        rows.map((w) => `    ${w.id}  ${w.slug}`).join("\n"),
    );
  }
  if (chosen!.id === DEMO_WORKSPACE_ID && !cli.allowDemoWorkspace) {
    fatal(
      `${chosen!.slug} is the seeded demo workspace. Real supplier content does not belong there.\n` +
        "Pass --workspace <real id>, or --allow-demo-workspace if this really is a rehearsal.",
    );
  }
  return chosen!;
}

// ---------------------------------------------------------------------------
// Filesystem + JSONL
// ---------------------------------------------------------------------------

export function corpusPath(cli: Cli, rel: string): string {
  return path.join(cli.corpusRoot, rel);
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function sizeOf(p: string): Promise<number> {
  return (await stat(p)).size;
}

/**
 * Stream a JSONL file. The corpus is gigabytes; nothing here loads a whole tree
 * into memory just to count it.
 */
export async function* readJsonl<T = Record<string, unknown>>(file: string): AsyncGenerator<T> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t) yield JSON.parse(t) as T;
  }
}

export async function countJsonl(file: string): Promise<number> {
  let n = 0;
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) n++;
  return n;
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  const s = createReadStream(file);
  for await (const chunk of s) h.update(chunk as Buffer);
  return h.digest("hex");
}

export async function listFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * Keep a decimal exact.
 *
 * Postgres numeric accepts a string; JSON.parse would already have rounded a
 * float. The corpus carries amounts as strings for exactly this reason, so pass
 * them through untouched and let the database do the arithmetic.
 */
export function exactDecimal(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

export function nz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** Safe object-key segment: Drive names can contain slashes and unicode. */
export function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
}

// ---------------------------------------------------------------------------
// Object keys — workspace-first, content-addressed, bucket name never repeated
// ---------------------------------------------------------------------------

export function sourceObjectKey(ws: string, collection: string, sourceId: string, sha: string, fileName: string): string {
  return `${ws}/drive/${collection}/${sourceId}/${sha}/${safeFilename(fileName)}`;
}

export function pageObjectKey(ws: string, sourceId: string, page: number): string {
  return `${ws}/sources/${sourceId}/pages/page-${String(page).padStart(4, "0")}.jpg`;
}

export function imageObjectKey(ws: string, sourceId: string, sha: string): string {
  return `${ws}/sources/${sourceId}/images/${sha}.jpg`;
}

export function artifactObjectKey(ws: string, runId: string, kind: string, fileName: string): string {
  return `${ws}/runs/${runId}/${kind}/${safeFilename(fileName)}`;
}

// ---------------------------------------------------------------------------
// Corpus -> canonical vocabulary
// ---------------------------------------------------------------------------

/** The corpus names its observation bases more verbosely than the schema does. */
export function canonicalObservationBasis(raw: string): string {
  if (raw.startsWith("pixel_measurement")) return "pixel_measurement";
  if (raw.startsWith("visual_review_of_contact_sheet")) return "machine_visual_classification";
  if (raw.startsWith("ocr") || raw.includes("supplier_text")) return "ocr_or_supplier_text";
  if (raw.startsWith("human")) return "human_visual_review";
  return "machine_visual_classification";
}

export function canonicalLinkBasis(raw: string): string {
  switch (raw) {
    case "exact_normalized_ocr_code":
      return "exact_ocr_code";
    case "candidate_page_locator":
      return "same_catalog_page";
    case "exact_supplier_code":
    case "exact_ocr_code":
    case "same_catalog_page":
    case "same_source_document":
    case "manual_match":
      return raw;
    default:
      return "same_source_document";
  }
}

export const ROOT_CODE_TO_NAME: Record<string, string> = {
  deco_tiles: "Deco Tiles",
  base_tiles_oem: "Base Tiles (OEM)",
  base_tiles_local: "Base Tiles (LOCAL)",
};

const SUPPLY_MODEL: Record<string, string> = {
  base_tiles_local: "local",
  base_tiles_oem: "oem",
  deco_tiles: "unknown",
};
export function supplyModelFor(rootCode: string): string {
  return SUPPLY_MODEL[rootCode] ?? "unknown";
}

/** Technical format for ingest.source_assets.kind (which keeps its CHECK). */
export function assetKindFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "excel";
  if (mime === "text/csv") return "csv";
  return "url";
}

// ---------------------------------------------------------------------------
// Resume state
// ---------------------------------------------------------------------------

export async function ensureStateDir(cli: Cli): Promise<void> {
  await mkdir(cli.stateDir, { recursive: true });
}

export async function readState<T>(cli: Cli, name: string, fallback: T): Promise<T> {
  const p = path.join(cli.stateDir, name);
  if (!(await exists(p))) return fallback;
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeState(cli: Cli, name: string, data: unknown): Promise<void> {
  await ensureStateDir(cli);
  await writeFile(path.join(cli.stateDir, name), JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Batching + retry
// ---------------------------------------------------------------------------

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const RETRYABLE = [408, 425, 429, 500, 502, 503, 504];

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number") return RETRYABLE.includes(status);
  const msg = String(e?.message ?? "");
  return /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed/i.test(msg);
}

/** Bounded retry, retryable failures only — a 4xx schema error must not loop. */
export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      const wait = 500 * 2 ** i;
      console.warn(`  retrying ${label} in ${wait}ms (${i + 1}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function fatal(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

export function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

export function row(label: string, value: string | number, note = ""): void {
  const v = typeof value === "number" ? value.toLocaleString("en-US") : value;
  console.log(`  ${label.padEnd(34)} ${String(v).padStart(14)}${note ? "  " + note : ""}`);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
