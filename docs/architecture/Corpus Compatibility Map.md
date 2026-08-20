---
title: Tile Concept OS - Corpus Compatibility Map
description: How Canonical Merchandise Schema v0.3 maps onto the implemented Supabase schema, what was evolved, what was added, and what the review gates now refuse.
created: 2026-08-21
updated: 2026-08-21
status: implemented
schema_version: 0.3.0
tags: [tile-concept, schema, migration, ingestion, corpus, supabase]
---

# Corpus Compatibility Map

This is the bridge between [Canonical Merchandise Schema](./Canonical%20Merchandise%20Schema.md)
v0.3 — written during discovery, in its own vocabulary — and the schema that
actually exists in this repository.

The governing rule while writing it was: **evolve the existing table, do not
create a parallel one just because the canonical document uses a different
noun.** Where v0.3 says `product_family` and the repo says `merch.products`,
those are the same grain and the repo name won. Where v0.3 describes something
the repo had no concept of at all — certificates, organizations, media evidence
— a new table was added.

Implemented by migrations `20260821000001` … `20260821000006`. Nothing in
`20260820000001` … `20260820000015` was edited.

---

## 1. Source and ingestion

| v0.3 concept | Implementation | Disposition |
| --- | --- | --- |
| `source_collection` | `ingest.source_collections` | **New.** The three accepted Drive roots. `supply_model` (`local`/`oem`/`imported`/`unknown`) is nullable and separate from `code`, because "LOCAL" and "OEM" describe a supply relationship, never a product category. |
| `source_location` | `ingest.source_locations` | **New.** Self-parenting folders and link manifests. `display_path` is a breadcrumb only — Drive names can contain a literal `/` (observed: `Website - Username/PW`), so hierarchy resolves through `parent_id`/`external_id`. |
| `source_asset` | `ingest.source_assets` | **Extended.** Gains `provider`, `external_id`, `source_location_id`, `asset_class`, `asset_class_review_state`, `current_version_id`. The pre-existing `kind` CHECK (`pdf`/`image`/`excel`/`csv`/`url`/`manual`) keeps its meaning as the technical format; `asset_class` is the reviewable document role. |
| `source_version` | `ingest.source_asset_versions` | **Extended.** Gains `workspace_id`, `size_bytes`, `mime_type`, `modified_at_source`, `provider_revision_id`, `snapshot_state`, `storage_bucket`, `storage_path`, `supersedes_version_id`. A unique index on `(source_asset_id, checksum)` moves the idempotency invariant out of `api.register_source_asset` and into the database. |
| `ingestion_run` | `ingest.import_runs` | **New**, alongside the existing `ingest.ingestion_jobs`. A job covers one uploaded document; a run covers a whole corpus pass. |
| — | `ingest.import_items` | **New.** The resume ledger. `(workspace_id, item_kind, external_key)` is what makes an interrupted import continue rather than duplicate. |
| `candidate_record` | `ingest.candidate_records` | **New.** `candidate_key` is the corpus's own stable id, unique per workspace. |
| `candidate_fact` | `ingest.candidate_facts` | **New.** One row per observed field, holding `raw_label`, `raw_value`, `normalized_value`, and a `validation_state` of `incomplete` when the source never established it. This is what makes "the source never said which currency" queryable instead of merely absent. |
| `review_decision` | `ingest.review_decisions` | **New**, append-only, enforced by a trigger. A later decision supersedes an earlier one; nothing is edited away. |
| — | `ingest.review_items` | **Extended** with `task_type`, `priority`, `external_key`, `review_target_*`, `import_run_id`. `item_type` has no CHECK constraint, so the corpus task types needed no DDL. |

`ingest.ingestion_records` and `ingest.extracted_fields` were deliberately left
untouched: they remain the interactive single-document upload path.

### Snapshot states

`source_asset_versions.snapshot_state` is how the exceptions stay visible rather
than becoming silent gaps:

| State | Meaning | Count at cutoff |
| --- | --- | ---: |
| `uploaded` | The binary is staged and in Storage | 230 |
| `connector_text_only` | Google-native or spreadsheet source; connector text imported, no binary exists | 9 |
| `binary_not_staged` | Deferred by size; metadata only, **no object and no placeholder** | 2 |
| `excluded_by_policy` | The Guocera credentials document; metadata only, content never read | 1 |

---

## 2. Parties and merchandise

| v0.3 concept | Implementation | Disposition |
| --- | --- | --- |
| `organization` | `merch.organizations` | **New.** A Drive folder called "White Horse" may name a brand, a manufacturer, a supplier, or all three. |
| `organization_role` | `merch.organization_roles` | **New**, dated. `merch.suppliers` is kept and linked through `organization_id`, not replaced — every existing supplier query keeps working. |
| `brand` | `merch.brands` | **Extended** with `owner_organization_id`, `slug`, `country_code`. |
| `product_category` | `merch.product_categories` | **Unchanged.** Already the right shape. |
| `product_family` | `merch.products` | **Same grain, no new table.** Extended with `series_name`, `material_code`, `published_version`, `source_version_id`. |
| `product_variant` | `merch.product_variants` | **Extended** with scoped `supplier_code` / `manufacturer_code` (plus generated normalized keys), `color_code`, `finish_code`, `grade_code`, `source_version_id`. Codes are indexed per workspace, never assumed globally unique. |
| `product_status_history` | `merch.product_status_history` | **New.** A workbook that says "WHMY Phased out" for 3,239 rows is one dated observation, not a licence to overwrite a lifecycle. |
| `product_alias` | `merch.product_aliases` | **Unchanged.** |
| `attribute_definition` / `attribute_value` | `merch.attribute_definitions` / `merch.product_attribute_values` | **Extended** with `schema_version`, `comparable`, `status`; and `source_version_id`, `unit_id`, `review_state`, `valid_from`/`valid_to`. |
| `unit_of_measure` | `merch.units_of_measure` | **Unchanged.** |
| `package_configuration` | `merch.packaging_configurations` | **Extended** with `source_version_id`, `gross_weight_kg`, `review_state`, `effective_from`/`effective_to`. |
| `catalog_edition` | `merch.catalog_editions` | **New.** |
| `catalog_item` | `merch.catalog_entries` | **Extended** with `catalog_edition_id`, `variant_id`, `source_version_id`, `display_order`, `raw_catalog_label`. |
| `price_list` | `merch.price_lists` | **Unchanged** in shape; the `currency` column default was **dropped**. |
| `price_list_version` | `merch.price_list_versions` | **New.** Its defaults are nullable on purpose — a missing source semantic is a publication blocker, not a value to inherit. |
| `price_entry` | `merch.variant_prices` | **Extended** with `price_list_version_id`, `quantity_unit_id`, `tax_basis`, `price_type`, `market`, `customer_tier`, `source_version_id`, `source_page_or_row`. The `currency` default was **dropped**. |
| `certificate` / `certificate_scope` | `merch.certificates` / `merch.certificate_scopes` | **New.** Nothing certificate-shaped existed anywhere in the repo or the PRD. |
| `product_media` | `merch.product_media` | **Extended** with `media_asset_id`, `media_asset_variant_link_id`, `usage_rights_state`, `review_state`, `alt_text`, `sort_order`, and a CHECK that a reviewed row must have accepted rights. |

---

## 3. Visual evidence

Four layers, deliberately kept apart:

```
ingest.media_assets               immutable evidence and derivatives
ingest.visual_observations        append-only measurements and readings
ingest.media_asset_variant_links  candidate relationship to a variant
merch.product_media               the reviewed publication mapping
```

| v0.3 concept | Implementation | Notes |
| --- | --- | --- |
| `media_asset` | `ingest.media_assets` | Named `media_assets`, not `product_media`: `api.*` view names are unqualified and share one namespace, and `api.product_media` already belongs to `merch.product_media`. |
| `visual_observation` | `ingest.visual_observations` | Append-only. `observation_basis` records *how* something was learned. |
| `media_asset_variant_link` | `ingest.media_asset_variant_links` | Carries both the canonical `link_basis` and the corpus's own `link_basis_raw`. |
| `product_media` | `merch.product_media` | Publication only. |

### Two vocabulary mappings

The corpus names things more verbosely than v0.3. Both raw forms are retained so
the mapping stays reversible:

| Corpus value | Canonical | Column holding the original |
| --- | --- | --- |
| `pixel_measurement_not_semantic_classification` | `pixel_measurement` | `observation_basis_raw` |
| `visual_review_of_contact_sheet_supported_by_visible_supplier_heading_and_filename` | `machine_visual_classification` | `observation_basis_raw` |
| `exact_normalized_ocr_code` | `exact_ocr_code` | `link_basis_raw` |
| `candidate_page_locator` | `same_catalog_page` | `link_basis_raw` |
| `same_source_document` | `same_source_document` | `link_basis_raw` |

### Media asset identity

Identity is `(workspace_id, source_asset_id, asset_kind, page_number)`, **not**
the content checksum.

This was found during the import, not designed in advance. Byte-identical pages
are common and legitimate: the ITAElement brochure series shares its boilerplate
pages, so page 5 of one catalogue hashes the same as page 5 of nine siblings —
25 rows across 10 groups at this cutoff. Each is still separate evidence with
its own document and its own provenance, and collapsing them would silently lose
one document's page. `content_checksum` stays indexed for dedup *reporting*.

---

## 4. What the gates now refuse

These are the rules that were previously prose in the discovery documents and
are now enforced, with pgTAP coverage in `supabase/tests/003_corpus.sql`.

### Prices

`api.approve_review_item` was rewritten. Its previous body filled in whatever
the source did not say: `currency` became `'MYR'`, `valid_from` became today,
`min_quantity` became `1`, a nameless product became `'Untitled product'`, and
the price list was guessed from the first active one matching the supplier. Each
of those turns "we do not know" into a published commercial fact.

It now collects every unresolved semantic and refuses once, naming all of them:

> cannot approve: the source does not establish currency, unit_id (price unit
> basis), tax_basis, price_type, market, min_quantity, price_list_id. Resolve
> each explicitly — none of these is defaulted.

A `tax_basis` of `unknown` counts as unresolved: it is an honest extraction
result, not an approvable basis. The `currency` column default was dropped from
`merch.variant_prices` and `merch.price_lists` so nothing can fill it silently
from another direction either.

This matters at scale here: of 10,183 price candidates, 5,936 have no currency
in the structured source, 7,235 have no unit basis, and 2,794 have no resolved
product code.

### Certificates

`certificate_scopes.scope_type` defaults to `unknown`, and a CHECK constraint
prevents a row from being `reviewed` while its scope is `unknown` or its named
target is null. `api.approve_certificate_candidate` refuses with *"a folder
location does not establish scope"*. All 62 certificate candidates arrive with
`scope_type = 'unknown'`.

### Images

- `visual_observations.physical_size_inferred_from_pixels` is a CHECK-enforced
  `false`. A dimension derived from image scale cannot be stored at all.
- A `visual_observation` can only reach `approved` when its basis is
  `human_visual_review`. A pixel measurement cannot be approved into a product
  attribute.
- `media_asset_variant_links` cannot be `approved` when `link_basis` is
  `same_source_document` — enforced by constraint *and* by the function, which
  explains why. 1,513 of the 3,344 links are same-document.
- `merch.product_media` cannot be `reviewed` unless `usage_rights_state` is
  `accepted`. Correctness and rights are separate gates.

---

## 5. Storage

| Bucket | Contents | Limit |
| --- | --- | --- |
| `source-assets` | Supplier originals, `<ws>/drive/<collection>/<source_id>/<sha256>/<file>` | raised to 512 MiB |
| `product-media` | Page renders and standalone images, `<ws>/sources/<source_id>/{pages,images}/…` | 20 MiB (largest render is 897 KB) |
| `ingest-artifacts` | Contact sheets, raw extraction artifacts, reconciliation manifests | 100 MiB, **new** |

All private. Object names begin with `<workspace_id>/` because
`core.storage_workspace_of()` reads the leading folder to decide access. The
bucket name is chosen by the SDK and never repeated inside the key.

Raising the `source-assets` bucket limit is inert until the **project-wide**
Storage file size limit is raised in the dashboard — that one is not SQL. 14 of
the 154 staged originals exceed the old 50 MiB cap; the largest is 366,392,675
bytes.

---

## 6. Where each corpus dataset landed

| Corpus file | Table | Rows |
| --- | --- | ---: |
| `00 Source Manifests/drive-inventory-2026-08-21.jsonl` | `source_collections`, `source_locations`, `source_assets`, `source_asset_versions` | 3 · 131 · 242 · 242 |
| `03 Shape Profiles/profiles.jsonl` | `shape_profiles` | 241 (242 less the credentials document) |
| `04 Provisional Records/shape-clusters.jsonl` | `shape_clusters` | 35 |
| `04 …/catalog-edition-candidates.jsonl` | `catalog_edition_candidates` | 160 |
| `04 …/product-variant-candidates.jsonl` | `variant_candidates` | 6,011 |
| `04 …/price-entry-candidates.jsonl` | `price_candidates` | 10,183 |
| `04 …/certificate-candidates.jsonl` | `certificate_candidates` | 62 |
| `04 …/commercial-amount-observations.jsonl` | `commercial_amount_observations` | 253 |
| `04 …/duplicate-code-groups.jsonl` | `duplicate_code_groups` | 238 |
| `04 …/validation-issues.jsonl` | `corpus_validation_issues` | 3 |
| all of the above | `candidate_records` / `candidate_facts` | 16,669 · 61,869 |
| `05 Visual Corpus/records/media-assets.jsonl` | `media_assets` | 2,252 |
| `05 …/visual-observations.jsonl` + `semantic-visual-observations.jsonl` | `visual_observations` | 2,174 |
| `05 …/asset-variant-links.jsonl` | `media_asset_variant_links` | 3,344 |
| `05 …/contact-sheet-index.jsonl` | `contact_sheets` / `contact_sheet_items` | 9 · 76 |
| `06 Review Decisions/review-queue.jsonl` + `visual-review-queue.jsonl` | `review_items` | 2,448 |

Never imported: the credentials document and its shape profile, the 39 orphan
page renders left over from earlier passes, and the vendored Python under
`_local/tools/python`.

---

## 7. Open decisions inherited from v0.3

These are unchanged by the migration and still belong to the business, not the
schema. The schema simply refuses to guess at them:

1. White Horse's real family/series/SKU grain.
2. Whether colour and finish need controlled entities or stay controlled attributes.
3. The accepted price types, customer tiers, tax bases, and market scopes.
4. The certificate vocabulary, expiry-warning window, and authorized reviewer.
5. Whether supplier code, manufacturer code, or the SQL Account item code is the primary operational key.
6. Whether supplier product images may be copied and displayed internally.
7. Category attribute rules, once one representative source per category is reviewed.
8. Controlled vocabularies for visual colour family, pattern, texture, finish, shape, and scene/swatch type.

Until each is answered, the corresponding candidates stay `pending_review`, which
is the correct state for them to be in.
