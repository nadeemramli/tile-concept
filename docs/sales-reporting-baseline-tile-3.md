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

---

## 3. Capture-field and entrypoint matrix

"Storage" means a column/table exists. "Capture" means a screen or command staff actually use writes it. Existence of storage is not evidence of coverage (§2). Downstream issue names follow the coordinator's mapping (TILE-4 classification … TILE-10 dashboard); their exported acceptance criteria were not available.

| Business concept | Current field / table | Current write path (cited) | Existing validation | Missing capture or linkage | Proposed responsible workflow | Issue | Testable evidence needed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lead arrival time | `intake_events.occurred_at` (TikTok, manual); `leads.created_at` | TikTok importer `accept_intake` + `created_at` rewrite (`scripts/import/tiktok-leads.mts:113-147`); manual dialog writes `occurred_at = now()` (`…20260921051515_atomic_manual_inquiry.sql:110-111`); walk-in creates lead with `created_at = visit time` (`…20260921032114_walk_in_inquiry_linkage.sql:133-136`); tracker import sets `created_at` = noon KL (`daily-tracker.mts:397`) | `work_inquiry` refuses events earlier than `created_at` (`…20260921021742_inquiry_operations.sql:140`) | No business-arrival field with provenance; manual inquiry cannot state a past arrival; walk-in has no intake event | Add `received_at` + `received_at_basis` (source / staff-stated / visit / record-time fallback); importers and the manual dialog set it; never rewrite `created_at` | TILE-4 (capture), TILE-9 (use) | pgTAP: importer-style insert keeps `created_at`, sets basis; weekly bucket follows `received_at`; batch fixture of 3 leads imported in one minute with 3 source weeks lands in 3 weeks |
| Pursuit identity (new vs repeat) | `sales.leads` per pursuit; `visits.lead_id`; `inquiry_link_state` | `resolve_walk_in_lead`: auto-link to the single safe open match, else direct new lead only when no candidate, else `needs_linking`; `new` mode needs a ≥5-char reason (`…walk_in_inquiry_linkage.sql:115-155`, candidates `:60-107`) | Shared/ambiguous identifiers block automatic linking (`:66-71`, `:99-104`) | 534 legacy visits each created their own lead; nothing marks a lead as a repeat touch of an existing pursuit; `duplicate` status has no write path in any command read | Keep the current resolver; add a reviewed "duplicate / same pursuit" action with reason; legacy visits classified by review, not inferred | TILE-4, TILE-9 | Fixtures: repeat visit of same need links; repeat customer with a new need recorded via `new` + reason counts as a new pursuit; shared phone across two contacts → review, never auto-merge |
| Buyer role (end user / contractor / ID / other) | `identity.contacts.customer_type`, `sales.visits.customer_type` (no CHECK on visits), `accounts.account_type` | Walk-in wizard → `visits.customer_type`, copied to contact only when blank (`…walk_in_inquiry_linkage.sql:206-208`); lead drawer "create contact" defaults to **homeowner** (`src/features/inbox/components/lead-drawer.tsx:476,487`); tracker maps `ID`→`designer` (`daily-tracker.mts:37-44`) | CHECK on contacts/accounts only | No role on the lead/pursuit; new-inquiry dialog collects none; default "homeowner" invents a known value; TikTok leads have no contact | Pursuit-level `buyer_role` with explicit `unknown`, seeded from contact without overwriting a confirmed pursuit value; remove the homeowner default | TILE-4 | Unit: no default role; pgTAP: contact edit does not overwrite confirmed pursuit role; unknown counted, not dropped |
| Project use / work type / GLC | `identity.projects.project_type` (mixes use and work type), `opportunities.segment` | Project registration (`…20260922195741_company_search_project_registration.sql`, tests `supabase/tests/021_…`); walk-in auto-project uses `project_type='other'` (`…walk_in_inquiry_linkage.sql:211`); `segment` only in Edit dialog (`opportunity-dialogs.tsx:61`) | CHECK lists | No GLC field; use and work type share one column | Three independent fields on the pursuit/project: `project_use`, `work_type`, `glc_involvement` (yes/no/unknown + party role) | TILE-4 | pgTAP: a commercial renovation with GLC client stores all three; unknown allowed |
| Quotation prepared | `visits.quotation_ref/amount`; `quotes`/`quote_versions` | Walk-in wizard / tracker patch (`daily-tracker.mts:389-390`); pipeline drawer `addQuoteVersionAction` (`src/server/commands/opportunities.ts:98-136`) — separate inserts, no RPC, no idempotency, `issued_at` defaults to now (`:119`), status set issued/revised (`:128`) | zod only (`src/features/pipeline/schema.ts:39-45`) | Quotes require an opportunity; visit quotes are not quote records; no line items written | One canonical quote command reachable from inbox and walk-in | TILE-5 | pgTAP: visit quotation creates canonical quote in `prepared` state |
| Quotation uploaded | `visit_quotation_files` | `visit_quotation_command` (`…20260922183048_visit_quotation_files.sql`) | upload intent + object check | Not linked to a quote record | Attach files to the canonical quote version | TILE-5 | Upload does not change sent count |
| Quotation **sent** | none | none | — | No send fact anywhere; `quote_sent` stage and `issued_at` are not delivery evidence | Append-only `quote_send_events` (version, channel, recipient role, actor, sent_at, evidence) | TILE-5 | Fixtures in §5 R3 |
| Forecast (close week, likelihood, value, owner, next action) | `opportunities.expected_close_date`, `probability_band`, `estimated_value`, `owner_id`, `next_action*` | Edit dialog only (`opportunity-dialogs.tsx:45-50`); not at create or stage change | CHECK on band | No history of forecast changes; no review timestamp | Forecast review command writing an append-only forecast event; missing forecast becomes an exception queue, not a blocker on recording a sent quote | TILE-7 | pgTAP: as-of query returns the forecast held at that time |
| Loss (lead) | `leads.status='disqualified'`, `disqualified_reason` | `work_inquiry` `lost` (≥3 chars free text), `reopen` nulls the reason (`…inquiry_operations.sql:146-147,170-177`); history survives in `sales.activities` metadata (`:213-218`) | free-text length | No reason code; rejection, spam, duplicate and genuine loss share one status | Structured outcome type + primary reason + detail; reopen appends, never erases | TILE-8 | Reopen-then-lose keeps both events in their weeks |
| Loss (opportunity) | `status`, `lost_at`, `outcome_reason`, `competitor` | `change_opportunity_stage` requires reason for won/lost/deferred; overwrites `outcome_reason`; does **not** clear `lost_at` when reopened (`…20260820000007_functions.sql:233-250`); stage events append-only with reason/actor (`:252-253`) | reason non-blank | No reason code; competitor optional free text, Edit dialog only (`opportunity-dialogs.tsx:66`) | As above, reason code at loss time; competitor name may be Unknown; relationship captured as detail | TILE-8 | Weekly loss count reads events, not current status |
| Product interest | `leads/opportunities.product_interest text[]` (6 category keys) | New inquiry, walk-in, TikTok mapping (`tiktok-leads.mts:21-26`) | zod enum | Category only, no brand/variant | Keep as interest population | TILE-6 | Separate column in report |
| Quoted / sold lines | `quote_items`, `purchase_items` (`product_variant_id` has **no FK**) | Quote: never written. Sale: `record_purchase` accepts items (`…20260921041005_…:406-466`); walk-in command maps items (`src/server/commands/walkins.ts:137`) but the wizard sends `purchase: null` (`walk-in-wizard.tsx:194`); sale workbench schema has no items (`src/features/sales/schema.ts`) | — | No UI line capture; no frozen dimensions/units; no reviewed provisional mapping | Line items on canonical quote version and confirmed sale, picker on `api.catalog_finder`, frozen attribute snapshot | TILE-6 | pgTAP: FK, snapshot immutability, unmatched line kept with review state |
| Catalog attributes | `product_attribute_values` (width/length 960, thickness 153), `catalog_finder` view (default variant only, `…20260831183013_catalog_finder_read_model.sql:8-40`) | Corpus import | review_state | All products `tile`; brands unreviewed; no panel type | Use what exists; provisional mapping allowed; corpus cleanup not a prerequisite | TILE-6 | — |
| Confirmed sale / collections | `sale_events`, `purchase_payments.review_state` | `sale_command` (MYR only for new, `…20260921041005_…:154`) | evidence gate, version checks | 63 legacy unclassified | Reuse unchanged | TILE-9 | Existing F3 suites |
| Report surface | `src/features/reports/registry.ts`, `api.report_*`, `funnel_*`, `exportReportAction` | — | `report.read`; named funnel drilldown needs `sales.read_all` | Export audit is console-only (`src/server/commands/reports.ts`, comment above the `report.exported` log) | Weekly RPC + drilldown + audited CSV | TILE-9/10 | Permission parity tests |
