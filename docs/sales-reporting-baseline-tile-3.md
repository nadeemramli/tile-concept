# TILE-3 — Sales reporting baseline, metric dictionary and delivery handoff

**Status:** agent analysis for TILE-3, revision 2. **Not** a Direct record, not human acceptance, not owner approval of any business definition.
**Prepared:** 2026-10-04 17:51–18:45 UTC (2026-10-05 01:51–02:45 Asia/Kuala_Lumpur) in a cloud session with read-only hosted access.
**Supersedes:** revision 1 of this file (commit `c3c2288bf84d36f10982ad7af712709bc2041841`, reconciled in `b70cf2a`). Revision 1's counts are kept below only where re-verified.
**Companion:** `docs/standard-sales-reporting-plan.md` (proposal merged in PR #17 at `85a048d`). That plan stays a proposal; §7 records where this dictionary overrides it under the coordinator rules.

> **Access limitation.** The coordinator's "Tile Concept Sales Reporting Agent Briefs" attachment (Direct export for TILE-1…TILE-10, refined acceptance criteria, dependencies, delivery guidance) did **not** reach this session: it was absent from the message, the container filesystem and Google Drive. TILE-3's actual acceptance criteria and the TILE-1/TILE-2 briefs were therefore **not read**. §9 maps evidence to the activities in the coordinator's assignment text instead and must be re-mapped once the export is available. Nothing here was looked up in Linear or GitHub Issues as a substitute.

---

## 1. Baseline fingerprints

Three different kinds of evidence, kept apart.

| Kind | Evidence | Observed |
| --- | --- | --- |
| **Repository** | `origin/main` = `1d6215e8bccdc117282d970a0028fc2552b82a9a` (merge of PR #16, walk-in collection reports). Since the static audit commit `ddd3048`: `85a048d` (PR #17, docs only) and PR #16 (adds `20261004000001_walkin_collection_reports.sql`, report registry grain support, and makes report date filters reach the server). 54 migration files. | 2026-10-04 17:51 UTC |
| **Deployed app** | Vercel project `tile-concept`, production deployment `dpl_Er5SjiqE6uM2KPe4L7kbzyAQjLyQ`, READY, `githubCommitSha = 1d6215e…`. | 2026-10-04 ~17:52 UTC |
| **Hosted migration names** | Supabase `ewyiiematuuojlhpioqh` lists 54 migrations, identical versions/names to the repo, last `20261004000001_walkin_collection_reports`. Name parity alone does not prove function parity. | 2026-10-04 ~17:52 UTC |
| **Hosted function bodies** | `md5(pg_proc.prosrc)` equals the md5 of the body of the **latest** repo definition for all 23 functions compared: `report_pipeline`, `report_lead_source`, `report_quotes`, `report_walkins`, `report_cohorts`, `report_demand`, `report_price_health`, `report_stock_freshness`, `report_data_quality`, `report_content_pipeline`, `report_walkin_collections`, `funnel_dashboard`, `funnel_history`, `sales_scorecard`, `command_centre_summary`, `work_inquiry`, `create_manual_inquiry`, `change_opportunity_stage`, `opportunity_command`, `visit_quotation_command`, `sale_command`, `record_walk_in`, `record_showroom_visit` (all `api.*`, one overload each, all `security definer`, `search_path=""`). Other functions, views (e.g. `api.catalog_finder`, `api.inbox_leads`), policies and grants were **not** compared. | 2026-10-04 ~17:53 UTC |

Code observations below cite the repository at `1d6215e` (identical to this branch's merge `b1b1ce9` for all non-doc files).

## 2. Aggregate completeness (hosted, production workspace only)

Read-only aggregate SQL against workspace slug `tile-concept`; the `demo` workspace is excluded. No rows, names, phones, documents or amounts were exported. Observed 2026-10-04 17:53–17:56 UTC. "R1 counts" from revision 1 (17:3x UTC the same day) were re-run and are unchanged.

### 2.1 Leads, arrival and identity

| Measure | Count | Note |
| --- | ---: | --- |
| Leads | 721 | `walk_in` 536, `tiktok` 185 |
| Status | | contacted 537, new 167, contact_attempted 15, qualified 1, disqualified 1, duplicate **0** |
| With an intake event | 185 | all TikTok; every one has `intake_events.occurred_at` (182 provider `tiktok_export`, 3 `manual`) |
| Walk-in leads with an intake event | 0 | all 536 are linked to a visit instead |
| Leads created in a single minute (≥10) | 145 at 2026-09-01 00:53 UTC | see 2.2 |
| `duplicate_of_lead_id` set | 0 | |
| Shared normalized phone groups | 74 groups / 209 leads | **0** groups span more than one contact — every shared-phone group resolves to one person, i.e. repeat leads of one customer, not proven duplicates of a pursuit |
| Contacts with >1 lead | 69 | |
| `first_response_at` set | 550 | `first_whatsapp_sent_at` 0, `first_customer_reply_at` 0 |
| With account | 0 | |
| `converted_opportunity_id` set | 0 | |
| `product_interest` non-empty | 143 | |

### 2.2 The 145-lead TikTok batch (finding C, investigated)

All 145 leads were **received** (`intake_events.received_at`) in one minute and have `leads.created_at` = 2026-09-01 00:53 UTC. Their source `occurred_at` (TikTok's own timestamp) falls in KL weeks starting 2026-06-08 (1), 06-22 (1), 08-10 (28), 08-17 (38), 08-24 (77); none is later than the import. Cause, from code: `scripts/import/tiktok-leads.mts` (added in `a030d5d`, 2026-09-11) rewrites `leads.created_at` to the source time for **newly** accepted leads (`:142-147`) but leaves existing leads alone (idempotency key `tiktok:lead:<id>`, `:118`). These 145 predate that importer ("the first export import", `:6-7`), so they kept import time. **They did not arrive in week 2026-08-31; they arrived over five earlier weeks.**

Consequence: `leads.created_at` currently mixes three meanings — record time (manual, `create_manual_inquiry`), source arrival time (TikTok re-import), and **synthetic noon-KL visit date** (`scripts/import/daily-tracker.mts:397`). No column says which. Any report bucketing on `created_at` is wrong for some cohort.

### 2.3 Pursuits, quotations, forecast, losses, products, sales

| Measure | Count |
| --- | ---: |
| Opportunities | 3 (all open, none archived) |
| …with lead / contact / account / project | 0 / 0 / 0 / 3 |
| …with `segment` / `probability_band` / `expected_close_date` | 0 / 0 / 0 |
| …with estimated value / next action due | 3 / 3 |
| Lost opportunities / with competitor | 0 / 0 |
| Stage events | 3 |
| Production stages requiring a reason | won, lost, deferred (`requires_reason = true`) |
| Projects | 4 (`new_build` 2, `renovation` 1, `residential` 1) |
| Accounts | 0 |
| Contacts | 407 (homeowner 326, designer 38, contractor 30, architect 4, unset 9) |
| Visits | 537 (`legacy` 534, `direct` 3); `customer_type`: homeowner 426, designer 56, contractor 38, architect 5, unset 12 |
| Visits with `quotation_amount` / `quotation_ref` / both | 58 / 8 / 7 |
| Visit quotation files (uploaded) | 1 |
| Quotes / quote versions / quote items | 0 / 0 / 0 |
| Purchases | 64, all MYR: 63 `legacy_unclassified`, 1 `confirmed`; 63 visit-linked, 1 lead-linked |
| Purchase items | 0 |
| Payments | 63, all `legacy_unclassified` collections |
| Sale events | confirmed 1, draft_updated 2 |
| Catalog variants | 5,087; **0** with non-empty `product_variants.dimensions`; width/length attribute values on 960, thickness on 153 (`merch.product_attribute_values`) |
| Product categories | all 5,087 products `tile` |
| Brands | 19, all `unreviewed` |

**What the data can answer today:** R1 approximately (after the arrival-date correction), R2 buyer role for walk-ins only. R3–R6 have no recorded evidence: storage exists, capture does not.

Correction to `standard-sales-reporting-plan.md` §3 R5: "size exists only as millimetre `dimensions` jsonb on about 960 of 5,087 variants" — on the hosted project `product_variants.dimensions` is empty for all variants; the 960 are width/length **attribute values**, which `api.catalog_finder` merges into its `dimensions` output.
