-- TILE-89: forecast history and the forecast readers read each opportunity with
-- the caller's own active sales.read in that opportunity's workspace.
--
-- 20261029162000 created
--   sales.opportunity_forecast_history.member_read as membership in the row's
--     workspace AND core.has_permission('sales.read') AND a visible opportunity;
--   api.forecast_rows / forecast_week / forecast_queue (security invoker) each
--     opening with core.require_permission('sales.read').
-- TILE-62 (20261029000002) runs earlier and narrows has_permission and
-- require_permission to the ACTING membership; its rewrite of every existing
-- policy could not reach these, created afterwards. A legitimate reader in B
-- whose acting membership (A) lacks sales.read therefore saw B's opportunity
-- but not its history, and all three readers refused them (42501). Before
-- TILE-62 the same checks were the union over every membership, so sales.read
-- in A opened B's history wherever B's opportunity was visible.
--
-- Repair, using TILE-62's per-row rule and TILE-86's reader pattern:
--   history policy   the middle conjunct becomes
--                    workspace_id in (select core.permitted_workspace_ids('sales.read'))
--                    exactly as TILE-62's policy rewrite would have produced it;
--                    the membership filter and the visible-opportunity guard
--                    stay (owner scoping still decides).
--   three readers    refused only when no active membership anywhere grants
--                    sales.read (same 28000 / 42501 errors as before); which
--                    rows are read is still decided per row by the
--                    opportunity, history, account, contact and sale RLS they
--                    query as the caller. Bodies are otherwise byte-identical.
-- Nothing else changes: the review command, opportunity commands, write
-- permissions, optimistic versions, append-only history, Kuala Lumpur weeks,
-- as-recorded interpretation, counts, values, queues and paging.

-- TILE-62 defines this helper (20261029000002). Created here only when it is
-- absent, with the identical body (as TILE-86's 20261029160003 does), so these
-- readers depend on one definition; where it exists it is left as is.
do $$
begin
  if to_regprocedure('core.permitted_workspace_ids(text)') is null then
    execute $f$
      create function core.permitted_workspace_ids(perm text)
      returns setof uuid
      language sql stable security definer set search_path = '' as $b$
        select m.workspace_id from core.memberships m
        join core.role_permissions rp on rp.role_key = m.role_key
        where m.user_id = (select auth.uid()) and m.status = 'active' and rp.permission = perm
      $b$;
      revoke all on function core.permitted_workspace_ids(text) from public, anon;
      grant execute on function core.permitted_workspace_ids(text) to authenticated, service_role;
      comment on function core.permitted_workspace_ids(text) is
        'Workspaces in which the caller''s own active membership grants perm. Use as `workspace_id in (select core.permitted_workspace_ids(...))` in RLS and readers.';
    $f$;
  end if;
end $$;

alter policy member_read on sales.opportunity_forecast_history using (
  workspace_id in (select core.member_workspace_ids())
  and workspace_id in (select core.permitted_workspace_ids('sales.read'))
  and exists(select 1 from sales.opportunities o where o.id = opportunity_id));

create or replace function api.forecast_rows(p_mode text default 'current', p_as_of timestamptz default null, p_owner_id uuid default null)
returns table(id uuid, name text, account_id uuid, contact_id uuid, project_id uuid, created_at timestamptz, version integer, recorded boolean,
  status text, stage_key text, archived boolean, owner_id uuid, expected_close_date date, probability_band text, estimated_value numeric,
  currency text, evidence text, next_action text, next_action_due_at timestamptz, reviewed_at timestamptz, reviewed_by uuid)
language plpgsql stable security invoker set search_path='' as $$
declare as_of timestamptz := coalesce(p_as_of, now());
begin
  -- Refused only when no active membership anywhere grants sales.read; which
  -- opportunities are read is decided per row by their own RLS.
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from core.permitted_workspace_ids('sales.read')) then
    raise exception 'permission denied: sales.read' using errcode = '42501';
  end if;
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

create or replace function api.forecast_week(p_week_start date default null, p_mode text default 'current', p_owner_id uuid default null,
  p_stale_days integer default 14, p_as_of timestamptz default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare w record; result jsonb;
begin
  -- Refused only when no active membership anywhere grants sales.read; which
  -- opportunities are read is decided per row by their own RLS.
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from core.permitted_workspace_ids('sales.read')) then
    raise exception 'permission denied: sales.read' using errcode = '42501';
  end if;
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

create or replace function api.forecast_queue(p_queue text, p_week_start date default null, p_mode text default 'current', p_owner_id uuid default null,
  p_stale_days integer default 14, p_limit integer default 50, p_offset integer default 0, p_as_of timestamptz default null)
returns table(id uuid, name text, account_id uuid, account_name text, contact_id uuid, contact_name text, owner_id uuid, stage_key text, status text,
  expected_close_date date, probability_band text, estimated_value numeric, currency text, evidence text, next_action text,
  next_action_due_at timestamptz, reviewed_at timestamptz, reviewed_by uuid, created_at timestamptz, version integer, recorded boolean, total_count bigint)
language plpgsql stable security invoker set search_path='' as $$
declare w record;
begin
  -- Refused only when no active membership anywhere grants sales.read; which
  -- opportunities are read is decided per row by their own RLS.
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from core.permitted_workspace_ids('sales.read')) then
    raise exception 'permission denied: sales.read' using errcode = '42501';
  end if;
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
