# Projects follow-up time cells through hydration — TILE-90 handoff

Stacked on `codex/tile-1-guest-denial-qc` at `0b35f865602bf77052c14e4e6ed2425915b7b8b3` (draft PR 50). Local and CI evidence only: no hosted migration, data change or deployment.

## Defect

On `/sales/projects`, the **Next follow-up** due time and **Last followed up** cells called `formatRelative`, which reads `Date.now()`. The server rendered "51 seconds ago"; if the browser hydrated a second later it rendered "52 seconds ago", and React reported a hydration mismatch and regenerated the tree. Independent CI at `e519c09` logged exactly this (server 51 s / client 52 s, `projects-table.tsx:49`) while its route checks stayed green.

## Repair

- `src/app/(app)/sales/projects/page.tsx` passes the server's request time, `renderedAt={new Date().toISOString()}`.
- `src/features/crm/follow-up-time.ts`, scoped to Projects:
  - `followUpRelative(value, now)` measures from an explicit reference time, with the same wording as `formatRelative`: "just now", "51 seconds ago", "in 3 hours", and "—" for a missing or unparseable value.
  - `useFollowUpClock(renderedAt)` returns the server time until mount, then the browser clock on the first animation frame and every 30 seconds after that.
- `src/features/crm/components/projects-table.tsx`:
  - The two cells render `<FollowUpTime>`, which reads that clock from context. The column definitions and their memo dependencies are unchanged.
  - A tick re-renders only the time text. Changing the columns instead would remount every cell, including the claim button and its pending state and request ID.

Not changed: `formatRelative`, the other `format.ts` helpers, the Projects query, the `project_command` SQL, registration/claim/follow-up/assign commands, permissions, filters, versions, wording, placeholders ("—", "Not yet") and the detail page.

## Evidence

- `src/features/crm/components/projects-table.hydration.test.tsx` renders the real `ProjectsView`, `DataTable` and formatter to HTML at the server time and hydrates them at a different client time.
  - Mocked boundaries: navigation, query state, session, dialogs, the claim command (a stand-in button) and the explanation tooltips.
  - On the unchanged `0b35` source it fails 8 tests. Six "Hydration failed" errors are reported, each cell fails on its own at 51 → 52 s, and the -5 s, +2 min and +1 day skews fail.
  - Three controls pass on the unchanged source: equal clocks, missing dates and unparseable dates.
  - On the repair all 11 pass, covering the live update after mount, the 30-second refresh, timer cleanup and that no cell or claim button is remounted by a tick.
  - Two throwaway mutations are caught: starting from the browser clock instead of `renderedAt` fails 6, and dropping the post-mount ticks fails 8.
- `src/features/crm/follow-up-time.test.ts` checks the wording against `formatRelative` on both sides of every unit boundary, plus the explicit reference time and the dash.
- `tests/e2e/project-follow-up-hydration.spec.ts` runs against a compiled app and the local stack, with synthetic users and projects, cleanup asserted, and a fail on any console or page error. It covers:
  - register, claim from the list, and record a follow-up with next action and due time, checked in the database;
  - My follow-ups / Unassigned filters, reload, and a teammate's follow-up that keeps the handler;
  - a role without `projects.follow_up` (no claim button, Log follow-up disabled, database 403);
  - the foreign workspace (not listed, not-found page, database refusal) and an account with no membership;
  - a browser clock 10 minutes ahead or behind, with the live text and a 30-second refresh that updates the same node.

## Limits

- In this environment the streamed `/sales/projects` page did not reproduce CI's mismatch in a real browser, even on the original build. That held in production and `next dev`, with Playwright's clock and with a `Date` offset shim: no error was reported on either build. So the browser spec is not a discriminating hydration control. It does discriminate the live refresh: the original build fails the 30-second refresh check (its text never updates after mount).
- The component test is the reproduction of the mismatch, with the mocked boundaries listed above, and does not recreate whole-browser timing. The original CI browser log is the root's evidence and is not re-run here.
- On this base, a signed-in account with no membership is bounced between `/login?reason=no-membership` and `/`. That is pre-existing and outside TILE-90; the spec only asserts it never reaches the list and the database refuses it.
- A missing project id renders Next's not-found page inside a 200 response, because the route streams behind `loading.tsx`. That is also pre-existing.
