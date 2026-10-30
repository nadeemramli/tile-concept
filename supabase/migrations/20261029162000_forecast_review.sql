-- TILE-7: weekly sales forecast review, forecast history and exception queues.
--
-- A forecast is the owner's stated expectation for an open opportunity:
-- expected close date, likelihood band, estimated value, the evidence behind
-- it and the next step. It is not revenue. Confirmed sales remain the F3
-- documented-sale events (`sales.sale_events`), and a won opportunity is a
-- pursuit outcome, not a sale.
--
-- Rules this migration encodes:
--   * Unknown stays unknown. A missing date, band or value is never filled,
--     weighted or rolled forward. It is reported in an exception queue.
--   * Likelihood is a band (low/medium/high) with no probability weight. Values
--     are summed unweighted, per currency, and unknown values are counted, not
--     treated as zero.
--   * Weeks are Monday-Sunday in Asia/Kuala_Lumpur.
--   * Active forecast = open and not archived. Won, lost, deferred and archived
--     work is excluded and counted separately so the exclusion is visible.
--   * No stage requires a forecast. Forecast capture is offered at creation,
--     quote follow-up and stage change, but nothing refuses a stage move or a
--     quotation that was actually sent; unforecast work lands in the queues.
--   * Every change to forecast-relevant fields, from any command, appends a row
--     to `sales.opportunity_forecast_history` (append-only, trigger-captured).
--     Explicit reviews are marked as such. The "as recorded" view rebuilds the
--     forecast from that history at the end of a week, so a later correction
--     changes the current view but never rewrites what was recorded earlier.
--   * History starts when this migration is applied: one `baseline` row per
--     existing opportunity copies its state at that moment. An opportunity
--     with no history at an earlier instant is reported as "not recorded".

------------------------------------------------------------------------------
-- 1. Forecast review fields on the opportunity.
------------------------------------------------------------------------------
alter table sales.opportunities
  add column forecast_evidence text check (forecast_evidence is null or length(forecast_evidence) <= 2000),
  add column forecast_reviewed_at timestamptz,
  add column forecast_reviewed_by uuid references auth.users(id);
create index opportunities_forecast_close_idx on sales.opportunities(workspace_id, expected_close_date)
  where archived_at is null and status = 'open';
create or replace view api.opportunities with(security_invoker=true) as select * from sales.opportunities;
revoke insert,update,delete on api.opportunities from authenticated;

------------------------------------------------------------------------------
-- 2. Append-only forecast history.
------------------------------------------------------------------------------
create table sales.opportunity_forecast_history (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  opportunity_id uuid not null references sales.opportunities(id) on delete cascade,
  -- When the change was recorded. A forecast review takes effect when it is made,
  -- so recording time is also its business time.
  recorded_at timestamptz not null default clock_timestamp(),
  -- No foreign keys on people: history rows are never updated, including by
  -- an ON DELETE SET NULL from auth.users.
  actor_id uuid,
  kind text not null check (kind in ('baseline','created','review','change')),
  review_context text check (review_context in ('review','create','quote','stage')),
  status text not null,
  stage_key text not null,
  archived boolean not null,
  owner_id uuid,
  expected_close_date date,
  probability_band text check (probability_band in ('low','medium','high')),
  estimated_value numeric(14,2),
  currency char(3) not null,
  evidence text,
  next_action text,
  next_action_due_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  constraint forecast_history_review_context check ((kind = 'review') = (review_context is not null))
);
create index forecast_history_opportunity_idx on sales.opportunity_forecast_history(opportunity_id, recorded_at desc, seq desc);
create index forecast_history_workspace_idx on sales.opportunity_forecast_history(workspace_id, recorded_at);

-- Updates are always refused. Deletes are allowed only when the opportunity or
-- the workspace itself is being deleted (admin delete, demo reset cascade).
create function sales.protect_forecast_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'DELETE' and (not exists(select 1 from sales.opportunities where id = old.opportunity_id)
      or not exists(select 1 from core.workspaces where id = old.workspace_id)) then
    return old;
  end if;
  raise exception 'Forecast history is append-only; record a new review instead' using errcode = '42501';
end $$;
revoke all on function sales.protect_forecast_history() from public,anon,authenticated;
create trigger forecast_history_append_only before update or delete on sales.opportunity_forecast_history
  for each row execute function sales.protect_forecast_history();

-- Captures every change to a forecast-relevant field, whichever command made it.
-- api.review_opportunity_forecast sets `tile.forecast_review_context` for the
-- duration of its own update so that row is marked as an explicit review.
create function sales.capture_forecast_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  ctx text := nullif(current_setting('tile.forecast_review_context', true), '');
  reviewed boolean := tg_op = 'UPDATE' and ctx is not null and new.forecast_reviewed_at is distinct from old.forecast_reviewed_at;
begin
  if tg_op = 'UPDATE' and (old.status, old.stage_key, old.archived_at is not null, old.owner_id, old.expected_close_date, old.probability_band,
      old.estimated_value, old.currency, old.forecast_evidence, old.next_action, old.next_action_due_at, old.forecast_reviewed_at)
    is not distinct from (new.status, new.stage_key, new.archived_at is not null, new.owner_id, new.expected_close_date, new.probability_band,
      new.estimated_value, new.currency, new.forecast_evidence, new.next_action, new.next_action_due_at, new.forecast_reviewed_at) then
    return null;
  end if;
  insert into sales.opportunity_forecast_history(workspace_id, opportunity_id, actor_id, kind, review_context, status, stage_key, archived, owner_id,
    expected_close_date, probability_band, estimated_value, currency, evidence, next_action, next_action_due_at, reviewed_at, reviewed_by)
  values (new.workspace_id, new.id, auth.uid(),
    case when tg_op = 'INSERT' then 'created' when reviewed then 'review' else 'change' end,
    case when reviewed then ctx end,
    new.status, new.stage_key, new.archived_at is not null, new.owner_id, new.expected_close_date, new.probability_band,
    new.estimated_value, new.currency, new.forecast_evidence, new.next_action, new.next_action_due_at, new.forecast_reviewed_at, new.forecast_reviewed_by);
  return null;
end $$;
revoke all on function sales.capture_forecast_history() from public,anon,authenticated;
create trigger capture_forecast_history after insert or update on sales.opportunities
  for each row execute function sales.capture_forecast_history();

-- Baseline: the state of each existing opportunity when history begins.
insert into sales.opportunity_forecast_history(workspace_id, opportunity_id, kind, status, stage_key, archived, owner_id,
  expected_close_date, probability_band, estimated_value, currency, evidence, next_action, next_action_due_at, reviewed_at, reviewed_by)
select workspace_id, id, 'baseline', status, stage_key, archived_at is not null, owner_id,
  expected_close_date, probability_band, estimated_value, currency, forecast_evidence, next_action, next_action_due_at, forecast_reviewed_at, forecast_reviewed_by
from sales.opportunities;

alter table sales.opportunity_forecast_history enable row level security;
-- Readable exactly when the opportunity itself is readable (its owner scoping applies).
create policy member_read on sales.opportunity_forecast_history for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.read'))
    and exists(select 1 from sales.opportunities o where o.id = opportunity_id));
grant select on sales.opportunity_forecast_history to authenticated;
revoke insert,update,delete,truncate on sales.opportunity_forecast_history from public,anon,authenticated;
create view api.opportunity_forecast_history with(security_invoker=true) as select * from sales.opportunity_forecast_history;
grant select on api.opportunity_forecast_history to authenticated;
revoke insert,update,delete on api.opportunity_forecast_history from authenticated;

------------------------------------------------------------------------------
-- 3. Review command: the only path that marks a forecast as reviewed.
--
-- p_input keys: version (required), context (review|create|quote|stage),
-- expected_close_date, probability_band, estimated_value, currency, evidence,
-- next_action, next_action_due_at. A key that is present is applied, and a
-- present null means "unknown"; an absent key leaves the field unchanged. A
-- review that changes nothing still records that the forecast was looked at.
------------------------------------------------------------------------------
create function api.review_opportunity_forecast(p_opportunity_id uuid, p_input jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := core.current_workspace_id(); uid uuid := auth.uid();
  o sales.opportunities%rowtype; after_row sales.opportunities%rowtype;
  prior sales.opportunity_requests%rowtype;
  payload jsonb := jsonb_build_object('action','forecast_review','opportunity_id',p_opportunity_id,'input',p_input);
  ctx text := coalesce(nullif(p_input->>'context',''),'review');
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_date date; v_band text; v_value numeric; v_currency text; v_evidence text; v_next text; v_due timestamptz;
  result jsonb;
begin
  perform core.require_permission('sales.write'); perform core.require_workspace(ws);
  if p_request_id is null then raise exception 'A request id is required' using errcode='23514'; end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' then raise exception 'Forecast details are required' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||p_request_id::text,0));
  select * into prior from sales.opportunity_requests where workspace_id=ws and request_id=p_request_id;
  if found then
    if prior.actor_id<>uid or prior.payload<>payload then raise exception 'Retry differs from original command' using errcode='23514'; end if;
    return prior.result;
  end if;
  if ctx not in ('review','create','quote','stage') then raise exception 'Unknown forecast context' using errcode='23514'; end if;

  select * into o from sales.opportunities where id=p_opportunity_id and workspace_id=ws for update;
  if not found then raise exception 'Opportunity not found' using errcode='42501'; end if;
  if not core.has_permission('sales.read_all') and o.owner_id is not null and o.owner_id<>uid then
    raise exception 'Only the owner or a sales manager can review this forecast' using errcode='42501';
  end if;
  if (p_input->>'version')::integer is distinct from o.version then raise exception 'Opportunity changed. Refresh and try again.' using errcode='40001'; end if;
  if o.archived_at is not null then raise exception 'Restore the opportunity before changing it' using errcode='23514'; end if;
  if o.status<>'open' then raise exception 'Only open opportunities carry a forecast' using errcode='23514'; end if;

  v_date := case when p_input ? 'expected_close_date' then nullif(p_input->>'expected_close_date','')::date else o.expected_close_date end;
  v_band := case when p_input ? 'probability_band' then nullif(p_input->>'probability_band','') else o.probability_band end;
  v_value := case when p_input ? 'estimated_value' then nullif(p_input->>'estimated_value','')::numeric else o.estimated_value end;
  v_currency := case when p_input ? 'currency' then nullif(p_input->>'currency','') else o.currency end;
  v_evidence := case when p_input ? 'evidence' then nullif(btrim(p_input->>'evidence'),'') else o.forecast_evidence end;
  v_next := case when p_input ? 'next_action' then nullif(btrim(p_input->>'next_action'),'') else o.next_action end;
  v_due := case when p_input ? 'next_action_due_at' then nullif(p_input->>'next_action_due_at','')::timestamptz else o.next_action_due_at end;

  -- A stated date must still lie ahead. A passed date is corrected by choosing
  -- a new one or by saying it is unknown; it is never moved forward for you.
  if p_input ? 'expected_close_date' and v_date is not null and v_date < today then
    raise exception 'Expected close date has passed. Choose a new date or leave it unknown.' using errcode='23514';
  end if;
  if v_band is not null and v_band not in ('low','medium','high') then raise exception 'Likelihood must be low, medium, high or unknown' using errcode='23514'; end if;
  if v_value is not null and (v_value<0 or v_value::text in ('NaN','Infinity','-Infinity')) then
    raise exception 'Estimated value must be a finite positive amount or zero' using errcode='23514';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter code' using errcode='23514'; end if;
  if v_evidence is not null and length(v_evidence)>2000 then raise exception 'Evidence is too long' using errcode='23514'; end if;
  if (p_input ? 'next_action' or p_input ? 'next_action_due_at') and (v_next is null or v_due is null) then
    raise exception 'Enter a next action and due date' using errcode='23514';
  end if;

  perform set_config('tile.forecast_review_context', ctx, true);
  update sales.opportunities set expected_close_date=v_date, probability_band=v_band, estimated_value=v_value, currency=v_currency,
    forecast_evidence=v_evidence, next_action=v_next, next_action_due_at=v_due,
    forecast_reviewed_at=clock_timestamp(), forecast_reviewed_by=uid
  where id=o.id returning * into after_row;
  perform set_config('tile.forecast_review_context', '', true);

  insert into sales.activities(workspace_id,kind,subject,body,actor_id,contact_id,account_id,project_id,opportunity_id,metadata)
  values(ws,'system','Forecast reviewed',v_evidence,uid,o.contact_id,o.account_id,o.project_id,o.id,
    jsonb_build_object('context',ctx,'expected_close_date',v_date,'probability_band',v_band,'estimated_value',v_value,'currency',v_currency));
  perform audit.emit(ws,'opportunity.forecast_reviewed','sales','opportunities',o.id,
    jsonb_build_object('expected_close_date',o.expected_close_date,'probability_band',o.probability_band,'estimated_value',o.estimated_value,'currency',o.currency,
      'evidence',o.forecast_evidence,'next_action',o.next_action,'next_action_due_at',o.next_action_due_at,'reviewed_at',o.forecast_reviewed_at),
    jsonb_build_object('expected_close_date',v_date,'probability_band',v_band,'estimated_value',v_value,'currency',v_currency,
      'evidence',v_evidence,'next_action',v_next,'next_action_due_at',v_due,'reviewed_at',after_row.forecast_reviewed_at),
    null, jsonb_build_object('context',ctx));

  result := jsonb_build_object('opportunity_id',o.id,'version',after_row.version,'reviewed_at',after_row.forecast_reviewed_at,
    'history_id',(select id from sales.opportunity_forecast_history where opportunity_id=o.id order by recorded_at desc, seq desc limit 1));
  insert into sales.opportunity_requests values(ws,p_request_id,uid,payload,result);
  return result;
end $$;
revoke all on function api.review_opportunity_forecast(uuid,jsonb,uuid) from public,anon;
grant execute on function api.review_opportunity_forecast(uuid,jsonb,uuid) to authenticated;

------------------------------------------------------------------------------
-- 4. Read model. All functions run as the caller (security invoker), so the
-- population is exactly the caller's RLS scope over the whole workspace: no
-- client-side limit, no sampling.
------------------------------------------------------------------------------

-- The forecast state of every visible opportunity, either now ('current') or as
-- recorded in history at p_as_of ('recorded'). In recorded mode an opportunity
-- created before p_as_of without a history row by then has recorded=false and
-- every forecast field null; for the owner filter it is attributed to its
-- current owner, since history holds no owner for it at that time.
create function api.forecast_rows(p_mode text default 'current', p_as_of timestamptz default null, p_owner_id uuid default null)
returns table(id uuid, name text, account_id uuid, contact_id uuid, project_id uuid, created_at timestamptz, version integer, recorded boolean,
  status text, stage_key text, archived boolean, owner_id uuid, expected_close_date date, probability_band text, estimated_value numeric,
  currency text, evidence text, next_action text, next_action_due_at timestamptz, reviewed_at timestamptz, reviewed_by uuid)
language plpgsql stable security invoker set search_path='' as $$
declare as_of timestamptz := coalesce(p_as_of, now());
begin
  perform core.require_permission('sales.read');
  if p_mode not in ('current','recorded') then raise exception 'Forecast mode must be current or recorded' using errcode='23514'; end if;
  if p_mode = 'current' then
    return query select o.id, o.name, o.account_id, o.contact_id, o.project_id, o.created_at, o.version, true,
      o.status, o.stage_key, o.archived_at is not null, o.owner_id, o.expected_close_date, o.probability_band, o.estimated_value::numeric,
      o.currency::text, o.forecast_evidence, o.next_action, o.next_action_due_at, o.forecast_reviewed_at, o.forecast_reviewed_by
    from api.opportunities o
    where (p_owner_id is null or o.owner_id = p_owner_id);
  else
    return query select o.id, o.name, o.account_id, o.contact_id, o.project_id, o.created_at, o.version, h.id is not null,
      h.status, h.stage_key, h.archived, h.owner_id, h.expected_close_date, h.probability_band, h.estimated_value::numeric,
      h.currency::text, h.evidence, h.next_action, h.next_action_due_at, h.reviewed_at, h.reviewed_by
    from api.opportunities o
    left join lateral (select x.* from api.opportunity_forecast_history x where x.opportunity_id = o.id and x.recorded_at <= as_of
      order by x.recorded_at desc, x.seq desc limit 1) h on true
    where o.created_at <= as_of and (p_owner_id is null or (case when h.id is null then o.owner_id else h.owner_id end) = p_owner_id);
  end if;
end $$;
revoke all on function api.forecast_rows(text,timestamptz,uuid) from public,anon;
grant execute on function api.forecast_rows(text,timestamptz,uuid) to authenticated;

-- Resolves the selected week and the instant the forecast is evaluated at.
-- current: now (or p_as_of). recorded: the last instant of the selected week,
-- or now when that week has not ended yet.
create function api.forecast_window(p_week_start date default null, p_mode text default 'current', p_as_of timestamptz default null)
returns table(week_start date, week_end date, week_start_at timestamptz, week_end_at timestamptz, as_of timestamptz, today date)
language plpgsql stable security invoker set search_path='' as $$
declare
  now_at timestamptz := coalesce(p_as_of, now());
  ws date := coalesce(p_week_start, date_trunc('week', (now_at at time zone 'Asia/Kuala_Lumpur')::date)::date);
  end_at timestamptz := (ws + 7)::timestamp at time zone 'Asia/Kuala_Lumpur';
  eval_at timestamptz;
begin
  if extract(isodow from ws) <> 1 then raise exception 'Choose a week that starts on a Monday (Asia/Kuala_Lumpur)' using errcode='23514'; end if;
  if p_mode not in ('current','recorded') then raise exception 'Forecast mode must be current or recorded' using errcode='23514'; end if;
  eval_at := case when p_mode = 'current' then now_at else least(end_at - interval '1 microsecond', now_at) end;
  return query select ws, ws + 6, ws::timestamp at time zone 'Asia/Kuala_Lumpur', end_at, eval_at, (eval_at at time zone 'Asia/Kuala_Lumpur')::date;
end $$;
revoke all on function api.forecast_window(date,text,timestamptz) from public,anon;
grant execute on function api.forecast_window(date,text,timestamptz) to authenticated;

create function api.forecast_week(p_week_start date default null, p_mode text default 'current', p_owner_id uuid default null,
  p_stale_days integer default 14, p_as_of timestamptz default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare w record; result jsonb;
begin
  perform core.require_permission('sales.read');
  if p_stale_days is null or p_stale_days not between 1 and 180 then raise exception 'Stale review threshold must be 1 to 180 days' using errcode='23514'; end if;
  select * into w from api.forecast_window(p_week_start, p_mode, p_as_of);
  with r as (select * from api.forecast_rows(p_mode, w.as_of, p_owner_id)),
  active as (select * from r where r.recorded and r.status = 'open' and not r.archived),
  wk as (select * from active where expected_close_date between w.week_start and w.week_end),
  bands as (
    select coalesce(probability_band,'unknown') band, currency, count(*) n, sum(estimated_value) value, count(*) filter (where estimated_value is null) value_unknown
    from wk group by 1, 2
  ),
  four as (
    select (w.week_start + 7 * g)::date week_start, coalesce(a.probability_band,'unknown') band, a.currency, count(a.id) n,
      sum(a.estimated_value) value, count(a.id) filter (where a.id is not null and a.estimated_value is null) value_unknown
    from generate_series(0, 3) g
    left join active a on a.expected_close_date between w.week_start + 7 * g and w.week_start + 7 * g + 6
    group by 1, 2, 3
  ),
  sales_in_week as (
    select p.currency::text currency, sum(e.net_delta) net, count(*) events
    from api.sale_events e join api.purchases p on p.id = e.purchase_id
    where e.occurred_at >= w.week_start_at and e.occurred_at < w.week_end_at and e.occurred_at <= w.as_of
      and (p_owner_id is null or p.salesperson_id = p_owner_id)
    group by 1
  )
  select jsonb_build_object(
    'mode', p_mode, 'as_of', w.as_of, 'timezone', 'Asia/Kuala_Lumpur', 'today', w.today,
    'week_start', w.week_start, 'week_end', w.week_end, 'stale_days', p_stale_days,
    'history_started_at', (select min(h.recorded_at) from api.opportunity_forecast_history h),
    'week_count', (select count(*) from wk),
    'bands', coalesce((select jsonb_agg(jsonb_build_object('band', band, 'currency', currency, 'count', n, 'value', value, 'value_unknown', value_unknown)
      order by array_position(array['high','medium','low','unknown'], band), currency) from bands), '[]'::jsonb),
    'excluded', (select jsonb_build_object(
      'won', count(*) filter (where r.recorded and not r.archived and r.status = 'won'),
      'lost', count(*) filter (where r.recorded and not r.archived and r.status = 'lost'),
      'deferred', count(*) filter (where r.recorded and not r.archived and r.status = 'deferred'),
      'archived', count(*) filter (where r.recorded and r.archived))
      from r where r.expected_close_date between w.week_start and w.week_end),
    'not_recorded', (select count(*) from r where not r.recorded),
    'active_count', (select count(*) from active),
    'queues', (select jsonb_build_object(
      'missing_date', count(*) filter (where expected_close_date is null),
      'missing_band', count(*) filter (where probability_band is null),
      'missing_value', count(*) filter (where estimated_value is null),
      'overdue_date', count(*) filter (where expected_close_date < w.today),
      'stale_review', count(*) filter (where reviewed_at < w.as_of - make_interval(days => p_stale_days)),
      'never_reviewed', count(*) filter (where reviewed_at is null)) from active),
    'next_four_weeks', coalesce((select jsonb_agg(jsonb_build_object('week_start', week_start, 'band', band, 'currency', currency, 'count', n,
      'value', value, 'value_unknown', value_unknown) order by week_start, array_position(array['high','medium','low','unknown'], band), currency)
      from four where n > 0), '[]'::jsonb),
    'confirmed_sales', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'net', net, 'events', events) order by currency) from sales_in_week), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function api.forecast_week(date,text,uuid,integer,timestamptz) from public,anon;
grant execute on function api.forecast_week(date,text,uuid,integer,timestamptz) to authenticated;

-- One page of a forecast list, with the complete count of that list.
-- week: active work expected to close in the selected week.
-- missing_date / missing_band / missing_value: active work with that field unknown.
-- overdue_date: active work whose expected close date is before today.
-- stale_review: reviewed, but not within p_stale_days.
-- never_reviewed: active work nobody has reviewed since forecast reviews began.
-- not_recorded: (recorded mode) existed then, but history has no state for it.
create function api.forecast_queue(p_queue text, p_week_start date default null, p_mode text default 'current', p_owner_id uuid default null,
  p_stale_days integer default 14, p_limit integer default 50, p_offset integer default 0, p_as_of timestamptz default null)
returns table(id uuid, name text, account_id uuid, account_name text, contact_id uuid, contact_name text, owner_id uuid, stage_key text, status text,
  expected_close_date date, probability_band text, estimated_value numeric, currency text, evidence text, next_action text,
  next_action_due_at timestamptz, reviewed_at timestamptz, reviewed_by uuid, created_at timestamptz, version integer, recorded boolean, total_count bigint)
language plpgsql stable security invoker set search_path='' as $$
declare w record;
begin
  perform core.require_permission('sales.read');
  if p_queue not in ('week','missing_date','missing_band','missing_value','overdue_date','stale_review','never_reviewed','not_recorded') then
    raise exception 'Unknown forecast list' using errcode='23514';
  end if;
  if p_stale_days is null or p_stale_days not between 1 and 180 then raise exception 'Stale review threshold must be 1 to 180 days' using errcode='23514'; end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then raise exception 'Page must be 1 to 200 rows from a non-negative offset' using errcode='23514'; end if;
  select * into w from api.forecast_window(p_week_start, p_mode, p_as_of);
  return query
  with r as (select * from api.forecast_rows(p_mode, w.as_of, p_owner_id)),
  picked as (
    select r.* from r
    where case p_queue when 'not_recorded' then not r.recorded
      else r.recorded and r.status = 'open' and not r.archived and case p_queue
        when 'week' then r.expected_close_date between w.week_start and w.week_end
        when 'missing_date' then r.expected_close_date is null
        when 'missing_band' then r.probability_band is null
        when 'missing_value' then r.estimated_value is null
        when 'overdue_date' then r.expected_close_date < w.today
        when 'stale_review' then r.reviewed_at < w.as_of - make_interval(days => p_stale_days)
        when 'never_reviewed' then r.reviewed_at is null
      end end
  )
  select p.id, p.name, p.account_id, a.name, p.contact_id, c.display_name, p.owner_id, p.stage_key, p.status, p.expected_close_date, p.probability_band,
    p.estimated_value, p.currency, p.evidence, p.next_action, p.next_action_due_at, p.reviewed_at, p.reviewed_by, p.created_at, p.version, p.recorded,
    count(*) over ()
  from picked p
  left join api.accounts a on a.id = p.account_id
  left join api.contacts c on c.id = p.contact_id
  order by
    case when p_queue = 'week' then array_position(array['high','medium','low'], p.probability_band) end nulls last,
    case when p_queue in ('week','overdue_date') then p.expected_close_date end,
    case when p_queue = 'stale_review' then p.reviewed_at end,
    p.created_at, p.id
  limit p_limit offset p_offset;
end $$;
revoke all on function api.forecast_queue(text,date,text,uuid,integer,integer,integer,timestamptz) from public,anon;
grant execute on function api.forecast_queue(text,date,text,uuid,integer,integer,integer,timestamptz) to authenticated;
