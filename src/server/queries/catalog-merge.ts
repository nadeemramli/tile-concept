import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { suggestedVariantMap, type MergeImpact } from "@/features/catalog/merge-schema";

/**
 * Preview a merge starting from the suggested variant pairing (same SKU or
 * supplier code). The reviewer can change every pairing before confirming.
 */
export async function getMergePreview(survivorId: string, mergedId: string): Promise<{ impact: MergeImpact | null; error: string | null }> {
  const supabase = await createServerSupabase();
  const first = await supabase.rpc("preview_product_merge", { p_survivor: survivorId, p_merged: mergedId });
  if (first.error) return { impact: null, error: first.error.message };
  const map = suggestedVariantMap(first.data as unknown as MergeImpact);
  const { data, error } = await supabase.rpc("preview_product_merge", { p_survivor: survivorId, p_merged: mergedId, p_variant_map: map as Json });
  if (error) return { impact: null, error: error.message };
  return { impact: data as unknown as MergeImpact, error: null };
}
