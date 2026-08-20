---
title: Tile Concept OS - Field Observation Registry
description: Corpus-wide heuristic field signals observed during the first full extraction pass.
created: 2026-08-21
updated: 2026-08-21
status: observed-unreviewed
tags: [tile-concept, discovery-corpus, field-registry, schema-discovery]
---

# Field Observation Registry

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

## Reading this registry

Counts mean “documents in which the signal was detected,” not record counts and not accepted normalized values. Detection is deliberately broad so discovery does not erase uncommon shapes. Every signal remains `unreviewed` until checked against source evidence.

| Signal | Documents | Main role distribution | Initial schema implication | State |
| --- | ---: | --- | --- | --- |
| Material terms | 193 | catalog 122; certificate 59; price list 11 | Controlled material vocabulary plus raw label | unreviewed |
| Product-code-like tokens | 174 | catalog 114; certificate 44; price list 13 | Candidate family/SKU identifiers need brand-scoped uniqueness tests | unreviewed |
| Dimensions | 159 | catalog 142; price list 11; certificate 4 | Structured width/height/length with unit and raw string | unreviewed |
| Application terms | 147 | catalog 135; certificate 6; price list 5 | Many-to-many application/use taxonomy | unreviewed |
| Thickness values | 121 | catalog 83; certificate 34; price list 3 | Variant property, not necessarily family property | unreviewed |
| Finish terms | 108 | catalog 80; certificate 20; price list 7 | Controlled finish vocabulary plus supplier wording | unreviewed |
| Currency amounts | 107 | catalog 88; price list 10; certificate 7 | Versioned price evidence with currency, unit basis, and effective scope | unreviewed |
| Standards | 88 | certificate 46; catalog 42 | Normalized standard plus certificate/document evidence | unreviewed |
| Certificate markers | 72 | certificate 51; catalog 21 | Separate certificate entity and coverage relationship | unreviewed |
| Email addresses | 54 | catalog 38; certificate 16 | Source/contact evidence; do not copy blindly into organization master data | unreviewed |
| Dates | 37 | certificate 26; catalog 8; price list 3 | Typed date role required: issue, expiry, effective, revision, or unknown | unreviewed |
| URLs | 37 | certificate 29; catalog 8 | External source/link entity with retrieval status | unreviewed |

## Language signals

Signals can overlap within one document.

| Signal | Documents |
| --- | ---: |
| English vocabulary | 216 |
| Malay vocabulary | 31 |
| Chinese characters | 21 |
| Undetermined non-empty text | 19 |

Raw labels and values should therefore remain Unicode, and normalization must not depend on English-only headings.

## Candidate semantic groups

### Product identity

- brand and legal manufacturer;
- collection or series;
- family name;
- supplier product code;
- sellable variant code;
- source-local aliases.

### Physical specification

- width, height, length, and thickness;
- nominal versus actual dimensions;
- unit of measure;
- material/body;
- surface finish and texture;
- color, shade, pattern, and variation;
- packaging quantity, area, and weight.

### Commercial evidence

- currency;
- amount;
- unit basis such as piece, box, square foot, or square metre;
- price tier and customer scope;
- effective and expiry dates;
- tax/inclusion status;
- price-list version and source row.

### Certification evidence

- scheme or standard;
- certificate/license number;
- issuer;
- holder/manufacturer;
- issue and expiry dates;
- scope text;
- products, families, plants, or organizations covered;
- source page and confidence.

### Provenance and review

- Drive file ID and source version;
- document/page/row/block coordinates;
- raw label and raw value;
- extraction method and confidence;
- candidate semantic mapping;
- review decision and reviewer;
- supersession and migration state.

## Current decision

The observations reinforce the existing normalized direction: keep source assets and extracted observations separate from products, variants, price history, certificates, and certificate coverage. Do not freeze the final Supabase columns until representative record grains have been reviewed across all three roots.

Related: [Corpus Extraction Report](<./Corpus Extraction Report.md>) and [Canonical Merchandise Schema](<../Canonical Merchandise Schema.md>).

