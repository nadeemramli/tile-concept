# Standard sales reporting — gap analysis and plan

**Status:** proposal, 2026-10-04. Nothing in this document is built yet.
**Provenance:** merged in PR #17 at `85a048d`. Reconciled for TILE-3 in `docs/sales-reporting-baseline-tile-3.md` §7: where that dictionary differs (GLC as an independent dimension, quotation send events, selected-week forecast, neutral competitor relationship, no forecast or segment gates, dimension coverage), the coordinator rules recorded there apply. Decisions in this plan remain proposals; none is owner-accepted.
**Owner question:** "What is missing in our lead management system before the app can show the standard weekly sales report by default?"

## 1. The report we want

One default view, per week (Monday to Sunday, Asia/Kuala_Lumpur), filterable by salesperson:

| # | Section | Question |
| --- | --- | --- |
| R1 | Leads | How many leads came in this week? |
| R2 | Lead segments | End user vs contractor (residential / commercial / GLC) vs interior designer (category, segment) |
| R3 | Quotations | How many quotations were sent out? |
| R4 | Forecast | How many might close? |
| R5 | Products | Which products, brands, sizes and panels are we selling? |
| R6 | Losses | Why did we lose the project? Pricing, timing, friendly competitor |

## 2. Verdict

The schema can answer R1 today and nothing else cleanly. The other five sections fail for two different reasons, and the plan has to fix both:

1. **Missing or unconstrained fields.** There is no segment on a lead, no sub-segment anywhere, no lost-reason code, no product line on a quotation or sale, and no size or panel classification in the catalog.
2. **The data path is not used.** On the hosted workspace the inbox and walk-in flows carry all the activity, while the opportunity and quotation module is almost empty. A report built on `sales.opportunities` and `sales.quotes` would be correct and blank.

Hosted workspace counts on 2026-10-04 (aggregates only):

| Record | Count | Note |
| --- | ---: | --- |
| Leads | 721 | 536 `walk_in`, 185 `tiktok`; 169 of them arrived in one week (an import batch) |
| Leads with a linked contact | 536 | 525 of those contacts have a `customer_type` |
| Showroom visits | 537 | 58 carry a quotation amount, 8 carry an SQ number, 1 has a quotation file |
| Opportunities (not archived) | 3 | all open; none has segment, probability band or expected close date |
| Quotes / quote versions / quote items | 0 / 0 / 0 | the quote dialog has never been used |
| Lost opportunities | 0 | so no loss reasons exist |
| Purchases / purchase items with a product | 64 / 0 | 63 are `legacy_unclassified` |

Production stages do require a reason on Won, Lost and Deferred (`requires_reason = true`). The demo workspace does not, because `20260823000002_demo_dataset.sql:74` omits the flag.

## 3. Gap by section

### R1. Leads per week — works, with two caveats

- `sales.leads.created_at` exists and `api.report_lead_source` already counts by source (`20260820000012_phase6_reports.sql:66`).
- Caveat 1: imports stamp `created_at` with the import time, so the 169-lead week is an artefact. The weekly report must bucket on a business date. `sales.intake_events.occurred_at` exists but is not always set; add `sales.leads.received_at` and have importers fill it.
- Caveat 2: every walk-in creates a lead, so "leads" mixes online enquiries and showroom visitors. The report should show both, split by `source_channel`, and the business should confirm whether a walk-in counts as a lead.

### R2. Lead segments — no home in the schema

| Business concept | Nearest field today | Gap |
| --- | --- | --- |
| End user | `identity.contacts.customer_type = 'homeowner'` | Only on the contact, never on the lead. 185 TikTok leads have no contact. |
| Contractor | `customer_type = 'contractor'`, `accounts.account_type = 'contractor'` | Flat value, no sub-split. |
| Contractor residential / commercial / GLC | none | `projects.project_type` and `opportunities.segment` describe the job, not the customer. No `glc` value anywhere. |
| Interior designer (ID) | `customer_type = 'designer'` | The tracker importer folds "ID" into `designer` (`scripts/import/daily-tracker.mts:37-44`). |
| ID category, ID segment | none | No field. |

Structural problems to fix at the same time:

- Four hard-coded copies of the customer-type list disagree with each other: the two CHECK constraints (`contacts`, `accounts`), `src/features/crm/schema.ts:4-5`, `src/features/walkins/schema.ts:6`, and an inline array in `src/features/inbox/components/lead-drawer.tsx:487`.
- `sales.visits.customer_type` has no CHECK at all (`20260820000003_sales.sql:127`).
- `sales.opportunities.segment` (`institutional, residential, fnb, hospitality, commercial, other`) is set only in the Edit dialog and is null on all production rows.
- The new-inquiry dialog and `api.create_manual_inquiry` collect no type or segment at all.

### R3. Quotations sent — three unlinked records, none complete

| Record | Where | What it has | What it lacks |
| --- | --- | --- | --- |
| `sales.quotes` + `quote_versions` + `quote_items` | pipeline drawer, `addQuoteVersionAction` (`src/server/commands/opportunities.ts:98-136`) | number, issued date, total, SQL Account ref | requires an opportunity; written as four separate inserts with no RPC and no idempotency; `quote_items` never written; `accepted/rejected/expired` never set; unused in production |
| `sales.visits.quotation_ref` + `quotation_amount` | walk-in wizard and workbook import | SQ number, amount, visit date | no quote row, no items, no status, no link to an opportunity |
| `sales.visit_quotation_files` | after a walk-in is saved | the PDF or XLS | no number, amount, date or items |

`api.report_quotes` groups by source channel and filters on `quotes.created_at`, not `issued_at`, and counts quotes rather than versions, so it cannot say "quotations sent this week".

### R4. How many might close — fields exist, rules do not

- `probability_band` (low/medium/high) and `expected_close_date` exist but are set only in the Edit dialog, not at create or at stage change. Production: 0 of 3 set.
- The metric definition itself says probability bands are not yet accepted by the business (`20260820000012_phase6_reports.sql:24`).
- No report groups open value by expected close week, and nothing requires a forecast once a quotation is out.

### R5. Products, brand, size, panels — no structured capture

- Leads and opportunities carry `product_interest text[]` with six category keys (`wall_panel, tile, cut_tile, mosaic, finishing, accessory`). That is interest, not what sold, and it is enforced only in zod and one RPC.
- `quote_items.product_variant_id` and `purchase_items.product_variant_id` are bare uuids with no foreign key, and no UI writes them. The walk-in wizard sends `purchase: null`, the workbook import sends `items: []`, and the sale workbench (`src/features/sales/schema.ts`) has no line items.
- Brand and category roll-ups exist in merch (`merch.products.brand_id`, `category_id`), but every imported product is categorised `tile` and all 19 brands are unreviewed (`docs/Backlog.md:21,85`).
- Size exists only as millimetre `dimensions` jsonb on about 960 of 5,087 variants. There is no nominal format ("600×1200") and no slab or large-format concept. "Panel" exists only as the `wall_panel` category.
- `api.report_demand` ignores its `p_from`/`p_to` parameters and double-counts by joining quote and purchase items on the same variant in one query.

### R6. Why we lose — free text only

- Opportunity: `outcome_reason` is one free-text column shared by won, lost and deferred (`20260820000007_functions.sql:251`). `competitor` is free text and is not asked at close. Moving back from Lost does not clear either.
- Lead: the inbox "lost" action writes `disqualified_reason` as free text of at least three characters (`20260921021742_inquiry_operations.sql:173-175`).
- No reason-code list exists in SQL, zod, or the status maps. "Friendly competitor" cannot be told apart from any other competitor.

## 4. Proposed design

### 4.1 One customer segment taxonomy, captured on the lead

Add two CHECK-constrained columns and use them everywhere instead of the four divergent lists:

- `customer_segment`: `end_user | contractor | interior_designer | architect | developer | other`
- `customer_sub_segment`: `residential | commercial | glc | hospitality | fnb | other`, allowed only when the segment is `contractor`, `interior_designer`, `architect` or `developer`

Where they live and who writes them:

| Table | Written by | Rule |
| --- | --- | --- |
| `sales.leads` | new-inquiry dialog, walk-in wizard, inbox drawer, TikTok and tracker importers | optional at intake; **required to mark a lead qualified, quoted or converted**. Inbox gets a "needs segment" badge and view. |
| `identity.contacts` | copied from the lead on link or create; editable on the contact | replaces the UI use of `customer_type`; keep the column, backfill, and map old values |
| `sales.opportunities` | copied from the lead on convert; editable | replaces the ad-hoc `segment` values in reporting; keep `segment` as the market segment of the project if the business still wants it |
| `sales.visits.customer_type` | walk-in wizard | add a CHECK to the same segment list |

The "ID category" is not defined anywhere, and nobody on the engineering side can invent it. Section 6 asks the business to define it. Until then it is a nullable `interior_designer_category` text column with a CHECK that is extended once the list exists.

Backfill: `homeowner → end_user`, `contractor → contractor` (sub-segment null), `designer → interior_designer`, `architect → architect`, `developer → developer`, `retailer → other`. Every lead with a contact inherits the contact's mapped value; this covers 525 of 721 leads on day one.

### 4.2 Lost-reason codes on both the lead and the opportunity

One CHECK list, used by `api.work_inquiry` (action `lost`) and `api.change_opportunity_stage` (any move to a `lost` group):

`pricing | timing | friendly_competitor | competitor | no_response | project_cancelled | spec_changed | other`

- Columns: `lost_reason_code` (required when lost), `lost_reason_detail` (free text, required when `other`), `competitor_name` (required when the code is `competitor` or `friendly_competitor`).
- The stage dialog (`src/features/pipeline/components/stage-dialog.tsx`) and the inquiry workflow lost action (`src/features/inbox/components/inquiry-workflow.tsx`) show a picklist first and the free text second.
- Moving a lead or opportunity back out of lost clears the code.
- Status map entries get labels and hints so the Help page explains "friendly competitor" (a competitor we refer work to and from).

### 4.3 One quotation record

Make `sales.quotes` the only quotation record and let it exist before an opportunity does:

- `opportunity_id` becomes nullable; add `lead_id` and `visit_id` with a CHECK that at least one of the three is set.
- New `api.quote_command(p_action, p_input, p_request_id)` RPC replaces the four-insert server action: `issue` (version 1), `revise`, `accept`, `reject`, `expire`. Atomic, idempotent on `p_request_id`, audited, and it writes the activity row.
- `api.record_showroom_visit` creates a quote (version 1, `issued_at = visit date`) when an SQ number or amount is supplied, so the walk-in wizard and workbook import feed the same table. `visit_quotation_files` gains a `quote_id`.
- New inquiry workflow action `quoted` on `api.work_inquiry`: records the quote and, in the same transaction, creates the opportunity at the `quote_sent` stage and converts the lead. This is the one change that makes the pipeline fill up from the screen the team already uses.
- "Quotations sent this week" = quote versions with `version_no = 1` and `issued_at` in the week; revisions are a separate count.

### 4.4 Forecast rules

- Add `requires_forecast boolean` to `core.opportunity_stages`, true from `quote_sent` onward. `api.change_opportunity_stage` and `api.opportunity_command` refuse to enter such a stage without `probability_band` and `expected_close_date`.
- "Might close" has two agreed definitions in the report, both shown: (a) open opportunities with `probability_band = 'high'` or in `verbal_confirmation`; (b) open opportunities with `expected_close_date` inside the next four weeks. Value is unweighted until the business accepts weights (PRD §3.2 says no targets before a baseline).

### 4.5 Product lines with brand, size and panel roll-up

- Add foreign keys from `quote_items.product_variant_id` and `purchase_items.product_variant_id` to `merch.product_variants`.
- Quote and sale dialogs get a line-item section using the existing catalog finder (`api.catalog_finder`) as the picker. A line without a catalog match records `brand_id`, `category_id` and a free-text `size_label` so the week is never blank.
- Add a derived `format_label` to the finder read model from `dimensions` jsonb (`600×1200`, `1200×2400`) and a `large_format` flag above a threshold the business confirms. "Panels" reports as the `wall_panel` category plus its `series` attribute.
- Fix `api.report_demand`: apply the date range, split the quote and purchase aggregations into two CTEs, and exclude voided purchases.
- Catalog hygiene is a precondition, not part of this plan: recategorise the corpus products away from `tile` and review the 19 brands (already in `docs/Backlog.md`).

### 4.6 The weekly report itself

- One RPC, `api.report_weekly_sales(p_week_start date, p_owner_id uuid default null)`, `security definer`, gated by `report.read`, restricted to the caller's own records unless they hold `sales.read_all`. Returns one jsonb with six sections (R1 to R6) plus the week-over-week deltas, computed set-based in one pass per table.
- Page `/insights/reports/weekly`, registered in `src/features/reports/registry.ts` and made the featured card on `/insights/reports`. Week picker and owner filter via nuqs. No new sidebar item (36px cost); the existing Reports entry stays.
- Metric definitions rows for each section in `reporting.metric_definitions` so the governance header, grain and caveats render from the database like the other ten reports.
- CSV export through the existing `exportReportAction`, which should also emit an audit row (today it only logs to the console).

## 5. Delivery plan

| PR | Scope | Migration | Tests |
| --- | --- | --- | --- |
| 0 | Business decisions in section 6 recorded in the PRD; metric definitions drafted | none | none |
| 1 | Segment taxonomy and lost-reason codes: columns, CHECKs, RPC changes, zod enums, status-map hints, capture in new-inquiry dialog, walk-in wizard, lead drawer, stage dialog, importers; backfill | `…_customer_segments_and_loss_reasons.sql` | pgTAP: lost refuses without a code, qualify refuses without a segment, backfill mapping; vitest on schemas and hint coverage |
| 2 | Quotation unification: `quote_command`, nullable opportunity on quotes, visit quotes, inquiry `quoted` action, forecast flag on stages | `…_quotation_record.sql` | pgTAP: idempotency, visit creates quote, `quoted` creates opportunity at `quote_sent`, forecast required |
| 3 | Product lines: FKs, line-item UI on quote and sale, format label, `report_demand` fix | `…_quote_and_sale_lines.sql` | pgTAP on FK and the demand report date filter |
| 4 | `report_weekly_sales` RPC, page, registry entry, metric definitions, export audit | `…_weekly_sales_report.sql` | pgTAP on scoping (own vs `read_all`) and week bucketing on `received_at`; vitest on the page mapper |

PR1 and PR4 can ship first: PR4 renders R1, R2 and R6 from day one, and shows R3 to R5 as empty with their caveat until PR2 and PR3 land. Each PR regenerates `database.types.ts` and keeps the `api` schema the only surface.

## 6. Decisions the business has to make before PR1

1. **Segment list.** Confirm `end_user | contractor | interior_designer | architect | developer | other` and the sub-segments `residential | commercial | glc | hospitality | fnb`. Does an architect or developer get a sub-segment?
2. **ID category and ID segment.** What is the category of an interior designer (firm size, tier, specialism)? What is their segment (the projects they serve, or something else)? Give the exact values.
3. **Is a walk-in a lead?** Today every showroom visit creates a lead. The report can show online leads and showroom leads separately, but the headline number needs a definition.
4. **What counts as a quotation sent?** Only a quote with an SQ number, or any amount quoted verbally? Does a revision count again?
5. **Lost reasons.** Confirm the eight codes and define "friendly competitor" for the glossary.
6. **"Might close."** Choose the definition from 4.4, or both.
7. **Size buckets.** Which formats matter (600×600, 600×1200, 800×1600, 1200×2400, slabs above a threshold)? Is "panel" the wall-panel category only?
8. **Forecast discipline.** Is the team willing to enter probability and expected close whenever a quotation goes out? If not, R4 stays stage-based.
