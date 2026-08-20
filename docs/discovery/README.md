---
title: Tile Concept OS - Obsidian Discovery Corpus
description: Local soft-schema workspace for discovering the textual, tabular, and visual shape of current Google Drive merchandise data before Supabase schema freeze.
created: 2026-08-21
updated: 2026-08-21
status: accepted-direction
tags: [tile-concept, discovery-corpus, obsidian, ingestion, soft-schema]
---

# Tile Concept OS - Obsidian Discovery Corpus

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

## Purpose

This corpus is the temporary ingestion and sense-making environment for the current Google Drive merchandise data. Its job is to reveal the real data shape across every brand before the permanent Supabase schema is frozen.

It is not the future production database. After migration, new information and updates should be entered through the Tile Concept application.

## Local corpus layout

All supplier documents, extracted values, Drive URLs, and provisional records live under `_local`, which is excluded from Git by the project `.gitignore`.

```text
Discovery Corpus/
├─ README.md
├─ Templates/
│  ├─ Source Asset Template.md
│  └─ Document Shape Profile Template.md
└─ _local/
   ├─ 00 Source Manifests/
   ├─ 01 Source Snapshots/
   ├─ 02 Raw Extractions/
   ├─ 03 Shape Profiles/
   ├─ 04 Provisional Records/
   ├─ 05 Visual Corpus/
   ├─ 06 Review Decisions/
   └─ tools/
```

The `_local` corpus was created on 2026-08-21 and remains Git-ignored. Do not commit it or copy its values into fixtures.

Current reconciled status:

- 242 file-level shape profiles generated;
- 239 files with readable connector/OCR content;
- one credentials record excluded from content processing;
- two oversized catalog PDFs explicitly deferred: Alpha and Bellezza;
- 76 JPEGs OCR'd;
- 27 image-only PDFs OCR'd across 323 pages with no failed pages.
- 154 source PDFs and 76 standalone JPEGs staged as local, Git-ignored snapshots;
- 2,022 pages rendered from 93 visually relevant PDFs;
- 2,098 reproducible pixel observations and 3,344 provisional media-to-variant links generated;
- 76 standalone images reviewed through nine contact sheets, with semantic candidates still awaiting human approval.

See [Corpus Extraction Report](<./Corpus Extraction Report.md>), [Visual Corpus Extraction Report](<./Visual Corpus Extraction Report.md>), and [Field Observation Registry](<./Field Observation Registry.md>).

The provisional-record layer is also generated. See [Provisional Record Extraction Report](<./Provisional Record Extraction Report.md>) for candidate counts, validation gates, duplicate-code groups, and the review queue.

## Layer rules

### `00 Source Manifests`

One source-asset note per Drive file or external catalog link. It records identity and provenance without interpreting the merchandise data.

### `01 Source Snapshots`

Optional exact local copies used for reproducible extraction. Google Drive remains the original authority. Store a snapshot only when internal duplication is approved.

### `02 Raw Extractions`

Machine output that preserves source order, page/row coordinates, raw labels, raw values, parser version, warnings, and confidence. Do not clean or overwrite this layer.

### `03 Shape Profiles`

One profile per document version describing its tables, row grain, repeated blocks, candidate keys, units, value types, missingness, anomalies, and relationship hypotheses.

### `04 Provisional Records`

Draft products, variants, price entries, catalogs, certificates, organizations, and relationships. These use a soft schema and may change as later brands reveal new shapes.

### `05 Visual Corpus`

Source PDFs, standalone supplier images, rendered catalog/price/technical pages, contact sheets, pixel measurements, semantic visual candidates, and media-to-variant links. Visual measurements remain evidence; they are not approved product attributes.

### `06 Review Decisions`

Append-only human decisions: mapping accepted, corrected, rejected, split, merged, or left unresolved. Never silently rewrite the original extraction.

### `tools`

Reproducible local extraction and reconciliation utilities. Future reviewable migration exports will be created only after the canonical grain and schema are accepted.

## Soft-schema rule

During discovery, every textual, tabular, or visual observation has three separate representations:

1. `raw_label` and `raw_value` exactly as observed;
2. `candidate_semantic` and provisional normalized value;
3. `decision_state` showing whether the mapping is unreviewed, accepted, corrected, rejected, or unresolved.

Never destroy the raw representation when a mapping changes.

## Discovery completion gate

The corpus is ready for Supabase schema freeze only when:

- all allowlisted folders have a reconciled source manifest;
- current catalogs, price lists, and certificates have been processed or explicitly excluded with reason;
- visual source assets and page/region locators reconcile to their originals;
- product-image mappings and semantic visual labels have explicit review states and accepted usage rights;
- every document has a shape profile;
- field coverage and value-type distributions are available across all brands;
- product family versus variant grain is resolved for each category;
- units, packaging, price scope, effective dates, and certificate scope have accepted rules;
- unresolved fields are classified as migration blockers, optional metadata, or retained raw evidence;
- unchanged re-import is idempotent;
- reviewed record counts reconcile to source counts and exceptions.

The source-manifest and file-profile portions of this gate are now complete. Product/variant grain review, semantic field decisions, provisional records, and migration reconciliation remain open.

## Cutover rule

At cutover:

1. Freeze the discovery corpus at a dated Drive cutoff.
2. Generate migration exports from reviewed provisional records.
3. Import into Supabase staging and reconcile every source and record count.
4. Approve the production publication set.
5. Route all future updates through the application.
6. Preserve this corpus as read-only discovery evidence; do not run it as a second live database.
