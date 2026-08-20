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
  parseAssetSchema,
  registerAssetSchema,
  rejectSchema,
  signedUrlSchema,
  type ApproveInput,
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
      p_job_type: kind === "pdf" ? "parse_pdf" : kind === "image" ? "ocr" : "parse_sheet",
      p_parser_version: PARSER_VERSION[kind] ?? "none@1",
    });
    if (jobErr || !jobId) return fail(jobErr ?? "Could not create the import job");

    let result: ParseResult;
    try {
      result = await parseSource(kind, buffer, { text: kind === "csv" ? new TextDecoder().decode(buffer) : undefined });
    } catch (e) {
      result = { records: [], stats: {}, parserVersion: "unknown@1", jobType: "manual", error: e instanceof Error ? e.message : "Extraction failed" };
    }

    const status = result.error && result.records.length === 0 ? "failed" : "succeeded";
    const { data: summary, error: recErr } = await supabase.rpc("record_extraction", {
      p_job_id: jobId,
      p_records: result.records as unknown as Json,
      p_status: status,
      p_error: result.error ?? undefined,
      p_stats: { ...result.stats, parser_version: result.parserVersion } as unknown as Json,
    });
    if (recErr) return fail(recErr);

    const counts = (summary ?? {}) as { records?: number; review_items?: number; duplicates?: number };
    const manual = result.records.filter((r) => r.issues.some((i) => i.code === "needs_manual")).length;
    revalidatePath("/sources/library");
    revalidatePath("/sources/review");

    if (status === "failed") return fail(result.error ?? "Nothing could be extracted from this file");
    return ok(
      { records: Number(counts.records ?? 0), review_items: Number(counts.review_items ?? 0), duplicates: Number(counts.duplicates ?? 0), note: manual ? `${manual} page(s) need manual entry` : undefined },
      `Extracted ${counts.records ?? 0} row(s) into the review queue.`,
    );
  } catch (e) {
    return fail(e);
  }
}

/** Short-lived signed URL for a private original (never exposes the key). */
export async function signedSourceUrlAction(input: { bucket: string; path: string }): Promise<ActionResult<{ url: string | null }>> {
  try {
    await requirePermission("source.import");
    const parsed = signedUrlSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid file reference");
    const admin = createAdminSupabase();
    const { data, error } = await admin.storage.from(parsed.data.bucket).createSignedUrl(parsed.data.path, 60);
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
