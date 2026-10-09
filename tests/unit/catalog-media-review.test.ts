import { describe, expect, it } from "vitest";
import { confirmAssociationSchema, mediaEvidenceSchema, mediaRightsSchema, publishMediaSchema, rejectAssociationSchema } from "@/features/catalog/media-review-schema";
import { isSignableSourceObject } from "@/features/sources/schema";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("imported media review boundary", () => {
  it("never accepts a rights decision without a stated basis, nor a reset to unknown", () => {
    expect(mediaRightsSchema.safeParse({ media_asset_id: ID, rights_state: "accepted", reason: "Supplier licence" }).success).toBe(true);
    expect(mediaRightsSchema.safeParse({ media_asset_id: ID, rights_state: "accepted", reason: "   " }).success).toBe(false);
    expect(mediaRightsSchema.safeParse({ media_asset_id: ID, rights_state: "unreviewed", reason: "x" }).success).toBe(false);
  });
  it("needs a reason to reject an association or to flag evidence, but not to approve it", () => {
    expect(rejectAssociationSchema.safeParse({ link_id: ID, reason: "" }).success).toBe(false);
    expect(mediaEvidenceSchema.safeParse({ media_asset_id: ID, decision: "approved" }).success).toBe(true);
    expect(mediaEvidenceSchema.safeParse({ media_asset_id: ID, decision: "rejected" }).success).toBe(false);
    expect(mediaEvidenceSchema.safeParse({ media_asset_id: ID, decision: "needs_correction", note: "Cropped" }).success).toBe(true);
  });
  it("requires a real variant to confirm, and an explicit primary choice to publish", () => {
    expect(confirmAssociationSchema.safeParse({ link_id: ID, variant_id: "" }).success).toBe(false);
    expect(publishMediaSchema.safeParse({ link_id: ID }).success).toBe(false);
    expect(publishMediaSchema.safeParse({ link_id: ID, is_primary: false }).success).toBe(true);
  });
});

describe("source evidence signing", () => {
  it("signs only source buckets inside the caller's own workspace", () => {
    expect(isSignableSourceObject("product-media", `${ID}/sources/a/pages/page-0001.jpg`, ID)).toBe(true);
    expect(isSignableSourceObject("source-assets", `${ID}/drive/x.pdf`, ID)).toBe(true);
    expect(isSignableSourceObject("product-media", `${OTHER}/sources/a/pages/page-0001.jpg`, ID)).toBe(false);
    expect(isSignableSourceObject("permission-evidence", `${ID}/consent.pdf`, ID)).toBe(false);
    expect(isSignableSourceObject("sales-receipts", `${ID}/r.jpg`, ID)).toBe(false);
    expect(isSignableSourceObject("source-assets", `${ID}/../${OTHER}/x.pdf`, ID)).toBe(false);
  });
});
