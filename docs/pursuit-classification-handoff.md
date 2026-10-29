# Buyer role and project segmentation (TILE-4) — handoff

Buyer role, project use, work type and GLC involvement are now independent, explicitly-Unknown attributes of one **buying pursuit**, captured across inquiry, qualification, project/opportunity, walk-in and imports. An inquiry's **effective arrival** is validated and kept apart from when it was recorded. This is agent first-pass evidence on synthetic data; owner acceptance, the hosted migration and any hosted backfill are separate, explicitly authorised steps. TILE-3's source audit was used as provisional guidance only.

## Model

- **Pursuit** = one inquiry (`sales.leads`) and, once converted, its opportunity (`sales.opportunities`). Both rows carry the same classification; a trigger keeps them in step and writes one history row per decision. `sales.pursuits` is the reporting grain: an opportunity (with its inquiry, if any) or an inquiry that has not become one. Duplicates belong to their original; visits, messages and extra stakeholders never add a pursuit.
- **Dimensions** (`core.classification_values`, mirrored by `src/features/classification/taxonomy.ts`):
  - `buyer_role`: end_user, contractor, interior_designer, other, unknown (primary); developer, architect, retailer (earlier-record values, preserved and reported as their own groups — never folded into another role).
  - `project_use`: residential, commercial, hospitality, mixed, other, unknown.
  - `work_type`: new_build, renovation, other, unknown.
  - `glc_involvement`: yes, no, unknown; `glc_party_role` (end_client, developer, main_contractor, consultant, other, unknown) only when yes.
  A residential job for a GLC is `residential` + `yes`: counted once in each dimension, never twice. The old single-select `opportunities.segment` ('institutional', 'fnb', …) is left untouched and is not used by the new report.
- **State**: `unreviewed` (saved as known, possibly all Unknown), `complete`, `missing_flagged` (qualified with Unknowns and a reason), `conflict` (a later source disagreed; the recorded value stands). **Basis**: capture, qualification, correction, walk_in, import, inherited, backfill, legacy (before this change).
- A contact's own `customer_type` is a fact about the person. It is **never copied onto a pursuit**; the classify dialog offers it as a one-click suggestion only. Its check now accepts the new keys and keeps the earlier `homeowner`/`designer` labels; "unknown" on a person is stored as null.

## Commands and rules (database is the authority)

- `api.classify_pursuit(p_input, p_request_id)` — capture / qualification / correction for an inquiry *or* an opportunity. Every dimension must be stated (Unknown allowed). Qualification refuses a silent Unknown unless it is flagged with a note, and sets the inquiry to `qualified`. Changing or clearing a known value, or dismissing a held conflict, needs a reason (≥5 chars). `expected_version` rejects a stale screen (40001). Request IDs are idempotent and actor/payload-bound. Owner rule as elsewhere: the owner, or a role with `sales.read_all` (note `sales_rep` holds it since `20260921073229`; the rule binds roles such as `showroom`).
- Direct writes to classification columns by `authenticated` are refused (42501); `sales.classification_events` is append-only and readable only where the pursuit is.
- A **showroom visit** (`sales.visits` insert or relink) states the buyer role for its inquiry: it fills an Unknown, and a different recorded role becomes a `conflict` for review. Legacy-linked visits are never re-read. The walk-in wizard now defaults to "Not stated" instead of Homeowner.
- **Arrival** (`20261029160001`): `created_at` keeps its long-standing meaning — the inquiry's effective arrival — now with `arrival_basis` (native, backdated, import, tracker, legacy), `arrival_precision` (exact, date = 00:00 Kuala Lumpur, unknown for legacy) and a separate immutable `recorded_at`. For every writer: no future arrival; a native arrival is within 5 minutes of recording; a correction can never place the arrival after a recorded response, reply, qualification, logged activity or showroom visit. `api.work_inquiry`'s existing check (an event cannot precede `created_at`) therefore keeps comparing against the effective arrival, and a response time cannot be negative. Corrections go through `api.set_inquiry_arrival` (basis + reason, history note, idempotent). `api.report_lead_source` excludes date-only arrivals from the median and never measures a negative duration. Legacy rows keep a "Historical" label and stay editable; re-dating one requires a basis.

## Surfaces

- Inquiry drawer and opportunity drawer: **Classification** section (values with hints, state/basis pills, held conflict, flagged note, arrival line with "Correct arrival", classification history). Inquiry **More → Qualify…** opens the qualification dialog (replaces the direct-update "Mark as qualified").
- New inquiry: optional "Arrived earlier" (backdated) and classification fields (default Unknown).
- New project / opportunity: classification for the new opportunity, saved via `classify_pursuit` after creation.
- **Classification Review** (`/sales/classification-review`, user menu → Platform, beside Identity Review): conflicts, flagged gaps, and pursuits past qualification not fully classified (includes historical records). Rows link to the inquiry drawer or the opportunity drawer.
- Report **Pursuits by buyer role and project segment** (`api.report_pursuit_segments`, day/week/month on the Kuala Lumpur calendar, Monday weeks).
- Help & glossary: inquiry arrival, every dimension, state and basis.

## Imports

- `scripts/import/daily-tracker.mts`: customer type maps through the shared taxonomy; an unrecognised spelling stays Unknown (not "other") and the sheet wording is kept in the visit notes. A visit that starts a new inquiry gets a date-only `tracker` arrival via `api.set_inquiry_arrival`; an existing inquiry keeps its own arrival (the old script overwrote it).
- `scripts/import/tiktok-leads.mts`: imported arrival (`import`, exact) instead of a bare `created_at` write; "who are you" / "this project is" answers map through the taxonomy, Unknown when unrecognised, raw answers kept.
- In-app walk-in workbook import maps customer type the same way and keeps the sheet wording in notes.

## Backfill (reviewed, not applied anywhere hosted)

`20261029160002`: `api.preview_classification_backfill()` (settings.manage) reconciles each pursuit/dimension into known / already_set / conflicting / unmatched with its evidence; `api.apply_classification_backfill(p_expected_known, p_reason)` writes only `known` rows still Unknown, only when the reviewed count matches, with basis `backfill` and the evidence in history. A rerun writes nothing. Evidence: matched (non-legacy) visits; a contact's type only when that contact has exactly one pursuit; `segment` residential/commercial/hospitality/other; `project_type` residential/commercial/hospitality/renovation/new_build. `project_type = 'other'` (the old system default), `institutional` and `fnb` are never mapped. Running it against the hosted project needs its own authorisation.

## Migration order

1. `20261029160000_pursuit_classification.sql`
2. `20261029160001_inquiry_arrival.sql`
3. `20261029160002_classification_backfill.sql`

Additive and forward-only. Existing rows become `classification_basis = 'legacy'` / `arrival_basis = 'legacy'` through column defaults (no row rewrite triggers fire). `api.leads` and `api.opportunities` are recreated as `select *` to expose the new columns; `api.inbox_leads` is unchanged.

## Shared-file integration notes (for the coordinator)

Other active lanes: quotation/version sending, forecasts, loss outcomes.
- `src/lib/supabase/database.types.ts` — regenerated here; regenerate again after integrating any other lane's migrations.
- `src/features/pipeline/components/opportunity-drawer.tsx` — one import and one `<PursuitClassificationSection>` line above Quotes.
- `api.opportunities` recreated (`select *`). A later lane that adds opportunity columns must recreate it again; an earlier one is picked up automatically.
- `sales.opportunities` has new BEFORE/AFTER triggers (`classification_before/after`). Inserts that set `lead_id` inherit the inquiry's classification. They do not touch stage, status, value or quote columns.
- `api.create_manual_inquiry` and `api.report_lead_source` are redefined (inquiry lane, owned here). `api.opportunity_command`, `api.change_opportunity_stage`, `api.convert_lead`, `api.record_showroom_visit` are **not** redefined.
- Also touched: `src/features/reports/registry.ts`, `src/lib/domain/status-maps.ts`, `src/lib/domain/glossary.ts`, `src/lib/nav/routes.ts`, `src/features/crm/{schema.ts,components/dialogs.tsx}`.

## Verification (local, isolated stack, synthetic data)

Run on a local Supabase stack (`pnpm db:start` / `pnpm db:reset`; stop with `pnpm db:stop`) and `pnpm dev` with a local `.env.local` pointing at it:

- `pnpm lint` (0 errors; the existing data-table warning), `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `pnpm exec supabase test db` — includes `024_pursuit_classification.sql` (80) and `025_inquiry_arrival_and_backfill.sql` (51).
- Types drift: `supabase gen types typescript --local --schema api` equals the committed file.
- `pnpm exec playwright test tests/e2e/pursuit-classification.spec.ts` — creates its own rep, showroom and other-workspace users and its own customer, then: backdated inquiry with Unknowns → reload → qualification refused until flagged → Classification Review link → classify → correction with reason and history → convert (inherited) → showroom walk-in through the wizard creates a held conflict → counter staff cannot decide or see the rep's opportunity → owner resolves with reason → reload; another workspace sees nothing. It removes what it created.

Known limits: the Daily Tracker still stores the visit itself at noon Kuala Lumpur (visits have no precision column); the arrival of the inquiry it creates is date-only. `identity.projects.project_type` still mixes use and work type and is not used by the new report.

## TILE-86: per-workspace report reads (forward repair)

`20261029160003_report_workspace_reads.sql` rebinds `api.report_pursuit_segments` and `api.report_lead_source` to TILE-62's per-row rule, `workspace_id in (select core.permitted_workspace_ids('report.read'))`. Without it, a report reader in one workspace saw another workspace's aggregates. Ordered after TILE-62, a legitimate reader whose acting membership lacks report.read was refused. `160001` had also replaced TILE-62's per-row lead-source reader. The bodies are otherwise identical. Segmentation is still refused (42501) when no active membership grants report.read, and lead source still returns no rows then. The helper is created with TILE-62's identical body only where TILE-62 is absent.

Ordered integration is TILE-62 (`20261029000002`) → PR49 (`160000`–`160002`) → `160003`. Never re-run TILE-62 after PR49 to mask the regression.

Evidence:
- `supabase/tests/026_report_workspace_reads.sql`.
- `tests/integration/report-workspace-reads.mts`: normal sign-in and PostgREST, with synthetic fixtures removed to zero.
- `tests/e2e/report-workspace-reads.spec.ts`.

Separate PR49 finding, not changed here: in the ordered integration, TILE-62's suite test 178 fails on `sales.classification_events.member_read`. That PR49 policy pairs `member_workspace_ids()` with the acting-membership `core.has_permission('sales.read')`. Its TILE-62-shaped repair would be `workspace_id in (select core.permitted_workspace_ids('sales.read'))` in place of those two terms, keeping the lead/opportunity visibility subqueries.
