# TILE-3 — Sales reporting baseline, metric dictionary and delivery handoff

**Status:** agent analysis for TILE-3, revision 3. **Not** a Direct record, not an Agent Pass recorded in Direct, not human acceptance, and not owner approval of any business definition. Every definition below is a **proposal** unless it is quoted from a Direct criterion.
**Prepared:** revision 2 on 2026-10-04 17:51–21:12 UTC; revision 3 on 2026-10-05 16:49–17:05 UTC (2026-10-06 00:49–01:05 Asia/Kuala_Lumpur), in a cloud session with read-only hosted access.
**History:** revision 1 `c3c2288bf84d36f10982ad7af712709bc2041841`; revision 2 last at `32f7288cecb57692e5aaa2dc8a1f616cdec13509`. All are on branch `claude/sharp-pasteur-18umtc` ([PR #18](https://github.com/nadeemramli/tile-concept/pull/18)).
**Planning companion:** `docs/standard-sales-reporting-plan.md`, merged in PR #17 at `85a048d78e152a755458ea04b90a59bf0258a8d0`. This is merged **planning evidence**. It is not implemented behaviour, not an approved taxonomy, and its merge is not acceptance (§7).

### Sources and access (corrected in revision 3)

| Source | State in this session |
| --- | --- |
| **Direct** (live service) | **Not accessible.** It runs on the owner's Windows machine. No claim was taken, no Direct record was read live, and nothing was written to Direct. |
| Direct snapshot of 5 October 2026 (pasted by the coordinator) | **Read.** It contains the TILE-1 and TILE-2 briefs with their verbatim acceptance, TILE-3 scope and AC1–AC7 verbatim, readiness (TILE-1 to TILE-10 are Ready; TILE-1 v3, TILE-2 v3, TILE-3 v5) and the dependency edges in §8. Ready means the owner authorised readiness. It is not evidence of implementation, completed dependencies, Agent Pass or acceptance. |
| TILE-4 to TILE-10 acceptance criteria | **Not supplied.** Only their scope labels and dependency edges are available, so §8's per-issue evidence plans are proposals. |
| Local Obsidian notes ("Standard Sales Reporting Gap Assessment and Delivery Plan", "…Source Evidence") | **Not read.** They were not supplied and are not reachable from cloud. |
| Repository, GitHub PRs and CI, Vercel deployments and env-var metadata (no values), hosted Supabase read-only SQL and advisors | Read. Observation times are given per finding. |

No issue system other than the Direct snapshot (for example Linear or GitHub Issues) was used as a substitute for Direct.

---

## 0. TILE-3 acceptance criteria — evidence matrix

Verdicts are the agent's evidence assessment only. **Met** means the evidence the criterion asks for is recorded here. It does not mean owner approval of the proposed definitions, and it does not mean human acceptance.

| AC (verbatim, abridged) | Section | Exact source / dated observation | Finding | Limitation | Remaining work | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **AC1** Record current repository and deployed build/migration evidence, or an exact access blocker, without changing hosted records. | §1 | Latest (2026-10-06 06:49 UTC): `origin/main` `34d8bb1cc43f1070c4d813298a7191438ef60c61` (PR #19); Vercel production `dpl_YV5gdn7ZozYgxY712s5CdxkDqmAk` on `34d8bb1`; hosted migrations 55, last `20261004000002`; redefined `api.funnel_dashboard` md5-equal to its new repo body. Earlier: `1d6215e`, 54 migrations, 23 function bodies md5-equal (2026-10-04 17:53 UTC). | Repository, deployment and migration names match. The function bodies compared match. Only read-only SQL was used. | Views, policies, grants and other functions were not body-compared. Name parity is not object parity. | Optional: compare `api.*` views/policies if a downstream issue depends on them. | **Met** |
| **AC2** Record aggregate coverage for pursuit links, buyer/project classification, canonical quotes/sent evidence, quote/sale variant lines, forecast dates/bands/review freshness and loss reasons; unknown coverage stays unknown. | §2 | Production-workspace aggregates, 2026-10-04 17:53–17:56 UTC. Core counts re-run 2026-10-05 16:51 UTC. | Every listed dimension is counted. Fields with no capture are recorded as **not captured**, not zero: sent evidence, forecast review freshness, structured loss reason. | Counts are as of the observation times. Hosted data stops at the last recorded lead (2026-09-28). | Re-run at implementation time. | **Met** |
| **AC3** Publish definitions for local Monday–Sunday weeks, valid lead/pursuit grain, duplicates, first quotes/revisions, activity versus cohorts, forecast as-of, product net sales and outcome effective dates. | §5.1, §5.2 | This document. | All eight definition areas are published as proposals. | **Product net sales at line level** needs an allocation rule for document-level discounts, credits and tax. None exists in code, so it is published as an open choice (U8), not decided. None of the definitions is owner-approved. | Owner review of U1, U6 and U8. Engineering choice of the allocation implementation once U8 is decided. | **Partially met** |
| **AC4** Confirm or explicitly record provisional ID, competitor relationship and GLC buyer/end-client wording; actual weekly leads remain separate from any future volume estimate. | §5.3 | Coordinator rules (2026-10-04) and Direct TILE-3 scope (2026-10-05). | ID = interior designer (provisional). Competitor relationship is neutral and provisional, and both prior readings are recorded. GLC can be buyer **or** end client/project owner, captured as an independent party-role dimension (provisional). Actual leads are never mixed with estimates. | No owner confirmation available. | Owner decision on U3 and U4. | **Met** (recorded as provisional) |
| **AC5** Read TILE-1/TILE-2 and record overlap and supported current-source paths; produce a criterion-to-evidence plan for the downstream issues. | §6, §8.3 | TILE-1/TILE-2 briefs (snapshot 2026-10-05); PR #15 at `8ded2a7`; `docs/Backlog.md`; hosted and Vercel checks 2026-10-05. | TILE-1 compared against PR #15 (unmerged draft, not deployed). TILE-2 reconciled item by item (43 items). Downstream evidence plan in §8.3. | TILE-4 to TILE-10 acceptance text was not supplied, so the plans follow scope labels and this dictionary's fixtures. Some TILE-2 items need dashboard access this session lacks: auth SMTP, branch protection, compute/backups. | Re-map §8.3 when TILE-4 to TILE-10 criteria are read. Owner/dashboard checks for the unverified TILE-2 items. | **Partially met** |
| **AC6** Compare every proposed design rule in merged PR17 against Direct; retain independent buyer role/project use/GLC/work type, explicit sent events, effective outcome history and selected-week forecast. Provide a six-section contract and field/entrypoint matrix with provenance and explicit unresolved definitions. | §7, §5, §3, §10 | `docs/standard-sales-reporting-plan.md` @ `85a048d`; code @ `1d6215e`. | 31 plan rules compared. The four retained principles are applied. R1–R6 contract (§5) and field/entrypoint matrices (§3.1, §3.2) carry file:line provenance. Unresolved definitions listed (§10). | The contract is proposed, not approved. | Owner review. | **Met** |
| **AC7** Reconcile hosted counts/source dates and importer business date versus creation date; do not describe merge of a proposal as acceptance or implementation. | §2.2, §2.4, §7 | Hosted 2026-10-04/05. `scripts/import/tiktok-leads.mts`, `daily-tracker.mts` @ `1d6215e`. | The 145-lead batch is reconciled to its source weeks. Importer behaviour that rewrites `created_at` is documented. Merged-plan count claims are reconciled, including one correction. PR17 is described only as merged planning evidence. | Source files (TikTok export, Daily Tracker workbook) were not read, so source dates come from `intake_events.occurred_at` as stored. | — | **Met** |

**TILE-3 overall (agent view):** analysis complete except AC3's open product net-sales allocation rule and AC5's dependence on unseen TILE-4 to TILE-10 criteria. Both are recorded, not hidden. Submitting this to Direct, Agent Pass and human acceptance are separate steps that have not happened.

---

## 1. Baseline fingerprints

| Kind | Evidence | Observed |
| --- | --- | --- |
| **Repository (latest)** | `origin/main` = `34d8bb1cc43f1070c4d813298a7191438ef60c61` (merge of PR #19, marketing-spend batch import). It adds `20261004000002_marketing_spend_batch_import.sql`, which redefines `api.funnel_dashboard`. The change is limited to spend tax handling: a `spend_tax_unreported` count, and MER withheld while tax is unreported. The lead cohort, date basis, duplicate exclusion and `report.read` gate are unchanged, so §4–§5 are unaffected. Merged into this branch. | 2026-10-06 06:49 UTC |
| **Repository (revision 3 basis)** | `origin/main` = `1d6215e8bccdc117282d970a0028fc2552b82a9a` (merge of PR #16). Since the static-audit commit `ddd3048`, main gained `85a048d` (PR #17, docs only) and PR #16. PR #16 adds `20261004000001_walkin_collection_reports.sql` and registry grain support, and makes report date filters reach the server. 54 migration files. Unchanged on re-fetch. | 2026-10-04 17:51 UTC; re-fetched 2026-10-05 ~16:50 UTC |
| **Deployed app** | Latest: production `dpl_YV5gdn7ZozYgxY712s5CdxkDqmAk`, READY, `githubCommitSha = 34d8bb1…`. Earlier: `dpl_Er5SjiqE6uM2KPe4L7kbzyAQjLyQ` on `1d6215e…`. | Latest 2026-10-06 ~06:50 UTC; earlier 2026-10-04/05 |
| **Hosted migration names** | `ewyiiematuuojlhpioqh`: latest 55 migrations, last `20261004000002` (applied). Earlier: 54, identical versions and names, last `20261004000001`. | Latest 2026-10-06 06:48 UTC; earlier 2026-10-04/05 |
| **Hosted function bodies** | `md5(pg_proc.prosrc)` equals the md5 of the latest repo definition body for 23 functions: `report_pipeline`, `report_lead_source`, `report_quotes`, `report_walkins`, `report_cohorts`, `report_demand`, `report_price_health`, `report_stock_freshness`, `report_data_quality`, `report_content_pipeline`, `report_walkin_collections`, `funnel_dashboard`, `funnel_history`, `sales_scorecard`, `command_centre_summary`, `work_inquiry`, `create_manual_inquiry`, `change_opportunity_stage`, `opportunity_command`, `visit_quotation_command`, `sale_command`, `record_walk_in`, `record_showroom_visit`. All are `api.*`, single overload, `security definer`, `search_path=""`. Views (e.g. `api.catalog_finder`, `api.inbox_leads`), policies, grants and other functions were **not** compared. After PR #19, only `funnel_dashboard` was re-compared: hosted md5 `118127c5…` equals its `20261004000002` body. The other 22 were not re-hashed, because PR #19's migration does not redefine them. | 2026-10-04 ~17:53 UTC; `funnel_dashboard` re-checked 2026-10-06 06:48 UTC |
| **PR #18 CI** | On `32f7288`: `verify`, `database` and Vercel preview passed. `e2e` failed once (job `111532654143`, 21:20 UTC) and passed on rerun (job `111534312145`, 21:28 UTC) on the same commit. See §9. | 2026-10-04 |

Code observations cite the repository at `1d6215e`. PR #19 does not touch the files cited for capture or reporting except `funnel_dashboard` (see above). This branch differs from `main` only in documentation.

## 2. Aggregate completeness (hosted, production workspace only)

Read-only aggregate SQL against workspace slug `tile-concept`, excluding the `demo` workspace. No rows, names, phones, documents or amounts were exported. Main observation: 2026-10-04 17:53–17:56 UTC. Core counts were re-run on 2026-10-05 16:51 UTC. The only change was **accounts 0 → 2**.

**Data freshness:** the latest `leads.created_at` is 2026-09-28 and the latest `intake_events.occurred_at` is 2026-09-08. Any weekly figure after those dates reflects missing entry, not missing demand.

### 2.1 Leads, arrival and identity

| Measure | Count | Note |
| --- | ---: | --- |
| Leads | 721 | `walk_in` 536, `tiktok` 185 |
| Status | | contacted 537, new 167, contact_attempted 15, qualified 1, disqualified 1, duplicate **0** |
| With an intake event | 185 | All TikTok. Every one has `intake_events.occurred_at` (182 provider `tiktok_export`, 3 `manual`). |
| Walk-in leads with an intake event | 0 | All 536 are linked to a visit instead. |
| Leads created in a single minute (≥10) | 145 at 2026-09-01 00:53 UTC | See §2.2. |
| `duplicate_of_lead_id` set | 0 | |
| Shared normalized phone groups | 74 groups / 209 leads | **0** groups span more than one contact. These are repeat leads of one customer, not proven duplicate pursuits. |
| Contacts with >1 lead | 69 | |
| `first_response_at` / `first_whatsapp_sent_at` / `first_customer_reply_at` set | 550 / 0 / 0 | |
| With account / `converted_opportunity_id` | 0 / 0 | |
| `product_interest` non-empty | 143 | |

### 2.2 The 145-lead TikTok batch

All 145 were received (`intake_events.received_at`) in one minute, with `leads.created_at` = 2026-09-01 00:53 UTC. Their source `occurred_at` falls in KL weeks starting 2026-06-08 (1), 06-22 (1), 08-10 (28), 08-17 (38) and 08-24 (77); none is later than the import.

The cause is in the code. `scripts/import/tiktok-leads.mts` (added in `a030d5d`, 2026-09-11) rewrites `leads.created_at` to the source time only for **newly** accepted leads (`:142-147`). It leaves existing leads alone (idempotency key `tiktok:lead:<id>`, `:118`). These 145 predate it ("the first export import", `:6-7`).

**They did not arrive in week 2026-08-31.**

### 2.3 Pursuits, quotations, forecast, losses, products, sales

| Measure | Count (2026-10-04; ✓ = re-checked unchanged 2026-10-05) |
| --- | ---: |
| Opportunities | 3 ✓ (all open, none archived) |
| …with lead / contact / account / project | 0 / 0 / 0 / 3 |
| …with `segment` / `probability_band` / `expected_close_date` | 0 / 0 / 0 ✓ |
| …forecast **review freshness** | **not captured**: no review timestamp or forecast history exists |
| …with estimated value / next action due | 3 / 3 |
| Lost opportunities / with competitor | 0 ✓ / 0 |
| Leads disqualified ("lost") / with a structured reason | 1 ✓ / **not captured** (free text only) |
| Stage events | 3 |
| Production stages requiring a reason | won, lost, deferred (`requires_reason = true`) |
| Projects | 4 ✓ (`new_build` 2, `renovation` 1, `residential` 1) |
| Accounts | 0 → **2** on 2026-10-05 |
| Contacts | 407 (homeowner 326, designer 38, contractor 30, architect 4, unset 9) |
| Visits | 537 ✓ (`legacy` 534, `direct` 3). `customer_type`: homeowner 426, designer 56, contractor 38, architect 5, unset 12. |
| Visits with `quotation_amount` / `quotation_ref` / both | 58 / 8 / 7 |
| Visit quotation files (uploaded) | 1 ✓ |
| Canonical quotes / versions / items | 0 ✓ / 0 / 0 ✓ |
| **Quote sent evidence** | **not captured**: no field or event exists |
| Purchases | 64 ✓, all MYR: 63 `legacy_unclassified`, 1 `confirmed` ✓; 63 visit-linked, 1 lead-linked |
| Purchase items | 0 ✓ |
| Payments | 63, all `legacy_unclassified` collections |
| Sale events | confirmed 1, draft_updated 2 |
| Catalog variants | 5,087. **0** with non-empty `product_variants.dimensions`. Width/length attribute values on 960, thickness on 153. |
| Product categories / brands | all 5,087 `tile` / 19 brands, all `unreviewed` |

**What the data can answer today:** R1 approximately, after the arrival-date correction; R2 buyer role for walk-ins only. R3–R6 have no recorded evidence: the storage exists, but nothing captures it.

### 2.4 Reconciliation with the merged plan's counts (AC7)

| Plan statement (`standard-sales-reporting-plan.md` @ `85a048d`) | Hosted evidence | Result |
| --- | --- | --- |
| 721 leads, 536 walk-in, 185 TikTok; "169 of them arrived in one week (an import batch)" | 721/536/185 ✓. 169 TikTok leads are **created** in week 2026-08-31, 145 of them in one minute. | Counts agree. "Arrived" is wrong: the batch's source weeks are §2.2. |
| 536 leads with a contact, 525 typed | 536 with contact; 525 = 536 − 11 unset ✓ | Agrees |
| Visits 58 amount / 8 SQ / 1 file | 58 / 8 / 1 ✓ | Agrees |
| 3 opportunities without segment/band/close date; 0 quotes; 0 lost | ✓ | Agrees |
| 64 purchases, 0 product lines, 63 `legacy_unclassified` | ✓ | Agrees |
| "`intake_events.occurred_at` … is not always set" | Set on all 185. Walk-in and manual leads lack an intake event or carry entry time. | Corrected |
| "Size exists only as millimetre `dimensions` jsonb on about 960 of 5,087 variants" | `product_variants.dimensions` empty on all. 960 width/length **attribute values**, merged by `api.catalog_finder`. | Corrected |

---

## 3. Capture fields and entrypoints

"Storage" means a column or table exists. "Capture" means a screen, import or command that staff use actually writes it. Storage alone is not coverage (§2).

### 3.1 R1–R6 field-to-entrypoint matrix

Permissions are the current gates, verified in code at `1d6215e` and in hosted `core.role_permissions` on 2026-10-04. "Historical coverage" is what can be reported for past weeks with today's data.

| Metric | Entity / grain | Capture UI / import / RPC today | Available field / event | Missing capture | Date basis (proposed) | Historical coverage | Permissions today | Responsible issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 new pursuits | Pursuit (`sales.leads` row) | New-inquiry dialog → `api.create_manual_inquiry`; inbox → `api.work_inquiry`; walk-in wizard → `api.record_showroom_visit` → `sales.resolve_walk_in_lead`; `scripts/import/tiktok-leads.mts` → `api.accept_intake`; `scripts/import/daily-tracker.mts` → `api.record_walk_in` | `leads.created_at` (mixed meaning, §2.2); `intake_events.occurred_at/received_at`; `visits.occurred_at`; `inquiry_link_state` | Business arrival time with basis; reviewed duplicate/same-pursuit action; manual back-dated arrival | `received_at` + basis; fallback record time, flagged | TikTok from source time; walk-ins at visit time. 534 legacy visits are one lead each and may include repeat touches. | Write: `sales.write`. Read: `sales.leads.read_all` or owner. | TILE-4 (capture), TILE-9 (calc) |
| R2.1 buyer role | Pursuit | Walk-in wizard (`visits.customer_type`, copied to contact if blank); lead drawer "create contact" (defaults to homeowner); daily-tracker mapping | `contacts.customer_type`, `visits.customer_type`, `accounts.account_type` | Pursuit-level role with explicit unknown; no role on inquiries; TikTok leads have no contact | As R1 | Walk-ins only: 525 of 536 typed. Current value only, no history. | As R1 | TILE-4 |
| R2.2 project use / work type / GLC | Pursuit × project | Project registration (`…20260922195741_company_search_project_registration.sql`); walk-in auto-project `project_type='other'`; opportunity Edit dialog `segment` | `projects.project_type` (mixed), `opportunities.segment` | Separate `project_use`, `work_type`, `glc_involvement` + party role | As R1 | 4 projects, 0 segments. Current value only. | Project create/edit via existing commands (`sales.write`). PR #15 would add `projects.*` (§6.1). | TILE-4 (reuses TILE-1 registration) |
| R3 quotations sent / revisions / prepared | Canonical quotation; quote version; send event | Pipeline drawer `addQuoteVersionAction` (opportunity required; separate inserts); walk-in `quotation_ref/amount`; `api.visit_quotation_command` (files) | `quotes`, `quote_versions.issued_at` (defaults to entry time), visit fields, `visit_quotation_files.uploaded_at` | Canonical quote outside the pipeline; append-only send events; resend/retry identity | First send event (effective) / recorded | None: 0 canonical quotes, 0 send facts. 58 visit amounts count as *prepared* only. | `sales.write` | TILE-5 |
| R4 might close in week | Open opportunity | Opportunity Edit dialog only (`opportunity-dialogs.tsx:45-50`) | `expected_close_date`, `probability_band`, `estimated_value`, `owner_id`, `next_action*` | Forecast review events with review time; capture at create/stage change; exception queue | Expected close date as held at as-of | None: 0 of 3 forecast. No as-of history. | `sales.write` (owner, or `sales.read_all` for stage) | TILE-7 |
| R5.1 interest | Pursuit × category | Inquiry, walk-in, TikTok mapping | `product_interest text[]` (6 categories) | Brand/variant-level interest (optional) | As R1 | 143 leads; category only | As R1 | TILE-6 (keep separate) |
| R5.2 quoted lines | Line of a sent version | None (`quote_items` never written) | `quote_items` (no FK on `product_variant_id`) | Line capture on canonical quote, catalog picker, frozen snapshot | Version send date; snapshot at as-of | None | `sales.write` | TILE-5 + TILE-6 |
| R5.3 sold lines | Line on confirmed sale | `api.record_purchase` accepts items. Walk-in command maps items but the wizard sends `purchase: null` (`walk-in-wizard.tsx:194`). Sale workbench has no items. | `purchase_items`, `sale_events` | Line capture on confirmed sales; allocation of document discount/credit (U8) | Sale event effective date | None: 0 lines, 1 confirmed sale | `purchase.write`; corrections `purchase.correct` | TILE-6, TILE-9 |
| R6 losses | Outcome event; pursuit | Inbox `work_inquiry('lost'/'reopen')` (≥3-char text); `api.change_opportunity_stage` (reason required, `p_outcome_date`) | `leads.disqualified_reason` (nulled on reopen; kept in `sales.activities`); `opportunities.lost_at/outcome_reason/competitor`; append-only `opportunity_stage_events` | Outcome type + reason code + competitor; lead and opportunity outcomes in one history | Outcome effective date / recorded | 1 disqualified lead (free text); 0 lost opportunities | `sales.write`; owner rules in each command | TILE-8 |
| All weekly sections | Report row / drilldown row | `src/features/reports/registry.ts`, `api.report_*`, `api.funnel_*`, `exportReportAction` | — | Weekly RPC, completeness states, drilldown parity, export audit | §5.1 | — | §4 (permissions) | TILE-9, TILE-10 |

### 3.2 Capture detail by business concept (cited)

| Business concept | Current field / table | Current write path (cited) | Existing validation | Missing capture or linkage | Proposed responsible workflow | Issue | Testable evidence needed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lead arrival time | `intake_events.occurred_at` (TikTok, manual); `leads.created_at` | TikTok `accept_intake` + `created_at` rewrite (`scripts/import/tiktok-leads.mts:113-147`). Manual dialog writes `occurred_at = now()` (`…20260921051515_atomic_manual_inquiry.sql:110-111`). Walk-in lead `created_at = visit time` (`…20260921032114_walk_in_inquiry_linkage.sql:133-136`). Tracker sets `created_at` = noon KL (`daily-tracker.mts:397`). | `work_inquiry` refuses events earlier than `created_at` (`…20260921021742_inquiry_operations.sql:139`) | No business-arrival field with provenance | `received_at` + `received_at_basis`; never rewrite `created_at` | TILE-4 | Three leads imported in one minute with three source weeks land in three weeks |
| Pursuit identity | `sales.leads`; `visits.lead_id`; `inquiry_link_state` | `resolve_walk_in_lead` (`…walk_in_inquiry_linkage.sql:114-155`, candidates `:60-107`) | Shared/ambiguous identifiers block auto-link (`:66-71`, `:95-104`) | 534 legacy per-visit leads; no write path sets `duplicate` | Reviewed "same pursuit / duplicate" action with reason | TILE-4 | Repeat visit links; repeat customer's new need counts; shared phone across two contacts → review |
| Buyer role | `contacts.customer_type`, `visits.customer_type` (no CHECK), `accounts.account_type` | Walk-in copies to contact when blank (`…walk_in_inquiry_linkage.sql:213-214`). Lead drawer default homeowner (`lead-drawer.tsx:476,487`). Tracker `ID`→`designer` (`daily-tracker.mts:37-44`). | CHECK on contacts/accounts | No pursuit role; invented default | Pursuit `buyer_role` with unknown; contact default never overwrites a confirmed pursuit value | TILE-4 | No default role; confirmed role survives contact edit |
| Project use / work type / GLC | `projects.project_type`, `opportunities.segment` | Registration (`…20260922195741_…`, tests `supabase/tests/021_…`); walk-in auto-project `'other'` (`…walk_in_inquiry_linkage.sql:217`); segment in Edit dialog (`opportunity-dialogs.tsx:61`) | CHECK lists | No GLC; use and work type in one column | Independent `project_use`, `work_type`, `glc_involvement` + party role | TILE-4 | Commercial renovation with GLC end client stores all three |
| Quotation prepared | visit fields; `quotes`/`quote_versions` | Tracker patch (`daily-tracker.mts:389-390`); `addQuoteVersionAction` (`src/server/commands/opportunities.ts:98-136`): separate inserts, no RPC or idempotency, `issued_at` defaults to now (`:119`), status set issued/revised (`:128`) | zod only (`src/features/pipeline/schema.ts:39-45`) | Quotes require an opportunity; visit quotes are not quote records | One canonical quote command from inbox and walk-in | TILE-5 | Visit quotation creates a canonical quote in `prepared` state |
| Quotation uploaded | `visit_quotation_files` | `visit_quotation_command` (`…20260922183048_visit_quotation_files.sql`) | Upload intent + object check | Not linked to a quote | Files on the canonical quote version | TILE-5 | Upload does not change sent count |
| Quotation sent | none | none | — | No send fact | Append-only send events (version, channel, recipient role, actor, sent_at, evidence) | TILE-5 | Fixtures in §5.2 R3 |
| Forecast | `expected_close_date`, `probability_band`, `estimated_value`, `owner_id`, `next_action*` | Edit dialog only (`opportunity-dialogs.tsx:45-50`) | CHECK on band | No history or review time | Forecast review events; exception queue, never a blocker on recording a sent quote | TILE-7 | As-of query returns the forecast held then |
| Loss (lead) | `status='disqualified'`, `disqualified_reason` | `work_inquiry` lost / reopen nulls the reason (`…inquiry_operations.sql:173-181`); history in `sales.activities` (`:213-218`) | Free-text length | No code; rejection, spam, duplicate and loss share one status | Outcome type + reason + detail; reopen appends | TILE-8 | Reopen-then-lose keeps both events |
| Loss (opportunity) | `status`, `lost_at`, `outcome_reason`, `competitor` | `change_opportunity_stage` overwrites `outcome_reason` and does not clear `lost_at` on reopen (`…20260820000007_functions.sql:249-251`); stage events append-only (`:254-255`) | Reason non-blank | No code; competitor only in Edit dialog (`opportunity-dialogs.tsx:66`) | Reason code at loss; competitor may be Unknown | TILE-8 | Weekly loss reads events, not current status |
| Product interest | `product_interest text[]` | Inquiry, walk-in, TikTok (`tiktok-leads.mts:21-26`) | zod enum | Category only | Keep as interest population | TILE-6 | Separate column |
| Quoted / sold lines | `quote_items`, `purchase_items` (no FK) | Quote: never written. Sale: `record_purchase` items (`…20260921041005_…:406-466`); walk-in maps items (`src/server/commands/walkins.ts:137`); wizard sends `purchase: null` (`walk-in-wizard.tsx:194`) | — | No UI line capture or frozen attributes | Lines on canonical version and confirmed sale, `api.catalog_finder` picker | TILE-6 | FK, snapshot immutability, unmatched line with review state |
| Catalog attributes | `product_attribute_values`, `api.catalog_finder` (default variant only, `…20260831183013_catalog_finder_read_model.sql:8-40`) | Corpus import | review_state | All `tile`; brands unreviewed; no panel type | Provisional reviewed mapping; corpus cleanup not a prerequisite | TILE-6 | — |
| Confirmed sale / collections | `sale_events`, `purchase_payments.review_state` | `sale_command` (MYR only for new, `…20260921041005_…:154`) | Evidence gate, version checks | 63 legacy unclassified | Reuse unchanged | TILE-9 | Existing F3 suites |

---

## 4. Query risks against current source

Basis column: **code** = read at `1d6215e`. **hosted** = the same body confirmed by md5 (§1). **runtime** = observed in hosted aggregates (§2). **CI** = observed in a GitHub Actions run. No local synthetic fixture was executed, because no local Postgres or Docker was available.

| Risk | Verdict | Basis | Evidence |
| --- | --- | --- | --- |
| Product-demand join multiplication | Confirmed defect | code + hosted | `api.report_demand` left-joins `quote_items` and `purchase_items` on the same variant (`…20260820000012_phase6_reports.sql:159-176`). Not observable at runtime (0 lines). |
| Unused product-demand date parameters | Confirmed defect | code + hosted | `p_from/p_to` are never referenced. Since PR #16 the UI sends the range and the header says "Between …". |
| Quote creation date vs sent date | Confirmed defect | code + hosted | `api.report_quotes` filters on `quotes.created_at` (`…20260921045534_opportunity_workflow.sql:184-200`). `issued_at` defaults to entry time (`opportunities.ts:119`). |
| Draft and superseded versions | Confirmed | code + hosted | `report_quotes` counts drafts. `report_demand` sums every version's items. |
| Duplicate / pursuit population | Confirmed | code + hosted + runtime | `report_lead_source` counts `status='duplicate'`. `funnel_dashboard` excludes it, but nothing sets it (0 rows). 534 legacy per-visit leads. |
| Import arrival vs creation; response latency | Confirmed | code + hosted + runtime | Cohorts use `leads.created_at` (§2.2). Latency subtracts import time for the batch. Walk-in `first_response_at` reflects the visit. |
| Stage aging on unrelated `updated_at` | Confirmed defect | code + hosted | `report_pipeline` ages by `now() − updated_at` (`…opportunity_workflow.sql:168-182`), unlike the "since last stage change" definition. |
| Confirmed vs unclassified/voided/collection-only | Mixed | code + hosted | Funnel and scorecard use `sale_events` / confirmed payments. Walk-in and cohort document totals include `legacy_unclassified` (labelled). `report_demand` includes draft/voided items. |
| Credit / currency / unit | Confirmed gap | code | `report_demand` sums across currencies and units and ignores credits. |
| Limited frontend populations | Confirmed | code | Pipeline `.limit(2000)` (`src/server/queries/opportunities.ts:85`); contacts `.limit(1000)` (`src/server/queries/contacts.ts:39`). |
| Pipeline page hydration error | Observed once, cause unproven | CI | §9 |

### 4.1 Aggregate, drilldown and export permissions

Observed in hosted `core.role_permissions` and function bodies at 2026-10-04 21:11 UTC; code at `1d6215e`. **No policy was changed. This section declares current behaviour only.**

| Surface | Gate (verified) | Who gets it (hosted roles) | What it exposes | Note |
| --- | --- | --- | --- | --- |
| Governed report aggregates (`api.report_*`) and `api.funnel_dashboard` | Workspace membership + `report.read`. No function references `owner_id` or `sales.read_all`. | admin, analyst, guest (demo only), management, sales_manager, sales_rep | **Workspace-wide** aggregates | The page tells users without `sales.read_all` the data is "limited to your scope" (`src/app/(app)/insights/reports/[report]/page.tsx`). For **analysts** that statement is false. Hosted had 0 active analyst memberships, so nobody sees it today. |
| Named drilldown `api.funnel_history` | `report.read` **and** `sales.read_all` | All `report.read` roles except analyst | Named customer and visit rows | Analysts are refused named rows. |
| Analyst role | `catalog.read`, `marketing.spend.read`, `price.read`, `report.read` only | — | Aggregates; no named sales rows; no `export.customer` | Matches the code mirror `src/lib/rbac/matrix.ts`. |
| **CSV export authorization** (`exportReportAction`, `src/server/commands/reports.ts`) | `requirePermission("report.read")` only. It does not check `export.customer` or `sales.read_all`. | Same as aggregates, including analyst | Re-runs the same RPC server-side | Audit is console-only (`report.exported` log). No `audit.emit`. |
| **CSV content exposure** (separate from authorization) | — | — | Columns as in the registry. E.g. `walkin_person` exports **staff names** per row (`registry.ts:201`); other governed reports export aggregates. | `report.read` authorizes the action. It does **not** establish that every exported field suits every `report.read` role. A field-level review of CSV columns (staff names, small-cell counts) is open for TILE-10. |

**Declared contract for the weekly review (proposal, consistent with current behaviour):** aggregates stay workspace-wide under `report.read` and are labelled "Workspace-wide totals". Named drilldowns require `sales.read_all` and return exactly the aggregate's population. Analysts see the same aggregates with drilldown disabled and the reason shown (`Gated`). CSV export of named rows must not be possible with `report.read` alone. The merged plan's "restricted to the caller's own records unless `sales.read_all`" for aggregates (§4.6 of the plan) would change analyst behaviour, so it is an **open proposal**, not the current contract (§7).

---

## 5. Weekly metric contract (R1–R6)

### 5.1 Shared definitions (AC3)

| Definition | Proposed contract |
| --- | --- |
| **Local week** | Monday 00:00 to next Monday 00:00 Asia/Kuala_Lumpur (UTC+8, no DST), computed as `(date)::timestamp at time zone 'Asia/Kuala_Lumpur'`. Presets: Week to date, Last completed week, custom (≤366 days, as `funnel_dashboard`). |
| **Valid lead / pursuit grain** | One buying pursuit: a genuine new buying need from a digital inquiry or a direct walk-in. Repeated messages, visits and payments on an existing pursuit are touches, not pursuits. A repeat customer's new need is a new pursuit. "New lead" ≠ "first-ever customer". Walk-ins are not excluded. "Valid" excludes only reviewed duplicate, spam and test (U1). |
| **Duplicates** | A *duplicate* is a **reviewed** decision that two pursuits are the same buying need (`status = 'duplicate'` + `duplicate_of_lead_id`, with a reason). A *possible duplicate* (shared phone or email, same contact) is a review case and stays counted until reviewed. Shared phones are never proof. A *retry* (same request ID) never creates a second row, because commands are idempotent, so it is not a duplicate. |
| **First quotes and revisions** | First quote = a canonical quotation's first send event, whatever its version number. Revision = a later **distinct** version at its own first send. A resend of an already-sent version, and a retried command, count zero. Preparation and upload are not sending. |
| **Activity vs cohort** | *Activity* measures count events whose effective date falls in the period (R1.1, R3, R4.2, R5.2a/b, R5.3, R6). *Cohort* measures follow a population defined by its arrival period through the as-of date (e.g. "of pursuits arriving in week W, how many had a sent quote by as-of"); they grow until as-of and are labelled "cohort to date". The default weekly review shows activity. Cohort conversions are separate, labelled views and never mixed into an activity tile. |
| **Effective vs recorded date; as-of** | Every fact carries an effective date (when it happened) and a recorded date (when the system learned it). Buckets use the effective date. A fact counts at as-of `p_as_of` (KL end of day) only if recorded before it. Each tile shows "recorded after period end" separately. |
| **Forecast as-of** | "Might close in week W as of D" uses the forecast (close date, staff-assessed likelihood, value, owner, next action) **held at D**, from forecast review events. Today no history exists, so past-week forecasts show "current value, history not retained" (rule H) and are never back-filled. |
| **Product net sales** | Net sales = signed `sale_events.net_delta` on confirmed sales by effective date: excludes separately stated tax, after document discount, credits and voids negative in their own week, MYR only (`docs/sales-evidence-handoff.md`). **At line level** (R5.3) the document-level discount, credit and tax must be allocated or shown separately. No rule exists (U8). Until decided, line totals are shown with an explicit "unallocated document adjustments" row so line sums reconcile to net sales. Collections never count as sales. |
| **Outcome effective dates** | Win, loss, deferral, rejection and reopen are append-only outcome events. The effective date is the staff-stated outcome date where supported (`change_opportunity_stage(p_outcome_date)`), else the event time; the recorded date is the insert time. Reopening adds an event and never erases earlier outcomes, reasons or actors. |
| **Unknown / incomplete** | Unknown is always a displayed bucket. A missing capture path shows "Not yet captured"; partial coverage shows "Incomplete". Missing evidence is never shown as zero. |
| **Scope** | §4.1 |
| **Money and units** | MYR only; non-MYR excluded and counted. Quantities per stated unit; incompatible units never summed. |

### 5.2 Measures

| ID | Business question | Grain & counting identity | Population & exclusions | Effective / recorded date | Calculation | Units | Unknown / incomplete | Drilldown | Lineage today → required | Acceptance fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1.1 New buying pursuits | How many valid new pursuits arrived? | Pursuit | §5.1 grain; reviewed duplicate, spam and test excluded | `received_at` with basis; fallback record time, flagged | Count | — | Basis breakdown; legacy walk-ins flagged "pre-linkage" | Pursuits | `created_at` → `received_at` + basis (TILE-4) | 3 leads imported in 1 minute with 3 source weeks → 3 weeks. Walk-in auto-linked → 0 new. `new` mode with reason → 1 new. |
| R1.2 Rejected at qualification | How many were rejected, and why? | Outcome event | Rejection, duplicate or spam (not lost deals) | Outcome effective / recorded | Count | — | Legacy free text "unclassified" | Pursuits | Free text → outcome type + code (TILE-8) | Reopen then reject → two events |
| R1.3 Response latency | How fast did we respond? | Digital pursuit | Walk-ins excluded; no source time → counted as excluded | First response − `received_at` | Median minutes | min | "No source time" bucket | Pursuits | `− created_at` → `− received_at` (TILE-9) | Import batch yields source-based latency |
| R2.1 Buyer role | End user / contractor / ID / other / unknown | Pursuit (R1.1) | As R1.1 | As R1.1 | Count and share | — | Unknown explicit. Architect, developer and retailer kept as their own values and grouped as Other in the headline, never remapped to ID. | Pursuits | Contact/visit type → pursuit role (TILE-4) | Contact change does not alter a confirmed pursuit role |
| R2.2 Project dimensions | Use, work type, GLC for contractor/ID pursuits | Pursuit × project | R2.1 contractor + ID | As R1.1 | Count per dimension independently | — | Unknown per dimension; "No project" | Pursuits | `project_type` → three fields (TILE-4) | Commercial renovation with a GLC end client → commercial, renovation, GLC = yes (end client) |
| R3.1 Quotations sent | How many quotations were actually sent? | Canonical quotation at its first send | Excludes prepared, uploaded, amount-only, SQ-only and stage-only | First send / recorded | Count | — | "Prepared, not sent" separate; "Not yet captured" until TILE-5 | Quotations | Send events (TILE-5) | v1 prepared, v2 first sent → 1. Resend → 0. Retry → 0. |
| R3.2 Revisions sent | Further distinct versions sent | Version at its first send | Not the quotation's first-sent version | Send date | Count | — | — | Versions | As R3.1 | v3 after v2 → 1 |
| R3.3 Prepared / uploaded | Work in progress | Version / file | — | Prepared / uploaded at | Count | — | — | Versions | Visit fields + files → canonical quote (TILE-5) | Upload alone never increments R3.1 |
| R4.1 Might close this week | Which open opportunities might close in the selected week? | Open, non-archived opportunity | `expected_close_date` in the selected week (not a four-week window) | Forecast held at as-of | Count + list; value unweighted | MYR | "No close date", "Stale forecast" queues | Owner, staff-assessed likelihood (labelled), value, next action | Forecast events (TILE-7) | Rescheduled after as-of → past week unchanged |
| R4.2 Actual wins | Won in week | Win event | — | Won effective | Count, value | MYR | — | Opportunities | Stage events | Never added to R4.1 |
| R5.1 Interest | What were people interested in? | Pursuit × category | R1.1 | As R1.1 | Count | — | "No interest recorded" | Pursuits | `product_interest` | — |
| R5.2a Quoted on first send (activity) | What did we quote for the first time this week? | Line of the version that is a quotation's first send (any version number). Each quotation contributes once in its lifetime. | Unsent, prepared-only and resent versions excluded | That version's first send date | Quantity **and** value from **that same version's lines**, same date | Stated unit; MYR | "Unmapped" lines with review state | Lines | Quote lines + snapshot (TILE-5/6) | v1 prepared, v2 first sent → v2 lines once. 1 quote line × 2 sale lines does not multiply. |
| R5.2b Revisions sent (activity) | What did we re-quote this week? | Line of a later distinct version at its own first send | First-sent versions and resends excluded | That version's first send date | Quantity and value from that version's lines | As R5.2a | As R5.2a | Lines | As R5.2a | v3 after v2 → v3 lines here only. Never summed with R5.2a. |
| R5.2c Open quoted position (snapshot) | What is currently on the table? | Line of the latest sent version of each open quotation at as-of | Quotations won, lost, expired or archived at as-of | Point in time (no period sum) | Quantity and value from that version's lines | As R5.2a | As R5.2a | Lines | Needs version/outcome history | Revising v2→v3 replaces v2 lines; past snapshots reproducible |
| R5.3 Sold lines | What was actually sold? | Line on a confirmed sale | Draft, voided and legacy-unclassified excluded; credits as negative events | Sale event date | Quantity per unit; net value per §5.1 product net sales | Stated unit; MYR | "Sale without lines"; "Unallocated document adjustments" (U8) | Lines | `purchase_items` (unused) → lines (TILE-6) | Half-line credit reduces value in the credit week |
| R6.1a Loss events | How many losses were recorded, and why? | One loss outcome event. A retried command (same request ID) is one event. A loss and a later **correction** of its reason are one loss with a superseding reason event, not two losses. | Genuine lost deals only. Rejection, duplicate, spam and deferral are separate (R1.2). | Loss effective / recorded | Count per primary reason (latest correction at as-of) | — | "Reason not structured (legacy)" | Loss events | Free text → code + detail + competitor (TILE-8) | Lost, reopened and lost again in one week → 2 events. Retry → 1. Reason corrected → 1 loss, latest reason. |
| R6.1b Distinct lost pursuits | How many pursuits did we lose? | Distinct pursuit with ≥1 loss event effective in the period. A lead and its converted opportunity are **one** pursuit. An opportunity without a lead is its own pursuit. | As R6.1a | As R6.1a | Distinct count; reason = the pursuit's latest loss event in the period | — | As R6.1a | Pursuits | As R6.1a | Same-week double loss → 1. Lost in week 1, reopened, lost in week 3 → 1 in each week, both events kept. Lead and opportunity both lost → 1. |
| R6.2 Competitor relationship | Losses to a competitor, with relationship | R6.1a events and R6.1b pursuits whose primary reason is a competitor | — | As R6.1a | Both counts, by relationship (neutral, provisional) | — | Competitor name Unknown allowed | Pursuits / events | (TILE-8) | Unknown competitor counted, not dropped |

**Default headline (proposal, not an owner decision):** R5.2a as the weekly "quoted" headline, with R5.2c as a separate snapshot panel (U7).

### 5.3 Provisional wording (AC4)

| Term | Recorded wording | Status |
| --- | --- | --- |
| **ID** | Interior designer (`customer_type = 'designer'`; tracker "ID" → designer). ID subtypes are configurable and empty at launch. Architects, developers and retailers remain distinct identities and are **not** remapped to ID. | Provisional |
| **Competitor relationship** ("friendly competitor") | Neutral relationship captured with detail. Two prior readings exist: (a) an existing customer or business relationship with a competitor; (b) a mutual referral partner (the plan's glossary). Neither is adopted. | Provisional |
| **GLC** | GLC is a **party role** on the pursuit or project, independent of buyer role and project use. A GLC may be the **buyer** (the account placing the order) or the **end client / project owner** while the buyer is, for example, a contractor. Captured as `glc_involvement` (yes / no / unknown) + party role (buyer / end client / other / unknown). The party-role list stays configurable. | Provisional |
| **Panel / slab / large format** | No thresholds invented. "Panel" may need type, series and dimensions beyond the `wall_panel` category. | Provisional |
| **Actual leads vs estimates** | R1 counts only recorded pursuits by effective arrival date. Any future-volume estimate (marketing forecast, target, run-rate) is a separately labelled series and never adds to R1. None exists in the data today. | Rule |

---

## 6. TILE-1 and TILE-2 reconciliation (AC5)

### 6.1 TILE-1 — QC and deliver shared project registration with sales follow-up

Source: Direct snapshot 2026-10-05 (TILE-1 v3, Ready; no issue links). Brief source [PR #15](https://github.com/nadeemramli/tile-concept/pull/15). Re-read 2026-10-05: **open draft, not merged**, head `8ded2a71d83c24f09b8bdb92deb520258f87ca9c`, base `ddd3048`. It merges cleanly onto current main by `git merge-tree`, but would add a second pgTAP file numbered `022` (main already has `022_walkin_collection_reports.sql`).

Hosted check (2026-10-05 16:49 UTC): migration `20260923052934` **not applied**. No `api.project_command`, no `identity.project_events`, no `projects.next_action`, and no `projects.*` permission rows.

| Acceptance element (verbatim parts) | Implemented (where) | Tested (evidence) | Deployed | Missing E2E / QC evidence |
| --- | --- | --- | --- | --- |
| Registration (title-only, any staff) | PR #15 only: `api.project_command('create')`, and `projects.read/write` granted to **every** role (migration lines 3-6) | PR #15 pgTAP `022_shared_project_registration.sql`; Playwright `tests/e2e/shared-projects.spec.ts`; PR #15 CI green on 2026-09-23 against base `ddd3048` | No | CI on the result merged with current main; hosted rehearsal |
| Enrichment (company, PIC, site, requirements, specification) | PR #15 `edit`, `project_directory`, `project_identity_search`. Precursor company/PIC search already on main and deployed (`922ad8f`, `…20260922195741_…`, pgTAP `021`). | pgTAP (both); e2e on PR #15 | Precursor only | Same as above |
| Claim / handover | PR #15 `assign` (handover reason required when changing handler; version check) | pgTAP; e2e (handover reason, "Handler: A → B") | No | — |
| Continued registrar visibility | PR #15 policy `project_register_read`; registrar (`created_by`) distinct from handler (`owner_id`) and PIC | pgTAP "assigned project remains visible"; e2e | No | — |
| Concurrency / retry / access boundaries | PR #15: stale version → `40001`; retry with different payload → `23514`; direct table update → `42501`; foreign workspace hidden; project-only identity lookup | pgTAP (stale version, retry mismatch, denial, isolation) | No | True concurrent writes not exercised (stale-version check only). Effect of granting `projects.read/write` to **guest and analyst** roles not assessed. |
| Preserve hosted data | Additive columns, tables, policies and permissions | None against hosted | No | Dry-run of the migration against a copy of hosted data |
| Deploy exact verified build; smoke owner entrypoint | — | — | No | Not started. This task must not deploy. |
| Human acceptance | — | — | — | Pending |

**How it supports reporting:** registered projects are where R2.2's project use, work type and GLC involvement should live (TILE-4 extends this registration rather than creating a parallel entity). The registrar/handler distinction gives report attribution a clear owner (`owner_id` = handler; `created_by` = registrar). Project `next_action` from PR #15 is a project follow-up and must **not** be read as an opportunity forecast (R4). Its append-only `project_events` would support as-of handler attribution.

**Unverified:** that PR #15's tests pass against current main, hosted-data compatibility, production smoke, and human acceptance. **Proposed edge (not in the snapshot):** TILE-4's project-dimension capture is easier on top of TILE-1. This is a proposal only; the snapshot has no TILE-1 links.

### 6.2 TILE-2 — Reconcile the dated engineering backlog with later releases

Source: `docs/Backlog.md` (dated 2026-08-23). Evidence was observed 2026-10-05 16:50–16:55 UTC: hosted SQL aggregates, Supabase security advisors, Vercel env-var **metadata** (no values), and code at `1d6215e`.

Classes: **Resolved** (provenance kept), **Still open**, **Partially addressed**, **Unverified** (needs access this session lacks), **Business queue** (needs a person, not engineering; preserved without inventing facts).

| # | Backlog item | Current evidence | Class | Reporting overlap |
| --- | --- | --- | --- | --- |
| 1 | 3,482 price candidates pending | `ingest.price_candidates` pending_review 3,482 | Business queue | No |
| 2 | 885 variant candidates | pending_review 885 | Business queue | R5 (catalog identity) |
| 3 | 62 certificates scope `unknown` | 62 `unknown`; 62 `certificate_scope_review` pending | Business queue | No |
| 4 | 2,015 semantic visual labels | 2,015 `semantic_visual_review` pending; `visual_observations` 2,098 pending + 76 machine-complete | Business queue | No |
| 5 | 1,513 same-document media links (3,344 total) | 1,513 `same_source_document` + 1,701 `exact_ocr_code` + 130 `same_catalog_page`, all pending (= 3,344) | Business queue | No |
| 6 | 19 brands unreviewed | 19 `unreviewed` | Still open (business review) | **R5 brand** |
| 7 | Every product categorised `tile` | 5,087 `tile` | Still open | **R5 category / panel** |
| 8 | 350 sizes with unstated unit | 350 `dimension_unit_unstated` pending | Business queue | **R5 dimensions** |
| 9 | `edge`, `grade`, `sqm_per_carton`, mosaic attributes empty | Hosted attribute values exist only for width, length, thickness, pieces/carton and cartons/pallet | Still open | R5 (dimensions only) |
| 10 | 238 duplicate-code groups | 238 `duplicate_code_resolution` pending | Business queue | R5 |
| 11 | 82 low-confidence price tasks (95 − 13) | 82 pending | Business queue | No |
| 12 | 2,785 review tasks remaining | 2,785 pending, 13 approved | Business queue (unchanged) | No |
| 13 | Alpha / Bellezza `binary_not_staged` | 2 `oversized_source_recovery` pending | Still open (inferred mapping) | No |
| 14 | White Horse imagery / crawl permission | Not assessable from data | Unverified (business/legal) | No |
| 15 | Widen `candidate_facts` | Not assessed | Unverified (optional) | No |
| 16 | Review UI for corpus tasks | Marked fixed 2026-08-23 in the backlog | Resolved (provenance) | No |
| 17 | Re-import un-deciding reviews | Fixed by `…11_protect_review_decisions` (2026-08-23) | Resolved (provenance) | No |
| 18 | Custom SMTP not configured | Auth config not readable via SQL/MCP here | Unverified | Indirect (staff onboarding) |
| 19 | Hosted signup config can drift (no migration) | Current setting not readable here | Unverified | No |
| 20 | `invite-user` / `provision-user` must be `.mts` | `scripts/*.mts` present | Resolved | No |
| 21 | `severityLevel` lacks a unit test | Defined at `scripts/corpus/import-postgres.mts:949`; no test references it | Still open | No |
| 22 | Importer holds the candidate set in memory | Deferred by design ("fine at this size") | Still open (non-urgent) | No |
| 23 | `api.start_import_run` etc. lack UI and pgTAP | No `supabase/tests` file references them | Still open | No |
| 24 | Guests share one demo workspace | Accepted deliberately | Not a gap | No |
| 25 | Demo reset not monitored | `cron.job` `demo-workspace-weekly-reset` active; last 5 Sunday runs `succeeded` (latest 2026-10-04 18:00 UTC); no alerting found | Partially addressed (runs succeed, still unmonitored) | No |
| 26 | E2E: workbook import commit | No e2e test | Still open | R1 / R3 (walk-in fields) |
| 27 | E2E: segment → Command Centre donut | No e2e test | Still open | R2 (segment) |
| 28 | E2E: Accounts quick filters | No e2e test | Still open | No |
| 29 | Suite additions: walk-in capture, stage-change reason gates, scorecard target | Partial: `guest.spec.ts:78` walk-in rows survive reload; no stage-gate or target test | Partially addressed | **R3 / R6** (stage gates) |
| 30 | Revoke public execute on `api.*` SECURITY DEFINER | Advisors 2026-10-05: no public/anon-executable lint | Resolved (per advisor) | No |
| 31 | Fixed `search_path` on 3 functions | Advisors 2026-10-05: no mutable-search-path lint | Resolved (per advisor) | No |
| 32 | "RLS enabled, no policy" on 1 table | Now 7 tables (INFO): `core.workspaces` and six `*_requests` idempotency ledgers. Ledgers are documented as deliberate deny-all. `core.workspaces` was not confirmed. | Partially addressed | No |
| 33 | 55 authenticated SECURITY DEFINER warnings expected | Now 90 (grows with RPCs) | Informational | No |
| 34 | Preview env vars | All 7 Vercel env vars target **production only** | Still open | Indirect (PR preview testing of reports) |
| 35 | Custom SMTP (deployment list) | Same as #18 | Unverified | — |
| 36 | Invite the rest of the staff | Production workspace: 7 active memberships (admin 1, sales_rep 6) | Partially addressed (completeness unknown) | **Yes**: coverage depends on staff capturing |
| 37 | Custom domain (optional) | Not checked | Unverified | No |
| 38 | Compute sizing / backups | Not readable here | Unverified | No |
| 39 | Verify storage buckets and path policies | 9 private buckets exist, incl. the 4 named. Path policies not re-tested. | Partially addressed | No |
| 40 | CI actions on deprecated Node 20 | `checkout@v7`, `setup-node@v7`, `pnpm/action-setup@v6`. `upload-artifact@v5` still logs a Node 20 deprecation (2026-10-04 run). | Partially addressed | No |
| 41 | WSL shell Node 20 vs required 24 | README: `nvm use # Node 24 (see .nvmrc)`; no auto-switch verified | Partially addressed | No |
| 42 | `main` can stay red (no branch protection) | Branch-protection settings not readable here | Unverified | No |
| 43 | SQL Account scorecard deferrals | Pointer to PRD §11.3.1 | Out of scope | Indirect (collections) |

**New findings outside the backlog** (advisors and Vercel metadata, 2026-10-05): `auth_otp_long_expiry` (WARN), `auth_leaked_password_protection` (WARN), and Vercel flags `SUPABASE_SECRET_KEY` as `readable-secret`. These are security follow-ups, unrelated to reporting.

**Proposed bounded follow-ups (not created in Direct; the coordinator decides):**

| Proposal | Scope | Basis |
| --- | --- | --- |
| P-1 Demo reset alerting | Alert on a failed or missing weekly `cron.job_run_details` row | #25 |
| P-2 Preview environment | Add Preview/Development env vars per policy | #34 |
| P-3 Auth hardening check | Verify SMTP and signup in the dashboard; decide OTP expiry and leaked-password protection | #18, #19, new advisors |
| P-4 E2E for capture paths | Import commit (synthetic CSV), stage-change reason gates, segment → donut, accounts filters | #26–29; R3/R6 overlap |
| P-5 CI hygiene | Bump `upload-artifact`; decide branch protection | #40, #42 |
| P-6 Import-run RPC coverage | pgTAP for `start_import_run`/`record_import_item`/`finish_import_run`; `severityLevel` unit test | #21, #23 |
| P-7 Deny-all confirmation | Confirm the 7 no-policy tables are intended deny-all | #32 |
| P-8 Vercel secret visibility | Review `readable-secret` flag | New |
| P-9 Pipeline hydration | §9 | CI 2026-10-04 |

The business queues (#1–5, 8, 10–12) stay as review queues. No facts are inferred for them.

---

## 7. PR17 design rules vs Direct (AC6)

`docs/standard-sales-reporting-plan.md` is merged planning evidence at `85a048d`. Its merge is **not** acceptance or implementation, and **none** of its rules exists in code at `1d6215e`.

| # | Plan rule | Direct / coordinator principle | Disposition |
| --- | --- | --- | --- |
| 1 | §1 weekly Monday–Sunday KL, filter by salesperson | AC3 | Retained (§5.1); owner filter must narrow aggregate and drilldown identically |
| 2 | §3 R1 add `leads.received_at` filled by importers | Rule C | Retained, with a basis/provenance column and no further `created_at` rewrites |
| 3 | §3 R1 show online and showroom leads separately; confirm whether a walk-in is a lead | Rule B | Modified: walk-ins are pursuits when they are a new need; channel split is a breakdown |
| 4 | §3 R2 four divergent customer-type lists; no CHECK on visits | AC6 matrix | Retained as finding (§3.2) |
| 5 | §4.1 `customer_segment` list incl. architect, developer | AC4 | Retained as buyer role; architect is not remapped to ID |
| 6 | §4.1 `customer_sub_segment` = residential/commercial/**glc**/hospitality/fnb | Independent dimensions | **Rejected**: project use, work type and GLC involvement are separate fields |
| 7 | §4.1 segment required to qualify, quote or convert | Rule A (unknown allowed) | **Rejected**: completeness exception, not a gate |
| 8 | §4.1 contact ↔ lead copying | Rule A | Modified: contact is a default; confirmed pursuit values are not overwritten without review |
| 9 | §4.1 `interior_designer_category` nullable, extended later | AC4 | Retained as configurable ID subtype |
| 10 | §4.1 backfill: retailer → other | AC4 / scope | Modified: retailer kept as its own value, grouped as Other only in the headline |
| 11 | §4.2 lost-reason code list incl. `friendly_competitor` | Rule G | Modified: neutral competitor relationship + detail; list is a proposal |
| 12 | §4.2 `competitor_name` **required** for competitor codes | Rule G | Modified: name may be Unknown |
| 13 | §4.2 moving out of lost **clears the code** | Effective outcome history | **Rejected**: reopen appends an event; earlier loss and reason are kept |
| 14 | §4.2 glossary "friendly competitor = refer work to and from" | AC4 | Not adopted (§5.3) |
| 15 | §4.3 `quotes.opportunity_id` nullable; add `lead_id`, `visit_id` | Rule D | Retained (proposal for TILE-5) |
| 16 | §4.3 `api.quote_command` issue/revise/accept/reject/expire, idempotent | Explicit sent events | Modified: add a distinct **send** action/event; "issue" is not delivery |
| 17 | §4.3 visit creates quote with `issued_at = visit date` | Explicit sent events | Modified: visit creates a **prepared** quote |
| 18 | §4.3 `visit_quotation_files.quote_id` | Rule D | Retained |
| 19 | §4.3 inquiry `quoted` creates an opportunity at `quote_sent` and converts the lead | Rule D | Modified: one quoting command; a stage is not send evidence; no forced identity re-entry |
| 20 | §4.3 "sent" = `version_no = 1` with `issued_at` in week | Explicit sent events | **Rejected**: first send event of any version; later versions are revisions |
| 21 | §4.4 `requires_forecast` blocks entering `quote_sent` | Rule E | **Rejected**: missing forecast is an exception queue |
| 22 | §4.4 "might close" = high band/verbal confirmation **or** next four weeks | Selected-week forecast | **Rejected** as default; a four-week view only as a separate labelled view |
| 23 | §4.4 value unweighted until weights are accepted | Rule E | Retained |
| 24 | §4.5 FKs from item tables to variants | Rule F | Retained |
| 25 | §4.5 line items via catalog finder; unmatched lines keep brand/category/size label | Rule F | Retained, plus reviewed provisional mapping and frozen snapshot |
| 26 | §4.5 `format_label` and `large_format` threshold | Rule F | Modified: dimensions with units; no invented threshold |
| 27 | §4.5 panels = `wall_panel` + series | AC4 | Provisional |
| 28 | §4.5 fix `report_demand` (dates, split CTEs, exclude voids) | §4 risks | Retained |
| 29 | §4.5 catalog hygiene a precondition | Rule F | **Rejected** as a precondition |
| 30 | §4.6 `api.report_weekly_sales(p_week_start, p_owner_id)`, restricted to the caller's own records unless `sales.read_all`; page, registry, metric definitions; CSV audit row | §4.1 | Page, registry, definitions and audit retained. Own-records restriction is an **open proposal**: it changes current workspace-wide aggregates for analysts. |
| 31 | §5 PR sequence; §6 eight-question gate | Direct edges (§8.1); §10 | Replaced by Direct edges; only consequential definitions block |

---

## 8. Downstream handoff (TILE-4 … TILE-10)

### 8.1 Direct dependency edges (snapshot 2026-10-05; "depends on" = blocked_by)

| Issue | Depends on (Direct) |
| --- | --- |
| TILE-4 classification | TILE-3 |
| TILE-5 canonical quotation and sending | TILE-3 |
| TILE-6 structured quoted/sold lines | TILE-3, TILE-5 |
| TILE-7 forecast review | TILE-3 |
| TILE-8 loss reasons and pursuit outcomes | TILE-3 |
| TILE-9 complete scoped report calculations | TILE-3, TILE-4, TILE-5, TILE-6, TILE-7, TILE-8 |
| TILE-10 default dashboard, drilldowns, completeness queues, audited CSV | TILE-4, TILE-5, TILE-6, TILE-7, TILE-8, TILE-9 |
| TILE-1, TILE-2 | No links |

**Proposed edges (labels only, not Direct):** TILE-5 → TILE-4 (a quote linked to a lead or visit without an opportunity needs TILE-4's pursuit identity); TILE-4 → TILE-1 (project dimensions on shared registration). Neither replaces a Direct edge.

### 8.2 Shared contracts (define once)

1. Effective vs recorded dates on every reportable fact, plus a KL week helper used by all weekly RPCs.
2. Append-only pursuit outcome event: outcome type (`rejected | duplicate | spam | lost | deferred | won | reopened`), reason code, detail, competitor (Unknown allowed), relationship detail, effective date, actor, request ID.
3. Command pattern `api.<x>_command(p_action, p_input, p_request_id)`: idempotent, audited, append-only.
4. Completeness states `captured | unknown | not_captured | incomplete` per section.

### 8.3 Criterion-to-evidence plan (proposal; TILE-4 to TILE-10 criteria not supplied)

| Issue | Evidence an Agent Pass should carry (proposed) | Fixtures from §5 |
| --- | --- | --- |
| TILE-4 | Migration + pgTAP for `received_at` + basis; pursuit role, project use, work type, GLC party role with Unknown; no invented default; importers stop rewriting `created_at`; hosted dry-run; e2e capture from inquiry and walk-in | R1.1, R2.1, R2.2 |
| TILE-5 | Canonical quote command (prepared, uploaded, sent, revised, resent) with idempotency; inbox and walk-in reuse; pgTAP send semantics; e2e send from inbox | R3.1–R3.3 |
| TILE-6 | FK; line capture on quote version and confirmed sale; frozen snapshot; provisional mapping review; U8 allocation implemented as decided | R5.2a–c, R5.3 |
| TILE-7 | Forecast review events with review time; as-of read; exception queue; sent quote never blocked | R4.1, R4.2 |
| TILE-8 | Outcome events from inbox and stage change; reopen appends; retry dedup; reason correction supersedes | R1.2, R6.1a, R6.1b, R6.2 |
| TILE-9 | Weekly RPC(s) per §5; drilldown = aggregate population; completeness states; `report_demand` fixed or retired; permission parity tests (§4.1) | All |
| TILE-10 | Default page; marketing/showroom report preserved; scope label corrected; CSV field review and `audit.emit`; Unknown never shown as zero | All |

---

## 9. Proposed code follow-up — pipeline hydration error (not fixed here)

| Item | Evidence |
| --- | --- |
| Failure | PR #18 CI run `37235147572`, job `111532654143`, 2026-10-04 21:20 UTC, commit `32f7288` (documentation only). `tests/e2e/guest.spec.ts:58` "guest route renders: /sales/pipeline" failed the `route-smoke.ts:38` assertion (no uncaught browser errors). The logged React diff shows a pipeline card text of `" · 1 minute ago"` vs `" · 2 minutes ago"`. |
| Rerun | Job `111534312145` on the same commit **passed** (2026-10-04 21:28 UTC). 92 other tests passed in the failing run. |
| Location | `src/features/pipeline/components/pipeline-view.tsx:207` (also `:89`, `:92`) renders `formatRelative()` (`src/lib/format.ts:36`, `formatDistanceToNowStrict` against the current time). |
| Hypothesis (not demonstrated) | Server render and browser hydration compute relative time at different moments; crossing a minute boundary changes the text and React reports a hydration error. Not reproduced deterministically in this session. |
| Proposed follow-up (P-9) | Reproduce with a fixed clock (Playwright clock), then render relative time after mount or isolate it in a hydration-tolerant element; check the other files that call `formatRelative`. Application-code change, out of scope here; no patch made and no warning suppressed. |

---

## 10. Remaining uncertainties

**Consequential business definitions** (each blocks only the work named):

| # | Question | Evidence | Impact | Options | Recommendation (proposal) |
| --- | --- | --- | --- | --- | --- |
| U1 | What makes a pursuit "valid" (spam, test, wrong number, out of area)? | Only free-text loss reasons exist | R1.1 | (a) exclude reviewed spam/test/duplicate only; (b) also out of area | (a). Blocks the TILE-8 code list only. |
| U2 | Treatment of 534 legacy per-visit walk-in leads | §2.1 | R1 before 2026-09-21 | Flag as "pre-linkage"; or reviewed back-classification | Flag now. Does not block TILE-4. |
| U3 | Competitor-relationship meaning | Two readings (§5.3) | R6.2 labels | Neutral + detail; or adopt one | Neutral. Blocks glossary text only. |
| U4 | GLC party roles and definition of a GLC | No field anywhere | R2.2 | yes/no/unknown; + party role list | yes/no/unknown + configurable party role. Blocks TILE-4's GLC enum only. |
| U5 | ID subtypes | Undefined | R2 drill | Configurable list, empty at launch | Configurable; does not block |
| U6 | What counts as send evidence | No send fact exists | R3 | Staff-attested event with channel; or require proof | Staff-attested + optional proof. Blocks TILE-5's send action. |
| U7 | Default "quoted" headline | R5.2a/b/c (§5.2) | Default R5 view | R5.2a or R5.2c | R5.2a headline + R5.2c panel. Blocks TILE-10 layout only. |
| U8 | Line-level allocation of document discount, credit and tax | Headers carry discount/tax; lines do not | R5.3 net value | Pro rata by line total; or an "unallocated adjustments" row | Unallocated row until decided. Blocks TILE-6/TILE-9 R5.3 value only. |
| U9 | Owner-restricted aggregates (plan §4.6) vs workspace-wide (current) | §4.1 | Analyst and sales-rep views | Keep current; or restrict | Keep current (no policy change in TILE-3). Decide in TILE-9. |

**Routine engineering choices** (decide in the issue, no owner gate): column and table names; one RPC or six; KL week helper location; event table shapes; CSV layout; fixing or retiring `report_demand`; pagination replacing the 2,000 ceiling.

**Evidence still missing:** live Direct (claim, readiness re-check, submission); TILE-4 to TILE-10 acceptance text; Obsidian notes; the TikTok export and Daily Tracker source files (dates come from stored `occurred_at`); dashboard-only settings (auth SMTP and signup, branch protection, compute and backups, custom domain); comparison of hosted views and policies beyond 23 functions; local pgTAP/E2E runs in this session; PR #15 tests against current main.
