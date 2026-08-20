/**
 * Upload the allowlisted corpus binaries to private Supabase Storage.
 *
 * Content-addressed and create-only: an object whose key already exists is
 * skipped, so re-running an unchanged corpus uploads nothing. Files above the
 * 6 MB standard-upload threshold go through TUS against the direct storage
 * hostname, with the upload URL persisted so an interrupted transfer resumes
 * where it stopped rather than starting the 366 MB catalogue again.
 *
 * Only these are ever uploaded:
 *   - originals referenced by the Drive manifest and present under 01 Source Snapshots
 *   - the page renders indexed by 05 Visual Corpus/records/media-assets.jsonl
 *   - the standalone supplier images from the same manifest
 *   - contact sheets and reconciliation manifests, into ingest-artifacts
 *
 * Never: vendored Python under tools/python, orphan page renders, the
 * credentials document, or any placeholder for a deferred binary.
 *
 * Usage:
 *   TILE_CORPUS_ROOT=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *   pnpm exec tsx scripts/corpus/upload-storage.mts --linked --workspace <id>
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as tus from "tus-js-client";
import {
  BUCKET_ARTIFACTS,
  BUCKET_MEDIA,
  BUCKET_SOURCE,
  DEFERRED_SOURCE_IDS,
  EXCLUDED_SOURCE_IDS,
  REL,
  RESUMABLE_THRESHOLD_BYTES,
  bytes,
  corpusPath,
  ensureStateDir,
  heading,
  imageObjectKey,
  listFiles,
  pageObjectKey,
  readJsonl,
  sizeOf,
  sourceObjectKey,
  withRetry,
  type ApiClient,
  type Cli,
  type Target,
} from "./lib.mts";
import { toWslPath, type MediaAssetRecord } from "./plan.mts";

export interface UploadOutcome {
  uploaded: number;
  skippedExisting: number;
  failed: { key: string; reason: string }[];
  bytesUploaded: number;
}

interface UploadJob {
  bucket: string;
  key: string;
  localPath: string;
  contentType: string;
  sourceId: string;
}

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
};

function contentTypeFor(p: string): string {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Build the upload list from the media manifest.
 *
 * The manifest is the allowlist. A file sitting in the render directory that no
 * manifest row points at is a leftover from an earlier pass, not corpus
 * content, and is never uploaded.
 */
export async function buildJobs(cli: Cli, workspaceId: string): Promise<UploadJob[]> {
  const jobs: UploadJob[] = [];

  // Drive manifest gives each source its collection, used in the object key.
  const collectionBySource = new Map<string, string>();
  for await (const f of readJsonl<{ id: string; kind: string; root_code: string }>(corpusPath(cli, REL.driveInventory))) {
    if (f.kind === "file") collectionBySource.set(f.id, f.root_code);
  }

  for await (const m of readJsonl<MediaAssetRecord>(corpusPath(cli, REL.mediaAssets))) {
    if (EXCLUDED_SOURCE_IDS.has(m.source_id) || DEFERRED_SOURCE_IDS.has(m.source_id)) continue;
    const local = toWslPath(m.local_path, cli);
    const collection = collectionBySource.get(m.source_id) ?? "unknown";

    if (m.asset_kind === "source_pdf") {
      jobs.push({
        bucket: BUCKET_SOURCE,
        key: sourceObjectKey(workspaceId, collection, m.source_id, m.sha256, m.file_name),
        localPath: local,
        contentType: contentTypeFor(local),
        sourceId: m.source_id,
      });
    } else if (m.asset_kind === "pdf_page_render") {
      jobs.push({
        bucket: BUCKET_MEDIA,
        key: pageObjectKey(workspaceId, m.source_id, m.page_number ?? 0),
        localPath: local,
        contentType: "image/jpeg",
        sourceId: m.source_id,
      });
    } else {
      jobs.push({
        bucket: BUCKET_MEDIA,
        key: imageObjectKey(workspaceId, m.source_id, m.sha256),
        localPath: local,
        contentType: contentTypeFor(local),
        sourceId: m.source_id,
      });
    }
  }

  // Contact sheets are review aids, not supplier originals.
  for (const name of await listFiles(corpusPath(cli, REL.contactSheets))) {
    jobs.push({
      bucket: BUCKET_ARTIFACTS,
      key: `${workspaceId}/contact-sheets/${name}`,
      localPath: path.join(corpusPath(cli, REL.contactSheets), name),
      contentType: "image/jpeg",
      sourceId: "contact-sheets",
    });
  }

  return jobs;
}

/**
 * True when Storage rejected the write because the object is already there.
 *
 * Supabase reports this as HTTP 400 with `statusCode: "409"` and
 * `code: "KeyAlreadyExists"`, so match on all three rather than on `status`.
 */
function isDuplicate(err: { message?: string; statusCode?: string | number; code?: string } | null): boolean {
  if (!err) return false;
  if (String(err.statusCode ?? "") === "409") return true;
  if (err.code === "KeyAlreadyExists") return true;
  return /already exists|duplicate/i.test(err.message ?? "");
}

async function uploadStandard(supabase: ApiClient, job: UploadJob): Promise<"uploaded" | "exists"> {
  const body = await readFile(job.localPath);
  const { error } = await supabase.storage.from(job.bucket).upload(job.key, body, {
    contentType: job.contentType,
    upsert: false, // create-only: identical content must never re-upload
  });
  if (!error) return "uploaded";
  if (isDuplicate(error as { message?: string; statusCode?: string | number; code?: string })) return "exists";
  throw error;
}

/**
 * Resumable upload for anything above 6 MB.
 *
 * The upload URL is kept in the state directory, so a transfer interrupted
 * halfway through a 366 MB catalogue continues instead of restarting.
 */
async function uploadResumable(target: Target, cli: Cli, job: UploadJob, size: number): Promise<"uploaded" | "exists"> {
  // The direct storage hostname is materially faster for large files; local
  // development has no such split host.
  const endpoint =
    target.env === "linked"
      ? `https://${target.projectRef}.storage.supabase.co/storage/v1/upload/resumable`
      : `${target.url}/storage/v1/upload/resumable`;

  await ensureStateDir(cli);
  // FileUrlStorage is the Node build's on-disk resume store; it is exported at
  // runtime but absent from the published types.
  const { FileUrlStorage } = tus as unknown as { FileUrlStorage: new (p: string) => tus.UrlStorage };
  const urlStorage = new FileUrlStorage(path.join(cli.stateDir, "tus-urls.json"));

  return await new Promise<"uploaded" | "exists">((resolve, reject) => {
    const upload = new tus.Upload(createReadStream(job.localPath), {
      endpoint,
      uploadSize: size,
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB chunks
      retryDelays: [0, 3000, 5000, 10000, 20000],
      urlStorage,
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${target.secretKey}`,
        apikey: target.secretKey,
        // create-only, matching the standard path
        "x-upsert": "false",
      },
      metadata: {
        bucketName: job.bucket,
        objectName: job.key,
        contentType: job.contentType,
        cacheControl: "3600",
      },
      onError: (error) => {
        if (isDuplicate(error as unknown as { message?: string; code?: string })) resolve("exists");
        else reject(error);
      },
      onSuccess: () => resolve("uploaded"),
    });

    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }, reject);
  });
}

/**
 * Everything already in a bucket under the workspace prefix.
 *
 * Without this, an unchanged re-run would read and transmit all 2.7 GB only to
 * be told each object already exists. One listing pass makes the no-op case a
 * no-op in practice as well as in effect.
 */
async function existingKeys(supabase: ApiClient, bucket: string, prefix: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) return; // an unreadable prefix simply yields no skips
      const entries = data ?? [];
      for (const e of entries) {
        const full = dir ? `${dir}/${e.name}` : e.name;
        // A folder placeholder has no id; a real object does.
        if (e.id) keys.add(full);
        else await walk(full, depth + 1);
      }
      if (entries.length < 1000) break;
    }
  };
  await walk(prefix, 0);
  return keys;
}

export async function uploadAll(
  supabase: ApiClient,
  target: Target,
  cli: Cli,
  workspaceId: string,
): Promise<UploadOutcome> {
  const jobs = await buildJobs(cli, workspaceId);
  const out: UploadOutcome = { uploaded: 0, skippedExisting: 0, failed: [], bytesUploaded: 0 };

  heading(`Uploading ${jobs.length.toLocaleString("en-US")} objects`);

  const present = new Map<string, Set<string>>();
  for (const bucket of [BUCKET_SOURCE, BUCKET_MEDIA, BUCKET_ARTIFACTS]) {
    present.set(bucket, await existingKeys(supabase, bucket, workspaceId));
  }
  const alreadyThere = [...present.values()].reduce((n, s) => n + s.size, 0);
  if (alreadyThere) console.log(`  ${alreadyThere.toLocaleString("en-US")} objects already present; those are skipped without reading`);

  let done = 0;

  for (const job of cli.limit ? jobs.slice(0, cli.limit) : jobs) {
    done++;

    if (present.get(job.bucket)?.has(job.key)) {
      out.skippedExisting++;
      continue;
    }

    let size = 0;
    try {
      size = await sizeOf(job.localPath);
    } catch {
      out.failed.push({ key: job.key, reason: "local file missing" });
      continue;
    }

    try {
      const result = await withRetry(job.key, () =>
        size > RESUMABLE_THRESHOLD_BYTES ? uploadResumable(target, cli, job, size) : uploadStandard(supabase, job),
      );
      if (result === "uploaded") {
        out.uploaded++;
        out.bytesUploaded += size;
        if (size > RESUMABLE_THRESHOLD_BYTES) console.log(`  ${done}/${jobs.length} ${bytes(size)}  ${job.key}`);
      } else {
        out.skippedExisting++;
      }
    } catch (err) {
      // Never log the file body or a supplier value — only the key and reason.
      out.failed.push({ key: job.key, reason: (err as Error).message ?? "unknown" });
    }

    if (done % 250 === 0) {
      console.log(`  ${done}/${jobs.length}  uploaded ${out.uploaded}, already present ${out.skippedExisting}, failed ${out.failed.length}`);
    }
  }

  heading("Upload result");
  console.log(`  uploaded         ${out.uploaded.toLocaleString("en-US")} (${bytes(out.bytesUploaded)})`);
  console.log(`  already present  ${out.skippedExisting.toLocaleString("en-US")}`);
  console.log(`  failed           ${out.failed.length.toLocaleString("en-US")}`);
  for (const f of out.failed.slice(0, 20)) console.log(`    ${f.key}: ${f.reason}`);
  return out;
}
