# TILE-3 — Sales reporting baseline, metric dictionary and delivery handoff

**Status:** agent analysis for TILE-3, revision 2. **Not** a Direct record, not human acceptance, not owner approval of any business definition.
**Prepared:** 2026-10-04 17:51–20:40 UTC (2026-10-05 01:51–04:40 Asia/Kuala_Lumpur); hosted aggregates 17:53–17:56 UTC, role-permission read later the same session in a cloud session with read-only hosted access.
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
| Lead arrival time | `intake_events.occurred_at` (TikTok, manual); `leads.created_at` | TikTok importer `accept_intake` + `created_at` rewrite (`scripts/import/tiktok-leads.mts:113-147`); manual dialog writes `occurred_at = now()` (`…20260921051515_atomic_manual_inquiry.sql:110-111`); walk-in creates lead with `created_at = visit time` (`…20260921032114_walk_in_inquiry_linkage.sql:133-136`); tracker import sets `created_at` = noon KL (`daily-tracker.mts:397`) | `work_inquiry` refuses events earlier than `created_at` (`…20260921021742_inquiry_operations.sql:139`) | No business-arrival field with provenance; manual inquiry cannot state a past arrival; walk-in has no intake event | Add `received_at` + `received_at_basis` (source / staff-stated / visit / record-time fallback); importers and the manual dialog set it; never rewrite `created_at` | TILE-4 (capture), TILE-9 (use) | pgTAP: importer-style insert keeps `created_at`, sets basis; weekly bucket follows `received_at`; batch fixture of 3 leads imported in one minute with 3 source weeks lands in 3 weeks |
| Pursuit identity (new vs repeat) | `sales.leads` per pursuit; `visits.lead_id`; `inquiry_link_state` | `resolve_walk_in_lead`: auto-link to the single safe open match, else direct new lead only when no candidate, else `needs_linking`; `new` mode needs a ≥5-char reason (`…walk_in_inquiry_linkage.sql:114-155`, candidates `:60-107`) | Shared/ambiguous identifiers block automatic linking (`:66-71`, `:95-104`) | 534 legacy visits each created their own lead; nothing marks a lead as a repeat touch of an existing pursuit; `duplicate` status has no write path in any command read | Keep the current resolver; add a reviewed "duplicate / same pursuit" action with reason; legacy visits classified by review, not inferred | TILE-4, TILE-9 | Fixtures: repeat visit of same need links; repeat customer with a new need recorded via `new` + reason counts as a new pursuit; shared phone across two contacts → review, never auto-merge |
| Buyer role (end user / contractor / ID / other) | `identity.contacts.customer_type`, `sales.visits.customer_type` (no CHECK on visits), `accounts.account_type` | Walk-in wizard → `visits.customer_type`, copied to contact only when blank (`…walk_in_inquiry_linkage.sql:213-214`); lead drawer "create contact" defaults to **homeowner** (`src/features/inbox/components/lead-drawer.tsx:476,487`); tracker maps `ID`→`designer` (`daily-tracker.mts:37-44`) | CHECK on contacts/accounts only | No role on the lead/pursuit; new-inquiry dialog collects none; default "homeowner" invents a known value; TikTok leads have no contact | Pursuit-level `buyer_role` with explicit `unknown`, seeded from contact without overwriting a confirmed pursuit value; remove the homeowner default | TILE-4 | Unit: no default role; pgTAP: contact edit does not overwrite confirmed pursuit role; unknown counted, not dropped |
| Project use / work type / GLC | `identity.projects.project_type` (mixes use and work type), `opportunities.segment` | Project registration (`…20260922195741_company_search_project_registration.sql`, tests `supabase/tests/021_…`); walk-in auto-project uses `project_type='other'` (`…walk_in_inquiry_linkage.sql:217`); `segment` only in Edit dialog (`opportunity-dialogs.tsx:61`) | CHECK lists | No GLC field; use and work type share one column | Three independent fields on the pursuit/project: `project_use`, `work_type`, `glc_involvement` (yes/no/unknown + party role) | TILE-4 | pgTAP: a commercial renovation with GLC client stores all three; unknown allowed |
| Quotation prepared | `visits.quotation_ref/amount`; `quotes`/`quote_versions` | Walk-in wizard / tracker patch (`daily-tracker.mts:389-390`); pipeline drawer `addQuoteVersionAction` (`src/server/commands/opportunities.ts:98-136`) — separate inserts, no RPC, no idempotency, `issued_at` defaults to now (`:119`), status set issued/revised (`:128`) | zod only (`src/features/pipeline/schema.ts:39-45`) | Quotes require an opportunity; visit quotes are not quote records; no line items written | One canonical quote command reachable from inbox and walk-in | TILE-5 | pgTAP: visit quotation creates canonical quote in `prepared` state |
| Quotation uploaded | `visit_quotation_files` | `visit_quotation_command` (`…20260922183048_visit_quotation_files.sql`) | upload intent + object check | Not linked to a quote record | Attach files to the canonical quote version | TILE-5 | Upload does not change sent count |
| Quotation **sent** | none | none | — | No send fact anywhere; `quote_sent` stage and `issued_at` are not delivery evidence | Append-only `quote_send_events` (version, channel, recipient role, actor, sent_at, evidence) | TILE-5 | Fixtures in §5 R3 |
| Forecast (close week, likelihood, value, owner, next action) | `opportunities.expected_close_date`, `probability_band`, `estimated_value`, `owner_id`, `next_action*` | Edit dialog only (`opportunity-dialogs.tsx:45-50`); not at create or stage change | CHECK on band | No history of forecast changes; no review timestamp | Forecast review command writing an append-only forecast event; missing forecast becomes an exception queue, not a blocker on recording a sent quote | TILE-7 | pgTAP: as-of query returns the forecast held at that time |
| Loss (lead) | `leads.status='disqualified'`, `disqualified_reason` | `work_inquiry` `lost` (≥3 chars free text), `reopen` nulls the reason (`…inquiry_operations.sql:173-181`); history survives in `sales.activities` metadata (`:213-218`) | free-text length | No reason code; rejection, spam, duplicate and genuine loss share one status | Structured outcome type + primary reason + detail; reopen appends, never erases | TILE-8 | Reopen-then-lose keeps both events in their weeks |
| Loss (opportunity) | `status`, `lost_at`, `outcome_reason`, `competitor` | `change_opportunity_stage` requires reason for won/lost/deferred; overwrites `outcome_reason`; does **not** clear `lost_at` when reopened (`…20260820000007_functions.sql:249-251`); stage events append-only with reason/actor (`:254-255`) | reason non-blank | No reason code; competitor optional free text, Edit dialog only (`opportunity-dialogs.tsx:66`) | As above, reason code at loss time; competitor name may be Unknown; relationship captured as detail | TILE-8 | Weekly loss count reads events, not current status |
| Product interest | `leads/opportunities.product_interest text[]` (6 category keys) | New inquiry, walk-in, TikTok mapping (`tiktok-leads.mts:21-26`) | zod enum | Category only, no brand/variant | Keep as interest population | TILE-6 | Separate column in report |
| Quoted / sold lines | `quote_items`, `purchase_items` (`product_variant_id` has **no FK**) | Quote: never written. Sale: `record_purchase` accepts items (`…20260921041005_…:406-466`); walk-in command maps items (`src/server/commands/walkins.ts:137`) but the wizard sends `purchase: null` (`walk-in-wizard.tsx:194`); sale workbench schema has no items (`src/features/sales/schema.ts`) | — | No UI line capture; no frozen dimensions/units; no reviewed provisional mapping | Line items on canonical quote version and confirmed sale, picker on `api.catalog_finder`, frozen attribute snapshot | TILE-6 | pgTAP: FK, snapshot immutability, unmatched line kept with review state |
| Catalog attributes | `product_attribute_values` (width/length 960, thickness 153), `catalog_finder` view (default variant only, `…20260831183013_catalog_finder_read_model.sql:8-40`) | Corpus import | review_state | All products `tile`; brands unreviewed; no panel type | Use what exists; provisional mapping allowed; corpus cleanup not a prerequisite | TILE-6 | — |
| Confirmed sale / collections | `sale_events`, `purchase_payments.review_state` | `sale_command` (MYR only for new, `…20260921041005_…:154`) | evidence gate, version checks | 63 legacy unclassified | Reuse unchanged | TILE-9 | Existing F3 suites |
| Report surface | `src/features/reports/registry.ts`, `api.report_*`, `funnel_*`, `exportReportAction` | — | `report.read`; named funnel drilldown needs `sales.read_all` | Export audit is console-only (`src/server/commands/reports.ts`, comment above the `report.exported` log) | Weekly RPC + drilldown + audited CSV | TILE-9/10 | Permission parity tests |

---

## 4. Query risks against current source

Basis column: **code** = read in the repository at `1d6215e`; **hosted** = the same body confirmed in production by md5 (§1); **runtime** = observed in hosted aggregates (§2). No synthetic fixture was executed in this session (no local Postgres/Docker), so none is claimed.

| Risk | Verdict | Basis | Evidence |
| --- | --- | --- | --- |
| Product-demand join multiplication | Confirmed defect | code + hosted | `api.report_demand` left-joins `quote_items` and `purchase_items` on the same variant (`…20260820000012_phase6_reports.sql:159-176`): N quote lines × M sale lines multiply both sums. Not observable at runtime (0 lines). |
| Unused product-demand date parameters | Confirmed defect | code + hosted | `p_from/p_to` are declared and never referenced (same lines). PR #16 now passes UI dates to the server (`shallow: false`), so the screen sends a range the function ignores while the header says "Between …". |
| Quote creation date vs sent date | Confirmed defect | code + hosted | `api.report_quotes` filters on `quotes.created_at` (`…20260921045534_opportunity_workflow.sql:184-200`); `issued_at` defaults to entry time (`src/server/commands/opportunities.ts:119`); no send fact exists. |
| Draft and superseded versions | Confirmed | code + hosted | `report_quotes` counts every quote regardless of `status` (drafts included); `report_demand` sums items of every version, superseded included. |
| Duplicate / pursuit population | Confirmed | code + hosted + runtime | `report_lead_source` counts `status='duplicate'`; `funnel_dashboard` excludes it but no command sets it (0 rows). Legacy walk-ins are one lead per visit (534). 74 shared-phone groups all resolve to one contact — repeat touches, not proven duplicate pursuits. |
| Import arrival vs creation date; response latency | Confirmed | code + hosted + runtime | `report_lead_source` and `funnel_dashboard` cohort on `leads.created_at`; §2.2 batch. Latency = `first_response_at − created_at`; for the batch that subtracts import time; for walk-ins `first_response_at` reflects the visit, so walk-in latency is not a response measure. |
| Stage aging on unrelated `updated_at` | Confirmed defect | code + hosted | `report_pipeline` ages by `now() − opportunities.updated_at` (`…opportunity_workflow.sql:168-182`) while `metric_definitions.pipeline_aging` says "days since the last stage change" from stage events. Any edit resets age. |
| Confirmed vs unclassified/voided/collection-only sales | Mixed | code + hosted | Funnel and scorecard use `sale_events` / confirmed payments (correct). `report_walkins`, `report_cohorts`, `report_walkin_collections` document totals use `purchases.amount` incl. `legacy_unclassified`, labelled as such in their scope notes — acceptable for those reports, **not** reusable as R5 "sold". `report_demand` includes draft/voided purchase items. |
| Credit / currency / unit treatment | Confirmed gap | code | `report_demand` sums `line_total` across currencies and quantities across units; credits/voids are `sale_events` deltas that line items do not see. |
| Limited frontend populations | Confirmed | code | Pipeline list `.limit(2000)` (`src/server/queries/opportunities.ts:85`); contacts list `.limit(1000)` (`src/server/queries/contacts.ts:39`). Report RPCs are not capped. A weekly report must not reuse these lists for counts or drilldowns. |
| Aggregate/drilldown permission parity | Confirmed defect (label) | code + hosted roles | Governed report RPCs filter by workspace + `report.read` only, never owner. The page tells users without `sales.read_all` "limited to your scope" (`src/app/(app)/insights/reports/[report]/page.tsx`). Hosted `core.role_permissions`: `report.read` = admin, analyst, guest, management, sales_manager, sales_rep; `sales.read_all` = all of those **except analyst**. So analysts see workspace-wide aggregates under a false "limited" label. Named funnel drilldown requires `sales.read_all` (`funnel_history`), so analysts get aggregate without drilldown — a deliberate split, but undeclared on the governed reports. CSV export requires only `report.read` and is audited to the server console only. |

---

## 5. Metric dictionary (R1–R6)

**Shared contract.**
- *Period:* week = Monday 00:00 to next Monday 00:00 Asia/Kuala_Lumpur (UTC+8, no DST); presets Week to date, Last completed week, custom (max 366 days, as `funnel_dashboard`). Boundaries computed as `(date)::timestamp at time zone 'Asia/Kuala_Lumpur'`.
- *Two dates on every fact:* **effective** (when it happened in the business) and **recorded** (when the system learned it). Buckets use effective date; each tile shows "recorded after period end" separately.
- *As-of:* `p_as_of` (date, KL end-of-day). A fact counts if recorded before as-of. Current-state attributes (role, forecast, stage) are read from retained events/snapshots at as-of **where they exist**; where they do not (§2: roles, forecasts today), the report states "current value, history not retained" (rule H) instead of fabricating.
- *Unknown:* explicit bucket, always displayed; "Not yet captured" when the capture path does not exist; "Incomplete" when it exists but coverage < 100 %. Never a zero for missing evidence.
- *Scope:* workspace + `report.read`. Aggregates are workspace-wide; the UI must say so. Named drilldown requires `sales.read_all` and returns exactly the rows the aggregate counted (same CTE). An owner filter narrows both identically.
- *Correction/reopen:* facts are append-only events; corrections add superseding events; a past week changes only by back-dated facts, which are flagged by recorded date.
- *Money:* MYR only; non-MYR excluded and counted as "excluded: currency". Net of separately stated tax, as accepted for sales (`docs/sales-evidence-handoff.md`). Collections never sum into sales.

| ID | Business question | Grain & counting identity | Population & exclusions | Effective / recorded date | Numerator / denominator | Units | Unknown / incomplete | Drilldown | Lineage today → required | Acceptance fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1.1 New buying pursuits | How many valid new buying pursuits arrived? | One pursuit (lead) | Digital inquiries and direct walk-ins. Exclude reviewed duplicate/spam and test. Repeat messages, visits, payments linked to an existing pursuit do not count. A repeat customer's new need counts. Do not exclude walk-ins; "new lead" ≠ "first-ever customer". | `received_at` (source occurred_at / staff-stated / visit time), with basis; fallback `created_at` flagged "record time" / `created_at` | count | — | Basis breakdown shown; legacy per-visit walk-in leads flagged "pre-linkage, may include repeat touches" | Pursuits counted | `leads.created_at` → `received_at` + basis (TILE-4) | 3 imported in 1 minute with 3 source weeks → 3 weeks; walk-in auto-linked to open pursuit → 0 new; `new` mode with reason → 1 new; shared-phone two contacts → review, counted once each |
| R1.2 Rejected at qualification | How many were rejected, and why? | Pursuit outcome event | Outcome type ∈ rejection / duplicate / spam (not "lost deal") | outcome effective date / recorded | count | — | Reason "unclassified" for legacy free text | Pursuits | `work_inquiry lost` free text → outcome type + code (TILE-8) | Reopen then reject → two events, latest state rejected |
| R1.3 Response latency | How fast did we respond? | Pursuit with digital source | Walk-ins excluded (present-in-person); imported without source time excluded and counted | first staff response − `received_at` | median minutes | minutes | "No source time" bucket | Pursuits | `first_response_at − created_at` → `− received_at` (TILE-9) | Import-batch fixture yields source-based latency |
| R2.1 Buyer role mix | End user / contractor / ID / other / unknown | Pursuit from R1.1 | Same as R1.1 | as R1.1 | count per role, share of R1.1 | — | Unknown explicit; Architect is its own value, grouped into Other in the headline | Pursuits by role | contact/visit `customer_type` → pursuit `buyer_role` (TILE-4) | Contact role change after confirmation does not alter pursuit role |
| R2.2 Project dimensions | For contractors/IDs: use, work type, GLC | Pursuit × project | R2.1 contractor + ID (+ other trade optional) | as R1.1 | count per value of each dimension independently | — | Unknown per dimension; "No project" | Pursuits | `project_type` (mixed) → `project_use`, `work_type`, `glc_involvement` (TILE-4) | Commercial renovation with GLC party appears in commercial, renovation and GLC=yes |
| R3.1 Quotations sent | How many quotations were actually sent? | Canonical quotation, at its **first** send event (any version) | Excludes prepared/uploaded/amount/SQ-only/`quote_sent` stage without a send event | first `quote_send_events.sent_at` / recorded_at | count | — | "Prepared, not sent" shown separately; "Not yet captured" until TILE-5 | Quotations | none → send events (TILE-5) | v1 prepared, v2 first sent → 1 sent (week of v2 send); resend of same version → 0; retry same request id → 0 |
| R3.2 Revisions sent | Further distinct versions sent | Quote version at its first send | Version that is not the quotation's first-sent version | send date | count | — | — | Versions | as R3.1 | v3 sent after v2 → 1 revision |
| R3.3 Prepared / uploaded | Work in progress | Quote version / file | — | prepared_at / uploaded_at | count | — | — | Versions | visits.quotation_* + files → canonical quote (TILE-5) | Upload alone never increments R3.1 |
| R4.1 Might close this week | Which open opportunities might close in the selected week? | Open, non-archived opportunity | `expected_close_date` within the selected week (not a four-week window) | forecast as held at as-of (needs forecast events) | count + list; value unweighted | MYR | "No close date", "Stale forecast (not reviewed since …)" exception queues | Opportunities with owner, likelihood (labelled staff-assessed), value, next action | edit-only fields → forecast review events (TILE-7) | Reschedule out of week after as-of does not change past week |
| R4.2 Actual wins | Won in week | Won event | — | won effective date | count, value | MYR | — | Opportunities | stage events | Never added to R4.1 |
| R5.1 Interest | What were people interested in? | Pursuit × interest category | R1.1 population | as R1.1 | count | — | "No interest recorded" | Pursuits | `product_interest` | — |
| R5.2 Quoted lines | What was quoted? | Line of a **sent** version (first-sent version for counts; latest sent at as-of for value — see U7) | Unsent/superseded excluded | send date | qty per unit, value | stated unit; MYR | Unmatched lines under "Unmapped" with review state | Lines | none → quote lines + snapshot (TILE-5/6) | One quote line × two sale lines does not multiply |
| R5.3 Sold lines | What was actually sold? | Line on a confirmed sale | Draft, voided, legacy-unclassified excluded; credits as negative events | sale event date | qty per unit, net value | stated unit; MYR | Sales without lines shown as "Sale without lines" value | Lines | `purchase_items` (unused) → lines (TILE-6) | Credit of half a line reduces value in credit week |
| R6.1 Losses | Why were pursuits lost? | Loss event (lead or opportunity) | Genuine lost deals only; qualification rejection, duplicate/spam and deferred are separate | loss effective date / recorded | count per primary reason | — | "Reason not structured (legacy)" | Pursuits | free text → reason code + detail + competitor (TILE-8) | Reopen + lose again → both losses kept in their weeks; competitor Unknown allowed |
| R6.2 Competitor relationship | Loss to a competitor, with relationship | Loss event with competitor | — | as R6.1 | count by relationship (neutral, provisional) | — | Unknown name allowed | Pursuits | none → (TILE-8) | — |

---

## 6. TILE-1 and TILE-2 overlap

The TILE-1/TILE-2 briefs were not available (see the access limitation above). Findings use only the one-line scope given in the assignment and current code/deployment. Backlog status in Direct proves neither delivery nor absence.

**TILE-1 — shared project registration QC and delivery.**
- *Delivered in code:* commit `922ad8f` (merged in PR #14, in `ddd3048` and every later main) adds company and PIC search, project registration details, `identity.guard_company_relationship`, `identity.guard_project_registration`, `api.showroom_customer_search`, and redefines `api.opportunity_command` (`supabase/migrations/20260922195741_company_search_project_registration.sql`). pgTAP suite `supabase/tests/021_company_search_project_registration.sql` exists.
- *Deployed:* migration present on hosted; `opportunity_command` hosted body matches (§1); production app includes it.
- *Not evidenced here:* that suite's execution result in this session (no local database); any browser/E2E journey (`tests/e2e` holds only `smoke`, `guest`, `route-smoke`); human QC acceptance. Hosted usage is minimal (0 accounts, 4 projects).
- *Reuse for reporting:* R2.2 should read project use / work type / GLC from the registered project and company, not create a parallel entity. TILE-4 extends this registration with the three independent dimensions; it should not reopen TILE-1's search/registration scope.

**TILE-2 — reconcile the older engineering backlog with later releases.**
- `docs/Backlog.md` is mostly catalog/corpus work. Two of its items are confirmed still open at runtime and matter to R5: every product is categorised `tile`, and all 19 brands are unreviewed (§2.3). Under rule F neither is a prerequisite for TILE-6; R5 reports them as provisional/unmapped.
- `docs/reporting-release-qc.md` "Remaining development" lists items re-checked here: the 2,000-opportunity ceiling is **still present** (`src/server/queries/opportunities.ts:85`); export audit is **still console-only**; the hosted migration-readiness check was not evaluated. PR #16's handoff confirms the governed-report date filters previously did not reach the server and now do.
- Recommendation: TILE-2 should mark these as current-state evidence rather than re-scope them into reporting issues. TILE-10 owns export auditing for the new report; the 2,000 ceiling matters only if a sales screen is reused for counts (it must not be).

---

## 7. Reconciliation with `docs/standard-sales-reporting-plan.md`

The plan remains a proposal. Where it conflicts with the coordinator rules, this dictionary follows the rule, and the downstream issue should too.

| Plan item | Rule | Resolution in this dictionary |
| --- | --- | --- |
| §4.1 `customer_sub_segment` = residential / commercial / **glc** / hospitality / fnb | A | Buyer role, project use, work type and GLC involvement are four independent fields; GLC is a party attribute, never a use sub-segment. |
| §4.1 segment "required to mark a lead qualified, quoted or converted" | A | Unknown stays allowed; missing role is a completeness exception, not a gate. |
| §4.1 contact ↔ lead copying | A | Contact supplies a default; a confirmed pursuit value is never overwritten without review. |
| §3 R1 "imports stamp `created_at` with the import time"; add `received_at` | C | Agreed, with a basis/provenance column, and stop rewriting `created_at` (importers currently do). |
| §3 R1 "is a walk-in a lead?" | B | Walk-ins are not excluded; count genuine new pursuits; the current resolver already separates repeat touches from new needs. |
| §4.2 "friendly competitor (a competitor we refer work to and from)" | G | Not adopted. Neutral "competitor relationship" with captured detail; both prior interpretations stay provisional. |
| §4.3 visit creates a quote with `issued_at = visit date`; "sent" = `version_no = 1` and `issued_at` in week | D | Visit creates a *prepared* canonical quote. Sent = first send event of the quotation, any version; later sent versions are revisions; resends/retries count once. |
| §4.3 inquiry `quoted` action creates opportunity at `quote_sent` | D | Reuse one quoting command from inbox and walk-in; a stage alone is not send evidence. Opportunity creation can follow, but must not require staff to re-enter identity. |
| §4.4 "might close" = high band or verbal confirmation, or next four weeks | E | Selected-week `expected_close_date`; likelihood labelled staff-assessed; no weights; four-week view may exist only as a separate labelled view. |
| §4.4 `requires_forecast` blocks entering `quote_sent` | E | Do not block recording a sent quotation; missing forecast becomes an exception queue. |
| §4.5 `format_label`, `large_format` threshold | F | No invented thresholds; dimensions with units, frozen per line; panels may need type/series/dimensions. |
| §4.5 catalog hygiene a precondition | F | Not a release prerequisite; reviewed provisional mappings allowed. |
| §2 / §3 R5 "about 960 of 5,087 variants" carry `dimensions` jsonb | — | Hosted: 0 variants carry `dimensions`; 960 carry width/length attribute values (§2.3). |
| §6 eight-question gate before PR1 | — | Replaced by §10: only consequential definitions block, and only the work they affect. |

---

## 8. Delivery handoff for TILE-4 … TILE-10

Shared contracts first; each issue keeps its own acceptance and dependencies as exported in Direct.

**Shared contracts (define once, in the first batch that needs them).**
1. *Effective vs recorded dates* on every reportable fact; KL week helper in SQL (`reporting.kl_week(timestamptz)`) used by all weekly RPCs.
2. *Pursuit outcome event* (append-only): pursuit id, outcome type (`rejected | duplicate | spam | lost | deferred | won | reopened`), primary reason code, detail, competitor name (nullable/Unknown), relationship detail, effective date, actor. Used by TILE-8 and read by TILE-9.
3. *Command pattern:* `api.<x>_command(p_action, p_input, p_request_id)` — idempotent, audited, append-only history (as `sale_command`, `opportunity_command`).
4. *Completeness states:* `captured | unknown | not_captured | incomplete` returned by the report RPC per section, so the UI never renders a false zero.

| Batch | Issues | Scope boundary | Depends on | Integration notes |
| --- | --- | --- | --- | --- |
| A | **TILE-4** classification (+ arrival provenance) | `received_at` + basis; pursuit `buyer_role`, `project_use`, `work_type`, `glc_involvement` with Unknown; remove homeowner default; importer changes | — | Extends TILE-1 registration; no reporting UI. Unblocks R1/R2. |
| A′ | **TILE-8** loss reasons and pursuit outcomes | Outcome event + reason codes from inbox `lost`/`reopen` and stage changes; legacy free text kept as "unstructured" | Shared contract 2; can run in parallel with TILE-4 | Must preserve `work_inquiry` and `change_opportunity_stage` invariants. |
| B | **TILE-5** canonical quotation and sending | One quote command from inbox, walk-in and pipeline; prepared/uploaded/sent/revised/resent facts; visit quote fields migrate to prepared quotes | TILE-4 pursuit identity (link to lead/visit without an opportunity) | Replaces `addQuoteVersionAction` inserts. |
| B′ | **TILE-6** structured quoted/sold lines | Lines on canonical quote versions and confirmed sales; FK to variants; frozen attribute snapshot; reviewed provisional mapping; `catalog_finder` picker | TILE-5 for quoted lines; sold lines can start independently | Fix `report_demand` or retire it in favour of TILE-9. |
| C | **TILE-7** forecast review | Forecast review command + events; exception queue for missing/stale | Opportunities exist (they do); independent of TILE-5 except "never block a sent quote" | — |
| D | **TILE-9** scoped report calculations | `api.report_weekly_sales` (or per-section RPCs) per §5; owner filter; drilldown = same population; completeness states | Contracts from A/A′/B/B′/C; may ship R1/R2 first behind TILE-4 | A partial preview is not R1–R6 completion. |
| E | **TILE-10** default dashboard, drilldowns, completeness queues, audited CSV | Default report page; keep the marketing/showroom report; fix the "limited to your scope" label; export audit to `audit.emit` | TILE-9 | No new sidebar item needed (Reports exists). |

---

## 9. Evidence map

TILE-3's exported acceptance criteria were not available; rows follow the coordinator's assignment activities and must be re-mapped in Direct.

| Activity | Evidence | Status |
| --- | --- | --- |
| 1 Baseline | §1 (repository, deployed, migration names, 23 function bodies; observation time) | Independently verified this session |
| 2 Capture paths | §3 matrix with file:line citations | Verified from code at `1d6215e` |
| 3 Aggregate completeness | §2 (production workspace, demo excluded, counts only) | Verified this session (hosted) |
| 4 TILE-1/TILE-2 | §6 | Partial — briefs unavailable |
| 5 Metric dictionary | §5 + shared contract | Proposed; rules A–H applied |
| 6 Query risks | §4 with basis column | Confirmed by code + hosted body; no synthetic fixture run |
| 7 Delivery plan | §8 | Proposed |
| Record in Direct | — | Not possible from cloud; coordinator to submit |

Retained from earlier agent reports and **re-verified** here: lead/visit/quote/purchase counts (unchanged), the 145-lead batch. Taken from the merged plan and **not** independently re-verified: the plan's statement about the demo workspace stage flags (`20260823000002_demo_dataset.sql:74`).

---

## 10. Remaining uncertainties

**Consequential business definitions** (block only the work named).

| # | Question | Evidence | Impact | Options | Recommendation |
| --- | --- | --- | --- | --- | --- |
| U1 | What makes a pursuit "valid" (spam, test, wrong-number, out-of-area)? | Only free-text loss reasons exist; 1 disqualified lead | R1.1 numerator | (a) exclude only reviewed spam/test/duplicate; (b) also exclude out-of-area | (a); report others as rejections (R1.2). Blocks TILE-8 code list only. |
| U2 | How are the 534 legacy per-visit walk-in leads treated? | §2.1 | R1 history before 2026-09-21 | (a) report as-is with a "pre-linkage" flag; (b) reviewed back-classification | (a) now; (b) optional later. Does not block TILE-4. |
| U3 | "Friendly competitor" meaning | Two conflicting plan readings, neither owner-confirmed | R6.2 labels | neutral relationship + detail; or one of the two readings | Neutral until the owner decides. Blocks only the glossary text in TILE-8. |
| U4 | GLC involvement — which party roles (owner, developer, main contractor, consultant)? | No field anywhere | R2.2 | yes/no/unknown only; or yes + party role | yes/no/unknown + optional party role. Blocks TILE-4's GLC enum only. |
| U5 | ID categories | Undefined | R2 drill | configurable list, empty at launch | Configurable; does not block. |
| U6 | What counts as send evidence (staff-marked WhatsApp send, email, printed handover)? | No send fact exists | R3 | staff-attested send event with channel; or require attachment/message proof | Staff-attested event with channel and optional proof. Blocks TILE-5's send command. |
| U7 | Quoted value for R5: first-sent or latest-sent version at as-of? | — | R5.2 value | first-sent / latest-sent | Count lines on first send; value at latest sent at as-of, labelled. Blocks TILE-9 R5 only. |

**Routine engineering choices** (decide in the issue, no owner gate): column names; whether R1–R6 is one RPC or six; KL week helper location; event table shapes; CSV layout; whether `report_demand` is fixed or retired; pagination replacement for the 2,000 ceiling.

**Access limits:** Direct export attachment not received; TILE-3 acceptance criteria and TILE-1/2 briefs unread; Obsidian sources unreachable; pgTAP and E2E not run in this session (no Docker); hosted views/policies other than the 23 functions not compared.
