# Sales reporting baseline and weekly metric contracts (TILE-3 evidence pack)

Prepared 2026-10-04 by an agent session for TILE-3. This file is the evidence for the issue, **not** the issue record. Direct could not be reached from this session (see Limitations), so nothing here has been recorded in Direct. A human must transfer it or hand the session the Direct contract. It contains analysis only: no production record, hosted migration, deployment or message was changed or sent. Agent verification is not human acceptance.

## 1. Source and build fingerprints (read-only)

| Item | Value | How verified |
| --- | --- | --- |
| Static-audit commit | `ddd304851709e3d29468b8f4e7a755e2b68e55d6` | Given in the assignment |
| Current `origin/main` | `85a048d78e152a755458ea04b90a59bf0258a8d0`, the audit commit plus one docs-only commit that adds `docs/standard-sales-reporting-plan.md` (#17). It changes no code or migrations. | `git log`/`git diff --stat ddd3048..origin/main`, re-checked 2026-10-04 after PR #18 opened |
| Vercel production (project `tile-concept`) | `dpl_Av7kUQUzkzpDhbu6hNY7wbT7jZzC`, READY, from `main` @ `85a048d…` (previously `dpl_82gET9Nu3UfQPCLhRUB1crWhYnyt` @ `ddd3048…`) | Vercel deployments API |
| Repo migrations | 53 files, last `20260922195741_company_search_project_registration` | `ls supabase/migrations` |
| Hosted migrations (`ewyiiematuuojlhpioqh`) | 53 rows, versions and names identical to the repo | Supabase `list_migrations` plus a line diff |
| Hosted report SQL | `api.report_demand`, `report_quotes`, `report_pipeline` and `report_lead_source` match the latest repo definitions word for word (`report_pipeline`/`report_quotes` from `…20260921045534_opportunity_workflow.sql`) | `pg_proc.prosrc` read and compared |

The repository, deployed build and hosted migrations all match. Application code and migrations are identical to the static audit's commit, so its code findings apply unchanged. Matching migration names does not prove every function body matches; only the four report functions above were compared word for word.

## 2. Aggregate coverage, production workspace (counts only, no rows exported)

Counts come from the `tile-concept` workspace on 2026-10-04. The demo workspace is excluded.

| Area | Evidence | Coverage today |
| --- | --- | --- |
| Leads | `sales.leads` | 721 total: 536 `walk_in`, 185 `tiktok`. Statuses: 537 contacted, 167 new, 15 contact_attempted, 1 qualified, 1 disqualified, **0 duplicate**. `duplicate_of_lead_id` is set on 0. |
| Lead arrival date | `sales.intake_events.occurred_at` through `lead_intake_links` | All 185 TikTok leads have an intake event. 182 come from `tiktok_export` and occurred more than a day before they were received. **145 TikTok leads were created in one minute (2026-09-01 00:53 UTC).** Counted by `leads.created_at`, week 2026-08-31 shows 169 TikTok leads. Their intake `occurred_at` spreads them over June, August and September. |
| Walk-in "leads" | `sales.visits.lead_id` | 535 of 536 walk-in leads were created at the same moment as their visit. They are one lead per visit, not per person. 69 contacts have more than one lead. 74 normalized phones are shared by 209 leads. |
| Segment (end user / contractor / ID) | `identity.contacts.customer_type` (also `sales.visits.customer_type`) | Leads with a contact (536, all walk-ins): homeowner 423, designer 53, contractor 41, architect 8, unset 11. **The 185 TikTok leads have no contact, so their segment is unknown.** 0 leads have an account. 0 accounts exist. |
| Project category / GLC | `identity.projects.project_type`, `sales.opportunities.segment` | 4 projects (new_build 2, renovation 1, residential 1). 3 opportunities, all with a project and all with `segment` unset. **No GLC field exists anywhere.** `project_type` mixes use (residential/commercial/hospitality) with work type (renovation/new_build). `opportunities.segment` is a third vocabulary. |
| Pursuit links | lead → opportunity, visit → opportunity | `opportunities.lead_id` 0 of 3. `leads.converted_opportunity_id` 0. `visits.opportunity_id` 0 of 537. |
| Quotations | `sales.quotes` / `quote_versions` / `quote_items` | **0 / 0 / 0.** Quotation evidence exists only on visits: `quotation_amount` 58, `quotation_ref` 8, 1 uploaded `visit_quotation_files`. **There is no evidence of a quotation being sent.** |
| Forecast | `opportunities.expected_close_date`, `probability_band` | 0 of 3 and 0 of 3. |
| Loss reasons | `outcome_reason`, `competitor` | 0 lost opportunities. 0 competitors recorded. |
| Product lines | `quote_items`, `purchase_items` | 0 and 0. 143 leads have free-text `product_interest`, which records interest only. |
| Sales | `sales.purchases`, `sale_events` | 64 purchases: 63 `legacy_unclassified`, 1 confirmed. `sale_events`: 1 confirmed, 2 draft_updated. |

**What this means:** today the data can answer only Q1 (with the date and duplicate corrections in §4) and Q2 (for walk-ins only). Q3 to Q7 have no data to measure, because nothing records that information yet. Fixing the queries alone will not answer them; the information has to be recorded first.

## 3. Weekly metric contracts (proposed)

These apply to every metric unless a row says otherwise:

- **Week:** Monday 00:00 to Sunday 24:00, Asia/Kuala_Lumpur. The Monday start is *proposed* and needs owner confirmation.
- **As-of:** a past week is computed from records that existed before the as-of time `asof_at = (as_of_date + 1) at KL`. This follows the `api.funnel_dashboard` pattern. Each week also shows "recorded after week end" counts, so back-entry is visible rather than silently changing history.
- **Scope:** only the current workspace, `report.read`, and archived opportunities excluded.
- **Drilldown:** only the population of the same contract, named only under `sales.read_all` (the same gate as `api.funnel_history`). The aggregate tiles never expose identifiers.

| # | Metric | Grain | Date basis | Exclusions | Drilldown population | Kept separate from |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | Valid new leads per week | One lead, counted once | **Arrival:** earliest linked `intake_events.occurred_at`. `leads.created_at` only for leads entered natively with no intake event. Each row is flagged with the basis used. | `status='duplicate'`, `duplicate_of_lead_id` set. Disqualified leads are shown as their own column, not dropped (see U4). | The leads counted, with source, arrival basis and status | Walk-in visits (reported as their own line, not counted as new inquiries; see U5). Future/expected leads are never counted. |
| M1a | Possible duplicates awaiting review | Group of leads sharing a normalized phone or email in the period | Arrival, as M1 | None | The leads in each group | M1. They are not silently removed. |
| M2 | Segment mix of M1 | Lead | Same as M1 | Same as M1 | M1, filtered by segment | Segment uses the contact's current `customer_type` at as-of, mapped homeowner → **end user**, contractor → **contractor**, designer → **ID (provisional: interior designer)**. Architect/developer/retailer/other → "other trade" until decided. Unset or no contact → **unknown**, which is always shown. |
| M3 | Project category for contractor/ID leads | Project linked to the lead's pursuit | Same as M1 | Leads with no linked project are counted as "no project" | Leads plus project | Three **independent** dimensions: project use (residential/commercial/…), work type (renovation/new build), and **GLC involvement (yes / no / unknown)**. GLC is never folded into use. |
| M4 | Quotations sent | **First** send of a quotation (version 1) | Send event timestamp (KL) | Drafts, prepared or uploaded files with no send event, voided | Quotations sent in the week | M4r revisions sent (version > 1), counted separately. Quotations *prepared/uploaded* (`visit_quotation_files.uploaded_at`, `visits.quotation_amount`) are a separate, lower-confidence measure, never labelled "sent". |
| M5 | Opportunities that might close in the selected week | Open, non-archived opportunity | `expected_close_date` within the week, as known at as-of | Won/lost/deferred at as-of, archived | Those opportunities with value, stage and probability | Actual wins in the week (status change to won by `won_at`) and actual sales (`sale_events`). Estimates are never added to actuals. |
| M6 | Products quoted vs sold | Line item by product → brand → size (`width_mm`×`length_mm` attributes) → panel (category `wall_panel`, provisional) | Quoted: the send date of the sent version whose lines count (see U7). Sold: `sale_events.occurred_at` on confirmed sales. | Unsent or superseded quote versions, draft/voided/unclassified purchases, non-MYR unless converted | The lines | Product *interest* (`leads/opportunities.product_interest`), quoted lines and sold lines are three columns, each aggregated **in its own subquery before joining**. Collections (`purchase_payments`) are never sales. |
| M7 | Loss reasons | Opportunity lost in the week | `lost_at` (KL) | Archived. Reopened opportunities count in the week of their final loss. | The lost opportunities | Reason code (pricing / timing / competitor relationship / other) is separate from the competitor named. "Friendly competitor" provisionally means **an existing relationship with a competitor**. |

## 4. Reported query risks confirmed against `ddd3048`

| Risk | Status | Evidence |
| --- | --- | --- |
| Product-demand join multiplication | **Confirmed** | `api.report_demand` (`20260820000012_phase6_reports.sql:159`) left-joins `quote_items` and `purchase_items` on the same variant. N quote lines × M sale lines inflates both sums. It also counts every quote version (superseded revisions included) and draft, voided and unclassified purchases, and sums line totals across currencies. |
| Unused date filters | **Confirmed** | `report_demand(p_from, p_to)` never references either parameter. The registry marks it `ranged: true` and the page prints "Created between …", so the label is false. |
| Quote creation date vs sent date | **Confirmed** | `api.report_quotes` filters on `quotes.created_at` and counts drafts. `addQuoteVersionAction` (`src/server/commands/opportunities.ts:119`) sets `issued_at` to *now* when none is given, so `issued_at` records when it was entered, not that it was sent. Visit quotations (the only quotation data in production) are not included at all. "Avg versions" mixes first quotes with revisions. |
| Duplicate lead handling | **Confirmed** | `report_lead_source` counts `status='duplicate'` leads. `funnel_dashboard` excludes that status, but nothing in production sets it (0 rows) while 74 shared-phone groups exist. Walk-in leads are one per visit, so repeat visitors inflate "new leads". |
| Stage aging | **Confirmed** | `report_pipeline` uses `now() - opportunities.updated_at`, so any edit resets the age. The metric definition `pipeline_aging` says "days since the last stage change" from `opportunity_stage_events`. Report and definition disagree. |
| *New:* lead date basis | **Found** | `report_lead_source` and `funnel_dashboard` cohort on `leads.created_at`. The TikTok bulk import (145 leads in one minute) lands in week 2026-08-31 instead of its arrival weeks. Median response time is measured from that import time too. |

## 5. Unresolved business definitions (kept open, not decided here)

- U1 **ID** = interior designer (provisional). It maps from `customer_type='designer'`. Whether `architect` counts as ID is undecided.
- U2 **"Friendly competitor"** = an existing competitor relationship (provisional). Whether it is a loss reason or a qualifier on the competitor is undecided.
- U3 **GLC involvement** is a separate yes/no/unknown dimension, not a project use. Its definition (GLC as owner, developer or main contractor?) is undecided.
- U4 Whether disqualified leads count as "valid" (proposed: report them, do not drop them).
- U5 Whether a walk-in counts as a "new lead", or only first visits by a new contact count, or walk-ins are reported apart from inquiries (proposed: apart).
- U6 Week start day (proposed: Monday, ISO).
- U7 For M6, whether the quoted lines are the first sent version or the latest sent version at as-of.
- U8 Whether "panel" means the `wall_panel` category.

## 6. Criterion-to-evidence plan

The live TILE-3 acceptance criteria could not be read. The rows below map to the seven numbered steps in the assignment as given, and must be re-mapped to the real criteria in Direct.

| Assignment step | Evidence in this file | Status |
| --- | --- | --- |
| 1 Repo/deploy/migration parity | §1 | Verified by agent |
| 2 Aggregate coverage | §2 | Verified by agent (counts only) |
| 3 Grain/date/exclusions/timezone/as-of/drilldown | §3 | Proposed; needs owner review |
| 4 Separate actuals from estimates, preparation from sending, revisions from firsts, interest from quoted/sold, collections from sales | §3 "Kept separate from" column | Proposed |
| 5 Keep unresolved definitions open | §5 | Recorded as open |
| 6 Confirm query risks | §4 | Verified by agent against code and hosted SQL |
| 7 Record in Direct | — | **Blocked:** Direct is not reachable from this session |

## 7. Limitations

- **Direct**: there is no Direct connector, CLI or API in this cloud session. TILE-3 is not in Linear or in GitHub issues for this repo. TILE-1, TILE-2, TILE-3's acceptance criteria, dependencies, readiness, claim state and TILE-4 to TILE-10 could not be read. No claim was taken and no update was written.
- **Obsidian**: the two staging notes are on a local Windows path (`C:/Users/Nadeem/Desktop/Obsidian/...`) and are not in Google Drive. They were not read. Nothing here relies on their contents.
- No `AGENTS.md`, Development Operating System or E2E guidance exists in the repository. `CLAUDE.md` was followed.
- Matching migration names does not prove every function body matches; only four report functions were compared in full.

## 8. Reconciliation with `docs/standard-sales-reporting-plan.md` (#17)

`main` gained a gap analysis and four-PR delivery plan after this pack was drafted. Its hosted counts agree with §2: 721 leads, 525 typed contacts, 58/8/1 visit quotations, 0 quotes, 3 opportunities and 64 purchases with 0 items. It is not known whether it is the same content as the Obsidian "Gap Assessment and Delivery Plan" note. Overlapping points are not repeated here. Where it conflicts with TILE-3's stated constraints, the conflict is recorded below so downstream issues inherit the constraint rather than the plan's wording. None of this edits the plan; the owner decides.

| Plan item | Conflict with a TILE-3 constraint | Required correction to downstream scope |
| --- | --- | --- |
| §4.1 `customer_sub_segment`: `residential \| commercial \| glc \| …` | GLC involvement must be **separate** from residential/commercial use. A single sub-segment column cannot hold "commercial **and** GLC". | Model project use and GLC involvement (yes/no/unknown) as independent fields, as in M3. Keep the definition of GLC involvement open (U3). |
| §4.2 glossary: friendly competitor = "a competitor we refer work to and from" | The provisional definition is **an existing competitor relationship**. The two are not equivalent. | Keep the code, but leave its glossary text provisional until the owner decides (U2). |
| §4.3 `record_showroom_visit` creates a quote with `issued_at = visit date`. "Quotations sent" = `version_no = 1` with `issued_at` in the week. | Preparation or upload must be kept apart from **sending**. A visit's SQ number, amount or file proves a quote was prepared, not sent. | Add an explicit send event (timestamp, channel, actor), and count M4 only from it. Visit-created quotes count as *prepared* until a send is recorded. |
| §4.4 "Might close" = high probability or `expected_close_date` within the next four weeks | The question is "might close **in the selected week**", and estimates must be separate from actuals. | M5: expected close date within the selected week, as known at as-of. Never added to wins or sales. |
| §3 R1: "`intake_events.occurred_at` … is not always set" | Not observed: all 185 intake events have `occurred_at`. The gap is walk-in and manual leads, which have no intake event. | Keep the plan's `received_at`, and backfill it from `intake_events.occurred_at` (TikTok) and the visit's `occurred_at` (walk-ins). |
| Not covered by the plan | §4 risks: stage aging on `updated_at`, duplicate leads (0 marked vs 74 shared-phone groups), `report_quotes` counting drafts, and as-of/back-entry behaviour | Add to whichever downstream issue owns the weekly report RPC (plan PR4). |

The plan's sequence (decisions → segments/loss codes → quotation record → product lines → weekly report) agrees with this pack's dependency order: data must be recorded before reports can count it. Its section 6 (business decisions) overlaps U1–U8 and should be resolved as one list.
