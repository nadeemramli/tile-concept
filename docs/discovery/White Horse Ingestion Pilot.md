---
title: Tile Concept OS - White Horse Ingestion Pilot
description: Proposed pilot for validating catalog, price-list, and certificate ingestion from the Base Tiles (LOCAL) White Horse folder.
created: 2026-08-21
updated: 2026-08-21
status: proposed
review_date: 2026-08-28
tags: [tile-concept, white-horse, pilot, catalog, pricing, certificates]
---

# Tile Concept OS - White Horse Ingestion Pilot

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

## Pilot purpose

Prove the Obsidian discovery-ingestion workflow on one brand before processing every supplier folder. White Horse validates the templates and processing mechanics; it does not freeze the final cross-brand schema.

## Observed source boundary

- Source collection: `Base Tiles (LOCAL)`
- Observed brand folder: `White Horse`

Observed child sources:

- `WH Pricelist` folder;
- `Certificates` folder;
- a Google document containing separate porcelain and ceramic catalog links.

The screenshots establish folder structure only. They do not establish the available file list, document contents, price validity, certificate scope, website reuse rights, or canonical White Horse product model.

## Corpus status - 2026-08-21

The authorized Drive pass has now moved beyond the screenshot-only boundary:

- 13 White Horse files were profiled;
- one Google Doc is an external e-catalog link manifest;
- one XLSX price list was extracted as a structured table;
- 11 certificate PDFs were extracted, including two that required page-level OCR;
- the external porcelain/ceramic catalog websites themselves have not been crawled or copied.

The visual-corpus pass retains the 11 certificate PDFs as source media and the XLSX as structured evidence, but it produces no White Horse product-page or product-image records. The only White Horse product catalogs currently in scope are external links, so image extraction, visual matching, and supplier-stated catalog attributes remain deferred until access and internal-use rights are accepted.

The price workbook produced 3,743 product-code candidates and 3,743 non-zero price candidates. It contains 380 non-empty series labels, 3,239 `WHMY Phased out` rows, 496 blank material-status rows, and 8 `WHMY Fail` rows.

The source column is labelled `W.M Pallet/FOB Price`. Currency, exact unit basis, tax basis, effective-date meaning, and whether “Pallet/FOB” represents one or more commercial programs are not explicit in the extracted table. These are publication blockers, not values to infer.

The certificate sources produced 11 document candidates, but their exact scope remains unknown until reviewed. Folder location alone does not authorize applying them to all 3,743 codes.

The White Horse pilot therefore proves structured row extraction and source traceability, but not approved product identity or price/certificate semantics. The external catalog link still needs an access/reuse decision before it can supply product names, dimensions, finishes, images, or family-to-code relationships.

## Required pilot inputs

Provide or authorize read access to:

1. One current price-list PDF with its business owner and effective-date interpretation.
2. One representative certificate PDF with a human explanation of what it is believed to cover.
3. One catalog source: porcelain or ceramic.
4. A small expected-output sample chosen by a catalog/pricing operator: ideally 10-20 variants covering more than one size, finish, or unit basis.
5. The current SQL Account item-code mapping for any sampled products, if it already exists.

Place authorized snapshots, raw extractions, price rows, and provisional records only under the Git-ignored `Discovery Corpus/_local` boundary. Google Drive remains the original authority. Do not copy these values into Git-tracked notes or fixtures.

## Pilot sequence

### 1. Inventory only

- Read the White Horse folder recursively.
- Record file/folder IDs, names, MIME types, parent IDs, modified times, sizes, checksums where available, links, and access errors.
- Classify each item as catalog, price list, certificate, link manifest, image, or other.
- Create source-asset notes under the local discovery corpus and produce reconciled counts and exceptions before interpreting business facts.

Exit check: every discovered item has a stable source identity and no Drive content was modified.

### 2. Establish expected truth

A human reviewer selects a representative slice and manually records the expected:

- brand, category, family/series, SKU/code, color, finish, dimensions, selling unit, package configuration;
- price amount, currency, unit basis, price type/tier, tax basis, and effective date;
- certificate number, issuer, standard, holder, issue/expiry dates, and exact scope.

Unknown values remain `unknown`; they are not filled from assumptions.

Exit check: expected records follow [Canonical Merchandise Schema](<./Canonical Merchandise Schema.md>) and point to exact source pages/rows.

### 3. Run extraction

- Snapshot or ephemerally download the exact source version according to the approved duplication rule.
- Extract native PDF text first; OCR only pages/regions without reliable text.
- Render visually relevant catalog, price-list, and technical pages; keep certificate originals linked without treating seals, signatures, or page backgrounds as product imagery.
- Fetch catalog links only if the domain and internal-use rights are approved.
- Link product imagery to variants through exact supplier/OCR codes or a reviewed page/region; a same-document association is not enough for publication.
- Map extracted rows into candidate records while preserving raw labels/values and coordinates.
- Run schema, unit, duplicate, price-overlap, and certificate-scope validation.

Exit check: every candidate is reproducible from a source version and pipeline version.

### 4. Review and compare

- Compare candidates with the human expected-output sample.
- Correct or reject ambiguous mappings.
- Record false positives, false negatives, field accuracy, review time, and template-specific rules.
- Retain reviewed records as provisional Obsidian discovery records; do not treat them as production-published records or freeze the global Supabase schema.

Exit check: no unreviewed candidate appears as an approved product, price, or certificate.

### 5. Re-import test

- Re-run the unchanged files and verify a no-op/idempotent result.
- Test one controlled changed fixture or later source revision.
- Verify that changed content creates a new version and diff without overwriting the approved historic record.

Exit check: counts reconcile and prior source/published versions remain queryable.

## Pilot scorecard

| Measure | Definition | Acceptance target |
| --- | --- | --- |
| Source coverage | Discovered approved items / expected approved items | 100% for pilot boundary |
| Idempotency | Duplicate published records after unchanged re-run | 0 |
| Required-field accuracy | Correct required values / expected required values | Target to be approved before run |
| Price accuracy | Exact amount, currency, unit, scope, and date match | 100% before publication |
| Certificate identity accuracy | Correct number, issuer, standard, dates | 100% before publication |
| Certificate scope certainty | Records with verified scope / reviewed certificates | Report separately; no assumed scope |
| Review effort | Median reviewer minutes per source page or record | Baseline, then improve |
| Traceability | Published fields with source version and locator | 100% |
| Re-import result | Unchanged source produces new published records | 0 |

Price and certificate values use a hard publication gate even if the general extraction-accuracy target is lower.

## Pilot outputs retained in Obsidian

The local discovery corpus retains:

- source manifests and optional authorized snapshots;
- raw extraction and OCR payloads;
- document shape profiles;
- provisional product, price, catalog, and certificate records;
- raw-to-candidate field mappings and review decisions;
- source counts, format distribution, measured results, and unresolved schema decisions.

Raw and confidential layers remain under `Discovery Corpus/_local` and outside Git. Durable schema lessons and sanitized summaries may be promoted into tracked project documentation.

## Continue/stop rule

Continue to two more structurally different `Base Tiles (LOCAL)` brands only if:

- the source inventory is complete;
- unchanged re-import is idempotent;
- all published prices match source evidence exactly;
- certificate scope is never inferred from folder location alone;
- reviewers can correct mappings without developer intervention;
- every published field is traceable to a source version and locator.

Revise the schema or stop scaling if the pilot requires product-specific hard-coded columns, loses source history, or makes review slower than the current lookup workflow without a credible path to improvement.

## Pilot decisions required

1. Name the catalog/pricing reviewer and certificate reviewer.
2. Select porcelain or ceramic as the first catalog source.
3. Approve one price-list PDF and one certificate PDF for the pilot.
4. Confirm whether local, Git-ignored source snapshots and raw extractions are allowed during discovery.
5. Confirm whether the external White Horse catalog may be fetched and whether its images may be stored/displayed internally.
6. Record provisional price type, tax basis, unit basis, and effective-date interpretations for the selected price list; confirm them only after cross-brand comparison.
