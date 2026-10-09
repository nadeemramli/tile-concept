import { z } from "zod";
import { uuid } from "@/lib/zod";

/** Duplicate variant id → survivor variant id to merge into, or null to move it across unchanged. */
export const variantMapSchema = z.record(uuid(), uuid().nullable());

export const previewMergeSchema = z.object({ survivor_id: uuid(), merged_id: uuid(), variant_map: variantMapSchema.optional() });

export const mergeProductsSchema = z.object({
  survivor_id: uuid(),
  merged_id: uuid(),
  variant_map: variantMapSchema,
  reason: z.string().trim().min(1, "State why these are the same product").max(1000),
  fingerprint: z.string().min(1, "Preview the merge first"),
  confirmed: z.literal(true, { message: "Confirm that you compared both products" }),
});

export interface MergeVariant {
  id: string;
  sku: string | null;
  name: string | null;
  supplier_code: string | null;
  status?: string;
  target?: string | null;
  suggested_target?: string | null;
  prices?: number;
  stock_records?: number;
  sales_lines?: number;
  media?: number;
}

export interface MergeSide {
  id: string;
  name: string;
  code: string | null;
  status: string;
  review_state: string;
  brand_id: string | null;
  category_id: string | null;
  source_ref: string | null;
  variants: MergeVariant[];
  media?: number;
}

export interface MergeImpact {
  survivor: MergeSide;
  merged: MergeSide;
  variant_map: Record<string, string | null>;
  counts: Record<string, number>;
  conflicts: { code: string; message: string }[];
  fingerprint: string;
}

/** The pairing a reviewer starts from: same SKU or supplier code, otherwise move. */
export function suggestedVariantMap(impact: MergeImpact): Record<string, string | null> {
  return Object.fromEntries(impact.merged.variants.map((v) => [v.id, v.suggested_target ?? null]));
}
