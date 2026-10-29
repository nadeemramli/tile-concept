# Walk-in collections by person and by period

The walk-in report (`Walk-ins and purchases`) grouped everything by location, so a reader could see the total collected but not whose sale it was, nor compare one week with the next. Two new governed reports under **Insights → Reports** answer both questions from one database function. Nothing about the existing report changed.

## What a reader sees

- **Walk-in collections by person** — one row per person per day (switchable to week or month). *Visits served* and *New customers* follow the staff member who served the visit (the Daily Tracker SMP). *Sales closed*, *Document total*, *Collections* and *Awaiting review* follow the salesperson recorded on the sale, which is who closed it. The two can legitimately differ on one row: Raj serves the visit, Aiman closes the sale. A sale with no person recorded appears as **Unassigned**; the visit's staff member is never copied onto it.
- **Walk-in collections by period** — one row per week by default, switchable to day or month, with a chart of reviewed collections against document totals. Weeks run Monday to Sunday.
- Both reports have a **Daily / Weekly / Monthly** toggle beside the date range, every column carries an ⓘ hint, and the CSV export carries the grain in its file name.

## Definitions

- **Collections** are payments with `review_state = 'confirmed'`, net of cash refunds, dated by `paid_at`. A legacy payment without a time is dated by its purchase. A sale paid in a later week shows its collection in that later week, so Collections and Document total are not expected to match row by row.
- **Awaiting review** counts payments in the period that are not yet confirmed. They are shown, never summed into Collections and never dropped.
- **Document total** is the historical `sales.purchases.amount`, including unclassified records, so it agrees with the existing walk-in report. Voided and draft documents are not sales.
- **Walk-in scope** is a purchase linked to a visit or recorded with `purchase_source = 'walk_in'`.
- All buckets and range boundaries are Kuala Lumpur calendar days: a visit at 17:00 UTC on a Sunday belongs to Monday and to the week that starts there.
- Definitions are registered in `reporting.metric_definitions` under `walkin_person` and `walkin_period`, so the governance header above each report describes them.

## Data and permissions

- Apply `supabase/migrations/20261004000001_walkin_collection_reports.sql` to the hosted project **before** deploying this app version; the two report pages call `api.report_walkin_collections` and fail without it, exactly as the funnel page did in September.
- The function is `security definer`, requires `report.read` (sales representatives, sales managers, management, analysts, administrators) and scopes rows to the caller's workspaces. It names staff, not customers, so its PII class stays aggregate.
- Date filters on every governed report now reach the server (`shallow: false`). Previously the URL changed but the rows did not.

## Verification

- `pnpm typecheck`, `pnpm lint` (zero errors, the one pre-existing TanStack warning) and `pnpm test` (220 unit tests, including new tests for the registry and period formatting) pass.
- The function body was executed in a throwaway PostgreSQL 16 against stub tables carrying the real column shapes and the fixtures from `supabase/tests/022_walkin_collection_reports.sql`; every expected figure in that suite was produced, including the Kuala Lumpur week boundary and the three refusals. The pgTAP suite itself has **not** been run here: this environment has no Docker, so `supabase start` was unavailable. Run `supabase db reset` and the test suites on a local stack before release.
