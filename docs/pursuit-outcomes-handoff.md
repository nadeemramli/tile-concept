# Pursuit outcomes: structured loss, rejection, deferral and reopen (TILE-8)

Implemented on `main` at `6c351c1`. Nothing hosted was changed: no hosted migration, data, backfill or deployment.

## What changed

- **One reason taxonomy** in `core.outcome_reasons` (lost / rejected / deferred), mirrored in `src/lib/domain/outcome-reasons.ts`. Unknown is an explicit choice in every set; Other always needs an explanation. The wording is the TILE-3 proposal and stays configurable (a migration adds, relabels or deactivates rows). A unit test reads the migration and fails if the SQL rows and the TypeScript list differ; a pgTAP test pins the same keys.
- **Append-only history** in `sales.pursuit_outcome_events`. One event per business outcome at the pursuit grain: an inquiry and the opportunity that closes with it are one event, so a linked closure counts once. Reopen and reason correction add rows; an update or delete is refused even for the table owner.
- **`api.pursuit_outcome_command(action, input, request_id)`**: `lose | reject | defer | reopen | correct`.
  - Loss needs a listed primary reason and an effective date (Kuala Lumpur business date, not in the future).
  - Qualification rejection (not buying, out of scope/area, spam, test, duplicate, Unknown, Other) is a separate outcome and never counts as a sales loss. A duplicate links its original or explains it.
  - Deferral needs a review date; a review reminder replaces outstanding reminders. Timing appears as a deferral reason ("Customer not ready yet") and as a genuine loss reason ("Timing: the award is gone"); staff choose.
  - Recording No response never closes anything; closing for silence is the explicit "Customer stopped responding" loss reason.
  - Outstanding reminders on the inquiry and its opportunity are cancelled with the reason, once, and kept.
  - Reopen needs a reason and a next follow-up (and a next action for an opportunity). The inquiry returns to its prior status; the opportunity to its prior stage (or a chosen open stage). The earlier event keeps its reason, actor, date and evidence.
  - Correction records a superseding reason with a note; reporting counts one outcome with the latest reason, and keeps the original.
  - Idempotent on `request_id`; a changed retry is refused. Locks inquiry before opportunity (same order as `api.work_inquiry`), so concurrent staff actions serialize and the second sees "already closed".
- **Values kept apart**: the latest quotation total is stored as *lost quoted value*; the opportunity estimate as *estimated value*, labelled "(not quoted)" when there is no quotation. They are never added together.
- **Competitor relationship is neutral and provisional.** A supplier name is optional (unnamed = Unknown). Relationship is `unknown | none_reported | reported`; "reported" needs a description and an evidence quality (`unverified | customer_stated | documented`) and is labelled provisional everywhere. Neither a mutual referral arrangement nor an existing customer relationship is asserted.
- **Guards instead of redefinitions.** Two triggers stop an authenticated caller from moving an inquiry into/out of a closed status, or an opportunity into/out of lost/deferred, except through the command. This retires the free-text `work_inquiry('lost'|'reopen')` path and the Lost/Deferred targets of `change_opportunity_stage` without redefining either function. Won and open-stage moves are unchanged.
- **Reporting read models**: `api.pursuit_outcome_history` (effective reason after corrections, Monday week of the effective date, reopen marker) and `api.report_pursuit_outcomes(from, to)` (per week × outcome × reason: events, distinct pursuits, reopened later, lost quoted value, lost estimated-unquoted value, value unknown, non-MYR). A reopen never removes an earlier week's outcome. Not yet on a report page (TILE-9/10 own that).
- **UI**: Inbox "Mark as lost" became **Close or defer…** (Lost / Rejected at qualification / Defer) and **Reopen inquiry** uses the same dialog; a deferred inquiry shows *Deferred until … · Resume now*. Pipeline drawer has **Close or defer…** and **Reopen**; choosing Lost or Deferred in the stage control opens the same form. Both drawers show the outcome history with **Correct reason**. Help & glossary lists outcomes, every reason, the relationship and evidence values, and "Lost quoted value vs estimated value".

## Acceptance criteria → evidence

| # | Criterion | Observable check |
| --- | --- | --- |
| 1 | Loss needs primary reason + effective date; Other needs explanation; Unknown explicit | pgTAP 024 "loss without a reason/effective date is refused", "Other without an explanation", "loss with explicit Unknown"; unit `schema.test.ts`; E2E test 1 (alerts, then Other + detail, then Unknown) |
| 2 | Rejection/spam/duplicate separate from loss; no response does not close | pgTAP "spam is a qualification rejection", "a loss reason is not a rejection reason", "duplicate needs its original", "repeated no response does not close the pursuit"; unit taxonomy test; E2E test 3 (spam) |
| 3 | Timing defers with review date or records genuine loss; staff choose | pgTAP "deferral needs a review date", "timing deferral", "a deferred pursuit can later record a genuine timing loss"; E2E test 3 |
| 4 | Linked closure counts once; reminders resolved; audited reopen/correction without deletion | pgTAP "one event closes the inquiry and its opportunity", "reminders on both records resolved", "reopen appends", "history cannot be rewritten/deleted", "every close is audited"; E2E test 2 |
| 5 | Quoted vs estimated-unquoted value labelled apart; competitor not asserted | pgTAP "latest quoted value and unquoted estimate are kept apart", report value columns; E2E test 2 ("Lost quoted value", "Supplier: Unknown (not named)", "Relationship: Unknown") |
| 6 | Inquiry + pipeline closure, defer/reopen, retry/concurrency, reload, role isolation | E2E tests 1–4 (dropped response then retry → one event; second tab refused; reload after each step; showroom disabled in UI; showroom and marketing refused by the API with 42501); pgTAP idempotency + role/cross-workspace/anon; two-session lock test (see Verification) |
| 7 | Picklists and help agree across inbox/pipeline/SQL; fixtures cover required fields, Unknown, Other, unnamed competitor | `outcome-reasons.test.ts` parses the migration rows; pgTAP `set_eq` on `api.outcome_reasons`; glossary test; fixtures in pgTAP 024 and the E2E spec |
| 8 | Reopen keeps prior loss event, reason, actor, evidence; current state active; weekly outcome kept | pgTAP "earlier loss keeps its reason, actor and effective date after reopen", "reopened loss still counts in its own week", "two loss events, one distinct pursuit"; E2E tests 1–2 |
| 9 | Friendly-competitor wording provisional; no referral/customer assertion | Taxonomy unit test (wording), relationship requires description + evidence (pgTAP), UI "provisional" pill and tip, glossary entry |

## Seams for integration

- **Forecasts (TILE-7)** may redefine `api.change_opportunity_stage`. This change does not touch it: the guard trigger refuses Lost/Deferred moves whatever the function body. If a later redefinition starts writing `status` to lost/deferred directly, it will be refused with the outcome-form message; route those through `api.pursuit_outcome_command`.
- **Quotations (TILE-5)**: lost quoted value reads the latest `sales.quotes` current version total on the opportunity. When quotes gain `lead_id`/sent events, revisit which version counts as "quoted".
- **Reports (TILE-9/10)**: consume `api.pursuit_outcome_history` / `api.report_pursuit_outcomes`; R6.1a = events, R6.1b = distinct `pursuit_key`, rejections are R1.2.
- `sales.leads.status = 'disqualified'` remains the closed-without-sale state; whether it is a loss or a rejection lives in the outcome event. Legacy closures from before this change have no event and appear as free text; reopening one records its old reason in the reopen event's `prior_state`.
- `deferred → won` now needs a reopen first, so the deferral stays in history.

## Migration order

1. `supabase/migrations/20261029163000_pursuit_outcomes.sql` (reserved TILE-8 namespace; after `20261016015608_catalog_upload_storage_read_access.sql`).

Forward-only, no backfill, no data change. Generated types are regenerated in this branch (`src/lib/supabase/database.types.ts`; additions only).

## Isolated local verification

Synthetic data only. The local stack is disposable.

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm exec supabase start -x vector,logflare,imgproxy,edge-runtime,studio
```

```bash
pnpm lint && pnpm typecheck && pnpm test
```

```bash
pnpm exec supabase test db
```

```bash
eval "$(pnpm exec supabase status -o env)" && NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_SECRET_KEY=$SECRET_KEY NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_APP_MODE=demo pnpm build
```

```bash
eval "$(pnpm exec supabase status -o env)" && NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_SECRET_KEY=$SECRET_KEY NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_APP_MODE=demo pnpm exec next start -p 3000
```

In a second terminal:

```bash
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test pursuit-outcomes --reporter=list
```

Stop the app with Ctrl-C, then:

```bash
pnpm exec supabase stop --no-backup
```

The E2E spec creates its own workspace, stages and three users per run (sales rep, showroom, marketing coordinator) and never signs anyone out globally. Outcome history is append-only, so each run's synthetic workspace stays until `pnpm db:reset`.
