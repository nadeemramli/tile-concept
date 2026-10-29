-- TILE-86: the pursuit segmentation and lead-source reports authorize each
-- aggregated row with the caller's own active report.read in THAT row's
-- workspace.
--
-- 20261029160000 created api.report_pursuit_segments and 20261029160001
-- redefined api.report_lead_source with a single check of report.read
-- (core.has_permission) followed by every workspace the caller belongs to
-- (core.member_workspace_ids). A report reader in one workspace therefore saw
-- the aggregates of another workspace where they hold no report.read and, once
-- TILE-62 (20261029000002) narrows has_permission to the acting membership, a
-- legitimate reader whose acting membership lacks report.read was refused the
-- workspace they may read. 20261029160001 also replaced TILE-62's per-row
-- report_lead_source reader, because it runs later.
--
-- This restores TILE-62's per-row rule for both readers:
--   workspace_id in (select core.permitted_workspace_ids('report.read'))
-- with no union of permissions across workspaces and no membership-only
-- filter. Everything else in the two bodies is unchanged: pursuit grain and
-- de-duplication, every dimension with its Unknown bucket, Kuala Lumpur
-- day/week/month buckets, period and grain validation, and the lead-source
-- columns, date filter, exact-arrival median, date-only exclusion and
-- non-negative response time.
--
-- Contracts kept: an anonymous caller cannot execute the segmentation report;
-- a signed-in caller with no active report.read in any workspace is refused it
-- (42501, as before); the lead-source reader still returns no rows for them.
-- Suspended, revoked and absent memberships grant nothing.

-- TILE-62 defines this helper (20261029000002). Created here only when that
-- migration is absent, with the identical body, so the readers below depend
-- on one definition; where TILE-62 is applied, its definition is left as is.
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

create or replace function api.report_pursuit_segments(p_from date default null, p_to date default null, p_grain text default 'week')
returns table (period_start date, period_end date, dimension text, dimension_label text, value text, value_label text, is_legacy boolean,
  pursuits bigint, complete bigint, unreviewed bigint, missing_flagged bigint, conflict bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_grain text := coalesce(p_grain,'week'); v_step interval; v_from timestamptz; v_to timestamptz;
begin
  -- Refused only when no active membership anywhere grants report.read; which
  -- rows are read is decided per workspace below.
  if auth.uid() is null or not exists (select 1 from core.permitted_workspace_ids('report.read')) then
    raise exception 'Permission denied: report.read' using errcode = '42501';
  end if;
  if v_grain not in ('day','week','month') then
    raise exception 'Choose a daily, weekly or monthly breakdown' using errcode = '23514';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The period must start before it ends' using errcode = '23514';
  end if;
  v_step := case v_grain when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end;
  v_from := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Kuala_Lumpur' end;
  v_to := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur' end;
  return query
  with p as (
    select date_trunc(v_grain, x.arrived_at at time zone 'Asia/Kuala_Lumpur')::date as bucket, x.*
    from sales.pursuits x
    where x.workspace_id in (select core.permitted_workspace_ids('report.read'))
      and (v_from is null or x.arrived_at >= v_from) and (v_to is null or x.arrived_at < v_to)
  ), cells as (
    select p.bucket, d.dimension, d.value, p.classification_state
    from p cross join lateral (values ('buyer_role',p.buyer_role),('project_use',p.project_use),('work_type',p.work_type),
      ('glc_involvement',p.glc_involvement),('glc_party_role',p.glc_party_role)) d(dimension,value)
    where d.value is not null
  )
  select c.bucket, (c.bucket + v_step - interval '1 day')::date, c.dimension,
    case c.dimension when 'buyer_role' then 'Buyer role' when 'project_use' then 'Project use' when 'work_type' then 'Work type'
      when 'glc_involvement' then 'GLC involvement' else 'GLC party role' end,
    c.value, coalesce(cv.label, c.value), coalesce(cv.is_legacy,false),
    count(*), count(*) filter (where c.classification_state = 'complete'), count(*) filter (where c.classification_state = 'unreviewed'),
    count(*) filter (where c.classification_state = 'missing_flagged'), count(*) filter (where c.classification_state = 'conflict')
  from cells c left join core.classification_values cv on cv.dimension = c.dimension and cv.key = c.value
  group by c.bucket, c.dimension, c.value, cv.label, cv.is_legacy, cv.position
  order by c.bucket desc, array_position(array['buyer_role','project_use','work_type','glc_involvement','glc_party_role'], c.dimension), cv.position;
end $$;
revoke all on function api.report_pursuit_segments(date,date,text) from public, anon;
grant execute on function api.report_pursuit_segments(date,date,text) to authenticated;

create or replace function api.report_lead_source(p_from date default null, p_to date default null)
returns table (source_channel text, leads bigint, responded bigint, median_response_minutes numeric, qualified bigint, converted bigint, disqualified bigint)
language sql stable security definer set search_path = '' as $$
  select l.source_channel,
         count(*),
         count(*) filter (where l.first_response_at is not null),
         round((percentile_cont(0.5) within group (order by case
           when l.arrival_precision <> 'date' and l.first_response_at >= l.created_at
           then extract(epoch from (l.first_response_at - l.created_at)) / 60 end))::numeric, 1),
         count(*) filter (where l.qualified_at is not null),
         count(*) filter (where l.status = 'converted'),
         count(*) filter (where l.status = 'disqualified')
  from sales.leads l
  where l.workspace_id in (select core.permitted_workspace_ids('report.read'))
    and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to + 1)
  group by l.source_channel
  order by 2 desc
$$;
grant execute on function api.report_lead_source(date,date) to authenticated;
