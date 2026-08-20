-- Phase 6 — Governed reports (PRD §7.9, §15).
-- Every report declares its metric definition, grain, filters, source lineage,
-- freshness and PII classification. Definitions live in the database so the
-- app and any future export agree on what a number means.

create table if not exists reporting.metric_definitions (
  key text primary key,
  name text not null,
  report_key text not null,
  formula text not null,
  grain text not null,
  sources text[] not null default '{}',
  pii_class text not null default 'aggregate' check (pii_class in ('aggregate','masked','personal')),
  caveat text,
  quality text not null default 'monitored' check (quality in ('trusted','monitored','degraded'))
);
alter table reporting.metric_definitions enable row level security;
create policy anyone_read on reporting.metric_definitions for select to authenticated using (true);
grant usage on schema reporting to authenticated;
grant select on reporting.metric_definitions to authenticated;
grant all on reporting.metric_definitions to service_role;

insert into reporting.metric_definitions (key, name, report_key, formula, grain, sources, pii_class, caveat, quality) values
  ('pipeline_open_value', 'Open pipeline value', 'pipeline', 'Sum of estimated value on opportunities in an open stage', 'Opportunity', array['sales.opportunities'], 'aggregate', 'Estimates entered by sales, not a weighted forecast — probability bands are not yet accepted by the business.', 'monitored'),
  ('pipeline_aging', 'Opportunity aging', 'pipeline', 'Days since the last stage change on open opportunities', 'Opportunity', array['sales.opportunity_stage_events'], 'aggregate', null, 'trusted'),
  ('lead_first_response', 'Median first response', 'lead_source', 'Median of first_response_at minus created_at, per source', 'Lead', array['sales.leads'], 'aggregate', 'Only counts responses logged in the app; a reply sent from a personal phone is invisible here.', 'monitored'),
  ('lead_conversion', 'Lead to opportunity rate', 'lead_source', 'Converted leads divided by all leads in the period, per source', 'Lead', array['sales.leads'], 'aggregate', null, 'monitored'),
  ('quote_conversion', 'Quote win rate', 'quote', 'Won opportunities with an issued quote divided by all opportunities with an issued quote', 'Opportunity', array['sales.quotes','sales.quote_versions','sales.opportunities'], 'aggregate', null, 'monitored'),
  ('walkin_purchase_rate', 'Walk-in purchase rate', 'walkin', 'Visits with a linked purchase divided by all visits', 'Visit', array['sales.visits','sales.purchases'], 'aggregate', 'Purchases recorded in this app only; accounting remains SQL Account.', 'monitored'),
  ('repeat_rate', 'Repeat purchase rate', 'cohort', 'Customers with more than one accepted purchase divided by customers with any purchase', 'Contact', array['sales.purchases'], 'aggregate', 'Depends on identity resolution — unmerged duplicates understate repeat behaviour.', 'monitored'),
  ('product_demand', 'Product demand', 'demand', 'Count and value of quote and purchase lines per product, brand and category', 'Product', array['sales.quote_items','sales.purchase_items'], 'aggregate', 'Only lines captured at item level; total-only purchases are excluded.', 'degraded'),
  ('price_coverage', 'Price coverage', 'price', 'Active products with a current approved price divided by all active products', 'Product', array['merch.products','merch.variant_prices'], 'aggregate', null, 'trusted'),
  ('stock_freshness', 'Supplier freshness', 'stock', 'Suppliers whose latest snapshot is within their freshness policy', 'Supplier', array['stock.supplier_availability_snapshots'], 'aggregate', null, 'trusted'),
  ('data_quality_open', 'Open data issues', 'data_quality', 'Data-quality issues in the open state by type and severity', 'Issue', array['ingest.data_quality_issues'], 'aggregate', null, 'trusted'),
  ('content_pipeline', 'Content pipeline', 'content', 'Content opportunities by status, permission state and shoot outcome', 'Content opportunity', array['marketing.content_opportunities','marketing.shoot_bookings'], 'aggregate', null, 'monitored')
on conflict (key) do nothing;

create or replace view api.metric_definitions with (security_invoker = true) as
select * from reporting.metric_definitions;
grant select on api.metric_definitions to authenticated;

------------------------------------------------------------------------------
-- Report queries. Each returns tidy rows the UI charts and tables directly.
-- All are aggregate; none expose a contact's identifiers.
------------------------------------------------------------------------------

-- 1. Pipeline and aging
create or replace function api.report_pipeline(p_from date default null, p_to date default null)
returns table (stage_key text, stage_label text, reporting_group text, stage_position int, opportunities bigint, open_value numeric, avg_age_days numeric, overdue bigint)
language sql stable security definer set search_path = '' as $$
  select st.key, st.label, st.reporting_group, st.position,
         count(o.id), coalesce(sum(o.estimated_value), 0),
         round(avg(extract(epoch from (now() - o.updated_at)) / 86400)::numeric, 1),
         count(*) filter (where o.next_action_due_at < now() and o.status = 'open')
  from core.opportunity_stages st
  left join sales.opportunities o on o.stage_key = st.key and o.workspace_id = st.workspace_id
    and core.has_permission('report.read')
    and (p_from is null or o.created_at >= p_from) and (p_to is null or o.created_at < p_to + 1)
  where st.workspace_id in (select core.member_workspace_ids()) and st.is_active
  group by st.key, st.label, st.reporting_group, st.position
  order by st.position
$$;
grant execute on function api.report_pipeline(date,date) to authenticated;

-- 2. Lead source and response performance
create or replace function api.report_lead_source(p_from date default null, p_to date default null)
returns table (source_channel text, leads bigint, responded bigint, median_response_minutes numeric, qualified bigint, converted bigint, disqualified bigint)
language sql stable security definer set search_path = '' as $$
  select l.source_channel,
         count(*),
         count(*) filter (where l.first_response_at is not null),
         round((percentile_cont(0.5) within group (order by extract(epoch from (l.first_response_at - l.created_at)) / 60))::numeric, 1),
         count(*) filter (where l.qualified_at is not null),
         count(*) filter (where l.status = 'converted'),
         count(*) filter (where l.status = 'disqualified')
  from sales.leads l
  where l.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
    and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to + 1)
  group by l.source_channel
  order by 2 desc
$$;
grant execute on function api.report_lead_source(date,date) to authenticated;

-- 3. Quote conversion and revisions
create or replace function api.report_quotes(p_from date default null, p_to date default null)
returns table (bucket text, quotes bigint, revisions numeric, total_value numeric, won bigint, lost bigint, open bigint)
language sql stable security definer set search_path = '' as $$
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
  where q.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
    and (p_from is null or q.created_at >= p_from) and (p_to is null or q.created_at < p_to + 1)
  group by 1
  order by 2 desc
$$;
grant execute on function api.report_quotes(date,date) to authenticated;

-- 4. Walk-ins, new versus existing, purchases and payment channels
create or replace function api.report_walkins(p_from date default null, p_to date default null)
returns table (bucket text, visits bigint, new_customers bigint, purchases bigint, amount numeric, payment_mix jsonb)
language sql stable security definer set search_path = '' as $$
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
  left join sales.purchases p on p.visit_id = v.id and p.status <> 'voided'
  where v.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
    and (p_from is null or v.occurred_at >= p_from) and (p_to is null or v.occurred_at < p_to + 1)
  group by loc.name, v.location_id, v.workspace_id
  order by 2 desc
$$;
grant execute on function api.report_walkins(date,date) to authenticated;

-- 5. Customer repeat and cohort behaviour
create or replace function api.report_cohorts(p_from date default null, p_to date default null)
returns table (cohort_month date, customers bigint, repeat_customers bigint, purchases bigint, amount numeric, median_days_between numeric)
language sql stable security definer set search_path = '' as $$
  with per_contact as (
    select p.contact_id,
           date_trunc('month', min(p.purchased_at))::date as cohort_month,
           count(*) as purchase_count,
           sum(p.amount) as amount,
           case when count(*) > 1
                then extract(epoch from (max(p.purchased_at) - min(p.purchased_at))) / 86400 / (count(*) - 1)
           end as avg_gap_days
    from sales.purchases p
    where p.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
      and p.status <> 'voided' and p.contact_id is not null
      and (p_from is null or p.purchased_at >= p_from) and (p_to is null or p.purchased_at < p_to + 1)
    group by p.contact_id
  )
  select cohort_month, count(*), count(*) filter (where purchase_count > 1),
         sum(purchase_count), sum(amount),
         round((percentile_cont(0.5) within group (order by avg_gap_days))::numeric, 1)
  from per_contact
  group by cohort_month
  order by cohort_month
$$;
grant execute on function api.report_cohorts(date,date) to authenticated;

-- 6. Product, brand and category demand
create or replace function api.report_demand(p_from date default null, p_to date default null)
returns table (product_id uuid, product_code text, product_name text, brand_name text, category_label text, quoted_qty numeric, quoted_value numeric, purchased_qty numeric, purchased_value numeric)
language sql stable security definer set search_path = '' as $$
  select pr.id, pr.code, pr.name, b.name, c.label,
         coalesce(sum(qi.quantity), 0), coalesce(sum(qi.line_total), 0),
         coalesce(sum(pi.quantity), 0), coalesce(sum(pi.line_total), 0)
  from merch.products pr
  left join merch.brands b on b.id = pr.brand_id
  left join merch.product_categories c on c.id = pr.category_id
  left join merch.product_variants v on v.product_id = pr.id
  left join sales.quote_items qi on qi.product_variant_id = v.id
  left join sales.purchase_items pi on pi.product_variant_id = v.id
  where pr.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
  group by pr.id, pr.code, pr.name, b.name, c.label
  having coalesce(sum(qi.quantity), 0) + coalesce(sum(pi.quantity), 0) > 0
  order by 9 desc, 7 desc
$$;
grant execute on function api.report_demand(date,date) to authenticated;

-- 7. Price coverage, expiry and conflicts
create or replace function api.report_price_health()
returns table (bucket text, products bigint, with_current_price bigint, conflicted bigint, expiring_30d bigint, unreviewed bigint)
language sql stable security definer set search_path = '' as $$
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
  where pr.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read') and pr.status = 'active'
  group by b.name
  order by 2 desc
$$;
grant execute on function api.report_price_health() to authenticated;

-- 8. Stock freshness and supplier update compliance
create or replace function api.report_stock_freshness()
returns table (supplier_name text, freshness text, last_update_at timestamptz, snapshot_count bigint, open_cases bigint)
language sql stable security definer set search_path = '' as $$
  select q.supplier_name, q.freshness, q.last_update_at, q.snapshot_count,
         (select count(*) from stock.stock_reconciliation_cases rc where rc.workspace_id = q.workspace_id and rc.status = 'open')
  from api.stale_supplier_queue q
  where core.has_permission('report.read')
  order by case q.freshness when 'stale' then 0 when 'unknown' then 1 when 'aging' then 2 else 3 end, q.supplier_name
$$;
grant execute on function api.report_stock_freshness() to authenticated;

-- 9. Data quality, duplicate review and import throughput
create or replace function api.report_data_quality()
returns table (bucket text, open_issues bigint, high_severity bigint, resolved_30d bigint, pending_reviews bigint, duplicates_open bigint)
language sql stable security definer set search_path = '' as $$
  select d.issue_type,
         count(*) filter (where d.status = 'open'),
         count(*) filter (where d.status = 'open' and d.severity = 'high'),
         count(*) filter (where d.resolved_at > now() - interval '30 days'),
         (select count(*) from ingest.review_items ri where ri.workspace_id = d.workspace_id and ri.status = 'pending'),
         (select count(*) from identity.identity_match_candidates mc where mc.workspace_id = d.workspace_id and mc.status = 'suggested')
  from ingest.data_quality_issues d
  where d.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
  group by d.issue_type, d.workspace_id
  order by 2 desc
$$;
grant execute on function api.report_data_quality() to authenticated;

-- 10. Customer-project content pipeline
create or replace function api.report_content_pipeline()
returns table (status text, opportunities bigint, permission_approved bigint, shoots_confirmed bigint, shoots_completed bigint, usable_assets bigint)
language sql stable security definer set search_path = '' as $$
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
  where co.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
  group by co.status
  order by 2 desc
$$;
grant execute on function api.report_content_pipeline() to authenticated;
