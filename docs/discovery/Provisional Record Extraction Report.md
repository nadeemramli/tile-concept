---
title: Tile Concept OS - Provisional Record Extraction Report
description: Source-anchored candidate records, quality gates, duplicate signals, and review queue generated from the full discovery corpus.
created: 2026-08-21
updated: 2026-08-21
status: generated-unreviewed
tags: [tile-concept, discovery-corpus, provisional-records, pricing, certificates, schema-discovery]
---

# Provisional Record Extraction Report

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

The 242 file profiles resolve into **35 document-shape clusters**. One representative source was selected for each cluster; 33 are available for content review, while the remaining two represent the oversized-PDF recovery shape and the excluded credentials shape.

The first deterministic provisional-record pass generated:

| Candidate or observation | Count |
| --- | ---: |
| Catalog-edition candidates | 160 |
| Product-variant candidates | 6,011 |
| Price-entry candidates | 10,183 |
| Certificate candidates | 62 |
| Non-product commercial-amount observations | 253 |
| Cross-source code-resolution groups | 238 |

Every candidate has a source ID and source locator. Every candidate remains `pending_review`; none is approved or production-ready.

## Extraction rule coverage

### Product variants

| Rule | Candidates | Interpretation |
| --- | ---: | --- |
| White Horse structured XLSX rows | 3,743 | High-confidence row extraction; commercial meaning still unconfirmed |
| Belleza structured XLSX rows | 731 | High-confidence row extraction with series, size, body, classification, packing, and three price tiers |
| Generic code-plus-context lines | 1,537 | Lower-confidence codes from catalogs and PDF price lists |

Variant candidates came from 57 source files.

### Prices

| Rule | Candidates | Interpretation |
| --- | ---: | --- |
| White Horse `W.M Pallet/FOB Price` rows | 3,743 | Amount extracted; currency, exact unit basis, tax basis, and effective date unresolved |
| Belleza list/showroom/project rows | 2,193 | Three extracted tiers per 731 rows; currency, unit basis, tax basis, and effective date unresolved |
| Generic `RM` price-context lines | 4,247 | Requires record association and layout review |

Price candidates came from 97 sources. A further 253 currency amounts were retained only as commercial observations because they appeared to be delivery charges, value thresholds, investment figures, storage charges, or otherwise lacked product-price context.

## Price publication blockers

| Blocker | Affected candidates |
| --- | ---: |
| Product code unresolved | 2,794 |
| Unit basis unresolved | 7,235 |
| Currency absent from the structured source extract | 5,936 |
| Certificate scope unknown | 62 certificates |

Price confidence describes extraction, not commercial correctness:

- 5,936 structured-row candidates have high extraction confidence but missing commercial scope;
- 624 generic candidates have medium evidence strength;
- 3,623 generic candidates have weak or unresolved associations.

No price can be published until amount, currency, price tier, unit basis, tax basis, effective date, and product mapping are confirmed.

## Structured workbook findings

### White Horse

- 3,743 product-code rows.
- 380 distinct non-empty series labels.
- 3,239 rows marked `WHMY Phased out`.
- 496 rows have no material-status value.
- 8 rows are marked `WHMY Fail`.
- Every row contains pieces-per-carton data; cartons-per-pallet is also preserved.
- The price column is labelled `W.M Pallet/FOB Price`, but the extracted table does not establish currency, unit basis, tax basis, or effective-date meaning.

This is strong evidence that lifecycle/status is a source-scoped fact and must not be inferred from whether a SKU appears in a current catalog.

### Belleza

- 731 item-code rows across 144 non-empty series labels.
- 23 distinct size strings.
- Body values include porcelain, ceramic, sintered stone, color/full-body variants, and eight blanks.
- 2,193 prices represent list, showroom, and project tiers.
- Packing details are present as supplier strings and require structured quantity/unit parsing.

The workbook shows that price tier belongs to `price_entry` or its price program, while size/body/classification/variation belong to variant attributes.

## Code reuse and identity

There are 238 brand-scoped code groups observed in more than one source. These are not automatically duplicates. Many are likely the same product code appearing in a catalog and a price list, which is the desired bridge between product identity and commercial evidence.

Examples include Guocera codes shared across catalogs and MML codes shared between brochure/catalog sources and the master price list. Review must decide whether each group represents:

- one variant with multiple source observations;
- a family code shared by several variants;
- an old/new alias;
- a code collision;
- OCR or extraction error.

## Certificate findings

All 62 certificate candidates retain unknown scope. The parser surfaced:

- standards in 46 documents;
- text-derived certificate/report numbers in 24;
- filename identifier candidates in 17;
- at least one text or filename identifier in 34;
- type signals in 35;
- text-derived dates in 26;
- filename date candidates in 12.

Filenames contribute useful hints such as certificate numbers and expiry-looking dates, but those hints are not accepted date roles. A reviewer must confirm issuer, holder, standard, certificate number, issue/expiry meaning, and whether scope is organization, facility, category, family, variant, or unknown.

## Review queue

The generated local review queue contains 433 tasks:

| Priority | Tasks |
| --- | ---: |
| 1 - publication/source blocker | 4 |
| 2 - shape, class, or certificate review | 96 |
| 3 - duplicate or weak-association review | 333 |

Task types:

- 2 oversized-source recovery tasks;
- 2 structured price-scope blockers;
- 62 certificate-scope reviews;
- 1 document-class conflict;
- 33 representative-shape reviews;
- 238 duplicate-code resolutions;
- 95 low-confidence price-source reviews.

## Schema pressure conclusions

1. `product_variant.status` needs dated, source-scoped lifecycle evidence rather than a single permanent Boolean.
2. Supplier codes require brand/organization scope, aliases, and cross-source resolution.
3. Price-list versions need source-level defaults for currency, unit basis, tax basis, market, tier, and effective dates, with row-level overrides where present.
4. Packaging strings require a variant-specific configuration model rather than one global carton conversion.
5. Catalog, price, and certificate facts must join through reviewed candidate identity; folder proximity is insufficient.
6. Certificate coverage needs a dedicated join and an explicit `unknown` state.
7. The ingestion model needs grouped candidate records in addition to individual candidate facts so reviewers can approve or correct a coherent row/card.

## Determinism and safety checks

- An unchanged rerun produced byte-identical provisional and review outputs.
- Candidate IDs are unique within every dataset.
- No candidate came from the credentials document or either unreadable oversized PDF.
- Reconciled at the cutoff: the two "oversized" sources referenced here are the Mosycle
  catalogues, which were later recovered. The pair still deferred is Alpha and Bellezza.
- All variant codes are non-empty.
- All price amounts are positive decimals.
- Every price and variant has a source locator.
- Raw rows, excerpts, prices, and certificate evidence remain inside the Git-ignored `Discovery Corpus/_local` boundary.

Related: [Corpus Extraction Report](<./Corpus Extraction Report.md>), [Field Observation Registry](<./Field Observation Registry.md>), and [Canonical Merchandise Schema](<../Canonical Merchandise Schema.md>).

