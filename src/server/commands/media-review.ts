"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { searchVariantsForMedia } from "@/server/queries/media-review";
import { confirmAssociationSchema, mediaEvidenceSchema, mediaRightsSchema, publishMediaSchema, rejectAssociationSchema } from "@/features/catalog/media-review-schema";

// Every rule (permission, workspace, reason, rights and evidence gates,
// publish-once) is enforced by the api.* function; these only validate shape.

function refresh(productId?: string | null) {
  revalidatePath("/merchandise/catalog/media-review");
  revalidatePath("/merchandise/catalog");
  if (productId) revalidatePath(`/merchandise/catalog/${productId}`);
}

function invalid(error: z.ZodError): ActionResult<never> {
  return fail("Check the highlighted fields", error.flatten().fieldErrors as Record<string, string[]>);
}

export async function confirmMediaAssociationAction(input: z.input<typeof confirmAssociationSchema>): Promise<ActionResult<{ link_id: string }>> {
  try {
    await requirePermission("catalog.write");
    const parsed = confirmAssociationSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("confirm_media_association", { p_link_id: d.link_id, p_variant_id: d.variant_id, p_note: d.note || undefined });
    if (error) return fail(error);
    refresh();
    return ok({ link_id: data as string }, "Association confirmed");
  } catch (e) { return fail(e); }
}

export async function rejectMediaAssociationAction(input: z.input<typeof rejectAssociationSchema>): Promise<ActionResult> {
  try {
    await requirePermission("catalog.write");
    const parsed = rejectAssociationSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("reject_media_association", { p_link_id: parsed.data.link_id, p_reason: parsed.data.reason });
    if (error) return fail(error);
    refresh();
    return ok(undefined, "Association rejected; the evidence is kept");
  } catch (e) { return fail(e); }
}

export async function reviewMediaRightsAction(input: z.input<typeof mediaRightsSchema>): Promise<ActionResult<{ withdrawn: number }>> {
  try {
    await requirePermission("catalog.write");
    const parsed = mediaRightsSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("review_media_rights", { p_media_asset_id: d.media_asset_id, p_rights_state: d.rights_state, p_reason: d.reason });
    if (error) return fail(error);
    const withdrawn = Number(data ?? 0);
    refresh();
    return ok({ withdrawn }, withdrawn ? `Usage rights recorded; ${withdrawn} published image(s) withdrawn` : "Usage rights recorded");
  } catch (e) { return fail(e); }
}

export async function reviewMediaEvidenceAction(input: z.input<typeof mediaEvidenceSchema>): Promise<ActionResult<{ withdrawn: number }>> {
  try {
    await requirePermission("catalog.write");
    const parsed = mediaEvidenceSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("review_media_asset", { p_media_asset_id: d.media_asset_id, p_decision: d.decision, p_note: d.note || undefined });
    if (error) return fail(error);
    const withdrawn = Number(data ?? 0);
    refresh();
    return ok({ withdrawn }, d.decision === "approved" ? "Evidence approved" : "Evidence decision recorded");
  } catch (e) { return fail(e); }
}

export async function publishMediaAction(input: z.input<typeof publishMediaSchema>): Promise<ActionResult<{ media_id: string; product_id: string | null }>> {
  try {
    await requirePermission("catalog.write");
    const parsed = publishMediaSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("publish_product_media", { p_link_id: d.link_id, p_alt_text: d.alt_text || undefined, p_is_primary: d.is_primary });
    if (error) return fail(error);
    const { data: media } = await supabase.from("product_media").select("product_id").eq("id", data as string).maybeSingle();
    refresh(media?.product_id);
    return ok({ media_id: data as string, product_id: media?.product_id ?? null }, d.is_primary ? "Published as the primary catalogue image" : "Published to the catalogue");
  } catch (e) { return fail(e); }
}

export async function searchMediaVariantsAction(term: string): Promise<ActionResult<{ id: string; label: string }[]>> {
  try {
    await requirePermission("catalog.write");
    return ok(await searchVariantsForMedia(String(term ?? "").slice(0, 100)));
  } catch (e) { return fail(e); }
}
