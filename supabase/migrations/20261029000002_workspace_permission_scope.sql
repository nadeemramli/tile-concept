-- TILE-62: a permission held in one workspace never authorizes another.
--
-- Until now core.has_permission(perm) and api.my_permissions() ORed role
-- permissions over EVERY active membership, and RLS combined that union with
-- membership in ANY workspace. A driver here who was an admin in another
-- workspace could therefore read and write this workspace's sales, customer and
-- settings rows through the other membership (reproduced on the local stack: 30
-- leads and 41 contacts; pinned as a TODO in supabase/tests/024).
--
-- The rule from here on: the permission that authorizes anything in workspace W
-- comes only from the caller's membership in W. Two ways of applying it:
--
--   per row      RLS policies and the cross-workspace report readers check each
--                row's own workspace with core.permitted_workspace_ids(perm), an
--                uncorrelated set (evaluated once per statement, like
--                core.member_workspace_ids, so no per-row function calls).
--                A member of two workspaces still reads each one exactly as far
--                as that membership allows.
--
--   acting       Commands (SECURITY DEFINER RPCs), core.has_permission,
--                core.require_permission, api.my_permissions and the app session
--                follow the ACTING membership (core.current_workspace_id: the
--                oldest active one), and core.require_workspace now admits only
--                the acting workspace. A command therefore touches records of the
--                acting workspace only, authorized by that membership. There is
--                no tenant selector, so this is what the app already presents.
--
-- core.member_workspace_ids() is deliberately unchanged: it still answers "which
-- workspaces is this person in" for profiles, memberships, preferences and
-- reference rows that need no permission.
--
-- Nothing is granted that was not granted before: every predicate below is the
-- old one narrowed to the right workspace.

------------------------------------------------------------------------------
-- 1. One acting membership, chosen deterministically
--
-- Ties on created_at (two memberships created in one transaction) used to be
-- broken arbitrarily, so the session and the database could act in different
-- workspaces. Break them by workspace id everywhere, and make my_membership use
-- the same function the database uses.
------------------------------------------------------------------------------
create or replace function core.current_workspace_id()
returns uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from core.memberships m
  where m.user_id = (select auth.uid()) and m.status = 'active'
  order by m.created_at, m.workspace_id limit 1
$$;

create or replace function core.current_role_key()
returns text
language sql stable security definer set search_path = '' as $$
  select m.role_key from core.memberships m
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and m.workspace_id = core.current_workspace_id()
$$;

create or replace function api.my_membership()
returns table(workspace_id uuid, workspace_name text, workspace_slug text, role_key text, role_label text, default_location_id uuid, timezone text, currency character)
language sql stable security definer set search_path = '' as $$
  select m.workspace_id, w.name, w.slug, m.role_key, r.label, m.default_location_id, w.timezone, w.default_currency
  from core.memberships m
  join core.workspaces w on w.id = m.workspace_id
  join core.roles r on r.key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and m.workspace_id = core.current_workspace_id()
$$;

------------------------------------------------------------------------------
-- 2. Helpers
------------------------------------------------------------------------------
-- Workspaces whose (active) membership grants perm. Per-row authority.
create or replace function core.permitted_workspace_ids(perm text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from core.memberships m
  join core.role_permissions rp on rp.role_key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active' and rp.permission = perm
$$;
revoke all on function core.permitted_workspace_ids(text) from public, anon;
grant execute on function core.permitted_workspace_ids(text) to authenticated, service_role;
comment on function core.permitted_workspace_ids(text) is
  'Workspaces in which the caller''s own active membership grants perm. Use as `workspace_id in (select core.permitted_workspace_ids(...))` in RLS and readers.';

-- The acting membership's permission. Was: the union over every membership.
create or replace function core.has_permission(perm text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.memberships m
    join core.role_permissions rp on rp.role_key = m.role_key
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and m.workspace_id = core.current_workspace_id() and rp.permission = perm
  )
$$;
comment on function core.has_permission(text) is
  'Whether the ACTING membership (core.current_workspace_id) grants perm. Never use it to authorize rows of another workspace: RLS uses core.permitted_workspace_ids.';

-- Commands act in the acting workspace only. Was: any workspace the caller
-- belongs to, which let a permission checked against the acting membership
-- authorize a record in another workspace.
create or replace function core.require_workspace(ws uuid)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if ws is null or ws is distinct from core.current_workspace_id() then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
end $$;

-- The session mirror: the acting membership's permissions, like
-- api.my_workspace_permissions (kept for the TILE-32 callers).
create or replace function api.my_permissions()
returns setof text
language sql stable security definer set search_path = '' as $$
  select rp.permission from core.memberships m
  join core.role_permissions rp on rp.role_key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and m.workspace_id = core.current_workspace_id()
$$;

-- Owner bypass is judged in the lead's own workspace.
create or replace function sales.require_lead_owner(l sales.leads)
returns void
language plpgsql stable set search_path = '' as $$
begin
  if not core.has_permission_in(l.workspace_id, 'sales.read_all') and l.owner_id is not null and l.owner_id <> auth.uid() then
    raise exception 'permission denied: not the owner' using errcode = '42501';
  end if;
end $$;

------------------------------------------------------------------------------
-- 3. Storage policies whose permission sits outside the object's row
------------------------------------------------------------------------------
-- Upload a photo for an opportunity in a workspace that grants sales.write, as
-- its owner unless that workspace grants sales.read_all.
alter policy opportunity_photo_upload on storage.objects with check (
  bucket_id = 'opportunity-photos'
  and exists (
    select 1 from sales.opportunity_photos p
    join sales.opportunities o on o.id = p.opportunity_id
    where p.object_path = objects.name and p.created_by = (select auth.uid())
      and p.uploaded_at is null and p.removed_at is null and o.archived_at is null
      and o.workspace_id in (select core.permitted_workspace_ids('sales.write'))
      and (o.workspace_id in (select core.permitted_workspace_ids('sales.read_all'))
           or o.owner_id is null or o.owner_id = (select auth.uid()))));

alter policy visit_quotation_upload on storage.objects with check (
  bucket_id = 'visit-quotations'
  and exists (
    select 1 from sales.visit_quotation_files f
    where f.object_path = objects.name and f.created_by = (select auth.uid()) and f.uploaded_at is null
      and f.workspace_id in (select core.permitted_workspace_ids('sales.write'))));

------------------------------------------------------------------------------
-- 4. Every other policy: narrow core.has_permission(p) to the row's workspace
--
-- Mechanical and total. For each policy that still calls core.has_permission,
-- the call is replaced by the workspace predicate for that table:
--   tables with workspace_id      <table>.workspace_id in permitted(p)
--   child tables                  parent id in (parents in permitted(p))
--   storage objects keyed by path core.storage_workspace_of(name) in permitted(p)
--   rows already pinned to the    has_permission_in(current_workspace_id(), p)
--   acting workspace (feedback media, sale receipts, realtime topic)
-- A policy on any other table aborts the migration rather than being guessed.
------------------------------------------------------------------------------
do $$
declare
  r record;
  tmpl text;
  new_qual text;
  new_check text;
  stmt text;
  wrapped constant text := '\( SELECT core\.has_permission\(((?:''[^'']*'')+::text)\) AS has_permission\)';
  bare constant text := 'core\.has_permission\(((?:''[^'']*'')+::text)\)';
begin
  for r in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check,
           exists (select 1 from information_schema.columns c
                   where c.table_schema = p.schemaname and c.table_name = p.tablename and c.column_name = 'workspace_id') as has_ws
    from pg_policies p
    where coalesce(p.qual, '') || coalesce(p.with_check, '') like '%core.has_permission(%'
    order by 1, 2, 3
  loop
    tmpl := case
      when (r.schemaname, r.tablename) in (('sales','purchase_items'), ('sales','purchase_payments')) then
        '(purchase_id IN ( SELECT p.id FROM sales.purchases p WHERE (p.workspace_id IN ( SELECT core.permitted_workspace_ids(\1) AS permitted_workspace_ids))))'
      when (r.schemaname, r.tablename) in (('marketing','shoot_checklists'), ('marketing','shoot_locations'), ('marketing','shoot_participants')) then
        '(shoot_booking_id IN ( SELECT b.id FROM marketing.shoot_bookings b WHERE (b.workspace_id IN ( SELECT core.permitted_workspace_ids(\1) AS permitted_workspace_ids))))'
      when (r.schemaname, r.tablename) = ('core','membership_scopes') then
        '(membership_id IN ( SELECT m.id FROM core.memberships m WHERE (m.workspace_id IN ( SELECT core.permitted_workspace_ids(\1) AS permitted_workspace_ids))))'
      when r.schemaname = 'storage' and r.tablename = 'objects'
           and coalesce(r.qual, '') || coalesce(r.with_check, '') like '%core.storage_workspace_of(name) IN ( SELECT core.member_workspace_ids()%' then
        '(core.storage_workspace_of(objects.name) IN ( SELECT core.permitted_workspace_ids(\1) AS permitted_workspace_ids))'
      when (r.schemaname = 'storage' and r.tablename = 'objects'
            and r.policyname in ('feedback_photo_insert','feedback_photo_read','sale_receipt_download','sale_receipt_upload'))
        or (r.schemaname = 'realtime' and r.tablename = 'messages' and r.policyname = 'inquiry_invalidation_read') then
        '( SELECT core.has_permission_in(core.current_workspace_id(), \1) AS has_permission_in)'
      when r.has_ws and r.schemaname not in ('storage', 'realtime') then
        format('(%I.workspace_id IN ( SELECT core.permitted_workspace_ids(\1) AS permitted_workspace_ids))', r.tablename)
      else null end;
    if tmpl is null then
      raise exception 'TILE-62: no workspace rule for policy %.%.%', r.schemaname, r.tablename, r.policyname;
    end if;

    new_qual := regexp_replace(regexp_replace(r.qual, wrapped, tmpl, 'g'), bare, tmpl, 'g');
    new_check := regexp_replace(regexp_replace(r.with_check, wrapped, tmpl, 'g'), bare, tmpl, 'g');
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if new_qual is not null then stmt := stmt || format(' using (%s)', new_qual); end if;
    if new_check is not null then stmt := stmt || format(' with check (%s)', new_check); end if;
    execute stmt;
  end loop;

  if exists (select 1 from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%core.has_permission(%') then
    raise exception 'TILE-62: a policy still authorizes rows with core.has_permission';
  end if;
end $$;

------------------------------------------------------------------------------
-- 5. Readers that gather rows from every membership: per-row permission
--
-- Bodies are unchanged except the workspace predicate: `workspace_id in
-- member_workspace_ids() and has_permission(p)` becomes `workspace_id in
-- permitted_workspace_ids(p)`. report_stock_freshness had no workspace filter
-- at all (it read every workspace's suppliers); it now has one.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.entity_timeline(p_entity_type text, p_entity_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, kind text, channel text, subject text, body text, occurred_at timestamp with time zone, actor_id uuid, actor_name text, opportunity_id uuid, lead_id uuid, purchase_id uuid, visit_id uuid, metadata jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  return query execute format($q$
    select a.id, a.kind, a.channel, a.subject, a.body, a.occurred_at, a.actor_id, p.full_name,
           a.opportunity_id, a.lead_id, a.purchase_id, a.visit_id, a.metadata
    from sales.activities a
    left join core.profiles p on p.user_id = a.actor_id
    where a.%I = $1 and a.workspace_id in (select core.permitted_workspace_ids('sales.read'))
    order by a.occurred_at desc
    limit $2
  $q$, v_column) using p_entity_id, greatest(1, least(coalesce(p_limit, 100), 500));
end $function$
;

CREATE OR REPLACE FUNCTION core.lead_followup_rollup()
 RETURNS TABLE(lead_id uuid, next_follow_up_task_id uuid, next_follow_up_at timestamp with time zone, follow_up_owner_id uuid, open_follow_ups bigint, completed_follow_ups bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.lead_id,
    (array_agg(t.id order by t.due_at asc nulls last, t.id) filter (where t.status = 'open'))[1],
    (array_agg(t.due_at order by t.due_at asc nulls last, t.id) filter (where t.status = 'open'))[1],
    (array_agg(t.assignee_id order by t.due_at asc nulls last, t.id) filter (where t.status = 'open'))[1],
    count(*) filter (where t.status = 'open'),
    count(*) filter (where t.status = 'done')
  from sales.tasks t
  where t.lead_id is not null
    and t.workspace_id in (select core.permitted_workspace_ids('sales.read'))
  group by t.lead_id
$function$
;

CREATE OR REPLACE FUNCTION api.report_cohorts(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(cohort_month date, customers bigint, repeat_customers bigint, purchases bigint, amount numeric, median_days_between numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with per_contact as (
    select p.contact_id,
           date_trunc('month', min(p.purchased_at))::date as cohort_month,
           count(*) as purchase_count,
           sum(p.amount) as amount,
           case when count(*) > 1
                then extract(epoch from (max(p.purchased_at) - min(p.purchased_at))) / 86400 / (count(*) - 1)
           end as avg_gap_days
    from sales.purchases p
    where p.workspace_id in (select core.permitted_workspace_ids('report.read'))
      and p.status in ('recorded','corrected') and p.contact_id is not null
      and (p_from is null or p.purchased_at >= p_from) and (p_to is null or p.purchased_at < p_to + 1)
    group by p.contact_id
  )
  select cohort_month, count(*), count(*) filter (where purchase_count > 1),
         sum(purchase_count), sum(amount),
         round((percentile_cont(0.5) within group (order by avg_gap_days))::numeric, 1)
  from per_contact
  group by cohort_month
  order by cohort_month
$function$
;

CREATE OR REPLACE FUNCTION api.report_content_pipeline()
 RETURNS TABLE(status text, opportunities bigint, permission_approved bigint, shoots_confirmed bigint, shoots_completed bigint, usable_assets bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select co.status,
         count(distinct co.id),
         count(distinct co.id) filter (where perm.status in ('approved','approved_with_restrictions')),
         count(distinct b.id) filter (where b.status = 'confirmed'),
         count(distinct b.id) filter (where b.status = 'completed'),
         count(distinct o.id) filter (where o.state = 'usable')
  from marketing.content_opportunities co
  left join lateral (select * from marketing.media_permission_records m where m.content_opportunity_id = co.id order by m.created_at limit 1) perm on true
  left join marketing.shoot_bookings b on b.content_opportunity_id = co.id
  left join marketing.shoot_outputs o on o.content_opportunity_id = co.id
  where co.workspace_id in (select core.permitted_workspace_ids('report.read'))
  group by co.status
  order by 2 desc
$function$
;

CREATE OR REPLACE FUNCTION api.report_data_quality()
 RETURNS TABLE(bucket text, open_issues bigint, high_severity bigint, resolved_30d bigint, pending_reviews bigint, duplicates_open bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d.issue_type,
         count(*) filter (where d.status = 'open'),
         count(*) filter (where d.status = 'open' and d.severity = 'high'),
         count(*) filter (where d.resolved_at > now() - interval '30 days'),
         (select count(*) from ingest.review_items ri where ri.workspace_id = d.workspace_id and ri.status = 'pending'),
         (select count(*) from identity.identity_match_candidates mc where mc.workspace_id = d.workspace_id and mc.status = 'suggested')
  from ingest.data_quality_issues d
  where d.workspace_id in (select core.permitted_workspace_ids('report.read'))
  group by d.issue_type, d.workspace_id
  order by 2 desc
$function$
;

CREATE OR REPLACE FUNCTION api.report_demand(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(product_id uuid, product_code text, product_name text, brand_name text, category_label text, quoted_qty numeric, quoted_value numeric, purchased_qty numeric, purchased_value numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pr.id, pr.code, pr.name, b.name, c.label,
         coalesce(sum(qi.quantity), 0), coalesce(sum(qi.line_total), 0),
         coalesce(sum(pi.quantity), 0), coalesce(sum(pi.line_total), 0)
  from merch.products pr
  left join merch.brands b on b.id = pr.brand_id
  left join merch.product_categories c on c.id = pr.category_id
  left join merch.product_variants v on v.product_id = pr.id
  left join sales.quote_items qi on qi.product_variant_id = v.id
  left join sales.purchase_items pi on pi.product_variant_id = v.id
  where pr.workspace_id in (select core.permitted_workspace_ids('report.read'))
  group by pr.id, pr.code, pr.name, b.name, c.label
  having coalesce(sum(qi.quantity), 0) + coalesce(sum(pi.quantity), 0) > 0
  order by 9 desc, 7 desc
$function$
;

CREATE OR REPLACE FUNCTION api.report_lead_source(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(source_channel text, leads bigint, responded bigint, median_response_minutes numeric, qualified bigint, converted bigint, disqualified bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.source_channel,
         count(*),
         count(*) filter (where l.first_response_at is not null),
         round((percentile_cont(0.5) within group (order by extract(epoch from (l.first_response_at - l.created_at)) / 60))::numeric, 1),
         count(*) filter (where l.qualified_at is not null),
         count(*) filter (where l.status = 'converted'),
         count(*) filter (where l.status = 'disqualified')
  from sales.leads l
  where l.workspace_id in (select core.permitted_workspace_ids('report.read'))
    and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to + 1)
  group by l.source_channel
  order by 2 desc
$function$
;

CREATE OR REPLACE FUNCTION api.report_pipeline(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(stage_key text, stage_label text, reporting_group text, stage_position integer, opportunities bigint, open_value numeric, avg_age_days numeric, overdue bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select st.key, st.label, st.reporting_group, st.position,
         count(o.id), coalesce(sum(o.estimated_value), 0),
         round(avg(extract(epoch from (now() - o.updated_at)) / 86400)::numeric, 1),
         count(*) filter (where o.next_action_due_at < now() and o.status = 'open')
  from core.opportunity_stages st
  left join sales.opportunities o on o.stage_key = st.key and o.workspace_id = st.workspace_id
    and o.archived_at is null
    and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at < p_to + 1)
  where st.workspace_id in (select core.permitted_workspace_ids('report.read')) and st.is_active
  group by st.key, st.label, st.reporting_group, st.position
  order by st.position
$function$
;

CREATE OR REPLACE FUNCTION api.report_price_health()
 RETURNS TABLE(bucket text, products bigint, with_current_price bigint, conflicted bigint, expiring_30d bigint, unreviewed bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(b.name, 'Unbranded'),
         count(distinct pr.id),
         count(distinct pr.id) filter (where exists (
           select 1 from merch.product_variants v join merch.variant_prices vp on vp.variant_id = v.id
           where v.product_id = pr.id and vp.state = 'current')),
         count(distinct pr.id) filter (where exists (
           select 1 from merch.product_variants v join merch.variant_prices vp on vp.variant_id = v.id
           where v.product_id = pr.id and vp.state = 'conflicted')),
         count(distinct pr.id) filter (where exists (
           select 1 from merch.product_variants v join merch.variant_prices vp on vp.variant_id = v.id
           where v.product_id = pr.id and vp.state = 'current' and vp.valid_to between current_date and current_date + 30)),
         count(distinct pr.id) filter (where pr.review_state = 'unreviewed')
  from merch.products pr
  left join merch.brands b on b.id = pr.brand_id
  where pr.workspace_id in (select core.permitted_workspace_ids('report.read')) and pr.status = 'active'
  group by b.name
  order by 2 desc
$function$
;

CREATE OR REPLACE FUNCTION api.report_quotes(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(bucket text, quotes bigint, revisions numeric, total_value numeric, won bigint, lost bigint, open bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(o.source_channel, 'unknown'),
         count(distinct q.id),
         round(avg(q.current_version_no)::numeric, 2),
         coalesce(sum(qv.total_amount), 0),
         count(distinct o.id) filter (where o.status = 'won'),
         count(distinct o.id) filter (where o.status = 'lost'),
         count(distinct o.id) filter (where o.status = 'open')
  from sales.quotes q
  join sales.opportunities o on o.id = q.opportunity_id
  left join sales.quote_versions qv on qv.quote_id = q.id and qv.version_no = q.current_version_no
  where q.workspace_id in (select core.permitted_workspace_ids('report.read')) and o.archived_at is null
    and (p_from is null or q.created_at >= p_from) and (p_to is null or q.created_at < p_to + 1)
  group by 1
  order by 2 desc
$function$
;

CREATE OR REPLACE FUNCTION api.report_stock_freshness()
 RETURNS TABLE(supplier_name text, freshness text, last_update_at timestamp with time zone, snapshot_count bigint, open_cases bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select q.supplier_name, q.freshness, q.last_update_at, q.snapshot_count,
         (select count(*) from stock.stock_reconciliation_cases rc where rc.workspace_id = q.workspace_id and rc.status = 'open')
  from api.stale_supplier_queue q
  where q.workspace_id in (select core.permitted_workspace_ids('report.read'))
  order by case q.freshness when 'stale' then 0 when 'unknown' then 1 when 'aging' then 2 else 3 end, q.supplier_name
$function$
;

CREATE OR REPLACE FUNCTION api.report_walkin_collections(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_grain text DEFAULT 'day'::text, p_by_person boolean DEFAULT false)
 RETURNS TABLE(period_start date, period_end date, person_id uuid, person text, visits bigint, new_customers bigint, purchases bigint, amount numeric, collections numeric, unreviewed_payments bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grain text := coalesce(p_grain, 'day');
  v_by_person boolean := coalesce(p_by_person, false);
  v_step interval;
  v_from timestamptz;
  v_to timestamptz;
begin
  if auth.uid() is null or not exists (select 1 from core.permitted_workspace_ids('report.read')) then
    raise exception 'Permission denied: report.read' using errcode = '42501';
  end if;
  if v_grain not in ('day', 'week', 'month') then
    raise exception 'Choose a daily, weekly or monthly breakdown' using errcode = '23514';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The period must start before it ends' using errcode = '23514';
  end if;

  v_step := case v_grain when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end;
  v_from := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Kuala_Lumpur' end;
  v_to := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur' end;

  return query
  with visit_rows as (
    select date_trunc(v_grain, v.occurred_at at time zone 'Asia/Kuala_Lumpur')::date as bucket,
           case when v_by_person then v.staff_user_id end as who,
           count(*) as n_visits,
           count(*) filter (where v.is_new_customer) as n_new
    from sales.visits v
    where v.workspace_id in (select core.permitted_workspace_ids('report.read'))
      and (v_from is null or v.occurred_at >= v_from)
      and (v_to is null or v.occurred_at < v_to)
    group by 1, 2
  ),
  walkin_sales as (
    select p.id, p.status, p.purchased_at, p.salesperson_id, p.amount
    from sales.purchases p
    where p.workspace_id in (select core.permitted_workspace_ids('report.read'))
      and p.status <> 'draft'
      and (p.visit_id is not null or p.purchase_source = 'walk_in')
  ),
  sale_rows as (
    select date_trunc(v_grain, s.purchased_at at time zone 'Asia/Kuala_Lumpur')::date as bucket,
           case when v_by_person then s.salesperson_id end as who,
           count(*) as n_sales,
           sum(s.amount) as doc_total
    from walkin_sales s
    where s.status in ('recorded', 'corrected')
      and (v_from is null or s.purchased_at >= v_from)
      and (v_to is null or s.purchased_at < v_to)
    group by 1, 2
  ),
  payment_rows as (
    select date_trunc(v_grain, coalesce(pp.paid_at, s.purchased_at) at time zone 'Asia/Kuala_Lumpur')::date as bucket,
           case when v_by_person then s.salesperson_id end as who,
           sum(case when pp.review_state = 'confirmed'
                    then pp.amount * case when pp.direction = 'refund' then -1 else 1 end
                    else 0 end) as collected,
           count(*) filter (where pp.review_state <> 'confirmed') as n_unreviewed
    from sales.purchase_payments pp
    join walkin_sales s on s.id = pp.purchase_id
    where (v_from is null or coalesce(pp.paid_at, s.purchased_at) >= v_from)
      and (v_to is null or coalesce(pp.paid_at, s.purchased_at) < v_to)
    group by 1, 2
  ),
  keys as (
    select bucket, who from visit_rows
    union
    select bucket, who from sale_rows
    union
    select bucket, who from payment_rows
  )
  select k.bucket,
         (k.bucket + v_step - interval '1 day')::date,
         k.who,
         case when v_by_person then coalesce(pr.full_name, 'Unassigned') end,
         coalesce(vr.n_visits, 0),
         coalesce(vr.n_new, 0),
         coalesce(sr.n_sales, 0),
         coalesce(sr.doc_total, 0),
         coalesce(py.collected, 0),
         coalesce(py.n_unreviewed, 0)
  from keys k
  left join visit_rows vr on vr.bucket = k.bucket and vr.who is not distinct from k.who
  left join sale_rows sr on sr.bucket = k.bucket and sr.who is not distinct from k.who
  left join payment_rows py on py.bucket = k.bucket and py.who is not distinct from k.who
  left join core.profiles pr on pr.user_id = k.who
  order by k.bucket, 4 nulls last, k.who;
end $function$
;

CREATE OR REPLACE FUNCTION api.report_walkins(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(bucket text, visits bigint, new_customers bigint, purchases bigint, amount numeric, payment_mix jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(loc.name, 'Unassigned'),
         count(distinct v.id),
         count(distinct v.id) filter (where v.is_new_customer),
         count(distinct p.id),
         coalesce(sum(p.amount), 0),
         coalesce((select jsonb_object_agg(m.method, m.n) from (
            select pp.method, count(*) n
            from sales.purchase_payments pp
            join sales.purchases p2 on p2.id = pp.purchase_id
            where p2.location_id is not distinct from v.location_id and p2.workspace_id = v.workspace_id
              and (p_from is null or p2.purchased_at >= p_from) and (p_to is null or p2.purchased_at < p_to + 1)
            group by pp.method) m), '{}'::jsonb)
  from sales.visits v
  left join core.business_locations loc on loc.id = v.location_id
  left join sales.purchases p on p.visit_id = v.id and p.status in ('recorded','corrected')
  where v.workspace_id in (select core.permitted_workspace_ids('report.read'))
    and (p_from is null or v.occurred_at >= p_from) and (p_to is null or v.occurred_at < p_to + 1)
  group by loc.name, v.location_id, v.workspace_id
  order by 2 desc
$function$
;

do $$
begin
  if exists (select 1 from pg_proc p where p.prosrc like '%member_workspace_ids%' and p.prosrc like '%has_permission(%') then
    raise exception 'TILE-62: a function still pairs every-membership rows with a single permission check';
  end if;
end $$;
