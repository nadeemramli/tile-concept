# Tasks Due cell: stable through hydration (TILE-83)

Agent first pass on `codex/tile-83-tasks-due-hydration`, stacked on the reviewed PR 50 head `0b35f86` (`codex/tile-1-guest-denial-qc`). The 8 PR 50 commits and 28 paths below this branch are inherited and are not TILE-83 work. No hosted change, deployment or owner acceptance is claimed.

## The defect

`/sales/tasks` rendered the Due cell with `formatRelative(due_at)` and `isOverdue(due_at)`. Both read `Date.now()` during render, so the server HTML and the browser's hydration pass could disagree.

- **Text:** CI run 40872878683 (job 123444170298, commit `2aebc61`) failed on exactly this, moving from "2 minutes ago" to "3 minutes ago".
- **Overdue class:** near the due time the overdue class could also disagree. React does not patch a stale attribute after hydration, so a task that had just become overdue could stay unstyled.

## The fix

- `src/features/tasks/due.ts`:
  - `dueLabel(dueAt, now)` and `isDuePast(dueAt, now)` measure from an explicit reference time. Their wording matches `formatRelative` and their overdue rule matches `isOverdue`; `due.test.ts` checks this across every wording boundary.
  - `useDueClock(renderedAt)` returns the server's request time until mount, so the hydration pass reproduces the server HTML. After mount it follows the browser clock, refreshed every 30 seconds.
- `TasksClient` takes `renderedAt` from the page (`new Date().toISOString()` at request time) and uses these helpers for the Due cell.
- What stays the same:
  - The title is still the full absolute time from `formatDateTime`.
  - Overdue styling still applies to open tasks only.
  - Tasks with no due date still show "—".
  - View filters, counts, assignment and completion are untouched.
- What is not used or changed: `src/lib/format.ts`, the forecast code and every task, date and business rule. No `suppressHydrationWarning`, disabled SSR, frozen or empty value, or dropped column is involved.
- The reference-time pattern follows TILE-82 (PR 53 tree, `19f829c`, `contacts-table.tsx`). That change added a `now` parameter to the shared `formatRelative`; this repair keeps the logic inside Tasks so the global formatter stays as it is. No CRM code or history was imported.

## Evidence

| Check | Environment | Result |
|---|---|---|
| `tasks-client.hydration.test.tsx` (real `TasksClient`, `DataTable` and `format.ts`, server render then `hydrateRoot` with separate clocks) on the **original** source | cloud sandbox, jsdom | 6 failed, 4 passed (see below) |
| The same 10 controls on the repaired source | cloud sandbox, jsdom | 10/10 |
| `due.test.ts` (wording and overdue equivalence, the boundary at the exact due instant, unparseable input) | cloud sandbox | 35/35 |
| `pnpm test` | cloud sandbox | 36 files, 298/298 |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | cloud sandbox | pass / 0 errors (existing TanStack warning) / pass |
| pgTAP, all files | local stack | 27 files, 1,150 assertions passed |
| Generated types against the local stack | local stack | no drift |
| `tasks-due.spec.ts` against the compiled repaired app | local stack, Chromium | 4/4 |
| Full compiled e2e, all specs except `catalog-media` | local stack | 129 passed, 1 failed (inherited, environment; see below) |

The 6 controls that failed on the original source:
- the browser clock 1,000 ms ahead across the 2 → 3 minute boundary ("Hydration failed because the server rendered text didn't match")
- the due-time boundary ("…attributes … didn't match … won't be patched up")
- a browser clock 10 minutes ahead
- following the live clock after mount
- a done task past its due time
- a cancelled task past its due time

The 4 that passed on the original are the behaviour this repair must keep: the same-clock control, the absolute title, a later due date, and a missing due date.

`tasks-due.spec.ts` creates its own users (sales rep, showroom, catalog), tasks and a second workspace, and deletes them afterwards. It checks:
- the browser clock 10 minutes ahead: the server HTML reads "in 30 minutes", and after mount the cell reads "in 20 minutes" with no hydration error;
- the absolute title;
- overdue styling: open past-due tasks are red, done and cancelled ones are not;
- My work, Overdue and Done views;
- completion persisting across a reload;
- showroom scope, the other workspace's task never appearing, and the catalog role being refused.

Page errors and hydration console errors fail it, including the minified production hydration codes.

## Limits and failed attempts

- **Whole-app reproduction was not achieved.** The same browser spec **passed against the original source**, both compiled (`next start`) and under `next dev`.
  - A compiled-original probe confirmed the page clock really was 600 s ahead, and React reported no error.
  - A later probe on the original dev server found no Due cell in the document at its `interactive` state, and its first visible row read "3 days ago", which a 10-minute skew cannot change. So the browser runs never captured a server-HTML versus hydrated difference.
  - The controlled component test is therefore the reproduction of the CI failure, and the browser spec covers real navigation, persistence, roles and errors, not the timing failure. TILE-82 QC saw the same limit.
- **Failed and invalid attempts, kept:**
  1. The repaired-build run failed on a test selector: status pills also carry the `tnum` class. It now selects the Due span by its `title`.
  2. One original-source run was invalid: port 3001 was the local PostgREST, so the app never started.
  3. The original-source runs (compiled and dev) passed, as described above.
- **`shared-projects.spec.ts:142` (inherited from PR 50)** shells out to `pnpm exec supabase status`, which needs the CLI-managed container `supabase_db_tile-concept`. This sandbox could not pull the full Supabase CLI image set, so the stack was assembled from individual images and the test cannot find that container. `catalog-media.spec.ts` was excluded for the same reason and because ffmpeg is missing. CI runs both on the standard stack.
- The two CI attempts the packet names are preserved and not re-run by this work:
  - original CI on `2aebc61`: 105 passed, 1 Tasks failure;
  - the worker-requested rerun: job 123449733790.
- Due fixtures are relative to the test's own clock (one 30 minutes ahead, others 2 hours past). No `created_at` is altered.
