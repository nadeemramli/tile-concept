-- Marketing-cost batch import (first format: TikTok Ads trend report).
--
-- 1. Tax that a source does not report is recorded as unreported, never as zero.
--    `tax_status` is 'stated' (tax holds the stated amount, zero included) or
--    'unreported' (tax is null); the ledger command only accepts a null tax
--    when the caller says 'unreported' explicitly. Tax-inclusive totals then exclude what is
--    unknown and say so; MER at the tax-inclusive basis stays N/A until every
--    cost in the period has a stated tax.
-- 2. A batch is one source file. Each line is posted through
--    api.record_marketing_spend('save', ...), so the permission gate, the
--    one-daily-total-or-campaigns rule, the unique daily key, coverage
--    invalidation and the per-entry audit are the same rules the popup uses.
--    Batch and line rows keep provenance (file name, SHA-256, source rows and
--    campaigns); corrections to an imported entry go through the popup's
--    versioned correction path, and verification reports that drift.

-- The status is derived, so it can never disagree with the amount: a null tax
-- reads as unreported, and nothing turns it into zero.
alter table marketing.spend_entries
  alter column tax drop not null,
  add column tax_status text generated always as (case when tax is null then 'unreported' else 'stated' end) stored,
  add constraint spend_entries_credit_tax_check check(tax is not null or entry_mode<>'credit');

create table marketing.spend_import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null,
  source_format text not null check(source_format in ('tiktok_trend_report')),
  parser_version text not null check(length(btrim(parser_version)) between 1 and 40),
  source_name text not null check(length(btrim(source_name)) between 1 and 255),
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_count integer not null check(source_row_count>0),
  campaign_count integer not null check(campaign_count>=0),
  report_date_from date not null,
  report_date_to date not null,
  currency text not null check(currency='MYR'),
  currency_basis text not null check(currency_basis in ('report_stated','operator_declared')),
  tax_status text not null check(tax_status in ('unreported')),
  platform text not null check(platform='tiktok'),
  entry_mode text not null check(entry_mode='daily_total'),
  category text not null check(category='platform_ads'),
  vendor text not null check(length(btrim(vendor)) between 1 and 160),
  entry_count integer not null check(entry_count>0),
  total_before_tax numeric(14,2) not null check(total_before_tax>0),
  excluded_zero_dates date[] not null,
  status text not null check(status in ('imported','voided')),
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  void_reason text,
  unique(workspace_id,request_id),
  check(report_date_to>=report_date_from),
  check((status='voided')=(voided_at is not null and voided_by is not null and void_reason is not null))
);
-- The same file can be imported once at a time. Voiding its batch releases it.
create unique index spend_import_batches_source_idx on marketing.spend_import_batches(workspace_id,source_sha256) where status='imported';
create index spend_import_batches_recent_idx on marketing.spend_import_batches(workspace_id,imported_at desc);

-- What the source said for each date, kept as imported even after a correction.
create table marketing.spend_import_lines (
  batch_id uuid not null references marketing.spend_import_batches(id),
  workspace_id uuid not null references core.workspaces(id),
  incurred_on date not null,
  before_tax numeric(14,2) not null check(before_tax>0),
  campaigns jsonb not null check(jsonb_typeof(campaigns)='array' and jsonb_array_length(campaigns)>0),
  source_rows integer[] not null check(cardinality(source_rows)>0),
  spend_entry_id uuid not null unique references marketing.spend_entries(id),
  primary key(batch_id,incurred_on)
);

alter table marketing.spend_entries add column import_batch_id uuid references marketing.spend_import_batches(id);
create index spend_entries_import_batch_idx on marketing.spend_entries(import_batch_id) where import_batch_id is not null;

alter table marketing.spend_import_batches enable row level security;
alter table marketing.spend_import_lines enable row level security;
revoke all on marketing.spend_import_batches,marketing.spend_import_lines from public,anon,authenticated;
create policy spend_import_batches_read on marketing.spend_import_batches for select to authenticated using(
  workspace_id=(select core.current_workspace_id()) and (select core.has_permission('marketing.spend.read')));
create policy spend_import_lines_read on marketing.spend_import_lines for select to authenticated using(
  workspace_id=(select core.current_workspace_id()) and (select core.has_permission('marketing.spend.read')));
grant select on marketing.spend_import_batches,marketing.spend_import_lines to authenticated;
create or replace view api.spend_entries with(security_invoker=true) as select * from marketing.spend_entries;
create view api.spend_import_batches with(security_invoker=true) as select * from marketing.spend_import_batches;
create view api.spend_import_lines with(security_invoker=true) as select * from marketing.spend_import_lines;
grant select on api.spend_import_batches,api.spend_import_lines to authenticated;

-- The ledger command, unchanged except for the explicit tax status:
--   tax present, tax_status absent or 'stated'  -> stated tax (zero included)
--   tax absent,  tax_status 'unreported'        -> unreported tax, never zero
--   anything else                               -> refused
create or replace function api.record_marketing_spend(p_action text,p_input jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  ws uuid:=core.current_workspace_id(); old marketing.spend_entries%rowtype; saved marketing.spend_entries%rowtype;
  parent marketing.spend_entries%rowtype; req marketing.spend_requests%rowtype;
  id uuid; day date; platform text; mode text; category text; amount numeric; tax numeric; tax_status text;
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
      tax_status:=case
        when p_input->>'tax_status'='unreported' and tax is null then 'unreported'
        when coalesce(p_input->>'tax_status','stated')='stated' and tax is not null then 'stated' end;
      if p_action='credit' then
        if old.credit_of is not null then raise exception 'Credit the original cost, not another credit' using errcode='23514'; end if;
        if old.tax_status<>'stated' then raise exception 'State the original cost''s tax before recording a credit against it' using errcode='23514'; end if;
        if tax_status is distinct from 'stated' then raise exception 'A vendor credit states its tax (zero if none)' using errcode='23514'; end if;
        parent:=old; platform:=old.platform; mode:='credit'; category:=old.category;
        select coalesce(sum(e.before_tax),0),coalesce(sum(e.tax),0) into prior_net,prior_tax from marketing.spend_entries e where e.credit_of=old.id and e.status='recorded';
        if day<old.incurred_on or amount+prior_net>old.before_tax or tax+prior_tax>old.tax then
          raise exception 'Credit exceeds the original cost or predates it' using errcode='23514'; end if;
        id:=null;
      elsif old.id is not null and (old.credit_of is not null or exists(select 1 from marketing.spend_entries e where e.credit_of=old.id and e.status='recorded')) then
        raise exception 'Costs with credits are immutable; void the credit first' using errcode='23514';
      end if;
      if day is null or day>(now() at time zone 'Asia/Kuala_Lumpur')::date or amount is null or tax_status is null
        or amount<0 or coalesce(tax,0)<0 or amount::text in ('NaN','Infinity','-Infinity') or coalesce(tax,0)::text in ('NaN','Infinity','-Infinity')
        or round(amount,2)<>amount or round(coalesce(tax,0),2)<>coalesce(tax,0) or p_input->>'currency' is distinct from 'MYR'
        or platform is null or mode is null or category is null
        or platform not in ('tiktok','meta','google_ads','shared')
        or category not in ('platform_ads','influencer','content','creative','agency','event','other')
        or not ((category='platform_ads' and platform<>'shared' and mode in ('daily_total','campaign','credit'))
          or (category<>'platform_ads' and platform='shared' and mode in ('event','credit')))
        or (amount+coalesce(tax,0)=0 and mode<>'daily_total') then
        raise exception 'Enter a valid incurred date, category, explicit MYR amount and tax (zero if none, or mark it as not reported)' using errcode='23514'; end if;
      if mode in ('daily_total','campaign') and exists(select 1 from marketing.spend_entries e
        where e.workspace_id=ws and e.incurred_on=day and e.platform=platform and e.status='recorded'
          and e.id is distinct from id and e.entry_mode in ('daily_total','campaign') and (mode='daily_total' or e.entry_mode='daily_total')) then
        raise exception 'Use one platform total or campaign detail for this day, never both' using errcode='23514'; end if;
      key:=case when mode='daily_total' then 'daily-total' else nullif(btrim(p_input->>'entry_key'),'') end;
      if key is null or nullif(btrim(p_input->>'vendor'),'') is null or nullif(btrim(p_input->>'description'),'') is null or nullif(btrim(p_input->>'reference'),'') is null then
        raise exception 'Enter campaign or event key, vendor, description and source reference' using errcode='23514'; end if;
      original:=nullif(p_input->>'original_amount','')::numeric;
      if (nullif(p_input->>'original_currency','') is not null or original is not null or nullif(p_input->>'conversion_note','') is not null) and
        (coalesce(p_input->>'original_currency','') !~ '^[A-Z]{3}$' or original is null or original<=0 or original::text in ('NaN','Infinity','-Infinity')
          or round(original,2)<>original or nullif(btrim(p_input->>'conversion_note'),'') is null) then
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

-- Period totals: `amount` is before-tax plus stated tax. Entries whose tax is
-- unreported are counted so the UI can say the total excludes their tax.
drop function api.marketing_spend_period(date,date);
create function api.marketing_spend_period(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); result jsonb;
begin
  if auth.uid() is null or ws is null or not core.has_permission('marketing.spend.read') then raise exception 'Permission denied: marketing.spend.read' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Choose a valid period up to 367 days' using errcode='23514'; end if;
  with channels(platform) as(values('tiktok'),('meta'),('google_ads'),('shared')),
  costs as(select e.platform,sum((before_tax+coalesce(tax,0))*case when credit_of is null then 1 else -1 end) total,
      sum(before_tax*case when credit_of is null then 1 else -1 end) before_tax,count(*) filter(where tax_status='unreported') unreported
    from marketing.spend_entries e where workspace_id=ws and status='recorded' and incurred_on between p_from and p_to group by e.platform)
  select jsonb_agg(jsonb_build_object('platform',c.platform,'amount',coalesce(k.total,0),'before_tax',coalesce(k.before_tax,0),
    'tax_unreported_entries',coalesce(k.unreported,0),'days',p_to-p_from+1,
    'covered_days',(select count(*) from generate_series(p_from::timestamp,p_to::timestamp,'1 day') d where exists(select 1 from marketing.spend_coverage x
    where x.workspace_id=ws and x.platform=c.platform and x.invalidated_at is null and d::date between x.date_from and x.date_to))))
  into result from channels c left join costs k using(platform);
  return result;
end $$;
revoke all on function api.marketing_spend_period(date,date) from public,anon;
grant execute on function api.marketing_spend_period(date,date) to authenticated;

-- Funnel dashboard, unchanged except that an unreported tax makes the
-- tax-inclusive spend incomplete: it is reported, and MER is N/A.
create or replace function api.funnel_dashboard(p_from date,p_to date,p_as_of date,p_location uuid default null,p_spend_basis text default 'including_tax')
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
  costs as (select e.platform,sum((e.before_tax+case when p_spend_basis='including_tax' then coalesce(e.tax,0) else 0 end)*case when e.credit_of is null then 1 else -1 end) as spend,
      count(*) filter(where p_spend_basis='including_tax' and e.tax_status='unreported') as tax_unreported
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
    (select coalesce(sum(tax_unreported),0) from costs) spend_tax_unreported,
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
  select jsonb_build_object('computed_at',now(),'summary',(select to_jsonb(s)||jsonb_build_object('mer',case when spend_complete and spend_tax_unreported=0 and spend>0 and p_location is null then revenue/spend else null end) from summary s),
    'channels',(select jsonb_agg(jsonb_build_object('platform',c.platform,'spend',coalesce(k.spend,0),'spend_tax_unreported',coalesce(k.tax_unreported,0),'covered_days',v.covered_days,'expected_days',p_to-p_from+1,
      'leads',coalesce(l.leads,0),'whatsapp_sent',coalesce(l.whatsapp_sent,0),'whatsapp_replied',coalesce(l.whatsapp_replied,0),'showroom',coalesce(l.showroom,0),
      'closed',coalesce(l.closed,0),'replied_and_closed',coalesce(l.replied_and_closed,0),'cohort_revenue',coalesce(r.revenue,0)))
      from channels c left join costs k using(platform) left join coverage v using(platform) left join leads_grouped l using(platform) left join cohort_revenue r using(platform)),
    'staff',coalesce((select jsonb_agg(to_jsonb(s) order by s.visits desc,s.name) from staff s),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function api.funnel_dashboard(date,date,date,uuid,text) from public,anon;
grant execute on function api.funnel_dashboard(date,date,date,uuid,text) to authenticated;

-- Safe casts for validating untrusted payloads: null instead of an exception.
create function marketing.try_date(p text) returns date language plpgsql stable set search_path='' as $$
begin return case when p ~ '^\d{4}-\d{2}-\d{2}$' then p::date end; exception when others then return null; end $$;
create function marketing.try_money(p jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
  if jsonb_typeof(p) is distinct from 'number' then return null; end if;
  n:=(p#>>'{}')::numeric;
  return case when n::text in ('NaN','Infinity','-Infinity') or round(n,2)<>n then null else n end;
exception when others then return null; end $$;
revoke all on function marketing.try_date(text),marketing.try_money(jsonb) from public,anon,authenticated;

-- Every problem with a batch payload, all at once. The payload is recomputed
-- here rather than trusted: line sums, counts, totals and date order.
create function marketing.spend_batch_issues(p_input jsonb) returns text[]
language plpgsql stable set search_path='' as $$
declare
  issues text[]:='{}'::text[]; src jsonb:=p_input->'source'; map jsonb:=p_input->'mapping'; tot jsonb:=p_input->'totals';
  e jsonb; c jsonb; d date; amt numeric; csum numeric; n int:=0; total numeric:=0; dates date[]:='{}'::date[];
  today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; i int:=0; zero date; first_day date; last_day date;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then return array['Send a batch payload']; end if;
  if src is null or jsonb_typeof(src)<>'object' then return array['Describe the source file']; end if;
  if src->>'format' is distinct from 'tiktok_trend_report' then issues:=issues||text 'Only TikTok trend reports can be imported'; end if;
  if length(btrim(coalesce(src->>'name','')))not between 1 and 255 then issues:=issues||text 'Name the source file'; end if;
  if coalesce(src->>'sha256','') !~ '^[0-9a-f]{64}$' then issues:=issues||text 'The source file fingerprint (SHA-256) is missing'; end if;
  if length(btrim(coalesce(src->>'parser_version','')))not between 1 and 40 then issues:=issues||text 'The parser version is missing'; end if;
  if coalesce(src->>'row_count','') !~ '^[1-9][0-9]*$' then issues:=issues||text 'State how many source rows were read'; end if;
  if coalesce(src->>'campaign_count','') !~ '^[0-9]+$' then issues:=issues||text 'State how many campaigns were read'; end if;
  first_day:=marketing.try_date(src->>'date_from'); last_day:=marketing.try_date(src->>'date_to');
  if first_day is null or last_day is null or last_day<first_day then issues:=issues||text 'State the report''s first and last date'; end if;
  if p_input->>'currency' is distinct from 'MYR' then issues:=issues||text 'Only MYR amounts can be imported; nothing is converted'; end if;
  if coalesce(p_input->>'currency_basis','') not in ('report_stated','operator_declared') then issues:=issues||text 'Say whether the report states MYR or the operator declared it'; end if;
  -- A trend report carries spend only. Its tax is unreported, never zero.
  if p_input->>'tax_status' is distinct from 'unreported' then issues:=issues||text 'A TikTok trend report does not report tax: import its tax as unreported'; end if;
  if map is null or map->>'platform' is distinct from 'tiktok' or map->>'entry_mode' is distinct from 'daily_total' or map->>'category' is distinct from 'platform_ads' then
    issues:=issues||text 'Map the report to TikTok / Platform daily total / Platform advertising'; end if;
  if length(btrim(coalesce(map->>'vendor','')))not between 1 and 160 then issues:=issues||text 'Name the vendor'; end if;
  if jsonb_typeof(p_input->'entries') is distinct from 'array' or jsonb_array_length(p_input->'entries') not between 1 and 367 then
    return issues||text 'Send between 1 and 367 dated entries'; end if;
  for e in select * from jsonb_array_elements(p_input->'entries') loop
    i:=i+1;
    d:=marketing.try_date(e->>'incurred_on');
    if d is null then issues:=issues||format('Entry %s has no valid date',i); continue; end if;
    if d=any(dates) then issues:=issues||format('%s appears more than once',d); end if;
    dates:=dates||d;
    if d>today then issues:=issues||format('%s is in the future',d); end if;
    if first_day is not null and (d<first_day or d>last_day) then issues:=issues||format('%s is outside the report''s date range',d); end if;
    amt:=marketing.try_money(e->'before_tax');
    if amt is null or amt<=0 then
      issues:=issues||format('%s needs a positive MYR amount with at most two decimals',d); continue; end if;
    if jsonb_typeof(e->'campaigns') is distinct from 'array' or jsonb_array_length(e->'campaigns')=0 then
      issues:=issues||format('%s does not list its campaigns',d); continue; end if;
    if jsonb_typeof(e->'source_rows') is distinct from 'array' or jsonb_array_length(e->'source_rows')=0
      or exists(select 1 from jsonb_array_elements(e->'source_rows') r where (r#>>'{}') !~ '^[1-9][0-9]{0,8}$') then
      issues:=issues||format('%s does not list its source rows',d); end if;
    csum:=0;
    for c in select * from jsonb_array_elements(e->'campaigns') loop
      if length(btrim(coalesce(c->>'name','')))=0 or coalesce(marketing.try_money(c->'spend'),-1)<0 then
        issues:=issues||format('%s has a campaign without a name or a valid spend',d); csum:=null; exit; end if;
      csum:=csum+(c->>'spend')::numeric;
    end loop;
    if csum is not null and csum<>amt then issues:=issues||format('%s: campaign spend sums to %s, not %s',d,csum,amt); end if;
    n:=n+1; total:=total+amt;
  end loop;
  if jsonb_typeof(p_input->'excluded_zero_dates') is distinct from 'array' then issues:=issues||text 'List the zero-spend dates that were excluded (an empty list if none)';
  else
    for zero in select marketing.try_date(z#>>'{}') from jsonb_array_elements(p_input->'excluded_zero_dates') z loop
      if zero is null then issues:=issues||text 'An excluded zero-spend date is not a valid date';
      elsif zero=any(dates) then issues:=issues||format('%s is listed as zero-spend and as an entry',zero); end if;
    end loop;
  end if;
  if tot is null or tot->>'entry_count' is distinct from n::text then issues:=issues||format('The batch has %s dated entries, not the %s stated',n,coalesce(tot->>'entry_count','none')); end if;
  if tot is null or marketing.try_money(tot->'before_tax') is distinct from total then
    issues:=issues||format('The entries total MYR %s, not the MYR %s stated',to_char(total,'FM999999999990.00'),coalesce(tot->>'before_tax','none')); end if;
  return issues;
end $$;
revoke all on function marketing.spend_batch_issues(jsonb) from public,anon,authenticated;

-- Existing TikTok daily totals or campaign rows on the batch's dates.
create function marketing.spend_batch_conflicts(p_ws uuid,p_input jsonb) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('incurred_on',e.incurred_on,'entry_id',e.id,'entry_mode',e.entry_mode,'entry_key',e.entry_key,
    'before_tax',e.before_tax,'tax',e.tax,'tax_status',e.tax_status,'import_batch_id',e.import_batch_id,'reference',e.reference,
    'report_before_tax',marketing.try_money(x->'before_tax'),'same_amount',e.before_tax=marketing.try_money(x->'before_tax')) order by e.incurred_on,e.entry_key),'[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_input->'entries')='array' then p_input->'entries' else '[]'::jsonb end) x
  join marketing.spend_entries e on e.workspace_id=p_ws and e.platform='tiktok' and e.status='recorded'
    and e.entry_mode in ('daily_total','campaign') and e.incurred_on=marketing.try_date(x->>'incurred_on')
$$;
revoke all on function marketing.spend_batch_conflicts(uuid,jsonb) from public,anon,authenticated;

create function api.preview_marketing_spend_batch(p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); issues text[]; prior marketing.spend_import_batches%rowtype; conflicts jsonb;
begin
  if auth.uid() is null or ws is null or not core.has_permission('marketing.spend.read') then
    raise exception 'Permission denied: marketing.spend.read' using errcode='42501'; end if;
  issues:=marketing.spend_batch_issues(p_input);
  select * into prior from marketing.spend_import_batches b where b.workspace_id=ws and b.status='imported' and b.source_sha256=p_input#>>'{source,sha256}';
  conflicts:=marketing.spend_batch_conflicts(ws,p_input);
  return jsonb_build_object(
    'importable',cardinality(issues)=0 and prior.id is null and jsonb_array_length(conflicts)=0 and core.has_permission('marketing.spend.write'),
    'can_import',core.has_permission('marketing.spend.write'),
    'issues',to_jsonb(issues),
    'duplicate_batch',case when prior.id is null then null else jsonb_build_object('id',prior.id,'imported_at',prior.imported_at,'source_name',prior.source_name,
      'entry_count',prior.entry_count,'total_before_tax',prior.total_before_tax) end,
    'conflicts',conflicts);
end $$;
revoke all on function api.preview_marketing_spend_batch(jsonb) from public,anon;
grant execute on function api.preview_marketing_spend_batch(jsonb) to authenticated;

-- All or nothing: any refusal rolls back every line of the batch.
create function api.import_marketing_spend_batch(p_input jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  ws uuid:=core.current_workspace_id(); issues text[]; prior marketing.spend_import_batches%rowtype; conflicts jsonb;
  batch marketing.spend_import_batches%rowtype; e jsonb; entry_id uuid; day date; names text; ncamp int; src jsonb:=p_input->'source';
  sha12 text;
begin
  if auth.uid() is null or ws is null or not core.has_permission('marketing.spend.write') then
    raise exception 'Permission denied: marketing.spend.write' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'Choose a valid marketing command' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketing-spend:'||ws::text,0));
  select * into prior from marketing.spend_import_batches b where b.workspace_id=ws and b.request_id=p_request_id;
  if found then
    if prior.imported_by<>auth.uid() or prior.source_sha256 is distinct from src->>'sha256' then
      raise exception 'Retry differs from original command' using errcode='23514'; end if;
    return prior.id;
  end if;
  issues:=marketing.spend_batch_issues(p_input);
  if cardinality(issues)>0 then
    raise exception 'The batch cannot be imported: %',array_to_string(issues,'; ') using errcode='23514'; end if;
  select * into prior from marketing.spend_import_batches b where b.workspace_id=ws and b.status='imported' and b.source_sha256=src->>'sha256';
  if found then
    raise exception 'This report was already imported on % (batch %). Verify that batch, or void it before importing the file again.',
      to_char(prior.imported_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI'),prior.id using errcode='23505'; end if;
  conflicts:=marketing.spend_batch_conflicts(ws,p_input);
  if jsonb_array_length(conflicts)>0 then
    raise exception 'TikTok costs are already recorded on %. Each platform day takes one daily total or campaign detail, never both: export a range without these dates, or correct or void the existing entries first.',
      (select string_agg(distinct x->>'incurred_on',', ') from jsonb_array_elements(conflicts) x) using errcode='23514'; end if;

  insert into marketing.spend_import_batches(workspace_id,request_id,source_format,parser_version,source_name,source_sha256,source_row_count,campaign_count,
    report_date_from,report_date_to,currency,currency_basis,tax_status,platform,entry_mode,category,vendor,entry_count,total_before_tax,excluded_zero_dates,status,imported_by)
  values(ws,p_request_id,src->>'format',btrim(src->>'parser_version'),btrim(src->>'name'),src->>'sha256',(src->>'row_count')::int,(src->>'campaign_count')::int,
    (src->>'date_from')::date,(src->>'date_to')::date,'MYR',p_input->>'currency_basis','unreported','tiktok','daily_total','platform_ads',btrim(p_input#>>'{mapping,vendor}'),
    (p_input#>>'{totals,entry_count}')::int,(p_input#>>'{totals,before_tax}')::numeric,
    array(select (z#>>'{}')::date from jsonb_array_elements(p_input->'excluded_zero_dates') z order by 1),'imported',auth.uid())
  returning * into batch;
  sha12:=left(batch.source_sha256,12);

  for e in select x from jsonb_array_elements(p_input->'entries') x order by x->>'incurred_on' loop
    day:=(e->>'incurred_on')::date;
    select count(*),string_agg(c->>'name',', ' order by c->>'name') into ncamp,names from jsonb_array_elements(e->'campaigns') c;
    -- The same command the popup sends, so every ledger rule applies to every line.
    entry_id:=api.record_marketing_spend('save',jsonb_build_object(
      'incurred_on',day,'platform','tiktok','entry_mode','daily_total','category','platform_ads',
      'vendor',batch.vendor,'reference',left(format('TikTok trend %s · %s',sha12,day),160),
      'description',left(format('TikTok trend report daily total from %s (%s campaign%s): %s. Tax not reported in the source.',
        batch.source_name,ncamp,case when ncamp=1 then '' else 's' end,names),2000),
      'before_tax',(e->>'before_tax')::numeric,'tax_status','unreported','currency','MYR',
      'reason',format('Imported from marketing cost batch %s',batch.id)),
      md5(p_request_id::text||':'||day::text)::uuid);
    update marketing.spend_entries s set import_batch_id=batch.id where s.id=entry_id;
    insert into marketing.spend_import_lines(batch_id,workspace_id,incurred_on,before_tax,campaigns,source_rows,spend_entry_id)
    values(batch.id,ws,day,(e->>'before_tax')::numeric,e->'campaigns',array(select (r#>>'{}')::int from jsonb_array_elements(e->'source_rows') r),entry_id);
  end loop;
  perform audit.emit(ws,'marketing.spend.import','marketing','spend_import_batches',batch.id,null,to_jsonb(batch),null,
    jsonb_build_object('entries',batch.entry_count,'total_before_tax',batch.total_before_tax,'source_sha256',batch.source_sha256));
  return batch.id;
end $$;
revoke all on function api.import_marketing_spend_batch(jsonb,uuid) from public,anon;
grant execute on function api.import_marketing_spend_batch(jsonb,uuid) to authenticated;

-- Undo a wrong import: void every still-recorded entry through the ledger
-- command (reviewer + reason, audited), then release the file for re-import.
create function api.void_marketing_spend_batch(p_batch_id uuid,p_reason text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare ws uuid:=core.current_workspace_id(); batch marketing.spend_import_batches%rowtype; s marketing.spend_entries%rowtype; reason text:=nullif(btrim(p_reason),'');
begin
  if auth.uid() is null or ws is null or not core.has_permission('marketing.spend.review') then
    raise exception 'Permission denied: marketing.spend.review' using errcode='42501'; end if;
  if p_request_id is null or reason is null or length(reason)<5 then
    raise exception 'Explain why the batch is being voided' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketing-spend:'||ws::text,0));
  select * into batch from marketing.spend_import_batches b where b.id=p_batch_id and b.workspace_id=ws for update;
  if not found then raise exception 'Import batch not found' using errcode='42501'; end if;
  if batch.status='voided' then return batch.id; end if;
  for s in select e.* from marketing.spend_entries e join marketing.spend_import_lines l on l.spend_entry_id=e.id
    where l.batch_id=batch.id and e.status='recorded' order by e.incurred_on loop
    perform api.record_marketing_spend('void',jsonb_build_object('id',s.id,'version',s.version,'reason',format('Batch %s voided: %s',batch.id,reason)),
      md5(p_request_id::text||':'||s.id::text)::uuid);
  end loop;
  update marketing.spend_import_batches b set status='voided',voided_by=auth.uid(),voided_at=now(),void_reason=reason where b.id=batch.id returning * into batch;
  perform audit.emit(ws,'marketing.spend.import_void','marketing','spend_import_batches',batch.id,null,to_jsonb(batch),reason);
  return batch.id;
end $$;
revoke all on function api.void_marketing_spend_batch(uuid,text,uuid) from public,anon;
grant execute on function api.void_marketing_spend_batch(uuid,text,uuid) to authenticated;

-- Compare what a batch imported with what the ledger holds now.
create function api.verify_marketing_spend_batch(p_batch_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); batch marketing.spend_import_batches%rowtype; lines jsonb; issues text[]:='{}'::text[];
  line_count int; line_total numeric; overlap_rows jsonb;
begin
  if auth.uid() is null or ws is null or not core.has_permission('marketing.spend.read') then
    raise exception 'Permission denied: marketing.spend.read' using errcode='42501'; end if;
  select * into batch from marketing.spend_import_batches b where b.id=p_batch_id and b.workspace_id=ws;
  if not found then raise exception 'Import batch not found' using errcode='42501'; end if;
  select count(*),coalesce(sum(l.before_tax),0),coalesce(jsonb_agg(jsonb_build_object(
      'incurred_on',l.incurred_on,'imported_before_tax',l.before_tax,'campaign_count',jsonb_array_length(l.campaigns),'source_rows',to_jsonb(l.source_rows),
      'entry_id',e.id,'ledger_status',e.status,'ledger_before_tax',e.before_tax,'ledger_tax',e.tax,'ledger_tax_status',e.tax_status,'version',e.version,
      'state',case when e.status='voided' then 'voided' when e.before_tax<>l.before_tax or e.incurred_on<>l.incurred_on or e.platform<>'tiktok' or e.entry_mode<>'daily_total' then 'corrected'
        when e.version>1 then 'edited' else 'matches' end) order by l.incurred_on),'[]'::jsonb)
    into line_count,line_total,lines
  from marketing.spend_import_lines l join marketing.spend_entries e on e.id=l.spend_entry_id where l.batch_id=batch.id;
  select coalesce(jsonb_agg(jsonb_build_object('incurred_on',o.incurred_on,'entry_id',o.id,'entry_mode',o.entry_mode,'entry_key',o.entry_key)),'[]'::jsonb) into overlap_rows
  from marketing.spend_entries o join marketing.spend_import_lines l on l.batch_id=batch.id and o.incurred_on=l.incurred_on
  where o.workspace_id=ws and o.platform='tiktok' and o.status='recorded' and o.entry_mode in ('daily_total','campaign') and o.id<>l.spend_entry_id;
  if line_count<>batch.entry_count then issues:=issues||format('The batch recorded %s lines, not %s',line_count,batch.entry_count); end if;
  if line_total<>batch.total_before_tax then issues:=issues||format('Lines total MYR %s, not MYR %s',line_total,batch.total_before_tax); end if;
  if jsonb_array_length(overlap_rows)>0 then issues:=issues||text 'Other TikTok daily totals or campaign entries overlap the imported dates'; end if;
  return jsonb_build_object(
    'batch',to_jsonb(batch),
    'lines',lines,
    'overlaps',overlap_rows,
    'issues',to_jsonb(issues),
    'summary',jsonb_build_object(
      'entries',line_count,'imported_before_tax',line_total,
      'matching',(select count(*) from jsonb_array_elements(lines) x where x->>'state'='matches'),
      'edited',(select count(*) from jsonb_array_elements(lines) x where x->>'state'='edited'),
      'corrected',(select count(*) from jsonb_array_elements(lines) x where x->>'state'='corrected'),
      'voided',(select count(*) from jsonb_array_elements(lines) x where x->>'state'='voided'),
      'ledger_before_tax',(select coalesce(sum((x->>'ledger_before_tax')::numeric),0) from jsonb_array_elements(lines) x where x->>'ledger_status'='recorded'),
      'tax_unreported',(select count(*) from jsonb_array_elements(lines) x where x->>'ledger_status'='recorded' and x->>'ledger_tax_status'='unreported')),
    'reconciled',cardinality(issues)=0 and batch.status='imported'
      and not exists(select 1 from jsonb_array_elements(lines) x where x->>'state' in ('corrected','voided')));
end $$;
revoke all on function api.verify_marketing_spend_batch(uuid) from public,anon;
grant execute on function api.verify_marketing_spend_batch(uuid) to authenticated;
