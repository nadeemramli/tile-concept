import { describe, expect, it } from "vitest";
import { mergeProductsSchema, suggestedVariantMap, type MergeImpact } from "@/features/catalog/merge-schema";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const V1 = "33333333-3333-3333-3333-333333333333";
const V2 = "44444444-4444-4444-4444-444444444444";
const T1 = "55555555-5555-5555-5555-555555555555";
const base = { survivor_id: A, merged_id: B, variant_map: { [V1]: T1, [V2]: null }, reason: "Same series", fingerprint: "abc", confirmed: true as const };

describe("product merge boundary", () => {
  it("needs a reason, a previewed fingerprint and explicit confirmation", () => {
    expect(mergeProductsSchema.safeParse(base).success).toBe(true);
    expect(mergeProductsSchema.safeParse({ ...base, reason: " " }).success).toBe(false);
    expect(mergeProductsSchema.safeParse({ ...base, fingerprint: "" }).success).toBe(false);
    expect(mergeProductsSchema.safeParse({ ...base, confirmed: false }).success).toBe(false);
  });
  it("accepts only ids in the variant map", () => {
    expect(mergeProductsSchema.safeParse({ ...base, variant_map: { [V1]: "../x" } }).success).toBe(false);
    expect(mergeProductsSchema.safeParse({ ...base, variant_map: { "not-an-id": null } }).success).toBe(false);
  });
  it("starts from same-code suggestions and moves everything else", () => {
    const impact = { merged: { variants: [{ id: V1, suggested_target: T1 }, { id: V2, suggested_target: null }] } } as unknown as MergeImpact;
    expect(suggestedVariantMap(impact)).toEqual({ [V1]: T1, [V2]: null });
  });
});
