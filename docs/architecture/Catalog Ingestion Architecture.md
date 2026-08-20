---
title: Tile Concept OS - Catalog Ingestion Architecture
description: Proposed boundary and processing design for standardizing supplier catalogs, price lists, certificates, and linked sources from Google Drive into Tile Concept OS.
created: 2026-08-21
updated: 2026-08-21
status: accepted-direction
tags: [tile-concept, catalog, pricing, certificates, ingestion, google-drive, supabase]
---

# Tile Concept OS - Catalog Ingestion Architecture

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
> [Corpus Compatibility Map](./Corpus%20Compatibility%20Map.md).

## Decision summary

Use three sequential layers:

1. **Google Drive remains the original-document authority.** Staff keep the existing supplier catalogs, price lists, certificates, and link manifests in their current brand folders during discovery.
2. **Obsidian is the temporary discovery and sense-making layer.** The current Drive corpus is inventoried and extracted into a local, inspectable soft-schema corpus. Field observations, raw labels, provisional mappings, exceptions, and shape profiles remain editable while the total data shape is unknown.
3. **Supabase becomes the permanent operational authority after discovery.** Once field coverage, product grains, units, price semantics, certificate scopes, and validation rules are understood, the accepted schema and current records are migrated. Future brand information and updates then enter through the application rather than through Obsidian or ad hoc Drive folders.

This is a deliberate bootstrap process: Obsidian helps discover the model; Supabase enforces the model after it is sufficiently understood.

## Why Obsidian-first discovery is appropriate

The current corpus is heterogeneous and its overall shape is not yet known. Committing early to relational tables would turn supplier-specific assumptions into hard migrations. Obsidian provides a transparent intermediate environment where the team can:

- inspect every source and extracted field without forcing it into a premature universal schema;
- compare brands, document types, labels, units, missingness, and repeated structures;
- maintain provisional mappings and revise them without database migrations;
- preserve links from every observation to the exact Drive file and source page;
- build a field-frequency and conflict profile before deciding which fields deserve typed Supabase columns;
- separate true product attributes from document layout artifacts and supplier terminology.

Obsidian is still not the final transactional database. The discovery corpus must be structured, machine-readable, idempotent, and isolated from Git where it contains raw supplier documents, extracted prices, or confidential information. See [Obsidian Discovery Corpus](../discovery/README.md).

## Observed Drive shape

The supplied screenshots show three top-level source collections:

- `Deco Tiles`
- `Base Tiles (OEM)`
- `Base Tiles (LOCAL)`

Each collection contains brand folders. The observed `Base Tiles (LOCAL) / White Horse` folder contains a price-list folder, a certificate folder, and a Google document containing links to separate porcelain and ceramic catalog sites.

The folder hierarchy is useful source context, but it must not be treated as the canonical product taxonomy. In particular:

- `LOCAL` and `OEM` describe a supply relationship or source collection, not necessarily a product category.
- A brand, manufacturer, supplier, distributor, and Drive-folder owner may be different organizations.
- A catalog can cover several categories, series, variants, or brands.
- A certificate can apply to a brand, facility, series, product family, SKU, or standard rather than to every product in its folder.

## Source-to-publication flow

```mermaid
flowchart LR
    A["Google Drive originals"] --> B["Obsidian source manifest"]
    B --> C["Raw extraction"]
    C --> D["Document shape profiles"]
    D --> E["Provisional record drafts"]
    E --> F["Cross-brand field registry"]
    F --> G["Accepted Supabase schema"]
    G --> H["Migrated current records"]
    H --> I["Future updates through app"]
```

### 1. Discover

Recursively inventory the allowlisted root folders using the authorized user's Google OAuth identity. Record Drive file/folder ID, parent ID, name, MIME type, modified time, web URL, size, checksum when available, and the observed path.

For an initial pilot, use a scheduled scan. Drive change notifications can be added later, but a notification is only a prompt to query the Drive change log; it does not contain the changed file's content or complete metadata.

### 2. Register and fingerprint

Create or update the source-asset record using:

- Stable identity: Google Drive file ID.
- Content identity: source checksum when available; otherwise a checksum calculated after download.
- Version identity: file ID plus content checksum, modified time, and Drive revision ID when available.

An unchanged fingerprint is a no-op. Changed content creates a new source version and diff; it never silently rewrites the previous extraction or published fact.

### 3. Snapshot

Keep the Google Drive file as the authoritative original. When reliable extraction requires a local copy, place it in the ignored `Discovery Corpus/_local/01 Source Snapshots` area with its Drive ID and checksum. This makes discovery reproducible without committing supplier binaries to Git.

If local duplication is not approved, retain metadata and checksum only and process an ephemeral download. Record that reproducibility depends on the Drive revision remaining accessible.

### 4. Classify

Classify each source as one of:

- `catalog`
- `price_list`
- `certificate`
- `link_manifest`
- `product_image`
- `other`

Folder names can suggest a class, but the file content and reviewer decision are authoritative.

### 5. Extract

Prefer deterministic extraction in this order:

1. XLSX/CSV or another structured source parser.
2. Embedded PDF text and table extraction.
3. Rendered page/region OCR for scanned or image-based content.
4. An allowlisted website connector for catalog URLs when access and reuse are approved.
5. Optional LLM mapping from extracted text into candidate fields, never direct publication.

Preserve raw extraction, page/region coordinates where practical, parser version, warnings, and confidence separately from normalized values.

### 6. Normalize and validate

Map supplier labels provisionally into the [Canonical Merchandise Schema](<./Canonical Merchandise Schema.md>) while also adding every observed label to the discovery field registry. Retain the raw label and raw value beside every mapped candidate. The canonical schema remains revisable until corpus-wide discovery is complete.

Validation includes:

- required common and category-specific attributes;
- code, brand, and alias collision checks;
- explicit units and unit basis;
- positive numeric values and sensible dimension ranges;
- price currency, tax basis, customer tier, effective dates, and overlap checks;
- certificate issuer, standard, scope, issue/expiry state, and document evidence;
- source-to-record traceability.

### 7. Review

Every candidate is assigned one of:

- `pending_review`
- `needs_correction`
- `approved`
- `rejected`
- `superseded`

Reviewers see the source page beside the extracted value, confidence, validation result, duplicate candidates, and changes from the currently published version. OCR or an LLM may propose; an authorized catalog/pricing operator publishes.

### 8. Profile and converge

Obsidian discovery does not yet publish production records. It produces:

- source and document-shape inventories;
- a cross-brand registry of every observed label, value type, unit, frequency, and mapping candidate;
- provisional product, price, catalog, and certificate records;
- reviewed exceptions and competing grain hypotheses;
- coverage and conflict reports by source collection, brand, document type, and category.

The hard Supabase schema is accepted only after these profiles show which semantics are stable, which belong in validated category attributes, and which are merely source-specific metadata.

## Drive connector recommendation

Start with a narrow OAuth connector for the current user's allowlisted Tile Concept folders. The screenshots show content under `Shared with me`, so access must be tested using the intended operational identity; a new service account will not automatically inherit those shares.

Initial synchronization should:

- traverse only the three accepted roots;
- support ordinary shared folders, shortcuts, and Shared Drives without assuming they behave identically;
- preserve Drive IDs rather than relying on names or paths;
- treat moves/renames as metadata changes and checksum changes as new content versions;
- use least-privilege read access during the pilot;
- never delete, rename, or reorganize supplier files.

After the pilot is stable, add a renewable `changes.watch` channel or a scheduled `changes.list` poll. The worker must still query the change log because Drive notifications have an empty body and contain no file content.

## Supabase boundary

Recommended placement during discovery and after cutover:

| Data | Location | Rule |
| --- | --- | --- |
| Original working source during discovery | Google Drive | Original-document authority |
| Source manifest, raw extraction, shape profiles, provisional mappings, and record drafts | Obsidian local discovery corpus | Soft schema; raw/confidential portions excluded from Git |
| Accepted schema, migrations, and durable operating decisions | Product repository and Build Vault documentation | Reviewed and versioned |
| Original/snapshot documents after cutover | Private Supabase Storage | Subject to approved duplication, access, and retention rules |
| Source, job, review, and published operational records after cutover | Supabase Postgres | Versioned, constrained, permissioned, and auditable |
| Future brand/product/price/certificate updates | Tile Concept application | App becomes the only normal write path |

Use a durable queue for extraction jobs, retries, and dead-letter handling. Queue consumers should use trusted server credentials; do not expose queue operations or the service/secret key to browser clients.

Tables in an exposed schema require explicit grants and RLS. Prefer private operational schemas with a narrow server-mediated API or reviewed security-invoker views/functions. Supabase's 2026 Data API change also means new tables may not be automatically exposed; exposure is an explicit decision, separate from RLS.

## Recommended rollout

### Phase A - Obsidian discovery corpus

- Inventory all three Drive roots without changing their contents.
- Create one source note per discovered file or external link.
- Extract current catalogs, price lists, and certificates into the ignored local corpus.
- Record every raw field label and observed value shape before forcing a mapping.
- Keep source ID, checksum, page/row locator, parser version, and extraction confidence.

### Phase B - White Horse pipeline pilot

- Inventory one White Horse catalog source, one price-list PDF, and one certificate PDF.
- Use White Horse to validate the manifest, extraction, shape-profile, and record-draft templates.
- Manually establish expected output for a small representative sample.
- Run extraction and compare provisional mappings against the expected result.
- Measure field accuracy, missing fields, review time, and duplicate/conflict behavior without freezing the global schema.

See [White Horse Ingestion Pilot](<./White Horse Ingestion Pilot.md>).

### Phase C - Corpus-wide shape discovery

- Process all approved sources across `Base Tiles (LOCAL)`, `Base Tiles (OEM)`, and `Deco Tiles` in controlled batches.
- Maintain a coverage matrix for brands, document types, categories, fields, units, and source formats.
- Identify stable common semantics, category-specific attributes, supplier-only metadata, conflicting grains, and unresolved values.
- Do not freeze the Supabase schema merely because the first few suppliers look similar.

### Phase D - Schema freeze and migration

- Approve the canonical grain and field dictionary from corpus evidence.
- Generate the Supabase schema, constraints, migrations, RLS, Storage layout, and import contracts.
- Transform reviewed discovery records into migration-ready datasets.
- Reconcile source counts, checksums, record counts, rejected rows, and control totals.
- Keep the Obsidian corpus as a dated discovery archive rather than a parallel live database.

### Phase E - App cutover

- Make the application the normal path for all new brands, documents, products, prices, and certificates.
- Store originals/snapshots, processing jobs, review decisions, and published records in Supabase.
- Stop ongoing manual data maintenance in Obsidian.
- Retain Google Drive as a read-only legacy archive for the migrated cutoff unless the business chooses a different retention policy.

## Decisions required before implementation

1. Who owns final approval for products, prices, and certificates?
2. May the discovery process keep local, Git-ignored snapshots and extracted supplier values inside the Obsidian vault boundary?
3. Which price types exist, and are prices tax-inclusive or tax-exclusive?
4. Which certificate types matter commercially, and at what scope can each apply?
5. What is the acceptable sample error rate before a supplier template can use lighter review?
6. Should `LOCAL` and `OEM` remain reporting labels, and can the same brand have more than one supply relationship?
7. Which Google identity will own discovery access, and will the source remain in `Shared with me` or move to a business-owned Shared Drive?
8. What evidence will mark corpus discovery complete enough to freeze the Supabase schema?
