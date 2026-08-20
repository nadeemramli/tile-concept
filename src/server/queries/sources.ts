import "server-only";

import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap } from "@/server/queries/reference";

export interface SourceAssetRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  checksum: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  page_count: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  url: string | null;
  received_at: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  supplier_name: string | null;
  brand_name: string | null;
  version_no: number | null;
  job_count: number;
  pending_reviews: number;
  last_processed_at: string | null;
}

export interface SourceFilters {
  kind?: string;
  supplier?: string;
  status?: string;
  q?: string;
}

export const listSourceAssets = cache(async (filters: SourceFilters = {}): Promise<SourceAssetRow[]> => {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("source_library")
    .select("id, name, kind, status, checksum, mime_type, size_bytes, page_count, storage_bucket, storage_path, url, received_at, uploaded_by, supplier_name, brand_name, version_no, job_count, pending_reviews, last_processed_at")
    .order("received_at", { ascending: false })
    .limit(500);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.supplier) query = query.eq("supplier_name", filters.supplier);
  if (filters.q) query = query.ilike("name", `%${filters.q}%`);

  const [{ data }, members] = await Promise.all([query, getMemberMap()]);
  return (data ?? [])
    .filter((r) => r.id)
    .map((r) => ({
      id: r.id!,
      name: r.name ?? "Untitled",
      kind: r.kind ?? "manual",
      status: r.status ?? "uploaded",
      checksum: r.checksum,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      page_count: r.page_count,
      storage_bucket: r.storage_bucket,
      storage_path: r.storage_path,
      url: r.url,
      received_at: r.received_at,
      uploaded_by: r.uploaded_by,
      uploaded_by_name: r.uploaded_by ? (members.get(r.uploaded_by)?.full_name ?? null) : null,
      supplier_name: r.supplier_name,
      brand_name: r.brand_name,
      version_no: r.version_no,
      job_count: Number(r.job_count ?? 0),
      pending_reviews: Number(r.pending_reviews ?? 0),
      last_processed_at: r.last_processed_at,
    }));
});

export interface AssetVersion {
  id: string;
  version_no: number;
  checksum: string;
  storage_path: string | null;
  created_at: string | null;
}

export interface IngestionJobRow {
  id: string;
  job_type: string;
  status: string;
  parser_version: string | null;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  stats: Record<string, unknown>;
  created_by_name: string | null;
}

export interface SourceAssetDetail {
  asset: SourceAssetRow;
  versions: AssetVersion[];
  jobs: IngestionJobRow[];
}

export async function getSourceAssetDetail(id: string): Promise<SourceAssetDetail | null> {
  const supabase = await createServerSupabase();
  const [assets, { data: versions }, { data: jobs }, members] = await Promise.all([
    listSourceAssets(),
    supabase.from("source_asset_versions").select("id, version_no, checksum, storage_path, created_at").eq("source_asset_id", id).order("version_no", { ascending: false }),
    supabase.from("ingestion_jobs").select("id, job_type, status, parser_version, attempts, started_at, finished_at, error, stats, created_by").eq("source_asset_id", id).order("created_at", { ascending: false }),
    getMemberMap(),
  ]);
  const asset = assets.find((a) => a.id === id);
  if (!asset) return null;
  return {
    asset,
    versions: (versions ?? []).filter((v) => v.id).map((v) => ({ id: v.id!, version_no: Number(v.version_no ?? 1), checksum: v.checksum ?? "", storage_path: v.storage_path, created_at: v.created_at })),
    jobs: (jobs ?? []).filter((j) => j.id).map((j) => ({
      id: j.id!,
      job_type: j.job_type ?? "parse",
      status: j.status ?? "queued",
      parser_version: j.parser_version,
      attempts: Number(j.attempts ?? 0),
      started_at: j.started_at,
      finished_at: j.finished_at,
      error: j.error,
      stats: (j.stats ?? {}) as Record<string, unknown>,
      created_by_name: j.created_by ? (members.get(j.created_by)?.full_name ?? null) : null,
    })),
  };
}

export interface ExtractedFieldRow {
  key: string;
  value: string | null;
  confidence: number | null;
  region: Record<string, number | string> | null;
  source_text: string | null;
}

export interface ReviewConflict {
  code: string;
  detail: string;
}

export interface ReviewItemRow {
  id: string;
  item_type: string;
  status: string;
  confidence: number | null;
  proposed: Record<string, unknown>;
  conflicts: ReviewConflict[];
  decision_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  published_object_id: string | null;
  created_at: string | null;
  job_id: string | null;
  job_type: string | null;
  parser_version: string | null;
  source_asset_id: string | null;
  source_name: string | null;
  source_kind: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  page_count: number | null;
  supplier_name: string | null;
  row_no: number | null;
  page_no: number | null;
  raw: Record<string, unknown>;
  fields: ExtractedFieldRow[];
}

export interface ReviewFilters {
  status?: string;
  asset?: string;
  itemType?: string;
  confidence?: string; // low | medium | high
  conflictsOnly?: boolean;
}

export const listReviewQueue = cache(async (filters: ReviewFilters = {}): Promise<ReviewItemRow[]> => {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("review_queue")
    .select("id, item_type, status, confidence, proposed, conflicts, decision_note, reviewed_at, reviewed_by, published_object_id, created_at, job_id, job_type, parser_version, source_asset_id, source_name, source_kind, storage_bucket, storage_path, page_count, supplier_name, row_no, page_no, raw, fields")
    .order("created_at", { ascending: true })
    .order("row_no", { ascending: true })
    .limit(500);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.asset) query = query.eq("source_asset_id", filters.asset);
  if (filters.itemType) query = query.eq("item_type", filters.itemType);
  if (filters.confidence === "low") query = query.lt("confidence", 0.8);
  if (filters.confidence === "high") query = query.gte("confidence", 0.95);
  if (filters.confidence === "medium") query = query.gte("confidence", 0.8).lt("confidence", 0.95);

  const [{ data }, members] = await Promise.all([query, getMemberMap()]);
  const rows = (data ?? [])
    .filter((r) => r.id)
    .map((r) => ({
      id: r.id!,
      item_type: r.item_type ?? "product",
      status: r.status ?? "pending",
      confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
      proposed: (r.proposed ?? {}) as Record<string, unknown>,
      conflicts: Array.isArray(r.conflicts) ? (r.conflicts as unknown as ReviewConflict[]) : [],
      decision_note: r.decision_note,
      reviewed_at: r.reviewed_at,
      reviewed_by_name: r.reviewed_by ? (members.get(r.reviewed_by)?.full_name ?? null) : null,
      published_object_id: r.published_object_id,
      created_at: r.created_at,
      job_id: r.job_id,
      job_type: r.job_type,
      parser_version: r.parser_version,
      source_asset_id: r.source_asset_id,
      source_name: r.source_name,
      source_kind: r.source_kind,
      storage_bucket: r.storage_bucket,
      storage_path: r.storage_path,
      page_count: r.page_count,
      supplier_name: r.supplier_name,
      row_no: r.row_no,
      page_no: r.page_no,
      raw: (r.raw ?? {}) as Record<string, unknown>,
      fields: Array.isArray(r.fields) ? (r.fields as unknown as ExtractedFieldRow[]) : [],
    }));
  return filters.conflictsOnly ? rows.filter((r) => r.conflicts.length > 0) : rows;
});

export interface SourceCounts {
  assets: number;
  awaitingProcessing: number;
  pendingReviews: number;
  failedJobs: number;
  needsManual: number;
}

export const getSourceCounts = cache(async (): Promise<SourceCounts> => {
  const supabase = await createServerSupabase();
  const [assets, { data: jobs }, reviews] = await Promise.all([
    listSourceAssets(),
    supabase.from("ingestion_jobs").select("id, status").limit(1000),
    listReviewQueue({ status: "pending" }),
  ]);
  return {
    assets: assets.length,
    awaitingProcessing: assets.filter((a) => a.status === "uploaded" || a.status === "processing").length,
    pendingReviews: reviews.length,
    failedJobs: (jobs ?? []).filter((j) => j.status === "failed" || j.status === "dead_letter").length,
    needsManual: reviews.filter((r) => r.conflicts.some((c) => c.code === "needs_manual")).length,
  };
});

/** Suppliers and brands for the upload form. */
export const getSourceRefs = cache(async () => {
  const supabase = await createServerSupabase();
  const [{ data: suppliers }, { data: brands }] = await Promise.all([
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("brands").select("id, name").order("name"),
  ]);
  return {
    suppliers: (suppliers ?? []).filter((s) => s.id).map((s) => ({ id: s.id!, name: s.name ?? "" })),
    brands: (brands ?? []).filter((b) => b.id).map((b) => ({ id: b.id!, name: b.name ?? "" })),
  };
});

/** Products a duplicate conflict may be pointing at, for the review screen. */
export async function findProductsByCode(codes: string[]): Promise<Map<string, { id: string; name: string; code: string | null }>> {
  const unique = [...new Set(codes.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("products").select("id, name, code").in("code", unique);
  const map = new Map<string, { id: string; name: string; code: string | null }>();
  for (const p of data ?? []) {
    if (p.id && p.code) map.set(p.code.toLowerCase(), { id: p.id, name: p.name ?? "", code: p.code });
  }
  return map;
}
