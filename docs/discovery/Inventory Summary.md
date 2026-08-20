---
title: Tile Concept OS - Discovery Inventory Summary
description: Sanitized summary of the first recursive metadata inventory across the three accepted Google Drive roots.
created: 2026-08-21
updated: 2026-08-21
status: observed
inventory_date: 2026-08-21
inventory_scope: metadata-only
tags: [tile-concept, discovery-corpus, google-drive, inventory]
---

# Discovery Inventory Summary

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

## Result

The connected Google identity successfully traversed all three accepted merchandise roots in read-only mode. No Drive item was moved, renamed, or edited. This note records the initial metadata pass; the subsequent content result is documented in [Corpus Extraction Report](<./Corpus Extraction Report.md>).

| Root | Folders below root | Files below root | Total discovered items |
| --- | ---: | ---: | ---: |
| Deco Tiles | 81 | 112 | 193 |
| Base Tiles (OEM) | 21 | 19 | 40 |
| Base Tiles (LOCAL) | 29 | 111 | 140 |
| **Total** | **131** | **242** | **373** |

- Folders traversed including the three roots: **134**
- Traversal errors: **0**

## Format distribution

| MIME type | Count |
| --- | ---: |
| PDF | 156 |
| JPEG image | 76 |
| Google Doc | 8 |
| XLSX spreadsheet | 2 |
| Folder | 131 |

## Initial shape implication

The corpus requires at least four processing paths:

1. native PDF text/table extraction;
2. rendered-page OCR for scanned PDFs and JPEG catalog/price material;
3. Google Doc reading, including link-manifest discovery;
4. native spreadsheet parsing for XLSX sources.

The metadata result supports the Obsidian-first discovery approach: document formats and folder depths vary materially before the contents or row grains are even inspected.

## Local evidence

The full path-level Markdown manifest and machine-readable JSONL inventory are stored under the Git-ignored `Discovery Corpus/_local/00 Source Manifests` boundary.

## Subsequent pass status

The full extraction and shape-profiling pass is complete for every retrievable non-sensitive source:

- 239 files have readable connector or OCR content;
- one credentials document is metadata-only by policy;
- two 300+ MB Mosycle PDFs were recorded here as source-recovery exceptions; both were
  later recovered and are staged and imported. The sources actually deferred at the
  2026-08-21 cutoff are the Alpha and Bellezza catalogues — see
  [Visual Corpus Extraction Report](./Visual%20Corpus%20Extraction%20Report.md);
- one shape profile exists for each of the 242 files.

See [Corpus Extraction Report](<./Corpus Extraction Report.md>) for methods, reconciliation, and limitations.
