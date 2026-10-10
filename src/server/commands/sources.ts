"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { classifySource, parseSource, type ParseResult } from "@/lib/parsers";
import type { Json } from "@/lib/supabase/database.types";
import {
  approveSchema,
  archiveSchema,
  manualItemSchema,
  parseAssetSchema,
  registerAssetSchema,
  rejectSchema,
  requestOcrSchema,
  retryOcrSchema,
  signedUrlSchema,
  isSignableSourceObject,
  type ApproveInput,
  type ManualItemInput,
  type RequestOcrInput,
  type RegisterAssetInput,
  type RejectInput,
} from "@/features/sources/schema";

const BUCKET = "source-assets";

/**
 * Register an uploaded artifact. The database decides whether this is new
 * content, a new version of a known document, or an exact re-import — the
 * caller surfaces that decision rather than assuming a job should follow.
 */
export async function registerSourceAssetAction(input: RegisterAssetInput): Promise<ActionResult<{ id: string; reused: boolean; version: number }>> {
  try {
    await requirePermission("source.import");
    const parsed = registerAssetSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("register_source_asset", {
      p_name: d.name,
      p_kind: d.kind,
      p_checksum: d.checksum,
      p_storage_path: d.storage_path || undefined,
      p_mime_type: d.mime_type || undefined,
      p_size_bytes: d.size_bytes,
      p_page_count: d.page_count,
      p_supplier_id: d.supplier_id || undefined,
      p_brand_id: d.brand_id || undefined,
      p_url: d.url || undefined,
    });
    if (error) return fail(error);
    const result = (data ?? {}) as { id?: string; reused?: boolean; version?: number };
    if (!result.id) return fail("The source could not be registered");
    revalidatePath("/sources/library");
    return ok(
      { id: result.id, reused: Boolean(result.reused), version: Number(result.version ?? 1) },
      result.reused ? "This exact file has already been imported." : `Registered as version ${result.version ?? 1}.`,
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * Download the original, parse it, and record the extraction. Native structure
 * is preferred; a raster page produces a "needs manual entry" record rather
 * than invented values.
 */
export async function parseSourceAssetAction(input: { asset_id: string }): Promise<ActionResult<{ records: number; review_items: number; duplicates: number; note?: string }>> {
  try {
    await requirePermission("source.import");
    const parsed = parseAssetSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid source");
    const supabase = await createServerSupabase();

    const { data: asset, error: assetErr } = await supabase
      .from("source_assets")
      .select("id, name, kind, mime_type, storage_bucket, storage_path")
      .eq("id", parsed.data.asset_id)
      .maybeSingle();
    if (assetErr) return fail(assetErr);
    if (!asset?.id) return fail("Source asset not found");
    if (!asset.storage_path) return fail("This source has no stored file to parse");

    const kind = classifySource(asset.name ?? "", asset.mime_type);

    // An image has no text layer: it goes straight to the OCR worker. If OCR
    // refuses it (size, format), the refusal is the answer and manual entry
    // remains available from the source.
    if (kind === "image") {
      const queued = await queueOcr(supabase, asset.id, [1]);
      revalidatePath("/sources/library");
      if (!queued.ok) return fail(`${queued.error} You can still enter its rows by hand from the source.`);
      return ok(
        { records: 0, review_items: 0, duplicates: 0, note: queued.reused ? "OCR for this image was already requested" : "Queued for OCR" },
        queued.reused ? "OCR for this image was already requested." : "Queued for OCR. Proposals appear in review when the worker has read it.",
      );
    }

    // Read the original with the service-role client: the object is private and
    // the parse runs on the server, never in the browser.
    const admin = createAdminSupabase();
    const { data: blob, error: dlErr } = await admin.storage.from(asset.storage_bucket ?? BUCKET).download(asset.storage_path);
    if (dlErr || !blob) {
      return fail("The stored original could not be read. It may not have finished uploading.");
    }
    const buffer = await blob.arrayBuffer();

    // The parser is decided by the kind, so the job can name its version up
    // front rather than leaving the column blank until the pass finishes.
    const PARSER_VERSION: Record<string, string> = { pdf: "pdf-text@1", excel: "sheet@1", csv: "sheet@1", image: "image@1" };
    const { data: jobId, error: jobErr } = await supabase.rpc("create_ingestion_job", {
      p_source_asset_id: asset.id,
      p_job_type: kind === "pdf" ? "parse_pdf" : "parse_sheet",
      p_parser_version: PARSER_VERSION[kind] ?? "none@1",
    });
    if (jobErr || !jobId) return fail(jobErr ?? "Could not create the import job");

    let result: ParseResult;
    try {
      result = await parseSource(kind, buffer, { text: kind === "csv" ? new TextDecoder().decode(buffer) : undefined });
    } catch (e) {
      result = { records: [], stats: {}, parserVersion: "unknown@1", jobType: "manual", error: e instanceof Error ? e.message : "Extraction failed" };
    }

    // Scanned pages go to the OCR worker. Only if OCR refuses them do they stay
    // as manual-entry rows here — either way nothing is silently dropped.
    const rasterPages = result.records.filter((r) => r.issues.some((i) => i.code === "needs_manual")).map((r) => r.page_no ?? 1);
    let ocrNote: string | undefined;
    let records = result.records;
    if (kind === "pdf" && rasterPages.length > 0) {
      const queued = await queueOcr(supabase, asset.id, rasterPages);
      if (queued.ok) {
        records = result.records.filter((r) => !r.issues.some((i) => i.code === "needs_manual"));
        ocrNote = `${rasterPages.length} scanned page(s) ${queued.reused ? "already queued" : "queued"} for OCR`;
      } else {
        ocrNote = `OCR refused the scanned page(s): ${queued.error}`;
      }
    }

    const status = result.error && result.records.length === 0 ? "failed" : "succeeded";
    const { data: summary, error: recErr } = await supabase.rpc("record_extraction", {
      p_job_id: jobId,
      p_records: records as unknown as Json,
      p_status: status,
      p_error: result.error ?? undefined,
      p_stats: { ...result.stats, parser_version: result.parserVersion } as unknown as Json,
    });
    if (recErr) return fail(recErr);

    const counts = (summary ?? {}) as { records?: number; review_items?: number; duplicates?: number };
    const manual = records.filter((r) => r.issues.some((i) => i.code === "needs_manual")).length;
    revalidatePath("/sources/library");
    revalidatePath("/sources/review");

    if (status === "failed") return fail(result.error ?? "Nothing could be extracted from this file");
    const note = [ocrNote, manual ? `${manual} page(s) need manual entry` : undefined].filter(Boolean).join("; ") || undefined;
    return ok(
      { records: Number(counts.records ?? 0), review_items: Number(counts.review_items ?? 0), duplicates: Number(counts.duplicates ?? 0), note },
      `Extracted ${counts.records ?? 0} row(s) into the review queue.${ocrNote ? ` ${ocrNote}.` : ""}`,
    );
  } catch (e) {
    return fail(e);
  }
}

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** The database decides limits and de-duplication; this only relays its answer. */
async function queueOcr(supabase: ServerSupabase, assetId: string, pages?: number[]): Promise<{ ok: true; jobId: string; reused: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("request_ocr", { p_source_asset_id: assetId, p_pages: pages });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { job_id?: string; reused?: boolean };
  if (!r.job_id) return { ok: false, error: "OCR could not be queued" };
  return { ok: true, jobId: r.job_id, reused: Boolean(r.reused) };
}

/** Queue OCR for a source's scanned pages (TILE-22). Runs in the background worker. */
export async function requestOcrAction(input: RequestOcrInput): Promise<ActionResult<{ job_id: string; reused: boolean }>> {
  try {
    await requirePermission("source.import");
    const parsed = requestOcrSchema.safeParse(input);
    if (!parsed.success) return fail("Check the page numbers", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const supabase = await createServerSupabase();
    const res = await queueOcr(supabase, parsed.data.asset_id, parsed.data.pages);
    if (!res.ok) return fail(res.error);
    revalidatePath("/sources/library");
    return ok({ job_id: res.jobId, reused: res.reused }, res.reused ? "OCR for these pages was already requested." : "Queued for OCR.");
  } catch (e) {
    return fail(e);
  }
}

export async function retryOcrJobAction(input: { job_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("source.import");
    const parsed = retryOcrSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid job");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("retry_ocr_job", { p_job_id: parsed.data.job_id });
    if (error) return fail(error);
    revalidatePath("/sources/library");
    return ok(undefined, "Queued again for OCR.");
  } catch (e) {
    return fail(e);
  }
}

/** Manual fallback: a blank review row tied to a page of the original. */
export async function addManualReviewItemAction(input: ManualItemInput): Promise<ActionResult<{ review_item_id: string }>> {
  try {
    await requirePermission("source.import");
    const parsed = manualItemSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("add_manual_review_item", {
      p_source_asset_id: parsed.data.asset_id,
      p_page_no: parsed.data.page_no,
      p_item_type: parsed.data.item_type,
      p_note: parsed.data.note || undefined,
    });
    if (error) return fail(error);
    if (!data) return fail("The manual row could not be created");
    revalidatePath("/sources/library");
    revalidatePath("/sources/review");
    return ok({ review_item_id: data as string }, "Manual row added. Type its values from the original, then approve.");
  } catch (e) {
    return fail(e);
  }
}

/** Short-lived signed URL for a private original (never exposes the key). */
export async function signedSourceUrlAction(input: { bucket: string; path: string }): Promise<ActionResult<{ url: string | null }>> {
  try {
    const session = await requirePermission("source.import");
    const parsed = signedUrlSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid file reference");
    // Only source evidence, only in the caller's own workspace, and signed with
    // the caller's own client so the bucket's storage policy still applies.
    if (!isSignableSourceObject(parsed.data.bucket, parsed.data.path, session.workspaceId)) return fail("Invalid file reference");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.storage.from(parsed.data.bucket).createSignedUrl(parsed.data.path, 60);
    // A missing object is expected in the demo workspace; say so plainly.
    if (error || !data?.signedUrl) return ok({ url: null }, undefined);
    return ok({ url: data.signedUrl });
  } catch (e) {
    return fail(e);
  }
}

export async function archiveSourceAssetAction(input: { asset_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("source.import");
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid source");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("source_assets").update({ status: "archived" }).eq("id", parsed.data.asset_id);
    if (error) return fail(error);
    revalidatePath("/sources/library");
    return ok(undefined, "Source archived. The original and its history are kept.");
  } catch (e) {
    return fail(e);
  }
}

export async function approveReviewItemAction(input: ApproveInput): Promise<ActionResult<{ product_id: string | null; variant_id: string | null; price_id: string | null }>> {
  try {
    await requirePermission("review.approve");
    const parsed = approveSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const supabase = await createServerSupabase();
    const corrections = parsed.data.corrections ?? {};
    const { data, error } = await supabase.rpc("approve_review_item", {
      p_review_item_id: parsed.data.review_item_id,
      p_corrections: corrections as unknown as Json,
      p_note: parsed.data.note || undefined,
    });
    if (error) return fail(error);
    const r = (data ?? {}) as { product_id?: string; variant_id?: string; price_id?: string };
    revalidatePath("/sources/review");
    revalidatePath("/merchandise/catalog");
    revalidatePath("/merchandise/pricing");
    return ok(
      { product_id: r.product_id ?? null, variant_id: r.variant_id ?? null, price_id: r.price_id ?? null },
      r.price_id ? "Published. The price is a draft until it is published on the price list." : "Published to the catalog.",
    );
  } catch (e) {
    return fail(e);
  }
}

export async function rejectReviewItemAction(input: RejectInput): Promise<ActionResult> {
  try {
    await requirePermission("review.approve");
    const parsed = rejectSchema.safeParse(input);
    if (!parsed.success) return fail("A reason is required", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("reject_review_item", { p_review_item_id: parsed.data.review_item_id, p_reason: parsed.data.reason });
    if (error) return fail(error);
    revalidatePath("/sources/review");
    return ok(undefined, "Rejected. The correction is kept as parser feedback.");
  } catch (e) {
    return fail(e);
  }
}
