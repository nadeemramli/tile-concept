-- Marketing cost ledger and period/cohort reporting. All money is explicitly MYR.
insert into core.role_permissions(role_key,permission)
select r,p from unnest(array['admin','sales_manager','marketing_coordinator','guest']) r
cross join unnest(array['marketing.spend.read','marketing.spend.write','marketing.spend.review']) p
on conflict do nothing;
insert into core.role_permissions(role_key,permission)
select r,'marketing.spend.read' from unnest(array['management','analyst']) r on conflict do nothing;

create table marketing.spend_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  incurred_on date not null,
  platform text not null check(platform in ('tiktok','meta','google_ads','shared')),
  category text not null check(category in ('platform_ads','influencer','content','creative','agency','event','other')),
  entry_mode text not null check(entry_mode in ('daily_total','campaign','event','credit')),
  entry_key text not null check(length(btrim(entry_key)) between 1 and 160),
  vendor text not null check(length(btrim(vendor)) between 1 and 160),
  description text not null check(length(btrim(description)) between 1 and 2000),
  reference text not null check(length(btrim(reference)) between 1 and 160),
  before_tax numeric(14,2) not null check(before_tax <> 'NaN'::numeric and before_tax >= 0),
  tax numeric(14,2) not null check(tax <> 'NaN'::numeric and tax >= 0),
  currency text not null check(currency='MYR'),
  original_currency text,
  original_amount numeric(14,2),
  conversion_note text,
  credit_of uuid references marketing.spend_entries(id),
  status text not null default 'recorded' check(status in ('recorded','voided')),
  version integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((entry_mode='credit')=(credit_of is not null)),
  check((category='platform_ads' and platform<>'shared' and entry_mode in ('daily_total','campaign','credit'))
    or (category<>'platform_ads' and platform='shared' and entry_mode in ('event','credit')))
);
create index spend_entries_period_idx on marketing.spend_entries(workspace_id,incurred_on,platform);
create index spend_entries_credit_idx on marketing.spend_entries(credit_of) where credit_of is not null;
create unique index spend_entries_key_idx on marketing.spend_entries(workspace_id,incurred_on,platform,lower(entry_key)) where status='recorded';
create unique index spend_event_reference_idx on marketing.spend_entries(workspace_id,lower(vendor),lower(reference)) where status='recorded' and entry_mode='event';
create table marketing.spend_coverage (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references core.workspaces(id),
  platform text not null check(platform in ('tiktok','meta','google_ads','shared')),
  date_from date not null, date_to date not null, reason text not null,
  confirmed_by uuid not null references auth.users(id), confirmed_at timestamptz not null default now(),
  invalidated_at timestamptz, check(date_to>=date_from and date_to-date_from<=366)
);
create index spend_coverage_period_idx on marketing.spend_coverage(workspace_id,platform,date_from,date_to) where invalidated_at is null;
create table marketing.spend_requests (
  workspace_id uuid not null, request_id uuid not null, actor_id uuid not null,
  payload jsonb not null, result uuid not null, primary key(workspace_id,request_id)
);
alter table marketing.spend_entries enable row level security;
alter table marketing.spend_coverage enable row level security;
alter table marketing.spend_requests enable row level security;
revoke all on marketing.spend_entries,marketing.spend_coverage,marketing.spend_requests from public,anon,authenticated;
create policy spend_read on marketing.spend_entries for select to authenticated using(
  workspace_id=(select core.current_workspace_id()) and (select core.has_permission('marketing.spend.read')));
create policy spend_coverage_read on marketing.spend_coverage for select to authenticated using(
  workspace_id=(select core.current_workspace_id()) and (select core.has_permission('marketing.spend.read')));
grant select on marketing.spend_entries,marketing.spend_coverage to authenticated;
create view api.spend_entries with(security_invoker=true) as select * from marketing.spend_entries;
create view api.spend_coverage with(security_invoker=true) as select * from marketing.spend_coverage;
grant select on api.spend_entries,api.spend_coverage to authenticated;

create function api.record_marketing_spend(p_action text,p_input jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  ws uuid:=core.current_workspace_id(); old marketing.spend_entries%rowtype; saved marketing.spend_entries%rowtype;
  parent marketing.spend_entries%rowtype; req marketing.spend_requests%rowtype;
  id uuid; day date; platform text; mode text; category text; amount numeric; tax numeric;
  reason text:=nullif(btrim(p_input->>'reason'),''); payload jsonb:=jsonb_build_object('action',p_action,'input',p_input);
  start_day date; end_day date; key text; original numeric; prior_net numeric; prior_tax numeric;
begin
  if auth.uid() is null or ws is null or not core.has_permission('marketing.spend.write') then
    raise exception 'Permission denied: marketing.spend.write' using errcode='42501'; end if;
  if p_request_id is null or p_input is null or p_action is null or p_action not in ('save','void','credit','coverage') then
    raise exception 'Choose a valid marketing command' using errcode='23514'; end if;
  -- Serialize workspace writes: coverage cannot race with a new or corrected cost.
  perform pg_advisory_xact_lock(hashtextextended('marketing-spend:'||ws::text,0));
  select * into req from marketing.spend_requests where workspace_id=ws and request_id=p_request_id;
  if found then
    if req.actor_id<>auth.uid() or req.payload<>payload then raise exception 'Retry differs from original command' using errcode='23514'; end if;
    return req.result;
  end if;
  if p_action='coverage' then
    if not core.has_permission('marketing.spend.review') then raise exception 'Permission denied: marketing.spend.review' using errcode='42501'; end if;
    platform:=p_input->>'platform'; start_day:=(p_input->>'date_from')::date; end_day:=(p_input->>'date_to')::date;
    if platform is null or platform not in ('tiktok','meta','google_ads','shared') or start_day is null or end_day is null
      or end_day<start_day or end_day-start_day>366 or end_day>(now() at time zone 'Asia/Kuala_Lumpur')::date
      or reason is null or length(reason)<5 or p_input->>'complete' is distinct from 'true' then
      raise exception 'Confirm all costs, including zero-spend days, for a valid period and explain your check' using errcode='23514'; end if;
    insert into marketing.spend_coverage(workspace_id,platform,date_from,date_to,reason,confirmed_by)
      values(ws,platform,start_day,end_day,reason,auth.uid()) returning spend_coverage.id into id;
    perform audit.emit(ws,'marketing.spend.coverage','marketing','spend_coverage',id,null,p_input,reason);
  else
    id:=nullif(p_input->>'id','')::uuid;
    if id is not null then
      select * into old from marketing.spend_entries e where e.id=id and e.workspace_id=ws for update;
      if not found then raise exception 'Marketing cost not found' using errcode='42501'; end if;
      if nullif(p_input->>'version','')::int is distinct from old.version then raise exception 'Marketing cost changed. Refresh before saving.' using errcode='40001'; end if;
      if old.status<>'recorded' then raise exception 'Voided cost cannot be changed' using errcode='23514'; end if;
      if not core.has_permission('marketing.spend.review') or reason is null or length(reason)<5 then
        raise exception 'A marketing cost reviewer and correction reason are required' using errcode='42501'; end if;
    elsif p_action<>'save' then raise exception 'Select an existing cost' using errcode='23514'; end if;
    if p_action='void' then
      if exists(select 1 from marketing.spend_entries e where e.credit_of=id and e.status='recorded') then
        raise exception 'Void the linked credits before voiding the original cost' using errcode='23514'; end if;
      update marketing.spend_entries e set status='voided',version=e.version+1,updated_at=now() where e.id=id returning * into saved;
    else
      day:=(p_input->>'incurred_on')::date; amount:=(p_input->>'before_tax')::numeric; tax:=(p_input->>'tax')::numeric;
      platform:=p_input->>'platform'; mode:=p_input->>'entry_mode'; category:=p_input->>'category';
      if p_action='credit' then
        if old.credit_of is not null then raise exception 'Credit the original cost, not another credit' using errcode='23514'; end if;
        parent:=old; platform:=old.platform; mode:='credit'; category:=old.category;
        select coalesce(sum(e.before_tax),0),coalesce(sum(e.tax),0) into prior_net,prior_tax from marketing.spend_entries e where e.credit_of=old.id and e.status='recorded';
        if day<old.incurred_on or amount+prior_net>old.before_tax or tax+prior_tax>old.tax then
          raise exception 'Credit exceeds the original cost or predates it' using errcode='23514'; end if;
        id:=null;
      elsif old.id is not null and (old.credit_of is not null or exists(select 1 from marketing.spend_entries e where e.credit_of=old.id and e.status='recorded')) then
        raise exception 'Costs with credits are immutable; void the credit first' using errcode='23514';
      end if;
      if day is null or day>(now() at time zone 'Asia/Kuala_Lumpur')::date or amount is null or tax is null
        or amount<0 or tax<0 or amount::text in ('NaN','Infinity','-Infinity') or tax::text in ('NaN','Infinity','-Infinity')
        or round(amount,2)<>amount or round(tax,2)<>tax or p_input->>'currency' is distinct from 'MYR'
        or platform is null or mode is null or category is null
        or platform not in ('tiktok','meta','google_ads','shared')
        or category not in ('platform_ads','influencer','content','creative','agency','event','other')
        or not ((category='platform_ads' and platform<>'shared' and mode in ('daily_total','campaign','credit'))
          or (category<>'platform_ads' and platform='shared' and mode in ('event','credit')))
        or (amount+tax=0 and mode<>'daily_total') then
        raise exception 'Enter a valid incurred date, category, explicit MYR amount and tax (zero if none)' using errcode='23514'; end if;
      if mode in ('daily_total','campaign') and exists(select 1 from marketing.spend_entries e
        where e.workspace_id=ws and e.incurred_on=day and e.platform=platform and e.status='recorded'
          and e.id is distinct from id and e.entry_mode in ('daily_total','campaign') and (mode='daily_total' or e.entry_mode='daily_total')) then
        raise exception 'Use one platform total or campaign detail for this day, never both' using errcode='23514'; end if;
      key:=case when mode='daily_total' then 'daily-total' else nullif(btrim(p_input->>'entry_key'),'') end;
      if key is null or nullif(btrim(p_input->>'vendor'),'') is null or nullif(btrim(p_input->>'description'),'') is null or nullif(btrim(p_input->>'reference'),'') is null then
        raise exception 'Enter campaign or event key, vendor, description and source reference' using errcode='23514'; end if;
      original:=nullif(p_input->>'original_amount','')::numeric;
      if nullif(p_input->>'original_currency','') is not null and p_input->>'original_currency'<>'MYR' and
        (original is null or original<=0 or original::text in ('NaN','Infinity','-Infinity') or nullif(btrim(p_input->>'conversion_note'),'') is null) then
        raise exception 'Foreign costs need the original amount and evidence for the MYR conversion' using errcode='23514'; end if;
      if id is null then
        insert into marketing.spend_entries(workspace_id,incurred_on,platform,category,entry_mode,entry_key,vendor,description,reference,before_tax,tax,currency,original_currency,original_amount,conversion_note,credit_of,created_by)
        values(ws,day,platform,category,mode,key,btrim(p_input->>'vendor'),btrim(p_input->>'description'),btrim(p_input->>'reference'),amount,tax,'MYR',nullif(p_input->>'original_currency',''),original,nullif(p_input->>'conversion_note',''),parent.id,auth.uid()) returning * into saved;
        id:=saved.id;
      else
        update marketing.spend_entries e set incurred_on=day,platform=platform,category=category,entry_mode=mode,entry_key=key,
          vendor=btrim(p_input->>'vendor'),description=btrim(p_input->>'description'),reference=btrim(p_input->>'reference'),before_tax=amount,tax=tax,
          original_currency=nullif(p_input->>'original_currency',''),original_amount=original,conversion_note=nullif(p_input->>'conversion_note',''),version=e.version+1,updated_at=now()
        where e.id=id returning * into saved;
      end if;
    end if;
    update marketing.spend_coverage c set invalidated_at=now() where c.workspace_id=ws and c.invalidated_at is null
      and ((c.platform=saved.platform and saved.incurred_on between c.date_from and c.date_to)
        or (c.platform=old.platform and old.incurred_on between c.date_from and c.date_to));
    perform audit.emit(ws,'marketing.spend.'||p_action,'marketing','spend_entries',id,
      case when old.id is not null then to_jsonb(old) else null end,to_jsonb(saved),reason);
  end if;
  insert into marketing.spend_requests values(ws,p_request_id,auth.uid(),payload,id);
  return id;
end $$;
revoke all on function api.record_marketing_spend(text,jsonb,uuid) from public,anon;
grant execute on function api.record_marketing_spend(text,jsonb,uuid) to authenticated;

create function api.marketing_spend_period(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); result jsonb;
begin
  if auth.uid() is null or ws is null or not core.has_permission('marketing.spend.read') then raise exception 'Permission denied: marketing.spend.read' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a valid period up to 367 days' using errcode='23514'; end if;
  with channels(platform) as(values('tiktok'),('meta'),('google_ads'),('shared')),
  costs as(select e.platform,sum((before_tax+tax)*case when credit_of is null then 1 else -1 end) total
    from marketing.spend_entries e where workspace_id=ws and status='recorded' and incurred_on between p_from and p_to group by e.platform)
  select jsonb_agg(jsonb_build_object('platform',c.platform,'amount',coalesce(k.total,0),'days',p_to-p_from+1,
    'covered_days',(select count(*) from generate_series(p_from::timestamp,p_to::timestamp,'1 day') d where exists(select 1 from marketing.spend_coverage x
    where x.workspace_id=ws and x.platform=c.platform and x.invalidated_at is null and d::date between x.date_from and x.date_to))))
  into result from channels c left join costs k using(platform);
  return result;
end $$;
revoke all on function api.marketing_spend_period(date,date) from public,anon;
grant execute on function api.marketing_spend_period(date,date) to authenticated;

-- Normalization groups source labels, not paid attribution. Website stays unknown.
create function reporting.channel_group(p_source text) returns text
language sql immutable set search_path='' as $$
 select case when p_source in ('meta','facebook','instagram') then 'meta'
   when p_source='tiktok' then 'tiktok' when p_source='google_ads' then 'google_ads'
   when p_source='walk_in' then 'walk_in' else 'other_unknown' end
$$;
revoke all on function reporting.channel_group(text) from public,anon,authenticated;

create function api.funnel_dashboard(p_from date,p_to date,p_as_of date,p_location uuid default null,p_spend_basis text default 'including_tax')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); start_at timestamptz; end_at timestamptz; asof_at timestamptz; result jsonb;
begin
  if auth.uid() is null or ws is null or not core.has_permission('report.read') then raise exception 'Permission denied: report.read' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_as_of is null or p_from>p_to or p_to-p_from>366 or p_as_of<p_to
    or p_as_of>(now() at time zone 'Asia/Kuala_Lumpur')::date or p_spend_basis is null or p_spend_basis not in ('including_tax','excluding_tax') then
    raise exception 'Choose a period up to 367 days, with an as-of date between its end and today' using errcode='23514'; end if;
  if p_location is not null and not exists(select 1 from core.business_locations where id=p_location and workspace_id=ws) then raise exception 'Location not found' using errcode='42501'; end if;
  start_at:=p_from::timestamp at time zone 'Asia/Kuala_Lumpur'; end_at:=(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur'; asof_at:=(p_as_of+1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  with
  channels(platform) as (values('tiktok'),('meta'),('google_ads'),('shared'),('walk_in'),('other_unknown')),
  coverage as (select platform,count(*) filter(where exists(select 1 from marketing.spend_coverage c
    where c.workspace_id=ws and c.platform=channels.platform and c.invalidated_at is null and d::date between c.date_from and c.date_to)) as covered_days
    from channels cross join generate_series(p_from::timestamp,p_to::timestamp,'1 day') d group by platform),
  costs as (select e.platform,sum((e.before_tax+case when p_spend_basis='including_tax' then e.tax else 0 end)*case when e.credit_of is null then 1 else -1 end) as spend
    from marketing.spend_entries e where e.workspace_id=ws and e.status='recorded' and e.incurred_on between p_from and p_to group by e.platform),
  sales_asof as (select p.id,p.contact_id,p.visit_id,p.lead_id,p.salesperson_id,p.purchased_at,p.location_id,sum(e.net_delta) as revenue
    from sales.purchases p join sales.sale_events e on e.purchase_id=p.id and e.occurred_at<asof_at
    where p.workspace_id=ws and p.currency='MYR' group by p.id having sum(e.net_delta)>0),
  lead_cohort as (select l.*,reporting.channel_group(l.source_channel) as platform,
    exists(select 1 from sales.visits v where v.workspace_id=ws and v.lead_id=l.id and v.occurred_at>=l.created_at and v.occurred_at<asof_at) as visited,
    exists(select 1 from sales_asof s where s.lead_id=l.id) as sold
    from sales.leads l where l.workspace_id=ws and l.status<>'duplicate' and l.created_at>=start_at and l.created_at<end_at
      and (p_location is null or l.location_id=p_location)),
  leads_grouped as (select platform,count(*) leads,count(*) filter(where first_whatsapp_sent_at<asof_at) whatsapp_sent,
    count(*) filter(where first_whatsapp_reply_at<asof_at) whatsapp_replied,count(*) filter(where visited) showroom,
    count(*) filter(where sold) closed,count(*) filter(where sold and first_whatsapp_reply_at<asof_at) replied_and_closed
    from lead_cohort group by platform),
  cohort_revenue as (select l.platform,sum(s.revenue) revenue from lead_cohort l join sales_asof s on s.lead_id=l.id group by l.platform),
  period_revenue as (select coalesce(sum(e.net_delta),0) revenue from sales.sale_events e join sales.purchases p on p.id=e.purchase_id
    where e.workspace_id=ws and p.currency='MYR' and e.occurred_at>=start_at and e.occurred_at<end_at and (p_location is null or p.location_id=p_location)),
  period_collections as (select coalesce(sum(pp.amount*case when pp.direction='refund' then -1 else 1 end),0) collections
    from sales.purchase_payments pp join sales.purchases p on p.id=pp.purchase_id where p.workspace_id=ws and pp.review_state='confirmed' and pp.currency='MYR'
    and pp.paid_at>=start_at and pp.paid_at<end_at and (p_location is null or p.location_id=p_location)),
  visits_cohort as (select v.*,exists(select 1 from sales_asof s where s.visit_id=v.id) as sold,
    (select coalesce(sum(s.revenue),0) from sales_asof s where s.visit_id=v.id) as revenue
    from sales.visits v where v.workspace_id=ws and v.occurred_at>=start_at and v.occurred_at<end_at and (p_location is null or v.location_id=p_location)),
  staff as (select v.staff_user_id as id,coalesce(pr.full_name,'Unassigned') as name,count(*) visits,
    count(distinct v.contact_id) customers,count(*) filter(where v.sold) converted_visits,sum(v.revenue) revenue,
    (select count(*) from sales.activities a where a.workspace_id=ws and a.actor_id is not distinct from v.staff_user_id
      and a.visit_id is not null and a.occurred_at>=start_at and a.occurred_at<end_at
      and exists(select 1 from sales.visits av where av.id=a.visit_id and (p_location is null or av.location_id=p_location))) as activities
    from visits_cohort v left join core.profiles pr on pr.user_id=v.staff_user_id group by v.staff_user_id,pr.full_name),
  summary as (select (select revenue from period_revenue) revenue,(select collections from period_collections) collections,
    (select coalesce(sum(spend),0) from costs) spend,
    (select count(*)=4 from coverage where platform in ('tiktok','meta','google_ads','shared') and covered_days=p_to-p_from+1) spend_complete,
    (select count(*) from lead_cohort) leads,(select count(*) from lead_cohort where sold) closed_leads,
    (select count(*) from lead_cohort where source_channel in ('tiktok','meta','facebook','instagram','google_ads','website','whatsapp','dm','email')) online_leads,
    (select count(*) from lead_cohort where source_channel in ('tiktok','meta','facebook','instagram','google_ads','website','whatsapp','dm','email') and sold) closed_online_leads,
    (select count(*) from visits_cohort) visits,(select count(distinct contact_id) from visits_cohort) identified_visitors,
    (select count(*) from visits_cohort where contact_id is null) unidentified_visits,
    (select count(*) from visits_cohort where sold) converted_visits,
    (select count(*) from visits_cohort where lead_id is not null) linked_visits,
    (select count(*) from sales.purchases p where p.workspace_id=ws and p.financial_state='legacy_unclassified'
      and p.purchased_at>=start_at and p.purchased_at<end_at and (p_location is null or p.location_id=p_location)) unclassified_sales,
    (select count(*) from sales.purchase_payments pp join sales.purchases p on p.id=pp.purchase_id where p.workspace_id=ws and pp.review_state<>'confirmed'
      and pp.paid_at>=start_at and pp.paid_at<end_at and (p_location is null or p.location_id=p_location)) unreviewed_payments,
    (select count(*) from sales.purchases p where p.workspace_id=ws and p.currency<>'MYR' and p.purchased_at>=start_at and p.purchased_at<end_at
      and (p_location is null or p.location_id=p_location)) foreign_sales)
  select jsonb_build_object('computed_at',now(),'summary',(select to_jsonb(s)||jsonb_build_object('mer',case when spend_complete and spend>0 and p_location is null then revenue/spend else null end) from summary s),
    'channels',(select jsonb_agg(jsonb_build_object('platform',c.platform,'spend',coalesce(k.spend,0),'covered_days',v.covered_days,'expected_days',p_to-p_from+1,
      'leads',coalesce(l.leads,0),'whatsapp_sent',coalesce(l.whatsapp_sent,0),'whatsapp_replied',coalesce(l.whatsapp_replied,0),'showroom',coalesce(l.showroom,0),
      'closed',coalesce(l.closed,0),'replied_and_closed',coalesce(l.replied_and_closed,0),'cohort_revenue',coalesce(r.revenue,0)))
      from channels c left join costs k using(platform) left join coverage v using(platform) left join leads_grouped l using(platform) left join cohort_revenue r using(platform)),
    'staff',coalesce((select jsonb_agg(to_jsonb(s) order by s.visits desc,s.name) from staff s),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function api.funnel_dashboard(date,date,date,uuid,text) from public,anon;
grant execute on function api.funnel_dashboard(date,date,date,uuid,text) to authenticated;

-- A separate permission gate protects named customer drilldowns from aggregate-only analysts.
create function api.funnel_history(p_from date,p_to date,p_as_of date,p_kind text default 'visits',p_page int default 1,
  p_location uuid default null,p_staff uuid default null,p_channel text default null,p_contact uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); start_at timestamptz; end_at timestamptz; asof_at timestamptz; result jsonb;
begin
  if auth.uid() is null or ws is null or not core.has_permission('report.read') or not core.has_permission('sales.read_all') then
    raise exception 'Named reporting history needs a sales manager or management role' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_as_of is null or p_from>p_to or p_to-p_from>366 or p_as_of<p_to
    or p_as_of>(now() at time zone 'Asia/Kuala_Lumpur')::date or p_kind is null or p_kind not in ('visits','leads','sales') or p_page is null or p_page<1 or p_page>100000 then
    raise exception 'Choose a valid history period and page' using errcode='23514'; end if;
  start_at:=p_from::timestamp at time zone 'Asia/Kuala_Lumpur';end_at:=(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur';asof_at:=(p_as_of+1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  with sale_totals as (select p.id,p.lead_id,p.visit_id,p.contact_id,p.purchased_at,p.external_ref,p.financial_state,p.location_id,p.salesperson_id,p.notes,
    coalesce((select sum(e.net_delta) from sales.sale_events e where e.purchase_id=p.id and e.occurred_at<asof_at),0) net_sales,
    coalesce((select sum(pp.amount*case when pp.direction='refund' then -1 else 1 end) from sales.purchase_payments pp where pp.purchase_id=p.id and pp.review_state='confirmed' and pp.paid_at<asof_at),0) collections
    from sales.purchases p where p.workspace_id=ws and p.currency='MYR' and p.purchased_at<asof_at),
  rows as (
    select v.id,v.occurred_at at_time,v.contact_id,c.display_name customer,coalesce(pr.full_name,'Unassigned') staff,v.staff_user_id staff_id,
      v.purpose label,v.inquiry_link_state state,v.notes,loc.name location,l.source_channel source,
      (select count(*) from sale_totals s where s.visit_id=v.id and s.net_sales>0) sale_count,
      (select coalesce(sum(s.net_sales),0) from sale_totals s where s.visit_id=v.id) net_sales,
      (select coalesce(sum(s.collections),0) from sale_totals s where s.visit_id=v.id) collections
    from sales.visits v left join identity.contacts c on c.id=v.contact_id left join core.profiles pr on pr.user_id=v.staff_user_id
      left join core.business_locations loc on loc.id=v.location_id left join sales.leads l on l.id=v.lead_id
    where p_kind='visits' and v.workspace_id=ws and v.occurred_at>=start_at and v.occurred_at<end_at
      and(p_location is null or v.location_id=p_location) and(p_staff is null or v.staff_user_id=p_staff) and(p_contact is null or v.contact_id=p_contact)
    union all
    select l.id,l.created_at,l.contact_id,coalesce(c.display_name,l.raw_name),coalesce(pr.full_name,'Unassigned'),l.owner_id,l.source_channel,l.status,l.notes,loc.name,l.source_channel,
      (select count(*) from sale_totals s where s.lead_id=l.id and s.net_sales>0),
      (select coalesce(sum(s.net_sales),0) from sale_totals s where s.lead_id=l.id),(select coalesce(sum(s.collections),0) from sale_totals s where s.lead_id=l.id)
    from sales.leads l left join identity.contacts c on c.id=l.contact_id left join core.profiles pr on pr.user_id=l.owner_id left join core.business_locations loc on loc.id=l.location_id
    where p_kind='leads' and l.workspace_id=ws and l.status<>'duplicate' and l.created_at>=start_at and l.created_at<end_at
      and(p_location is null or l.location_id=p_location) and(p_channel is null or reporting.channel_group(l.source_channel)=p_channel) and(p_contact is null or l.contact_id=p_contact)
    union all
    select s.id,s.purchased_at,s.contact_id,c.display_name,coalesce(pr.full_name,'Unassigned'),s.salesperson_id,s.external_ref,s.financial_state,s.notes,loc.name,l.source_channel,
      case when s.net_sales>0 then 1 else 0 end,s.net_sales,s.collections
    from sale_totals s left join identity.contacts c on c.id=s.contact_id left join core.profiles pr on pr.user_id=s.salesperson_id
      left join core.business_locations loc on loc.id=s.location_id left join sales.leads l on l.id=s.lead_id
    where p_kind='sales' and s.purchased_at>=start_at and s.purchased_at<end_at and(p_location is null or s.location_id=p_location)
      and(p_staff is null or s.salesperson_id=p_staff) and(p_contact is null or s.contact_id=p_contact)
  ), page as (select * from rows order by at_time desc,id limit 25 offset(p_page-1)*25)
  select jsonb_build_object('total',(select count(*) from rows),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by at_time desc,id) from page p),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function api.funnel_history(date,date,date,text,int,uuid,uuid,text,uuid) from public,anon;
grant execute on function api.funnel_history(date,date,date,text,int,uuid,uuid,text,uuid) to authenticated;

insert into reporting.metric_definitions(key,name,report_key,formula,grain,sources,pii_class,caveat,quality) values
('funnel_mer','Marketing efficiency ratio','funnel','Period recorded net sales excluding sales tax / period incurred marketing cost at selected tax basis','Business period',array['sales.sale_events','marketing.spend_entries','marketing.spend_coverage'],'aggregate','N/A when spend coverage is incomplete, spend is non-positive or a showroom location is selected. Unclassified historical documents are excluded.','monitored'),
('funnel_lead_sales','Lead-to-sale conversion','funnel','Distinct nonduplicate inquiries created in period with positive documented sales through as-of date / inquiries in that same cohort','Inquiry creation cohort',array['sales.leads','sales.sale_events','sales.purchases'],'aggregate','Source labels describe recorded origin; they do not prove paid advertising attribution. Later-stage counts can skip earlier stages.','monitored'),
('funnel_showroom','Showroom conversion','funnel','Distinct visits in period linked to positive documented sales through as-of date / visits in that period','Visit cohort',array['sales.visits','sales.purchases','sales.sale_events'],'aggregate','Visit count differs from unique identified visitors. Staff is the recorded visit handler. Unlinked sales are not inferred from a matching customer.','monitored');
