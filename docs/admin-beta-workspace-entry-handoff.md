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

## Membership scope (read before touching auth)

`core.has_permission(perm)` and `api.my_permissions()` OR across **every**
active membership. Workspace entry does not rely on them:

- `api.set_default_area` checks `core.has_permission_in(acting workspace, …)`.
- `api.my_workspace_permissions()` returns the acting membership's permissions;
  `getSession()` takes the six entry keys from it (`scopeEntryPermissions`).
- Tested both ways (driver here / sales rep elsewhere, and the reverse) in
  `supabase/tests/024_workspace_entry.sql` and `tests/e2e/workspace-entry.spec.ts`.

**Known pre-existing gap, not fixed here:** table RLS and every other permission
key still use the aggregated `core.has_permission`. A member who is a driver in
this workspace and holds a sales role in *another* workspace can read this
workspace's sales records (reproduced locally: 30 leads). It is pinned as a pgTAP
`TODO` in 024, so it will show up when fixed. It matters only once someone holds
memberships in two workspaces (the guest trigger already forbids that for
guests). The fix is to scope RLS/RPC checks with `core.has_permission_in(row
workspace, …)`. That is a cross-cutting authorization change and needs its own
issue and review.

## Not applied anywhere hosted

Migration `20261029000001_workspace_entry.sql` has run only on local and CI
stacks. Applying it to the hosted project is the owner's decision.
