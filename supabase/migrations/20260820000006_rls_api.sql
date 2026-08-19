-- Row-level security, grants, and the exposed `api` schema.
--
-- Shape: every operational table lives in a private schema with RLS enabled.
-- The browser/server client talks to `api.*` security-invoker views (and RPCs),
-- so the invoker's RLS applies. Policies use uncorrelated subqueries over the
-- SECURITY DEFINER helpers so Postgres evaluates membership once per statement.

------------------------------------------------------------------------------
-- 1. Enable RLS on every table in private schemas (deny-by-default).
------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('core','identity','sales','marketing','merch','stock','ingest','audit')
  loop
    execute format('alter table %I.%I enable row level security', r.schema_name, r.table_name);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 2. Generic workspace policies for tables that carry workspace_id.
--    read/write permission keys per schema; owner-scoped read for sales work
--    objects when the caller lacks sales.read_all.
------------------------------------------------------------------------------
do $$
declare
  r record;
  read_perm text;
  write_perm text;
  using_sql text;
  ws_sql text := '(workspace_id in (select core.member_workspace_ids()))';
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
    where c.relkind = 'r' and n.nspname in ('core','identity','sales','marketing','merch','stock','ingest')
  loop
    -- permission mapping
    read_perm := case r.schema_name
      when 'identity' then 'sales.read'
      when 'sales' then 'sales.read'
      when 'marketing' then 'marketing.read'
      when 'merch' then case when r.table_name in ('price_lists','variant_prices','price_approval_events') then 'price.read' else 'catalog.read' end
      when 'stock' then 'stock.read'
      when 'ingest' then case when r.table_name in ('integration_connections','data_quality_issues') then 'audit.read' else 'source.import' end
      else null end;
    write_perm := case r.schema_name
      when 'identity' then 'sales.write'
      when 'sales' then case when r.table_name in ('purchases') then 'purchase.write' else 'sales.write' end
      when 'marketing' then 'marketing.write'
      when 'merch' then case when r.table_name in ('price_lists','variant_prices','price_approval_events') then 'price.publish' else 'catalog.write' end
      when 'stock' then 'stock.write'
      when 'ingest' then case when r.table_name in ('integration_connections') then 'settings.manage' else 'source.import' end
      else null end;

    -- core schema: members read; admins write (saved_views handled separately)
    if r.schema_name = 'core' then
      if r.table_name = 'saved_views' then
        execute format($p$create policy member_read on core.saved_views for select to authenticated
          using (%s and (user_id is null or user_id = (select auth.uid())))$p$, ws_sql);
        execute format($p$create policy owner_write on core.saved_views for all to authenticated
          using (%s and (user_id = (select auth.uid()) or (user_id is null and (select core.has_permission('settings.manage')))))
          with check (%s and (user_id = (select auth.uid()) or (user_id is null and (select core.has_permission('settings.manage')))))$p$, ws_sql, ws_sql);
      elsif r.table_name = 'membership_invites' then
        execute format($p$create policy admin_all on core.membership_invites for all to authenticated
          using (%s and (select core.has_permission('settings.manage'))) with check (%s and (select core.has_permission('settings.manage')))$p$, ws_sql, ws_sql);
      else
        execute format('create policy member_read on core.%I for select to authenticated using (%s)', r.table_name, ws_sql);
        execute format($p$create policy admin_write on core.%I for all to authenticated
          using (%s and (select core.has_permission('settings.manage'))) with check (%s and (select core.has_permission('settings.manage')))$p$, r.table_name, ws_sql, ws_sql);
      end if;
      continue;
    end if;

    -- owner scoping for personal sales work objects
    if r.schema_name = 'sales' and r.table_name in ('leads','opportunities') then
      using_sql := format($u$(%s and (select core.has_permission(%L)) and ((select core.has_permission('sales.read_all')) or owner_id is null or owner_id = (select auth.uid())))$u$, ws_sql, read_perm);
    elsif r.schema_name = 'sales' and r.table_name = 'tasks' then
      using_sql := format($u$(%s and (select core.has_permission(%L)) and ((select core.has_permission('sales.read_all')) or assignee_id is null or assignee_id = (select auth.uid()) or created_by = (select auth.uid())))$u$, ws_sql, read_perm);
    else
      using_sql := format('(%s and (select core.has_permission(%L)))', ws_sql, read_perm);
    end if;

    execute format('create policy member_read on %I.%I for select to authenticated using %s', r.schema_name, r.table_name, using_sql);
    execute format($p$create policy member_insert on %I.%I for insert to authenticated with check (%s and (select core.has_permission(%L)))$p$, r.schema_name, r.table_name, ws_sql, write_perm);
    execute format($p$create policy member_update on %I.%I for update to authenticated using (%s and (select core.has_permission(%L))) with check (%s and (select core.has_permission(%L)))$p$, r.schema_name, r.table_name, ws_sql, write_perm, ws_sql, write_perm);
    -- deletes are admin-only; the product model prefers archive over delete
    execute format($p$create policy admin_delete on %I.%I for delete to authenticated using (%s and (select core.has_permission('settings.manage')))$p$, r.schema_name, r.table_name, ws_sql);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 3. Explicit policies for tables without workspace_id.
------------------------------------------------------------------------------

-- Global reference data
create policy anyone_read on core.roles for select to authenticated using (true);
create policy anyone_read on core.role_permissions for select to authenticated using (true);

-- Profiles: readable by anyone who shares a workspace with the profile owner; editable by owner.
create policy shared_workspace_read on core.profiles for select to authenticated
  using (user_id = (select auth.uid()) or user_id in (
    select m.user_id from core.memberships m where m.workspace_id in (select core.member_workspace_ids())));
create policy owner_update on core.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy member_read on core.membership_scopes for select to authenticated
  using (membership_id in (select m.id from core.memberships m where m.workspace_id in (select core.member_workspace_ids())));
create policy admin_write on core.membership_scopes for all to authenticated
  using ((select core.has_permission('settings.manage'))) with check ((select core.has_permission('settings.manage')));

-- Sales children (join to parent)
create policy via_lead on sales.lead_intake_links for all to authenticated
  using (lead_id in (select l.id from sales.leads l)) with check (lead_id in (select l.id from sales.leads l));
create policy via_quote_version on sales.quote_items for all to authenticated
  using (quote_version_id in (select v.id from sales.quote_versions v)) with check (quote_version_id in (select v.id from sales.quote_versions v));
create policy via_purchase_read on sales.purchase_items for select to authenticated
  using (purchase_id in (select p.id from sales.purchases p));
create policy via_purchase_write on sales.purchase_items for all to authenticated
  using (purchase_id in (select p.id from sales.purchases p) and (select core.has_permission('purchase.write')))
  with check (purchase_id in (select p.id from sales.purchases p) and (select core.has_permission('purchase.write')));
create policy via_purchase_read on sales.purchase_payments for select to authenticated
  using (purchase_id in (select p.id from sales.purchases p));
create policy via_purchase_write on sales.purchase_payments for all to authenticated
  using (purchase_id in (select p.id from sales.purchases p) and (select core.has_permission('purchase.write')))
  with check (purchase_id in (select p.id from sales.purchases p) and (select core.has_permission('purchase.write')));

-- Audit: read-only by permission; writes only through SECURITY DEFINER functions/triggers.
create policy audit_read on audit.audit_events for select to authenticated
  using (workspace_id in (select core.member_workspace_ids())
     and ((select core.has_permission('audit.read_all')) or actor_id = (select auth.uid()) or (select core.has_permission('audit.read'))));
create policy outbox_admin_read on audit.outbox_events for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('settings.manage')));

-- Later-phase children without workspace_id remain deny-all until their module ships:
-- marketing.* status events/participants/locations/checklists/asset reviews, ingest.* versions/records/fields/checkpoints/sync_runs.

------------------------------------------------------------------------------
-- 4. Table grants for the invoker (RLS still applies).
------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('core','identity','sales','marketing','merch','stock','ingest')
  loop
    if r.schema_name = 'core' and r.table_name in ('roles','role_permissions') then
      execute format('grant select on %I.%I to authenticated', r.schema_name, r.table_name);
    else
      execute format('grant select, insert, update, delete on %I.%I to authenticated', r.schema_name, r.table_name);
    end if;
    execute format('grant all on %I.%I to service_role', r.schema_name, r.table_name);
  end loop;
  grant select on audit.audit_events, audit.outbox_events to authenticated;
  grant all on audit.audit_events, audit.outbox_events to service_role;
end $$;

------------------------------------------------------------------------------
-- 5. api schema: one security-invoker view per operational table.
--    Simple views are auto-updatable, so inserts/updates flow to the base table
--    under the caller's RLS. Generated types come from this schema.
------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('core','identity','sales','marketing','merch','stock','ingest','audit')
      and not (n.nspname = 'audit' and c.relname = 'outbox_events')
    order by 1, 2
  loop
    execute format('create or replace view api.%I with (security_invoker = true) as select * from %I.%I', r.table_name, r.schema_name, r.table_name);
    if r.schema_name = 'audit' or (r.schema_name = 'core' and r.table_name in ('roles','role_permissions')) then
      execute format('grant select on api.%I to authenticated', r.table_name);
    else
      execute format('grant select, insert, update, delete on api.%I to authenticated', r.table_name);
    end if;
    execute format('grant all on api.%I to service_role', r.table_name);
  end loop;
end $$;

-- Exposed helper wrappers
create or replace function api.my_permissions()
returns setof text language sql stable security definer set search_path = '' as $$
  select rp.permission from core.memberships m
  join core.role_permissions rp on rp.role_key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active'
$$;
grant execute on function api.my_permissions() to authenticated;

create or replace function api.my_membership()
returns table (workspace_id uuid, workspace_name text, workspace_slug text, role_key text, role_label text, default_location_id uuid, timezone text, currency char(3))
language sql stable security definer set search_path = '' as $$
  select m.workspace_id, w.name, w.slug, m.role_key, r.label, m.default_location_id, w.timezone, w.default_currency
  from core.memberships m
  join core.workspaces w on w.id = m.workspace_id
  join core.roles r on r.key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active'
  order by m.created_at limit 1
$$;
grant execute on function api.my_membership() to authenticated;

-- Lock down default function execution in api to explicit grants
alter default privileges in schema api revoke execute on functions from public;
