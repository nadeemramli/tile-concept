---
title: Tile Concept OS - Visual Corpus Extraction Report
description: Reconciled visual-media baseline for the currently available Google Drive catalog, price-list, technical, certificate, and supplier-image corpus.
created: 2026-08-21
updated: 2026-08-21
status: provisional-reviewed-baseline
tags: [tile-concept, visual-corpus, images, pdf, ocr, product-media, extraction]
---

# Tile Concept OS - Visual Corpus Extraction Report

> **Repository snapshot.** This is a dated copy of the canonical document in the
> Obsidian Build Vault (`5. Idea Vault/1. Internal Application/Tiles Concept - Backend
> Management/`), taken at the **2026-08-21 corpus cutoff**. Product decisions are
> still made in the vault; this copy exists so the schema, the import tooling, and
> the reasoning behind them live next to the code that implements them.
>
> The discovery corpus itself (`Discovery Corpus/_local`, ~3.1 GB of supplier
> originals, extractions, and provisional records) is **not** in this repository and
> never will be. It stays on the operator's machine, Git-ignored, and reaches
> Supabase only through `scripts/corpus/` — see
> [Corpus Compatibility Map](../architecture/Corpus%20Compatibility%20Map.md).

## Outcome

The available corpus now includes a reproducible visual layer rather than OCR text alone. Source PDFs and supplier JPEGs are indexed, visually relevant PDFs are rendered page by page, pixel measurements are retained separately from semantic labels, and provisional links connect images/pages to extracted variant candidates.

This is discovery evidence, not approved product content. Human review and image-usage rights remain publication gates.

## Processing boundary

Processed from the three accepted Drive roots:

- `Deco Tiles`;
- `Base Tiles (OEM)`;
- `Base Tiles (LOCAL)`.

Two oversized catalog PDFs were explicitly deferred by user direction and are not represented as media assets or page renders:

| Source | Size | State |
| --- | ---: | --- |
| `Base Tiles (LOCAL)/Alpha/Catalogue/Alpha Catalogoue 5th Edition - amend 3 (2)[1].pdf` | 174,006,407 bytes | Deferred |
| `Base Tiles (OEM)/Belleza/Belleza Catalogue/Large Format_Bellezza Catalogue_2026.pdf` | 382,335,899 bytes | Deferred |

The Guocera username/password document remains excluded from content and visual processing.

## Reconciled visual corpus

| Layer | Count |
| --- | ---: |
| Locally staged source PDFs | 154 |
| Locally staged standalone JPEGs | 76 |
| Source PDF media records | 154 |
| Standalone image media records | 76 |
| Rendered page media records | 2,022 |
| Total media asset records | 2,252 |
| Reproducible pixel observations | 2,098 |
| Provisional media-to-variant links | 3,344 |
| Distinct linked variant candidates | 1,522 |
| Semantic visual review tasks | 2,015 |
| Standalone-image contact sheets | 9 |

The 2,098 pixel observations cover all 2,022 indexed page renders and all 76 standalone JPEGs.

### Rendered PDF scope

| Document class | PDFs | Pages |
| --- | ---: | ---: |
| Catalog | 79 | 1,839 |
| Price list | 11 | 101 |
| Technical sheet | 1 | 30 |
| Other visually useful supplier material | 2 | 52 |
| **Total rendered** | **93** | **2,022** |

The other 61 local PDFs are certificates. Their originals remain directly linked as source media and their text/OCR evidence remains available, but the final visual index does not classify certificate page decoration, seals, or signatures as product imagery.

## What is captured from pictures

Every standalone image and rendered page retains:

- source identity, Drive path, source URL, and source checksum;
- exact page locator for PDF renders;
- width, height, orientation, and image checksum;
- whole-image palette, brightness, saturation, luminance variation, edge density, and a surface-complexity proxy;
- OCR/text-backed supplier-code links where an exact normalized code can be located;
- review tasks for product region, scene versus swatch, color family, pattern, texture, finish, shape, and application context.

The pixel palette and complexity values are reproducible measurements of the whole image or page. They are not approved tile color or texture values: white page backgrounds, room furniture, lighting, grout, and graphic design can dominate them.

Physical size is never derived from the apparent scale of a picture. A dimension becomes a product fact only when it is explicitly printed in supplier text or a technical drawing, supplied in structured data, or confirmed by a reviewer.

## Standalone-image semantic review

All 76 standalone JPEGs were arranged into nine contact sheets and visually inspected. The assisted review produced:

| Result | Count |
| --- | ---: |
| Reviewed standalone assets | 76 |
| Candidate product-visual assets | 73 |
| Assets with pattern candidates | 52 |
| Assets with shape candidates | 38 |
| Assets with color-family candidates | 18 |

These candidates use visible supplier headings, filenames, and contact-sheet inspection. Their state is `machine_visual_review_complete_human_approval_pending`. They can help the team find and review material, but they must not be published as canonical attributes yet.

## Media-to-product links

The 3,344 links use two distinct evidence strengths:

- exact normalized supplier/OCR codes on a page provide page-level evidence and a tighter product candidate link;
- same-source-document links provide lower-confidence discovery context only.

A same-document association must not make a whole catalog page the published image for every variant in that catalog. Publication requires an exact page/region, supplier code, or manual match.

## Validation completed

- all 154 source PDFs were SHA-256 rechecked across 2.355 GiB; mismatches: `0`;
- missing local paths: `0`;
- missing observation, semantic-label, review-task, link, or variant references: `0`;
- duplicate asset, observation, link, and review-task IDs: `0`;
- non-contiguous or duplicate page sequences across 93 rendered PDFs: `0`;
- assets originating from either deferred PDF or the credentials document: `0`.

Representative rendered pages from Guocera, Niro, MML, Citigres, Balena, and Mosycle were visually inspected. Product scenes, swatch matrices, supplier codes, printed dimensions, finishes, and application icons remained legible in the generated page images.

## Storage and safety

All originals, page renders, measurements, contact sheets, provisional links, and review queues remain under the Git-ignored `Discovery Corpus/_local` boundary. Google Drive was not modified. Local snapshots are reproducible working copies; Drive remains source authority until the Supabase migration cutoff.

## Supabase mapping

The visual layer maps to the proposed [Canonical Merchandise Schema](<../Canonical Merchandise Schema.md>) as:

- `source_asset` and `source_version` for Drive identity and immutable source checksums;
- `media_asset` for source PDFs, supplier JPEGs, page renders, and later reviewed crops;
- `visual_observation` for pixel measurements and separately reviewed semantic descriptions;
- `media_asset_variant_link` for candidate or approved image-to-product relationships;
- `product_media` only for reviewed, rights-cleared publication mappings.

This structure allows Obsidian discovery records to expose the real data shape without hardening unreliable image interpretations into the production product table.

## Remaining review gates

1. Human-approve or correct the 76 standalone-image semantic candidates.
2. Review page/region mappings for high-value catalog variants before publishing product imagery.
3. Approve controlled vocabularies for color family, pattern, texture, finish, shape, and scene/swatch type.
4. Confirm whether supplier images may be copied to private Supabase Storage and displayed internally.
5. Process the two deferred Alpha and Bellezza catalogs only if they become operationally necessary.
6. Decide whether the external White Horse porcelain and ceramic catalogs may be fetched and stored.
