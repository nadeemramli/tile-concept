-- Hot-path performance and advisor clean-up.
--
-- 1. api.inbox_leads called api.lead_followup_summary(l.id) once per lead. That
--    function is plpgsql SECURITY DEFINER, so the planner cannot inline it and
--    every inbox render ran ~7 statements per lead (permission checks, a
--    re-read of the lead, three task lookups) for every lead in the workspace,
--    because api.inquiry_page materialises the whole set to compute view
--    counts. It is replaced by one set-based rollup over sales.tasks.
-- 2. api.entity_timeline wrapped the entity column in a CASE, which made every
--    sales.activities index unusable. It now branches per entity type.
-- 3. Indexes for the drawer (intake events by lead) and the command-centre
--    counters that scanned tables without a supporting index.
-- 4. Advisor findings: SECURITY DEFINER api functions were executable by anon
--    and three core helpers had a mutable search_path.

------------------------------------------------------------------------------
-- 1. Follow-up rollup: one pass over sales.tasks for all visible leads.
------------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as api.lead_followup_summary: the inbox
-- is shared for reading, but sales.tasks RLS is scoped to the assignee, so a
-- security-invoker join would hide colleagues' reminders. Only the narrow
-- summary is exposed; task titles and descriptions never leave this function.
-- It lives in core (not exposed through PostgREST) and is reached only through
-- api.inbox_leads, whose security-invoker join to sales.leads keeps lead RLS.
create or replace function core.lead_followup_rollup()
returns table(lead_id uuid, next_follow_up_task_id uuid, next_follow_up_at timestamptz,
  follow_up_owner_id uuid, open_follow_ups bigint, completed_follow_ups bigint)
language sql stable security definer set search_path = '' as $$
  select t.lead_id,
    (array_agg(t.id order by t.due_at asc nulls last, t.id) filter (where t.status = 'open'))[1],
    (array_agg(t.due_at order by t.due_at asc nulls last, t.id) filter (where t.status = 'open'))[1],
    (array_agg(t.assignee_id order by t.due_at asc nulls last, t.id) filter (where t.status = 'open'))[1],
    count(*) filter (where t.status = 'open'),
    count(*) filter (where t.status = 'done')
  from sales.tasks t
  where t.lead_id is not null
    and t.workspace_id in (select core.member_workspace_ids())
    and core.has_permission('sales.read')
  group by t.lead_id
$$;
revoke all on function core.lead_followup_rollup() from public, anon;
grant execute on function core.lead_followup_rollup() to authenticated, service_role;

-- Same columns, same order, same semantics as the previous definition; leads
-- with no tasks keep counts of 0 (the old lateral returned a zero row).
create or replace view api.inbox_leads with (security_invoker = true) as
select l.*, f.next_follow_up_task_id, f.next_follow_up_at, f.follow_up_owner_id,
       coalesce(f.open_follow_ups, 0) as open_follow_ups,
       coalesce(f.completed_follow_ups, 0) as completed_follow_ups,
       (coalesce(b.confirmed_sales,0)=0 and l.status not in ('disqualified','duplicate') and
         ((l.first_response_at is null and s.first_showroom_at is null) or
          (coalesce(f.open_follow_ups, 0) = 0 and l.no_next_action_reason is null) or
          (coalesce(f.open_follow_ups, 0) > 0 and f.next_follow_up_at is null) or
          coalesce(f.next_follow_up_at < (date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur',false))) as needs_action,
       s.first_showroom_at, s.showroom_visits, b.first_sale_at, b.confirmed_sales, b.recorded_net_sales
from sales.leads l
left join core.lead_followup_rollup() f on f.lead_id = l.id
left join lateral (select min(v.occurred_at) as first_showroom_at, count(*) as showroom_visits
  from sales.visits v where v.workspace_id = l.workspace_id and v.lead_id = l.id) s on true
left join lateral (select min(p.purchased_at) filter(where x.net_sales>0 and p.status<>'voided') as first_sale_at,
 count(*) filter(where x.net_sales>0 and p.status<>'voided') as confirmed_sales,coalesce(sum(x.net_sales),0) as recorded_net_sales
 from sales.purchases p join api.sale_balances x on x.id=p.id where p.workspace_id=l.workspace_id and p.lead_id=l.id and p.financial_state='confirmed') b on true;
grant select on api.inbox_leads to authenticated;

------------------------------------------------------------------------------
-- 2. Timeline: one indexed predicate per entity type instead of a CASE.
------------------------------------------------------------------------------
create or replace function api.entity_timeline(p_entity_type text, p_entity_id uuid, p_limit int default 100)
returns table (id uuid, kind text, channel text, subject text, body text, occurred_at timestamptz, actor_id uuid, actor_name text, opportunity_id uuid, lead_id uuid, purchase_id uuid, visit_id uuid, metadata jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_column text := case p_entity_type
    when 'contact' then 'contact_id'
    when 'account' then 'account_id'
    when 'project' then 'project_id'
    when 'opportunity' then 'opportunity_id'
    when 'lead' then 'lead_id'
    else null end;
begin
  if v_column is null or p_entity_id is null then return; end if;
  if not core.has_permission('sales.read') then return; end if;
  return query execute format($q$
    select a.id, a.kind, a.channel, a.subject, a.body, a.occurred_at, a.actor_id, p.full_name,
           a.opportunity_id, a.lead_id, a.purchase_id, a.visit_id, a.metadata
    from sales.activities a
    left join core.profiles p on p.user_id = a.actor_id
    where a.%I = $1 and a.workspace_id in (select core.member_workspace_ids())
    order by a.occurred_at desc
    limit $2
  $q$, v_column) using p_entity_id, greatest(1, least(coalesce(p_limit, 100), 500));
end $$;
revoke all on function api.entity_timeline(text,uuid,int) from public, anon;
grant execute on function api.entity_timeline(text,uuid,int) to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. Indexes on hot predicates.
------------------------------------------------------------------------------
-- Drawer: intake history for one lead (was a full scan of sales.intake_events).
create index if not exists intake_events_lead_idx on sales.intake_events (lead_id, received_at desc) where lead_id is not null;
create index if not exists lead_intake_links_event_idx on sales.lead_intake_links (intake_event_id);
-- Lead-to-opportunity lookups and the opportunities_lead_id FK.
create index if not exists opportunities_lead_idx on sales.opportunities (lead_id) where lead_id is not null;
-- command_centre_summary counters without a supporting index.
create index if not exists quote_versions_ws_valid_idx on sales.quote_versions (workspace_id, valid_until);
create index if not exists integration_connections_ws_status_idx on ingest.integration_connections (workspace_id, status);
create index if not exists variant_prices_ws_state_idx on merch.variant_prices (workspace_id, state);
create index if not exists products_ws_review_idx on merch.products (workspace_id, review_state);

------------------------------------------------------------------------------
-- 4. Advisor findings.
------------------------------------------------------------------------------
-- Every SECURITY DEFINER function in api is a staff command or a staff read
-- model; none is meant for an unauthenticated caller. Server-side scripts use
-- service_role, which keeps its grant.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- Helpers that only use pg_catalog builtins; pin the search path anyway.
alter function core.set_updated_at() set search_path = '';
alter function core.mask_value(text, text) set search_path = '';
alter function core.storage_workspace_of(text) set search_path = '';
