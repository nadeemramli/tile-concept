-- Tile Concept OS — foundation
-- Schemas, extensions, organization/access tables, helper functions, audit.
-- Conventions (PRD §10.3): uuid PKs, workspace_id on tenant rows, created/updated
-- actor + timestamps, append-only events, private schemas + narrow `api` schema.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists core;
create schema if not exists identity;
create schema if not exists sales;
create schema if not exists marketing;
create schema if not exists merch;
create schema if not exists stock;
create schema if not exists ingest;
create schema if not exists audit;
create schema if not exists reporting;
create schema if not exists api;

comment on schema core is 'Workspace, access, locations, reference data (private)';
comment on schema identity is 'Contacts, accounts, contact points, match/merge (private PII boundary)';
comment on schema sales is 'Intake, leads, opportunities, activities, quotes, purchases (private)';
comment on schema marketing is 'Content opportunities, media permission, shoot bookings (private)';
comment on schema merch is 'Brands, suppliers, products, variants, prices (private)';
comment on schema stock is 'Inventory sources, snapshots, supplier availability (private)';
comment on schema ingest is 'Source assets, jobs, extracted fields, review items (strict/private)';
comment on schema audit is 'Append-only audit events (strict/private)';
comment on schema api is 'Security-invoker views and functions exposed to the web client';
comment on schema reporting is 'Governed read models';

-- The web client (authenticated role) can only see the api schema.
grant usage on schema api to authenticated, service_role;
grant usage on schema core, identity, sales, marketing, merch, stock, ingest, audit, reporting to service_role;
-- Security-invoker views need the invoker to hold privileges on underlying tables.
-- Tables are still unreachable through PostgREST because these schemas are not exposed.
grant usage on schema core, identity, sales, marketing, merch, stock, audit to authenticated;

------------------------------------------------------------------------------
-- Generic helpers
------------------------------------------------------------------------------

create or replace function core.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if to_jsonb(new) ? 'version' then
    new.version = coalesce(old.version, 0) + 1;
  end if;
  return new;
end $$;

create or replace function core.normalize_text(input text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(extensions.unaccent(coalesce(input, '')), '\s+', ' ', 'g')), '')
$$;

create or replace function core.normalize_key(input text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]', '', 'g'), '')
$$;

create or replace function core.hash_key(input text)
returns text language sql immutable set search_path = '' as $$
  select case when input is null then null else encode(extensions.digest(input, 'sha256'), 'hex') end
$$;

------------------------------------------------------------------------------
-- Organization and access
------------------------------------------------------------------------------

create table core.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  default_currency char(3) not null default 'MYR',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.business_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null default 'showroom' check (kind in ('showroom','office','warehouse','site','other')),
  address jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table core.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.roles (
  key text primary key,
  label text not null,
  description text,
  rank int not null default 100
);

create table core.role_permissions (
  role_key text not null references core.roles(key) on delete cascade,
  permission text not null,
  primary key (role_key, permission)
);

create table core.teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table core.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null references core.roles(key),
  status text not null default 'active' check (status in ('active','suspended')),
  default_location_id uuid references core.business_locations(id),
  team_id uuid references core.teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index memberships_user_idx on core.memberships (user_id) where status = 'active';

create table core.membership_scopes (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references core.memberships(id) on delete cascade,
  scope_type text not null check (scope_type in ('location','team','brand','salesperson')),
  scope_id uuid not null,
  created_at timestamptz not null default now(),
  unique (membership_id, scope_type, scope_id)
);

create table core.membership_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  email extensions.citext not null,
  role_key text not null references core.roles(key),
  default_location_id uuid references core.business_locations(id),
  invited_by uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, email)
);

create table core.feature_flags (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table core.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, -- null = shared view
  surface text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort jsonb not null default '[]'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_views_surface_idx on core.saved_views (workspace_id, surface);

create table core.opportunity_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  key text not null,
  label text not null,
  position int not null,
  reporting_group text not null check (reporting_group in ('open','won','lost','deferred')),
  requires_reason boolean not null default false,
  requires_next_action boolean not null default true,
  is_active boolean not null default true,
  unique (workspace_id, key),
  unique (workspace_id, position)
);

------------------------------------------------------------------------------
-- Reference roles & permissions (global)
------------------------------------------------------------------------------

insert into core.roles (key, label, description, rank) values
  ('admin', 'Platform administrator', 'Manage users, scopes, integrations, audit, settings', 0),
  ('management', 'Management', 'Cross-team pipeline, conversion, stock risk, data trust', 10),
  ('sales_manager', 'Sales manager', 'Assign leads, inspect pipeline, approve merges', 20),
  ('sales_rep', 'Sales representative', 'Capture inquiries and walk-ins, work opportunities', 30),
  ('showroom', 'Showroom / walk-in staff', 'Find or register customers, capture visits and purchases', 40),
  ('marketing_coordinator', 'Marketing coordinator', 'Review content opportunities, confirm shoots', 50),
  ('catalog_pricing', 'Catalog / pricing operator', 'Import sources, maintain products and effective-dated prices', 60),
  ('stock_coordinator', 'Stock coordinator', 'Monitor SQL sync, enter supplier snapshots', 70),
  ('analyst', 'Read-only analyst', 'Masked reporting views only', 90);

-- Permission keys are noun.verb and mirrored in src/lib/rbac/matrix.ts.
insert into core.role_permissions (role_key, permission)
select r.key, p.permission from core.roles r
join lateral (values
  ('admin', array['sales.read','sales.read_all','sales.write','sales.assign','contact.reveal','identity.merge','purchase.write','purchase.correct','catalog.read','catalog.write','price.read','price.publish','stock.read','stock.write','marketing.read','marketing.write','marketing.confirm','source.import','review.approve','report.read','audit.read','audit.read_all','settings.manage','export.customer']),
  ('management', array['sales.read','sales.read_all','contact.reveal','catalog.read','price.read','stock.read','marketing.read','report.read','audit.read']),
  ('sales_manager', array['sales.read','sales.read_all','sales.write','sales.assign','contact.reveal','identity.merge','purchase.write','purchase.correct','catalog.read','price.read','stock.read','marketing.read','marketing.write','report.read','audit.read','export.customer']),
  ('sales_rep', array['sales.read','sales.write','contact.reveal','purchase.write','catalog.read','price.read','stock.read','marketing.read','marketing.write','audit.read']),
  ('showroom', array['sales.read','sales.write','purchase.write','catalog.read','price.read','stock.read','audit.read']),
  ('marketing_coordinator', array['sales.read','marketing.read','marketing.write','marketing.confirm','catalog.read','audit.read']),
  ('catalog_pricing', array['catalog.read','catalog.write','price.read','price.publish','stock.read','source.import','review.approve','audit.read']),
  ('stock_coordinator', array['catalog.read','price.read','stock.read','stock.write','audit.read']),
  ('analyst', array['report.read','catalog.read','price.read'])
) as v(role_key, perms) on v.role_key = r.key
cross join lateral unnest(v.perms) as p(permission);

------------------------------------------------------------------------------
-- Access helper functions (SECURITY DEFINER, read memberships without RLS).
-- Used inside policies as uncorrelated subqueries so Postgres evaluates them
-- once per statement (semi-join / InitPlan), not once per candidate row.
------------------------------------------------------------------------------

create or replace function core.member_workspace_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from core.memberships m
  where m.user_id = (select auth.uid()) and m.status = 'active'
$$;
revoke all on function core.member_workspace_ids() from public;
grant execute on function core.member_workspace_ids() to authenticated, service_role;

create or replace function core.has_permission(perm text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.memberships m
    join core.role_permissions rp on rp.role_key = m.role_key
    where m.user_id = (select auth.uid()) and m.status = 'active' and rp.permission = perm
  )
$$;
revoke all on function core.has_permission(text) from public;
grant execute on function core.has_permission(text) to authenticated, service_role;

create or replace function core.current_role_key()
returns text
language sql stable security definer set search_path = '' as $$
  select m.role_key from core.memberships m
  where m.user_id = (select auth.uid()) and m.status = 'active'
  order by m.created_at limit 1
$$;
revoke all on function core.current_role_key() from public;
grant execute on function core.current_role_key() to authenticated, service_role;

-- Membership row the caller acts under (first active). Single-workspace launch.
create or replace function core.current_workspace_id()
returns uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from core.memberships m
  where m.user_id = (select auth.uid()) and m.status = 'active'
  order by m.created_at limit 1
$$;
revoke all on function core.current_workspace_id() from public;
grant execute on function core.current_workspace_id() to authenticated, service_role;

------------------------------------------------------------------------------
-- Profile + invite acceptance on auth user creation
------------------------------------------------------------------------------

create or replace function core.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare inv record;
begin
  insert into core.profiles (user_id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do update set email = excluded.email;

  for inv in
    select * from core.membership_invites i
    where i.email = new.email::extensions.citext and i.status = 'pending'
  loop
    insert into core.memberships (workspace_id, user_id, role_key, default_location_id)
    values (inv.workspace_id, new.id, inv.role_key, inv.default_location_id)
    on conflict (workspace_id, user_id) do nothing;
    update core.membership_invites set status = 'accepted', accepted_at = now() where id = inv.id;
  end loop;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_auth_user();

------------------------------------------------------------------------------
-- Audit (append-only)
------------------------------------------------------------------------------

create table audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  action text not null,                 -- insert | update | delete | <business action>
  object_schema text,
  object_table text,
  object_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb
);
create index audit_events_object_idx on audit.audit_events (object_table, object_id, occurred_at desc);
create index audit_events_ws_time_idx on audit.audit_events (workspace_id, occurred_at desc);
create index audit_events_actor_idx on audit.audit_events (actor_id, occurred_at desc);

-- Outbox for downstream consumers (notifications, analytics, integrations).
create table audit.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  event_type text not null,
  event_version int not null default 1,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  object_type text,
  object_id uuid,
  correlation_id uuid,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz
);
create index outbox_unprocessed_idx on audit.outbox_events (occurred_at) where processed_at is null;

create or replace function audit.log_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old); v_after := null;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old); v_after := to_jsonb(new);
    if v_before = v_after then return new; end if;
  else
    v_before := null; v_after := to_jsonb(new);
  end if;
  v_ws := coalesce((v_after->>'workspace_id')::uuid, (v_before->>'workspace_id')::uuid);
  v_id := coalesce((v_after->>'id')::uuid, (v_before->>'id')::uuid);
  insert into audit.audit_events (workspace_id, actor_id, action, object_schema, object_table, object_id, before_data, after_data, reason)
  values (v_ws, auth.uid(), lower(tg_op), tg_table_schema, tg_table_name, v_id, v_before, v_after,
          nullif(current_setting('app.audit_reason', true), ''));
  return coalesce(new, old);
end $$;

create or replace function audit.emit(
  p_workspace_id uuid, p_action text, p_object_schema text, p_object_table text, p_object_id uuid,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into audit.audit_events (workspace_id, actor_id, action, object_schema, object_table, object_id, before_data, after_data, reason, metadata)
  values (p_workspace_id, auth.uid(), p_action, p_object_schema, p_object_table, p_object_id, p_before, p_after, p_reason, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  insert into audit.outbox_events (workspace_id, event_type, actor_id, object_type, object_id, payload)
  values (p_workspace_id, p_action, auth.uid(), p_object_table, p_object_id, coalesce(p_metadata, '{}'::jsonb));
  return v_id;
end $$;
revoke all on function audit.emit(uuid,text,text,text,uuid,jsonb,jsonb,text,jsonb) from public;

-- updated_at triggers for core tables
do $$
declare t text;
begin
  foreach t in array array['workspaces','business_locations','profiles','memberships','saved_views']
  loop
    execute format('create trigger set_updated_at before update on core.%I for each row execute function core.set_updated_at()', t);
  end loop;
end $$;
