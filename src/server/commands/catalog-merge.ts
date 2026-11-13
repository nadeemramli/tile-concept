"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { mergeProductsSchema, previewMergeSchema, type MergeImpact } from "@/features/catalog/merge-schema";

// api.preview_product_merge / api.merge_products own every rule: permission,
// workspace, conflicts, the stale-preview fingerprint, reason and confirmation.

export async function previewProductMergeAction(input: z.input<typeof previewMergeSchema>): Promise<ActionResult<MergeImpact>> {
  try {
    await requirePermission("catalog.write");
    const parsed = previewMergeSchema.safeParse(input);
    if (!parsed.success) return fail("Choose two products to compare");
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("preview_product_merge", { p_survivor: d.survivor_id, p_merged: d.merged_id, p_variant_map: (d.variant_map ?? undefined) as Json | undefined });
    if (error) return fail(error);
    return ok(data as unknown as MergeImpact);
  } catch (e) { return fail(e); }
}

export async function mergeProductsAction(input: z.input<typeof mergeProductsSchema>): Promise<ActionResult<{ merge_id: string; survivor_id: string }>> {
  try {
    await requirePermission("catalog.write");
    const parsed = mergeProductsSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("merge_products", {
      p_survivor: d.survivor_id, p_merged: d.merged_id, p_variant_map: d.variant_map as Json, p_reason: d.reason, p_expected_fingerprint: d.fingerprint, p_confirmed: d.confirmed,
    });
    if (error) return fail(error);
    revalidatePath(`/merchandise/catalog/${d.survivor_id}`);
    revalidatePath(`/merchandise/catalog/${d.merged_id}`);
    revalidatePath("/merchandise/catalog");
    return ok({ merge_id: data as string, survivor_id: d.survivor_id }, "Products merged; the duplicate is archived and points here");
  } catch (e) { return fail(e); }
}
