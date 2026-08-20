---
title: Tile Concept OS - Corpus Extraction Report
description: Reconciled extraction and shape-profiling result for the three accepted Google Drive merchandise roots.
created: 2026-08-21
updated: 2026-08-21
status: observed
inventory_date: 2026-08-21
tags: [tile-concept, discovery-corpus, extraction, ocr, schema-discovery]
---

# Corpus Extraction Report

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

The discovery corpus now has one machine-readable shape profile for every one of the **242 Drive files** in scope.

| Processing result | Files |
| --- | ---: |
| Readable text from the Google Drive connector | 136 |
| Page-level OCR fallback for image-only PDFs | 27 |
| OCR for JPEG assets | 76 |
| Credentials record excluded from content processing | 1 |
| Oversized PDFs awaiting source recovery | 2 |
| **Total reconciled files** | **242** |

The usable content coverage is **239 of 242 files**. The other three are not silent failures: one is a deliberate security exclusion and two are explicit oversized-source exceptions.

## Format reconciliation

| Format | Inventory | Completed processing | Exception |
| --- | ---: | ---: | --- |
| PDF | 156 | 154 | 2 oversized Mosycle catalogs |
| JPEG | 76 | 76 | none |
| Google Doc | 8 | 7 | 1 credentials document, metadata only |
| XLSX | 2 | 2 | none |
| **Total** | **242** | **239 readable + 1 excluded** | **2 source-recovery items** |

The PDF fallback covered **27 documents and 323 rendered pages** with no failed pages. PDF pages were rendered at 144 DPI and processed with RapidOCR 3.9.2 on ONNX Runtime 1.28.0. Each page retained text, coordinates, confidence, and page identity. All 76 JPEGs retained the same line-level evidence plus source hashes.

## Provisional document roles

Roles are inferred primarily from the Drive path, then from content when the path is ambiguous. They are discovery labels, not accepted production classifications.

| Root | Catalog | Certificate | Price list | Technical sheet | Other | Excluded credential | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Base Tiles (LOCAL) | 50 | 55 | 4 | 0 | 1 | 1 | 111 |
| Base Tiles (OEM) | 11 | 6 | 2 | 0 | 0 | 0 | 19 |
| Deco Tiles | 101 | 1 | 8 | 1 | 1 | 0 | 112 |
| **Total** | **162** | **62** | **14** | **1** | **2** | **1** | **242** |

These labels describe a file's primary role. The contents overlap: catalogs can contain prices, standards, certificate claims, dimensions, and technical properties.

## Brand coverage

The file-level corpus spans 19 brand folder labels:

- Base Tiles (LOCAL): Alpha, Deer Tiles, Feruni, Guocera, Johnson, Kimgres, MML, Niro, and White Horse.
- Base Tiles (OEM): Balena, Belleza, BMS, Citigres, Muda Seramik, and Super Ceramic.
- Deco Tiles: GNG, Jerry's Mosaic, Mosycle, and Yidodo.

Folder labels are provenance hints, not yet canonical organization identities. Aliases and legal manufacturer names still require review.

## Explicit exceptions

| Source | Size | State | Required recovery |
| --- | ---: | --- | --- |

> **Reconciled 2026-08-21 at the migration cutoff.** The two oversized Mosycle
> catalogues named below were subsequently recovered and staged: both are present
> in the visual snapshot set (`Special Tiles catalog.pdf`, 366,392,675 bytes, and
> `泳池小册子.pdf`, 327,054,478 bytes) and both are imported. The sources actually
> deferred are a different pair — the Alpha catalogue (174,006,407 bytes) and the
> Bellezza catalogue (382,335,899 bytes) — recorded as `binary_not_staged` with no
> Storage object and no placeholder. The count of 154 staged PDFs is unchanged; only
> the identity of the missing two differs. See
> [Visual Corpus Extraction Report](./Visual%20Corpus%20Extraction%20Report.md).

| `Deco Tiles/Mosycle/Mosycle e-catalogue/Special Tiles catalog.pdf` | 366,392,675 bytes | Connector text empty; raw transfer exceeds inline connector path | Copy/download through an approved local Drive sync or provide a smaller source PDF |
| `Deco Tiles/Mosycle/Mosycle e-catalogue/泳池小册子.pdf` | 327,054,478 bytes | Connector text empty; raw transfer exceeds inline connector path | Copy/download through an approved local Drive sync or provide a smaller source PDF |
| `Base Tiles (LOCAL)/Guocera/Website - Username/PW/Guocera Site - Username/PW` | metadata only | Deliberately excluded | Keep in a password manager; do not ingest into this corpus or Supabase merchandise tables |

The attempted browser transfer for the first oversized catalog did not produce valid PDF bytes. Its invalid local HTML response was removed immediately.

## Source-quality warning

`Base Tiles (LOCAL)/Deer Tiles/Catalogue/2025.pdf` contains malformed PDF object references. The parser reported those references while counting pages, but Poppler rendered all 64 pages and the OCR pass completed all 64. Keep the warning attached to this source if later page-level reconciliation reveals visual anomalies.

## What the corpus shape already establishes

1. A catalog is not only a product list. Catalog sources frequently include dimensions, prices, finish/application claims, standards, and certificate language.
2. Product identity needs at least product-family and sellable-variant grains. Product-code-like values appeared in 174 documents, while dimensions appeared in 159.
3. Price evidence must remain versioned and source-scoped. Currency amounts appeared in 107 documents, including 88 catalog-role files.
4. Certificate scope cannot be stored as a single product column. Standards appeared in 88 documents and certificate markers in 72, with evidence also present inside catalogs.
5. Multilingual raw evidence must be preserved. Chinese characters appeared in 21 documents and Malay vocabulary in 31; these signals overlap with English.
6. Extraction confidence belongs to evidence, not the normalized product. Low-confidence OCR lines must remain reviewable without weakening already-verified fields.

## Safe interpretation boundary

The generated shape profiles and field counts are heuristic observations. They do not yet assert:

- that every code-like token is a SKU;
- that every currency value is a current sell price;
- that a certificate applies to every product shown nearby;
- that folder brand names equal legal manufacturers;
- that OCR text is correct without source-level review.

No raw supplier content is committed to Git. The full manifests, snapshots, OCR, connector text, and per-file JSON profiles remain under the ignored `Discovery Corpus/_local` boundary.

## Next review pass

The next pass should convert observations into provisional records in this order:

1. validate brand aliases and document roles;
2. select representative catalog, price-list, and certificate shapes from each root;
3. infer product-family, variant, price-entry, and certificate-coverage grains;
4. review field mappings and confidence thresholds;
5. generate reconciled migration exports only after the grains are stable.

Related: [Field Observation Registry](<./Field Observation Registry.md>), [Catalog Ingestion Architecture](<../Catalog Ingestion Architecture.md>), and [Canonical Merchandise Schema](<../Canonical Merchandise Schema.md>).
