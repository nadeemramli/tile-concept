-- Sales scorecard for the Command Centre: an annual target to measure against,
-- a market segment on opportunities, and one function that returns target vs
-- YTD collection + open pipeline plus the pipeline broken down by segment.

------------------------------------------------------------------------------
-- Annual sales target per workspace/year (admin-set).
------------------------------------------------------------------------------
create table if not exists sales.sales_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  year int not null,
  target_amount numeric(14,2) not null check (target_amount >= 0),
  currency char(3) not null default 'MYR',
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, year)
);
alter table sales.sales_targets enable row level security;
create policy member_read on sales.sales_targets for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.read')));
create policy admin_write on sales.sales_targets for all to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('settings.manage')))
  with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('settings.manage')));
grant select, insert, update, delete on sales.sales_targets to authenticated;
grant all on sales.sales_targets to service_role;
create view api.sales_targets with (security_invoker = true) as select * from sales.sales_targets;
grant select, insert, update, delete on api.sales_targets to authenticated;
grant all on api.sales_targets to service_role;

------------------------------------------------------------------------------
-- Market segment on opportunities, for the pipeline-by-segment breakdown.
------------------------------------------------------------------------------
alter table sales.opportunities
  add column segment text check (segment in ('institutional','residential','fnb','hospitality','commercial','other'));
comment on column sales.opportunities.segment is 'Market segment for pipeline reporting (Command Centre scorecard).';
-- api.opportunities was created as `select *` in ...0006 and froze its column
-- list there; recreate so the new column is exposed.
create or replace view api.opportunities with (security_invoker = true) as select * from sales.opportunities;
grant select, insert, update, delete on api.opportunities to authenticated;
grant all on api.opportunities to service_role;

------------------------------------------------------------------------------
-- Set/replace the annual target (admin only, audited).
------------------------------------------------------------------------------
create or replace function api.set_sales_target(p_year int, p_amount numeric, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ws uuid := core.current_workspace_id();
begin
  perform core.require_permission('settings.manage');
  insert into sales.sales_targets (workspace_id, year, target_amount, notes, created_by)
  values (v_ws, p_year, p_amount, p_notes, auth.uid())
  on conflict (workspace_id, year) do update
    set target_amount = excluded.target_amount, notes = excluded.notes, updated_at = now();
  perform audit.emit(v_ws, 'sales_target.set', 'sales', 'sales_targets', null,
    '{}'::jsonb, jsonb_build_object('year', p_year, 'amount', p_amount), p_notes, '{}'::jsonb);
end $$;
grant execute on function api.set_sales_target(int, numeric, text) to authenticated;

------------------------------------------------------------------------------
-- Scorecard: target vs YTD collected + open pipeline, and pipeline by segment.
-- Collection is app-recorded purchases (not reconciled with SQL Account);
-- pipeline is unweighted open opportunity value under the caller's scope.
------------------------------------------------------------------------------
create or replace function api.sales_scorecard(p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_me uuid := auth.uid();
  v_all boolean := core.has_permission('sales.read_all');
  v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Kuala_Lumpur'))::int);
  v_start timestamptz := (make_date(v_year, 1, 1)::timestamp) at time zone 'Asia/Kuala_Lumpur';
  v_end   timestamptz := (make_date(v_year + 1, 1, 1)::timestamp) at time zone 'Asia/Kuala_Lumpur';
  v_target numeric; v_currency char(3);
  v_collected numeric; v_pipeline numeric; v_segments jsonb;
begin
  perform core.require_permission('sales.read');
  select target_amount, currency into v_target, v_currency
    from sales.sales_targets where workspace_id = v_ws and year = v_year;
  select coalesce(sum(p.amount), 0) into v_collected from sales.purchases p
    where p.workspace_id = v_ws and p.status <> 'voided'
      and p.purchased_at >= v_start and p.purchased_at < v_end;
  select coalesce(sum(o.estimated_value), 0) into v_pipeline from sales.opportunities o
    where o.workspace_id = v_ws and o.status = 'open' and (v_all or o.owner_id = v_me);
  select coalesce(jsonb_agg(jsonb_build_object('segment', seg, 'value', val) order by val desc), '[]'::jsonb)
    into v_segments from (
      select coalesce(o.segment, 'other') as seg, sum(o.estimated_value) as val
      from sales.opportunities o
      where o.workspace_id = v_ws and o.status = 'open' and o.estimated_value is not null
        and (v_all or o.owner_id = v_me)
      group by coalesce(o.segment, 'other')
    ) s;
  return jsonb_build_object(
    'year', v_year, 'target', v_target, 'currency', coalesce(v_currency, 'MYR'),
    'collected', v_collected, 'pipeline', v_pipeline, 'segments', v_segments,
    'generated_at', now());
end $$;
grant execute on function api.sales_scorecard(int) to authenticated;
