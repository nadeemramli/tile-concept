import { describe, expect, it } from "vitest";
import { catalogMediaPath, catalogMediaSchema, matchesCatalogMediaType, MAX_CATALOG_MEDIA_BYTES } from "@/features/catalog/media-schema";

const input = { product_id: "11111111-1111-4111-8111-111111111111", media_id: "22222222-2222-4222-8222-222222222222", filename: "tile.jpg", mime_type: "image/jpeg" as const, size_bytes: 100, rights_confirmed: true as const };
describe("catalogue upload boundary", () => {
  it("requires a real identity, permitted type, bounded nonempty file and explicit rights", () => {
    expect(catalogMediaSchema.safeParse(input).success).toBe(true);
    // Seed/fixture ids are valid PostgreSQL uuids without RFC-4122 version bits.
    expect(catalogMediaSchema.safeParse({ ...input, product_id: "11111111-1111-1111-1111-111111111111", replaces_id: "aaaaaaaa-0000-0000-0000-000000000001" }).success).toBe(true);
    for (const patch of [{ replaces_id: "../x" },{ product_id: "../other" }, { rights_confirmed: false }, { mime_type: "image/svg+xml" }, { size_bytes: 0 }, { size_bytes: MAX_CATALOG_MEDIA_BYTES + 1 }]) expect(catalogMediaSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("keeps filenames out of workspace/product/user scoped object keys", () => {
    const value = catalogMediaPath("workspace", "user", input);
    expect(value).toBe(`workspace/products/${input.product_id}/user/${input.media_id}.jpg`);
    expect(catalogMediaPath("workspace", "user", { ...input, filename: "../../escape.jpg" } as typeof input)).toBe(value);
  });
  it("rejects HTML, SVG and mismatched signatures despite declared MIME", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4", "video/webm"]) {
      expect(matchesCatalogMediaType(new TextEncoder().encode("<html>disguised file</html>"), mime)).toBe(false);
      expect(matchesCatalogMediaType(new Uint8Array(), mime)).toBe(false);
    }
    expect(matchesCatalogMediaType(new Uint8Array([255, 216, 255]), "image/jpeg")).toBe(true);
    expect(matchesCatalogMediaType(new Uint8Array([137,80,78,71,13,10,26,10]), "image/png")).toBe(true);
    expect(matchesCatalogMediaType(new TextEncoder().encode("RIFFxxxxWEBP"), "image/webp")).toBe(true);
    expect(matchesCatalogMediaType(new TextEncoder().encode("%PDF-1.7"), "application/pdf")).toBe(true);
    expect(matchesCatalogMediaType(new TextEncoder().encode("xxxxftypisom"), "video/mp4")).toBe(true);
    expect(matchesCatalogMediaType(new Uint8Array([26,69,223,163]), "video/webm")).toBe(true);
    expect(matchesCatalogMediaType(new TextEncoder().encode("%PDF-1.7"), "image/jpeg")).toBe(false);
  });
});
