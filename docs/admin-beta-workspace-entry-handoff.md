# Admin beta — workspace entry handoff (TILE-32)

Read this before extending the Admin System. Mechanics are in
`docs/architecture/Workspace Entry.md`.

## Current authority

- **Product:** the Obsidian vault PRD **v0.6** and the owner's explicit
  development request for the additive Admin beta. The repo PRD snapshot
  (`docs/prd/…`) is older. Where its v1 non-goals say no delivery-route or
  warehouse-management functionality (§3.3) and "not a mobile-first warehouse
  application" (§12.2), **v0.6 supersedes them for the Admin
  beta**: mobile driver and warehouse entry are in scope.
- **Permissions:** the database. `core.role_permissions` decides; the UI mirror
  is `src/lib/rbac/matrix.ts`. Navigation and remembered choices never grant.

## Boundaries that still hold

- **One tenant.** Operating System and Admin System are navigation areas of the
  *same* workspace and dataset — not separate tenants, not duplicated data.
- **No approval creep.** Management and the demo guest gained only the entry
  keys (`workspace.*`, `overview.read`, `admin.coordinate`, `preparation.read`,
  guest also `delivery.read_own`). Do not add stock posting, accounting,
  settings/user management or other approval rights to management, and do not
  widen the guest beyond its existing "everything except `settings.manage`".
- **Business admin ≠ platform admin.** `business_admin` has no
  `settings.manage`, no sales or customer access.
- **Drivers and warehouse** get their own queue only; no sales, customer or
  catalogue permissions.
- **Placeholders stay honest.** Preparation, delivery schedule and My Deliveries
  are "not built" with no numbers. No scheduling, routing/fleet optimisation,
  stock posting or accounting ledger has been built; each needs its own issue.
- **Not in TILE-32:** sync RPC guards and freshness (queued as TILE-59).
- **TILE-62:** cross-membership permission borrowing is closed; see below.

## Membership scope (read before touching auth)

A permission held in one workspace never authorizes another (TILE-62,
`supabase/migrations/20261029000002_workspace_permission_scope.sql`). Until then
`core.has_permission` and `api.my_permissions()` ORed every active membership,
so a driver here who was an admin elsewhere read 30 leads and 41 contacts here
and could write them.

| Path | Membership that decides | How |
| --- | --- | --- |
| RLS on every table, view and storage object | the row's own workspace | `workspace_id in (select core.permitted_workspace_ids(perm))` — an uncorrelated set, evaluated once per statement |
| Cross-workspace readers (`report_*`, `entity_timeline`, `lead_followup_rollup`) | the row's own workspace | same predicate |
| Commands (SECURITY DEFINER RPCs) | the acting membership | `core.has_permission` / `core.require_permission` read the acting membership; `core.require_workspace` admits only the acting workspace |
| Session mirror (`getSession`, nav, page gates) | the acting membership | `api.my_workspace_permissions()`; `api.my_permissions()` now returns the same |
| Workspace entry, remembered default | the acting membership | unchanged from TILE-32 |

The acting membership is `core.current_workspace_id()`: the oldest active one,
ties broken by workspace id; `api.my_membership()` uses the same function, so
the session and the database always act in the same workspace.

Consequences, tested in `supabase/tests/025_workspace_permission_scope.sql`:

- Driver / warehouse / analyst / suspended / no membership in A plus admin or
  manager in B (either order): no A sales, customer, contact-point, audit or
  invite rows; no A reveal, search, timeline, summary, insert, update, delete,
  assign, merge, stage change, invite, role change or shared view; A is
  unchanged afterwards.
- Legitimate: each membership still reads and writes its own workspace's rows
  (a rep in A and B sees both inboxes; an analyst in A gets A's masked reports).
  Commands run in the acting workspace only — a member of two workspaces cannot
  run, say, `reveal_contact_points` on a B contact while acting in A. There is
  no tenant selector, so the app never offers that.
- Service-role tooling still bypasses RLS and holds no member permissions.
- Guards: no policy may call `core.has_permission(` and no function may pair
  `member_workspace_ids` with `has_permission(`; the migration aborts and 025
  fails if one does. New policies use `core.permitted_workspace_ids(perm)`.

`core.member_workspace_ids()` is unchanged: it still means "workspaces this
person belongs to" for profiles, memberships, preferences and reference rows.

## Not applied anywhere hosted

Migration `20261029000001_workspace_entry.sql` has run only on local and CI
stacks. Applying it to the hosted project is the owner's decision.
