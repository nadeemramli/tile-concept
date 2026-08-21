import { describe, expect, it } from "vitest";
import {
  DEFERRED_SOURCE_IDS,
  EXCLUDED_SOURCE_IDS,
  assetKindFor,
  canonicalLinkBasis,
  canonicalObservationBasis,
  exactDecimal,
  imageObjectKey,
  pageObjectKey,
  safeFilename,
  sourceObjectKey,
} from "../../scripts/corpus/lib.mts";

const WS = "11111111-1111-1111-1111-111111111111";

describe("exactDecimal", () => {
  it("passes a decimal through as a string so Postgres does the arithmetic", () => {
    expect(exactDecimal("698.13")).toBe("698.13");
    expect(exactDecimal("0.1")).toBe("0.1");
  });

  it("keeps precision a float would have lost", () => {
    // 0.1 + 0.2 in JS is 0.30000000000000004; the string never gets the chance.
    const v = exactDecimal("1234567890123456.789");
    expect(v).toBe("1234567890123456.789");
    expect(Number(v).toString()).not.toBe(v);
  });

  it("treats an unparseable amount as absent rather than guessing zero", () => {
    expect(exactDecimal("RM 12.50")).toBeNull();
    expect(exactDecimal("")).toBeNull();
    expect(exactDecimal(null)).toBeNull();
    expect(exactDecimal("1.2.3")).toBeNull();
  });
});

describe("canonicalObservationBasis", () => {
  it("maps the corpus's verbose pixel basis onto the canonical one", () => {
    expect(canonicalObservationBasis("pixel_measurement_not_semantic_classification")).toBe("pixel_measurement");
  });

  it("treats a contact-sheet review as a machine classification, not a human one", () => {
    // It is a machine pass awaiting human approval; calling it human_visual_review
    // would let it satisfy the approval constraint it is supposed to fail.
    expect(
      canonicalObservationBasis("visual_review_of_contact_sheet_supported_by_visible_supplier_heading_and_filename"),
    ).toBe("machine_visual_classification");
  });

  it("recognises supplier text and human review", () => {
    expect(canonicalObservationBasis("ocr_or_supplier_text")).toBe("ocr_or_supplier_text");
    expect(canonicalObservationBasis("human_visual_review")).toBe("human_visual_review");
  });

  it("falls back to a machine classification for anything unknown", () => {
    expect(canonicalObservationBasis("something_new")).toBe("machine_visual_classification");
  });
});

describe("canonicalLinkBasis", () => {
  it("maps the corpus rule names onto the canonical bases", () => {
    expect(canonicalLinkBasis("exact_normalized_ocr_code")).toBe("exact_ocr_code");
    expect(canonicalLinkBasis("candidate_page_locator")).toBe("same_catalog_page");
  });

  it("passes canonical values through unchanged", () => {
    for (const v of ["exact_supplier_code", "exact_ocr_code", "same_catalog_page", "same_source_document", "manual_match"]) {
      expect(canonicalLinkBasis(v)).toBe(v);
    }
  });

  it("degrades an unknown basis to the weakest one, never a stronger one", () => {
    // Guessing upwards would let an unrecognised rule become publishable.
    expect(canonicalLinkBasis("some_future_rule")).toBe("same_source_document");
  });
});

describe("object keys", () => {
  it("puts the workspace first and never repeats the bucket name", () => {
    const key = sourceObjectKey(WS, "base_tiles_local", "drive-id", "abc123", "Catalogue 2025.pdf");
    expect(key.startsWith(`${WS}/`)).toBe(true);
    expect(key).not.toContain("source-assets");
    expect(key).toBe(`${WS}/drive/base_tiles_local/drive-id/abc123/Catalogue_2025.pdf`);
  });

  it("zero-pads page numbers so keys sort in page order", () => {
    expect(pageObjectKey(WS, "s", 1)).toBe(`${WS}/sources/s/pages/page-0001.jpg`);
    expect(pageObjectKey(WS, "s", 1234)).toBe(`${WS}/sources/s/pages/page-1234.jpg`);
  });

  it("content-addresses standalone images", () => {
    expect(imageObjectKey(WS, "s", "deadbeef")).toBe(`${WS}/sources/s/images/deadbeef.jpg`);
  });

  it("neutralises separators and unicode in supplier filenames", () => {
    // Observed in the corpus: a Drive name containing a literal slash, and
    // Chinese filenames. Neither may escape its key segment.
    expect(safeFilename("Website - Username/PW")).not.toContain("/");
    expect(safeFilename("泳池小册子.pdf")).not.toContain("泳");
    expect(safeFilename("")).toBe("file");
  });
});

describe("assetKindFor", () => {
  it("maps MIME types onto the existing source_assets.kind CHECK values", () => {
    expect(assetKindFor("application/pdf")).toBe("pdf");
    expect(assetKindFor("image/jpeg")).toBe("image");
    expect(assetKindFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("excel");
    expect(assetKindFor("text/csv")).toBe("csv");
    // A Google-native doc has no binary format of its own.
    expect(assetKindFor("application/vnd.google-apps.document")).toBe("url");
  });
});

describe("policy exclusions", () => {
  it("excludes the credentials document by source id, not by content", () => {
    // It has a shape profile on disk, so "skip what has no extracted text"
    // would not have caught it.
    expect(EXCLUDED_SOURCE_IDS.has("1TlyRsUiIPUp8a6tbdIrXTamgplJxca47cTXU95yR8h8")).toBe(true);
    expect(EXCLUDED_SOURCE_IDS.size).toBe(1);
  });

  it("names exactly the two deferred binaries, with their sizes", () => {
    expect(DEFERRED_SOURCE_IDS.size).toBe(2);
    expect(DEFERRED_SOURCE_IDS.get("1DBnAxZPjvfTM1FWOCCwprFd6qm5EmGHq")?.sizeBytes).toBe(174_006_407);
    expect(DEFERRED_SOURCE_IDS.get("1qQT38waL5vbOmP8OpRt6FE74_TZKvzxJ")?.sizeBytes).toBe(382_335_899);
  });
});
