# Weekly forecast review and exception queues (TILE-7)

Agent first pass on `claude/busy-hopper-wwqrib`, from `main` at `6c351c1`. No hosted migration, data change, backfill or deployment has been made. Owner acceptance is separate.

## What changed

- **Weekly forecast** at `/sales/pipeline/forecast` (button on Pipeline; no new sidebar item). The selected Monday-to-Sunday Kuala Lumpur week is primary: open, unarchived work whose expected close date falls in it, however old the opportunity is. Won, lost, deferred and archived work dated in the week is excluded and counted separately.
- **Likelihood cards** (High, Medium, Low, Unknown) show counts and the plain sum of known values per currency, with unknown values counted rather than treated as zero. No probability weight exists anywhere. **Confirmed net sales** for the week (F3 sale events) sit beside them, labelled as not part of the forecast.
- **Exception queues** over all active work in scope: no close date, no likelihood, close date passed, stale review (threshold 7/14/30 days, default 14, a review prompt and not a business rule), never reviewed, no value. Dates are never rolled forward: a passed date stays as it was until someone reviews it.
- **Review** (page row or opportunity drawer): expected close date, likelihood band, estimated value and currency, evidence, next step and due time. A blank field is saved as unknown. The review time and actor persist on the opportunity, and each review is appended to history. A stale form is refused with a refresh conflict.
- **Current vs. as recorded.** Current applies today's forecast to any selected week. *As recorded at week end* rebuilds the forecast from history as it stood at Sunday 23:59 Kuala Lumpur (or now, for the current week), so later corrections do not change it. The page states which view is shown, its as-of time and its population.
- **Next four weeks by expected close** is a secondary table with its own definition. The selected week stays primary. No stage-based alternative was added.
- **Forecast at creation, quote follow-up and stage change.** New opportunity, Quote version and Stage dialogs have an optional Forecast fieldset. It is saved as a review *after* the main command commits, so a forecast problem can never block or undo an opportunity, a stage move, or a quotation that was actually sent. A failed forecast is reported in the success message and the work stays in the queues.
- **No stage requires a forecast.** Legacy and unforecast work is listed in the queues; nothing is filled in for it.
- Help & glossary gains Forecast likelihood, Forecast review lists and Forecast history, generated from the status maps.

## Data and security contract

Migration `supabase/migrations/20261029162000_forecast_review.sql` (one file, reserved TILE-7 namespace):

- `sales.opportunities` adds `forecast_evidence`, `forecast_reviewed_at` and `forecast_reviewed_by`. `api.opportunities` is re-created to expose them.
- `sales.opportunity_forecast_history` is append-only (trigger refuses update/delete except when the opportunity or workspace itself is deleted). An `AFTER INSERT OR UPDATE` trigger on `sales.opportunities` records every change to status, stage, archive, owner, close date, band, value, currency, evidence, next step or review, whichever command made it. Rows written by `api.review_opportunity_forecast` are marked `review` with their context (`review | create | quote | stage`); others are `change`. RLS makes a history row readable exactly when its opportunity is readable. It is exposed as the `api.opportunity_forecast_history` view, with no direct writes.
- **The migration writes one `baseline` history row per existing opportunity** (its state at apply time). This is the only data-writing statement. Before that instant, an opportunity is reported as *Not recorded*; nothing is guessed.
- `api.review_opportunity_forecast(id, input, request_id)` is SECURITY DEFINER. It requires `sales.write` and the owner or `sales.read_all` rule, checks the record version, is idempotent on the request id, and refuses closed and archived work. Present keys are applied (null means unknown) and absent keys are unchanged. A stated close date must be today or later in Kuala Lumpur. It writes an activity and an audit event.
- The read functions `api.forecast_rows`, `api.forecast_window`, `api.forecast_week` and `api.forecast_queue` are SECURITY INVOKER and require `sales.read`. Counts and pages are computed in SQL over the caller's whole RLS scope, with no client-side row limit. Queue pages are 1–200 rows and carry the complete `total_count`.
- Integration seam with the loss/defer/reopen worker: `api.change_opportunity_stage` and `api.opportunity_command` are **not modified**. Whatever those commands do to status, stage or forecast fields is captured by the history trigger, and closed or reopened work leaves or re-enters the active forecast by `status`.

## Criterion map

| # | Criterion | Observable check |
|---|---|---|
| 1 | Review/update date, likelihood, value, evidence, next step; timestamp/actor persist | pgTAP `024` "reviewed fields persist", "review actor persists", "review time persists", "review is recorded in history"; E2E test 1 review → reload shows Medium, RM 2,500.00 and the reviewer's name |
| 2 | Older lead closing this week appears; won/lost/deferred/archived excluded | pgTAP "a pursuit created long ago appears…", "won, lost, deferred and archived work is not in the active forecast", "excluded work is counted separately"; E2E test 1 (created 2025 row visible; won row absent; "1 won") |
| 3 | Missing dates/bands and stale/overdue in queues; no automatic roll-forward | pgTAP queue counts, "passed close date is queued with its original date", "reading the forecast never rolls a date forward", stale threshold tests; E2E test 1 ("5 Jan 2026" in Close date passed; unforecast row in No close date) |
| 4 | Band counts and unweighted values distinct from confirmed sales; no weights | pgTAP "bands carry unweighted sums per currency…", "no probability weight…", "confirmed net sales are listed separately", "a confirmed sale does not change forecast values" |
| 5 | Declared current vs historical behaviour; complete scoped populations | pgTAP recorded-week tests, "current view applies today's state…", 2,105-row tests; E2E test 2 (As recorded shows the history row and disables Review; Current hides it); declaration strip asserted |
| 6 | Week/date boundaries, >2,000 rows, correction/reload, role visibility | pgTAP Sunday 23:59:59 / Monday 00:00 local, 2,105 rows (counts, bands, values, last page, stable paging), correction vs recorded view, showroom/catalog/manager/anon; unit `week.test.ts`; E2E tests 1, 4, 5 |
| 7 | Enrichment at creation/quote/stage; unforecast work queued | Optional Forecast fieldset in the three dialogs; E2E test 3 (quote without forecast stays queued; stage change captures Low + date); pgTAP "quoted but unforecast work stays in the review queue" |
| 8 | Selected-week view primary; alternatives carry distinct definitions | Page order and copy; "Next four weeks by expected close" with its own ⓘ definition; pgTAP next-four-weeks assertion |
| 9 | Stage requirement has legacy/unknown pathway and cannot block a sent quotation | No stage requirement added; pgTAP "a quotation stage can be entered without a forecast", "a sent quotation is recorded without a forecast"; E2E test 3 |

## Verification (local, this branch)

Environment: Node 24.22.2, pnpm 11.16.0, Postgres 17.6 (`supabase/postgres:17.6.1.159`), GoTrue `supabase/auth:v2.195.0`, PostgREST v16.1, storage-api v1.69.11, Chromium from `/opt/pw-browsers`.

- `pnpm typecheck`: pass. `pnpm lint`: 0 errors, plus the existing TanStack React Compiler warning. `pnpm test`: 36 files, 269 tests passed. `pnpm build`: pass; the route `/sales/pipeline/forecast` is built.
- pgTAP: all 26 files pass, including `024_forecast_review.sql` with 85 assertions.
- Types: `supabase gen types … --schema api` matches the committed `database.types.ts`, and the diff from `main` only adds.
- Browser, compiled app (`next build && next start`) against the local stack: `forecast-review.spec.ts` 5/5. Existing `smoke.spec.ts` and `guest.spec.ts` pass 93/93 before the route was added to the smoke list, and both new route-smoke entries pass. After the suite, no synthetic users, opportunities, companies or memberships were left behind.
- Failed attempts, kept for the record:
  1. `playwright test` could not launch because the pinned browser build was missing in the sandbox. Re-run with an uncommitted config that sets `executablePath: /opt/pw-browsers/chromium`.
  2. A label lookup was ambiguous: "Expected close" also matched the ⓘ button "About Expected close". Lookups are now exact.
  3. Required labels render as "Next step *", so exact matching failed. Fixed with anchored patterns.
- Sandbox limits: the Supabase CLI could not pull its full image set. ECR returned "Data limit exceeded", Docker Hub returned 429, and the proxy refused ghcr blob downloads. The stack above was therefore assembled from individually pulled images, with a small local gateway standing in for Kong. Every test was then run against that stack. The baseline run on unmodified `main` only failed where seed files were missing, and the full run with all four seeds passes. CI's `database` and `e2e` jobs use the standard `supabase start` and are the authoritative runs.

## Run it locally

```bash
pnpm install --frozen-lockfile
pnpm db:start            # or: pnpm exec supabase start -x vector,logflare,imgproxy,edge-runtime,studio
pnpm exec supabase test db
eval "$(pnpm exec supabase status -o env)"
NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_SECRET_KEY=$SECRET_KEY \
  NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_APP_MODE=demo pnpm build
NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_SECRET_KEY=$SECRET_KEY \
  NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_APP_MODE=demo pnpm exec next start -p 3000 &
NEXT_PUBLIC_SUPABASE_URL=$API_URL SUPABASE_SECRET_KEY=$SECRET_KEY E2E_BASE_URL=http://localhost:3000 \
  pnpm exec playwright test tests/e2e/forecast-review.spec.ts
pnpm db:stop
```

The browser suite creates its own users (`e2e.forecast.<random>.*@tileconcept.test`), company and opportunities in the local seeded workspace, and signs each one in within its own browser context, with no global sign-out. It deletes everything afterwards. `E2E_DB_CONTAINER` overrides the database container name (default `supabase_db_tile-concept`). The suite refuses any non-local Supabase URL.

## Staff QC (synthetic data, local or preview)

1. Pipeline → **Weekly forecast**. Check the week label, the *Current* declaration and the population count.
2. Open **No close date**, choose **Review** on a row, and state a date this week, a likelihood, a value, evidence and the next step. Save and reload. The row is now in *Closing this week* with your name under Last review.
3. Review the same row again with a different likelihood. Under *As recorded at week end* for an earlier week, the earlier state is unchanged.
4. Issue a quote with the Forecast fields blank. The quote saves and the opportunity stays in the queues. Move its stage with a likelihood filled in, and the forecast is saved.
5. As showroom staff, another salesperson's forecast is not visible. As a catalog role, the page is refused.

## Open decisions for the business

- The default stale-review threshold is 14 days, which is a prompt and not a policy. The page offers 7, 14 and 30.
- Bands carry no weights, and none should be introduced without an accepted definition (PRD §3.2).
- Whether *As recorded* should snapshot at another cut-off, such as the Monday sales meeting, instead of Sunday 23:59.
