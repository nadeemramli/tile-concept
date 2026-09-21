# Hot-path performance: merge and hosted rollout

Recorded from a Claude Code cloud session on 2026-09-21, after the local session
that authored `perf/inbox-drawer-and-shell` lost its Remote Control bridge. The
local worktree has no knowledge of anything below. Read this before continuing
there, and `git pull` `main` first.

## What shipped

PR #11 (`perf/inbox-drawer-and-shell`) is merged into `main` as `6ea151f`. The
branch was one commit (`00b581c`) behind three commits of `main`; the base was
merged in first as `4e7f27f`, so the merge carries both.

All four checks passed on `4e7f27f` before the merge: `verify`, `database`,
`e2e`, and the Vercel preview deployment. The cloud session also re-ran the
suite independently against `main` merged into the branch: `pnpm typecheck`
clean, `pnpm lint` 0 errors (the pre-existing TanStack Table / React Compiler
warning in `data-table.tsx` remains), `pnpm test` 170/170, `pnpm build` succeeds.

## Hosted database

`supabase/migrations/20260921120000_hot_path_performance.sql` **has been applied
to the hosted project `ewyiiematuuojlhpioqh`.** Do not apply it again by hand.

Verified against the hosted database after the apply:

| Check | Result |
| --- | --- |
| `core.lead_followup_rollup()` exists | yes |
| `api.inbox_leads` definition references the rollup | yes |
| `api` SECURITY DEFINER functions still executable by `anon` | 0 |
| New indexes present (of 7) | 7 |
| `core` helpers with `search_path` pinned (of 3) | 3 |

### Migration ledger mismatch — reconciled during Creative integration

The Supabase MCP apply originally recorded this migration as
`20260921064931`, rather than the repository's `20260921120000`.
On 21 September, Creative integration verified the stored SQL against the
repository file (trimmed-text MD5 `9d354133054ff9549a544e88e06338ae`), then
conditionally updated only that history row to `20260921120000`. The update
checked the old version, name, matching SQL hash and absence of the new version.
It returned the expected single row. No migration SQL or business data was
reapplied.

The exact separately hosted sales-role grant was also captured as repository
migration `20260921073229_sales_rep_review_and_reports.sql`. A subsequent
linked dry run succeeded and listed only the two pending Creative migrations.
Its interaction with existing ownership checks is documented in
`creative-production-handoff.md`; the grant's intended edit policy still needs
resolution before the final release checks can pass.

`src/lib/supabase/database.types.ts` was **not** regenerated, and does not need
to be: `api.inbox_leads` keeps its columns and `api.entity_timeline` keeps its
signature.

### Not re-checked

The Supabase security advisors were not re-read after the apply — the tool call
was blocked in that session. The 55 `anon`-executable SECURITY DEFINER findings
are confirmed cleared by the direct query above, but the advisor list itself
should be re-read to confirm nothing else moved. The items PR #11 deliberately
left open (282 unindexed foreign keys, 44 overlapping permissive SELECT
policies, `pg_stat_statements`, the two Auth dashboard settings) are untouched.

## `fix/shared-enquiry-inbox-access` is dead — do not merge it

This branch is fully superseded. Its work landed on `main` on 2026-09-04 as
commit `6e96ab7` via PR #6, under the same title. The migration
`20260904074501_shared_enquiry_inbox_access.sql` is byte-identical on both, and
`main`'s `src/lib/rbac/matrix.ts` wires `sales.leads.read_all` through admin,
management, sales_manager, sales_rep, showroom and guest — more completely than
the branch, which only added the constant and one explainer.

The branch is 25 commits behind `main`. Merging it would revert roughly 14,777
lines: 12 migrations plus the feedback feature, inbox-live, opportunity
workflow, walk-in linkage and marketing funnels. It is a leftover pre-squash
branch and should be deleted, not merged or rebased.

## Why the app was slow

For context when the client feedback comes up again — the dominant cause was not
application code. The Supabase project is in Seoul (`ap-northeast-2`) while
Vercel functions ran in the default `iad1`, so each of the 8-13 PostgREST/GoTrue
round trips per render crossed the Pacific (~230 ms for trivial selects,
~635 ms for `command_centre_summary`). `vercel.json` now pins functions to
`icn1`; that one file affects every page, not only the Enquiry Box.
