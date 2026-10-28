-- TILE-32: one shared sign-in, two workspace areas, role-appropriate landing.
--
-- Tile Concept has one business and one dataset. The app now presents it as two
-- areas of the same workspace, not two tenants:
--
--   operating  the existing sales / showroom / marketing / catalogue UI
--   admin      business administration: order preparation and deliveries
--
-- Which areas a person may enter is an ordinary permission in
-- core.role_permissions, so the database stays the authority. Choosing an area
-- or remembering a default is a preference and never grants anything: the
-- stored value is ignored by the app unless the permission still holds, and
-- api.set_default_area refuses an area the caller cannot enter.
--
-- The new roles are additive. A business administration employee
-- (business_admin) is not a platform administrator (admin): it carries no
-- settings.manage, no user management and no sales/customer access. Drivers and
-- warehouse staff get only their own admin-area queue. Management gains the
-- ability to browse both areas and nothing that approves or posts: no
-- stock.write, purchase.correct, price.publish, review.approve, settings.manage
-- or marketing.spend.review is added to any existing role here.

------------------------------------------------------------------------------
-- 1. Roles
------------------------------------------------------------------------------
insert into core.roles (key, label, description, rank) values
  ('business_admin', 'Admin employee', 'Business administration: order preparation and delivery coordination. Not a platform administrator; no user management or sales access.', 75),
  ('warehouse', 'Warehouse staff', 'Prepares orders for collection and delivery. Admin System only.', 80),
  ('driver', 'Delivery driver', 'Sees deliveries assigned to them. Admin System only; no sales or customer records.', 85)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 2. Permissions (mirrored in src/lib/rbac/matrix.ts)
--
--   workspace.operating  enter the Operating System
--   workspace.admin      enter the Admin System
--   overview.read        land on and open the Management Overview
--   admin.coordinate     open the Admin System hub with every admin queue
--   preparation.read     see the warehouse preparation queue
--   delivery.read_own    see deliveries assigned to you (My Deliveries)
------------------------------------------------------------------------------
insert into core.role_permissions (role_key, permission)
select v.role_key, p.permission
from (values
  ('admin',                 array['workspace.operating','workspace.admin','admin.coordinate','preparation.read','delivery.read_own']),
  ('management',            array['workspace.operating','workspace.admin','overview.read','admin.coordinate','preparation.read']),
  ('sales_manager',         array['workspace.operating']),
  ('sales_rep',             array['workspace.operating']),
  ('showroom',              array['workspace.operating']),
  ('marketing_coordinator', array['workspace.operating']),
  ('catalog_pricing',       array['workspace.operating']),
  ('stock_coordinator',     array['workspace.operating']),
  ('analyst',               array['workspace.operating']),
  ('business_admin',        array['workspace.admin','admin.coordinate','preparation.read']),
  ('warehouse',             array['workspace.admin','preparation.read']),
  ('driver',                array['workspace.admin','delivery.read_own']),
  -- The demo guest keeps "every permission except settings.manage".
  ('guest',                 array['workspace.operating','workspace.admin','overview.read','admin.coordinate','preparation.read','delivery.read_own'])
) as v(role_key, perms)
join core.roles r on r.key = v.role_key
cross join lateral unnest(v.perms) as p(permission)
on conflict (role_key, permission) do nothing;

------------------------------------------------------------------------------
-- 3. Remembered default area (a preference, never an entitlement)
------------------------------------------------------------------------------
create table core.user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  default_area text check (default_area in ('operating','admin')),
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id)
);
comment on table core.user_preferences is
  'Per-member UI preferences. default_area is only honoured while the member still holds workspace.<area>; it grants nothing.';

alter table core.user_preferences enable row level security;
-- Read your own row in a workspace you belong to. There are deliberately no
-- insert/update/delete policies: writes go through api.set_default_area, which
-- checks the area against the caller's permissions.
create policy user_preferences_select_own on core.user_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select core.member_workspace_ids()));
grant select on core.user_preferences to authenticated;
grant all on core.user_preferences to service_role;

create view api.user_preferences with (security_invoker = true) as
  select user_id, workspace_id, default_area, updated_at from core.user_preferences;
grant select on api.user_preferences to authenticated;
grant all on api.user_preferences to service_role;

create or replace function api.set_default_area(p_area text default null)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_ws uuid := core.current_workspace_id();
begin
  if v_me is null or v_ws is null then
    raise exception 'an active workspace membership is required' using errcode = '42501';
  end if;
  if p_area is not null and p_area not in ('operating','admin') then
    raise exception 'unknown workspace area: %', p_area using errcode = '22023';
  end if;
  -- Remembering an area is only allowed for an area the caller may already
  -- enter. This is what keeps a preference from ever acting as a grant.
  if p_area is not null and not core.has_permission('workspace.' || p_area) then
    raise exception 'permission denied: workspace.%', p_area using errcode = '42501';
  end if;

  insert into core.user_preferences (user_id, workspace_id, default_area, updated_at)
  values (v_me, v_ws, p_area, now())
  on conflict (user_id, workspace_id) do update set default_area = excluded.default_area, updated_at = excluded.updated_at;
  return p_area;
end $$;
revoke all on function api.set_default_area(text) from public;
grant execute on function api.set_default_area(text) to authenticated;
