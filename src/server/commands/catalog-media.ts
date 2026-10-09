"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { catalogMediaEditSchema, catalogMediaPath, catalogMediaRefSchema, catalogMediaSchema, matchesCatalogMediaType, type CatalogMediaInput } from "@/features/catalog/media-schema";

const BUCKET = "product-media";

async function mediaContext(input: CatalogMediaInput) {
  const session = await requirePermission("catalog.write");
  const d = catalogMediaSchema.parse(input);
  const supabase = await createServerSupabase();
  const { data: product, error } = await supabase.from("products").select("id").eq("id", d.product_id).eq("workspace_id", session.workspaceId).maybeSingle();
  if (error || !product) throw new Error("Product not found in your workspace");
  if (d.variant_id) {
    const { data: variant, error: variantError } = await supabase.from("product_variants").select("id").eq("id", d.variant_id).eq("product_id", d.product_id).eq("workspace_id", session.workspaceId).maybeSingle();
    if (variantError || !variant) throw new Error("Variant does not belong to this product");
  }
  return { session, d, supabase, path: catalogMediaPath(session.workspaceId, session.userId, d) };
}

export async function prepareCatalogMediaAction(input: CatalogMediaInput): Promise<ActionResult<{ path: string; token: string }>> {
  try {
    const { supabase, path } = await mediaContext(input);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return fail(error ?? "Could not prepare upload");
    return ok({ path, token: data.token });
  } catch (e) { return fail(e); }
}

export async function completeCatalogMediaAction(input: CatalogMediaInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, d, supabase, path } = await mediaContext(input);
    const { data: existing, error: existingError } = await supabase.from("product_media").select("id, product_id, storage_path").eq("id", d.media_id).eq("workspace_id", session.workspaceId).maybeSingle();
    if (existingError) return fail(existingError);
    if (existing) {
      if (existing.product_id !== d.product_id || existing.storage_path !== path) return fail("Media identity conflict");
      // A retry after a lost response: the file is attached; finish any replacement.
      const replaced = await replaceIfRequested(supabase, d.replaces_id, d.media_id);
      if (!replaced.ok) return replaced;
      refresh(d.product_id);
      return ok({ id: d.media_id }, "Media already attached");
    }
    if (d.replaces_id) {
      const { data: old } = await supabase.from("product_media").select("id").eq("id", d.replaces_id).eq("product_id", d.product_id).is("archived_at", null).maybeSingle();
      if (!old) return fail("The attachment being replaced is no longer active. Reload the product.");
    }
    const bucket = supabase.storage.from(BUCKET);
    const { data: info, error: infoError } = await bucket.info(path);
    if (infoError || !info) return fail("Upload not found. Retry this file.");
    if (Number(info.size) !== d.size_bytes || info.contentType !== d.mime_type) {
      await bucket.remove([path]);
      return fail("Uploaded file does not match its declared type or size");
    }
    const { data: blob, error: readError } = await bucket.download(path);
    if (readError || !blob) return fail("Could not validate the uploaded file. Retry this file.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length !== d.size_bytes || !matchesCatalogMediaType(bytes, d.mime_type)) {
      // The new object is owned by this user and is not attached to a product yet.
      await bucket.remove([path]);
      return fail("File contents do not match an allowed image, PDF or video type");
    }
    const { error } = await supabase.from("product_media").insert({
      id: d.media_id, workspace_id: session.workspaceId, product_id: d.product_id, variant_id: d.variant_id ?? null,
      storage_bucket: BUCKET, storage_path: path, kind: d.mime_type.startsWith("image/") ? "image" : d.mime_type === "application/pdf" ? "pdf" : "other",
      caption: d.caption || null, alt_text: d.alt_text || null, source_ref: d.source_ref || null,
      usage_rights_state: "accepted", review_state: "reviewed", reviewed_by: session.userId, reviewed_at: new Date().toISOString(),
      original_filename: d.filename, mime_type: d.mime_type, size_bytes: d.size_bytes,
      checksum: createHash("sha256").update(bytes).digest("hex"), uploaded_by: session.userId,
    });
    if (error) return fail(error);
    refresh(d.product_id);
    const replaced = await replaceIfRequested(supabase, d.replaces_id, d.media_id);
    if (!replaced.ok) return fail(`New file attached, but the old one was not replaced: ${replaced.error}. Retry to finish.`);
    return ok({ id: d.media_id }, d.replaces_id ? "Media replaced; previous file archived" : "Media uploaded and attached");
  } catch (e) { return fail(e); }
}

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

async function replaceIfRequested(supabase: Supabase, oldId: string | null | undefined, newId: string): Promise<ActionResult> {
  if (!oldId) return ok(undefined);
  const { data: old, error } = await supabase.from("product_media").select("archived_at").eq("id", oldId).maybeSingle();
  if (error) return fail(error);
  if (old?.archived_at) return ok(undefined);
  const { error: rpcError } = await supabase.rpc("replace_catalog_media", { p_old_id: oldId, p_new_id: newId });
  return rpcError ? fail(rpcError) : ok(undefined);
}

export async function updateCatalogMediaAction(input: z.input<typeof catalogMediaEditSchema>): Promise<ActionResult> {
  try {
    const session = await requirePermission("catalog.write");
    const d = catalogMediaEditSchema.parse(input);
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("product_media").update({ caption: d.caption || null, alt_text: d.alt_text || null, source_ref: d.source_ref || null }).eq("id", d.id).eq("product_id", d.product_id).eq("workspace_id", session.workspaceId).is("archived_at", null).select("id").maybeSingle();
    if (error || !data) return fail(error ?? "Media not found");
    refresh(d.product_id);
    return ok(undefined, "Media details saved");
  } catch (e) { return fail(e); }
}

export async function setPrimaryCatalogMediaAction(input: { id: string; product_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("catalog.write");
    const d = catalogMediaRefSchema.parse(input);
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("set_primary_catalog_media", { p_media_id: d.id, p_product_id: d.product_id });
    if (error) return fail(error);
    refresh(d.product_id);
    return ok(undefined, "Primary image updated");
  } catch (e) { return fail(e); }
}

export async function archiveCatalogMediaAction(input: { id: string; product_id: string }): Promise<ActionResult> {
  try {
    const session = await requirePermission("catalog.write");
    const d = catalogMediaRefSchema.parse(input);
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("product_media").update({ archived_at: new Date().toISOString(), is_primary: false }).eq("id", d.id).eq("product_id", d.product_id).eq("workspace_id", session.workspaceId).is("archived_at", null).select("id").maybeSingle();
    if (error || !data) return fail(error ?? "Media not found");
    refresh(d.product_id);
    return ok(undefined, "Media archived; original and audit retained");
  } catch (e) { return fail(e); }
}

function refresh(productId: string) {
  revalidatePath(`/merchandise/catalog/${productId}`);
  revalidatePath("/merchandise/catalog");
}
