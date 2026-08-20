/**
 * Corpus plan / dry run.
 *
 * Walks the discovery corpus, recomputes every count from the files themselves,
 * and writes a reconciliation baseline. Nothing is written to Supabase.
 *
 * The counts published in the discovery reports are treated as claims to be
 * checked, not as facts to be trusted: this recomputes them and reports any
 * divergence rather than asserting the documented number.
 *
 * Usage:
 *   TILE_CORPUS_ROOT="/mnt/c/.../Discovery Corpus/_local" \
 *   pnpm exec tsx scripts/corpus/plan.ts
 */

import path from "node:path";
import {
  CORPUS_CUTOFF,
  DEFERRED_SOURCE_IDS,
  EXCLUDED_SOURCE_IDS,
  REL,
  RESUMABLE_THRESHOLD_BYTES,
  bytes,
  corpusPath,
  countJsonl,
  exists,
  heading,
  listFiles,
  parseCli,
  readJsonl,
  row,
  sizeOf,
  type Cli,
} from "./lib.mts";

export interface DriveFile {
  root_code: string;
  root_name: string;
  parent_folder_id: string | null;
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  mime_type: string;
  size: string | number | null;
  created_time: string | null;
  modified_time: string | null;
  url: string | null;
}

export interface MediaAssetRecord {
  media_asset_id: string;
  asset_kind: "source_pdf" | "standalone_image" | "pdf_page_render";
  source_id: string;
  source_path: string;
  source_url: string | null;
  local_path: string;
  file_name: string;
  sha256: string;
  size_bytes: number | null;
  page_number: number | null;
  document_class: string | null;
  brand_hint: string | null;
  review_state: string;
  width_px?: number;
  height_px?: number;
  orientation?: string;
  parent_pdf_local_path?: string;
}

export interface CorpusPlan {
  generatedFor: string;
  corpusCutoff: string;
  drive: {
    files: number;
    folders: number;
    byMime: Record<string, number>;
    byRoot: Record<string, number>;
    totalSizeBytes: number;
  };
  staged: { pdfs: number; images: number };
  exceptions: {
    credentialDocuments: { id: string; path: string }[];
    deferredBinaries: { id: string; path: string; sizeBytes: number }[];
    connectorTextOnly: { id: string; path: string; mime: string }[];
  };
  candidates: Record<string, number>;
  visual: {
    mediaAssets: number;
    byKind: Record<string, number>;
    physicalPageRenders: number;
    orphanPageRenders: number;
    visualObservations: number;
    semanticObservations: number;
    assetVariantLinks: number;
    distinctLinkedVariants: number;
    contactSheets: number;
    contactSheetRows: number;
  };
  review: { generalTasks: number; visualTasks: number };
  upload: {
    originals: { count: number; bytes: number; resumable: number };
    pageRenders: { count: number; bytes: number };
    standaloneImages: { count: number; bytes: number };
    contactSheets: { count: number; bytes: number };
    totalBytes: number;
  };
  divergences: string[];
}

/** Counts asserted by the discovery reports, checked rather than assumed. */
const DOCUMENTED = {
  driveFiles: 242,
  stagedPdfs: 154,
  stagedImages: 76,
  shapeProfiles: 242,
  catalogEditions: 160,
  variants: 6011,
  prices: 10183,
  certificates: 62,
  amounts: 253,
  duplicates: 238,
  mediaAssets: 2252,
  pageRenders: 2022,
  standaloneImages: 76,
  visualObservations: 2098,
  semanticObservations: 76,
  assetVariantLinks: 3344,
  distinctLinkedVariants: 1522,
  contactSheets: 9,
  generalTasks: 433,
  visualTasks: 2015,
};

export async function buildPlan(cli: Cli): Promise<CorpusPlan> {
  const divergences: string[] = [];
  const check = (label: string, actual: number, expected: number) => {
    if (actual !== expected) divergences.push(`${label}: recomputed ${actual}, reports claim ${expected}`);
  };

  // -- Drive manifest --------------------------------------------------------
  const driveFiles: DriveFile[] = [];
  let folders = 0;
  const byMime: Record<string, number> = {};
  const byRoot: Record<string, number> = {};
  let totalSize = 0;

  for await (const r of readJsonl<DriveFile>(corpusPath(cli, REL.driveInventory))) {
    if (r.kind === "folder") {
      folders++;
      continue;
    }
    driveFiles.push(r);
    byMime[r.mime_type] = (byMime[r.mime_type] ?? 0) + 1;
    byRoot[r.root_name] = (byRoot[r.root_name] ?? 0) + 1;
    if (r.size) totalSize += Number(r.size);
  }
  check("drive files", driveFiles.length, DOCUMENTED.driveFiles);

  // -- Staged snapshots ------------------------------------------------------
  const pdfFiles = await listFiles(corpusPath(cli, REL.snapshotPdfs));
  const imageFiles = await listFiles(corpusPath(cli, REL.snapshotImages));
  check("staged pdfs", pdfFiles.length, DOCUMENTED.stagedPdfs);
  check("staged images", imageFiles.length, DOCUMENTED.stagedImages);

  const stagedIds = new Set([...pdfFiles, ...imageFiles].map((f) => path.parse(f).name));

  // -- Exceptions ------------------------------------------------------------
  const credentialDocuments: { id: string; path: string }[] = [];
  const deferredBinaries: { id: string; path: string; sizeBytes: number }[] = [];
  const connectorTextOnly: { id: string; path: string; mime: string }[] = [];

  for (const f of driveFiles) {
    if (EXCLUDED_SOURCE_IDS.has(f.id)) {
      credentialDocuments.push({ id: f.id, path: f.path });
      continue;
    }
    if (stagedIds.has(f.id)) continue;
    if (DEFERRED_SOURCE_IDS.has(f.id)) {
      deferredBinaries.push({ id: f.id, path: f.path, sizeBytes: Number(f.size ?? 0) });
    } else {
      connectorTextOnly.push({ id: f.id, path: f.path, mime: f.mime_type });
    }
  }
  if (credentialDocuments.length !== 1) {
    divergences.push(`credential documents: found ${credentialDocuments.length}, expected exactly 1`);
  }
  if (deferredBinaries.length !== 2) {
    divergences.push(`deferred binaries: found ${deferredBinaries.length}, expected exactly 2`);
  }

  // -- Candidate datasets ----------------------------------------------------
  const candidates: Record<string, number> = {
    shapeProfiles: await countJsonl(corpusPath(cli, REL.shapeProfiles)),
    shapeClusters: await countJsonl(corpusPath(cli, REL.shapeClusters)),
    catalogEditions: await countJsonl(corpusPath(cli, REL.catalogEditions)),
    variants: await countJsonl(corpusPath(cli, REL.variants)),
    prices: await countJsonl(corpusPath(cli, REL.prices)),
    certificates: await countJsonl(corpusPath(cli, REL.certificates)),
    amounts: await countJsonl(corpusPath(cli, REL.amounts)),
    duplicates: await countJsonl(corpusPath(cli, REL.duplicates)),
    validationIssues: await countJsonl(corpusPath(cli, REL.validationIssues)),
  };
  check("shape profiles", candidates.shapeProfiles, DOCUMENTED.shapeProfiles);
  check("catalog edition candidates", candidates.catalogEditions, DOCUMENTED.catalogEditions);
  check("variant candidates", candidates.variants, DOCUMENTED.variants);
  check("price candidates", candidates.prices, DOCUMENTED.prices);
  check("certificate candidates", candidates.certificates, DOCUMENTED.certificates);
  check("commercial amount observations", candidates.amounts, DOCUMENTED.amounts);
  check("duplicate code groups", candidates.duplicates, DOCUMENTED.duplicates);

  // -- Visual corpus ---------------------------------------------------------
  const byKind: Record<string, number> = {};
  const indexedRenderPaths = new Set<string>();
  const upload = {
    originals: { count: 0, bytes: 0, resumable: 0 },
    pageRenders: { count: 0, bytes: 0 },
    standaloneImages: { count: 0, bytes: 0 },
    contactSheets: { count: 0, bytes: 0 },
    totalBytes: 0,
  };
  let mediaAssets = 0;
  const missingLocal: string[] = [];

  for await (const m of readJsonl<MediaAssetRecord>(corpusPath(cli, REL.mediaAssets))) {
    mediaAssets++;
    byKind[m.asset_kind] = (byKind[m.asset_kind] ?? 0) + 1;

    if (EXCLUDED_SOURCE_IDS.has(m.source_id) || DEFERRED_SOURCE_IDS.has(m.source_id)) {
      divergences.push(`media asset ${m.media_asset_id} belongs to an excluded or deferred source`);
      continue;
    }

    const local = toWslPath(m.local_path, cli);
    if (!(await exists(local))) {
      missingLocal.push(m.media_asset_id);
      continue;
    }
    const size = await sizeOf(local);

    if (m.asset_kind === "source_pdf") {
      upload.originals.count++;
      upload.originals.bytes += size;
      if (size > RESUMABLE_THRESHOLD_BYTES) upload.originals.resumable++;
    } else if (m.asset_kind === "pdf_page_render") {
      indexedRenderPaths.add(path.resolve(local).toLowerCase());
      upload.pageRenders.count++;
      upload.pageRenders.bytes += size;
    } else {
      upload.standaloneImages.count++;
      upload.standaloneImages.bytes += size;
    }
  }
  if (missingLocal.length) divergences.push(`${missingLocal.length} media assets have no local file`);
  check("media assets", mediaAssets, DOCUMENTED.mediaAssets);
  check("page renders", byKind.pdf_page_render ?? 0, DOCUMENTED.pageRenders);
  check("standalone images", byKind.standalone_image ?? 0, DOCUMENTED.standaloneImages);

  // The render directory keeps intermediate leftovers from earlier passes. Only
  // what the manifest indexes is corpus content.
  const renderRoot = corpusPath(cli, "05 Visual Corpus/page-renders");
  const physicalRenders = await countRenderFiles(renderRoot);
  const orphanRenders = physicalRenders.total - indexedRenderPaths.size;

  const visualObservations = await countJsonl(corpusPath(cli, REL.visualObservations));
  const semanticObservations = await countJsonl(corpusPath(cli, REL.semanticObservations));
  const contactSheetRows = await countJsonl(corpusPath(cli, REL.contactSheetIndex));
  check("visual observations", visualObservations, DOCUMENTED.visualObservations);
  check("semantic observations", semanticObservations, DOCUMENTED.semanticObservations);

  let assetVariantLinks = 0;
  const linkedVariants = new Set<string>();
  for await (const l of readJsonl<{ variant_candidate_id: string }>(corpusPath(cli, REL.assetVariantLinks))) {
    assetVariantLinks++;
    linkedVariants.add(l.variant_candidate_id);
  }
  check("asset variant links", assetVariantLinks, DOCUMENTED.assetVariantLinks);
  check("distinct linked variants", linkedVariants.size, DOCUMENTED.distinctLinkedVariants);

  const sheetFiles = await listFiles(corpusPath(cli, REL.contactSheets));
  for (const f of sheetFiles) {
    upload.contactSheets.count++;
    upload.contactSheets.bytes += await sizeOf(path.join(corpusPath(cli, REL.contactSheets), f));
  }
  check("contact sheets", sheetFiles.length, DOCUMENTED.contactSheets);

  const generalTasks = await countJsonl(corpusPath(cli, REL.reviewQueue));
  const visualTasks = await countJsonl(corpusPath(cli, REL.visualReviewQueue));
  check("general review tasks", generalTasks, DOCUMENTED.generalTasks);
  check("visual review tasks", visualTasks, DOCUMENTED.visualTasks);

  upload.totalBytes =
    upload.originals.bytes + upload.pageRenders.bytes + upload.standaloneImages.bytes + upload.contactSheets.bytes;

  return {
    generatedFor: cli.corpusRoot,
    corpusCutoff: CORPUS_CUTOFF,
    drive: { files: driveFiles.length, folders, byMime, byRoot, totalSizeBytes: totalSize },
    staged: { pdfs: pdfFiles.length, images: imageFiles.length },
    exceptions: { credentialDocuments, deferredBinaries, connectorTextOnly },
    candidates,
    visual: {
      mediaAssets,
      byKind,
      physicalPageRenders: physicalRenders.total,
      orphanPageRenders: orphanRenders,
      visualObservations,
      semanticObservations,
      assetVariantLinks,
      distinctLinkedVariants: linkedVariants.size,
      contactSheets: sheetFiles.length,
      contactSheetRows,
    },
    review: { generalTasks, visualTasks },
    upload,
    divergences,
  };
}

async function countRenderFiles(root: string): Promise<{ total: number }> {
  const { readdir } = await import("node:fs/promises");
  if (!(await exists(root))) return { total: 0 };
  let total = 0;
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const files = await readdir(path.join(root, dir.name));
    total += files.filter((f) => f.toLowerCase().endsWith(".jpg")).length;
  }
  return { total };
}

/**
 * The corpus manifests record Windows paths; the importer runs under WSL. Map
 * the recorded absolute path back onto the configured corpus root so the
 * manifest stays the authority for *which* file, not for where it is mounted.
 */
export function toWslPath(recorded: string, cli: Cli): string {
  const marker = "Discovery Corpus\\_local\\";
  const i = recorded.indexOf(marker);
  if (i === -1) return recorded;
  const rel = recorded.slice(i + marker.length).replace(/\\/g, "/");
  return path.join(cli.corpusRoot, rel);
}

export function printPlan(plan: CorpusPlan): void {
  heading("Drive manifest");
  row("files", plan.drive.files);
  row("folders", plan.drive.folders);
  for (const [mime, n] of Object.entries(plan.drive.byMime).sort((a, b) => b[1] - a[1])) row(`  ${mime}`, n);
  row("total size", bytes(plan.drive.totalSizeBytes));

  heading("Staged locally");
  row("source pdfs", plan.staged.pdfs);
  row("standalone images", plan.staged.images);

  heading("Exceptions");
  for (const c of plan.exceptions.credentialDocuments) console.log(`  credential (never read)   ${c.path}`);
  for (const d of plan.exceptions.deferredBinaries) console.log(`  binary_not_staged         ${d.path} (${bytes(d.sizeBytes)})`);
  row("connector_text_only", plan.exceptions.connectorTextOnly.length, "Google Docs and XLSX with no local binary");

  heading("Candidates (all remain pending review)");
  for (const [k, v] of Object.entries(plan.candidates)) row(k, v);

  heading("Visual corpus");
  row("media assets", plan.visual.mediaAssets);
  for (const [k, v] of Object.entries(plan.visual.byKind)) row(`  ${k}`, v);
  row("page renders on disk", plan.visual.physicalPageRenders);
  row("orphan renders (skipped)", plan.visual.orphanPageRenders, "not indexed by the manifest");
  row("visual observations", plan.visual.visualObservations);
  row("semantic observations", plan.visual.semanticObservations);
  row("media-variant links", plan.visual.assetVariantLinks);
  row("distinct linked variants", plan.visual.distinctLinkedVariants);
  row("contact sheets", plan.visual.contactSheets);

  heading("Review queues");
  row("general tasks", plan.review.generalTasks);
  row("visual tasks", plan.review.visualTasks);

  heading("Upload plan");
  row("originals", plan.upload.originals.count, `${bytes(plan.upload.originals.bytes)} · ${plan.upload.originals.resumable} resumable`);
  row("page renders", plan.upload.pageRenders.count, bytes(plan.upload.pageRenders.bytes));
  row("standalone images", plan.upload.standaloneImages.count, bytes(plan.upload.standaloneImages.bytes));
  row("contact sheets", plan.upload.contactSheets.count, bytes(plan.upload.contactSheets.bytes));
  row("total", bytes(plan.upload.totalBytes));

  heading("Reconciliation against the discovery reports");
  if (plan.divergences.length === 0) {
    console.log("  every recomputed count matches the documented baseline");
  } else {
    for (const d of plan.divergences) console.log(`  DIVERGENCE  ${d}`);
  }
  console.log("");
}

if (import.meta.filename === process.argv[1]) {
  const cli = parseCli(process.argv.slice(2));
  const plan = await buildPlan(cli);
  printPlan(plan);
  const { writeState } = await import("./lib.mts");
  await writeState(cli, "plan.json", plan);
  console.log(`  plan written to ${path.join(cli.stateDir, "plan.json")}\n`);
  if (plan.divergences.length) process.exit(2);
}
