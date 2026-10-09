-- Walk-in collections by person and by period.
--
-- The showroom Daily Tracker shows, per day, who served each visit (SMP) and
-- the collection taken against it. api.report_walkins only groups by location,
-- so a reader could see the total collected but not whose sale it was, nor
-- compare one week with the next. This function answers both questions in one
-- set-based pass over visits, walk-in sales and their payments, bucketed on
-- the Kuala Lumpur calendar at the chosen grain (day, ISO week or month) and
-- optionally split by person.
--
-- Attribution is never inferred:
--   visits       -> sales.visits.staff_user_id      the staff member who served the visit
--   sales closed -> sales.purchases.salesperson_id  the person who closed the sale
--   collections  -> payments on those sales, dated by paid_at (purchase date when a
--                   legacy payment carries no time)
-- A row whose person is null is reported as 'Unassigned'; the visit's staff is
-- not copied onto the sale.
--
-- Walk-in scope is a purchase linked to a visit or recorded with
-- purchase_source = 'walk_in'. Document totals are the historical
-- sales.purchases.amount, including unclassified legacy records, so they agree
-- with api.report_walkins. Collections count only review_state = 'confirmed'
-- payments, net of refunds; payments still awaiting review are counted on their
-- own column so the gap stays visible instead of being summed in or dropped.

create or replace function api.report_walkin_collections(
  p_from date default null,
  p_to date default null,
  p_grain text default 'day',
  p_by_person boolean default false)
returns table (
  period_start date,
  period_end date,
  person_id uuid,
  person text,
  visits bigint,
  new_customers bigint,
  purchases bigint,
  amount numeric,
  collections numeric,
  unreviewed_payments bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_grain text := coalesce(p_grain, 'day');
  v_by_person boolean := coalesce(p_by_person, false);
  v_step interval;
  v_from timestamptz;
  v_to timestamptz;
begin
  if auth.uid() is null or not core.has_permission('report.read') then
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
    where v.workspace_id in (select core.member_workspace_ids())
      and (v_from is null or v.occurred_at >= v_from)
      and (v_to is null or v.occurred_at < v_to)
    group by 1, 2
  ),
  walkin_sales as (
    select p.id, p.status, p.purchased_at, p.salesperson_id, p.amount
    from sales.purchases p
    where p.workspace_id in (select core.member_workspace_ids())
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
end $$;

revoke all on function api.report_walkin_collections(date, date, text, boolean) from public, anon;
grant execute on function api.report_walkin_collections(date, date, text, boolean) to authenticated;

-- Governed definitions: one report_key per report in the registry.
insert into reporting.metric_definitions (key, name, report_key, formula, grain, sources, pii_class, caveat, quality) values
  ('walkin_person_collections', 'Collections by person', 'walkin_person',
   'Confirmed payments on walk-in sales, net of refunds, grouped by the salesperson on the sale and the Kuala Lumpur day, ISO week or month the payment was taken',
   'Person and period', array['sales.purchases', 'sales.purchase_payments', 'core.profiles'], 'aggregate',
   'Collections and sales follow the salesperson on the sale; visits follow the staff member who served them, so the two can differ on one row. Payments awaiting review are counted separately and excluded from the collected total. Unassigned means no person is recorded on the sale.', 'monitored'),
  ('walkin_person_visits', 'Visits served', 'walkin_person',
   'Visits in the period whose serving staff member (the Daily Tracker SMP) is this person, with the new-customer subset',
   'Person and period', array['sales.visits'], 'aggregate', null, 'monitored'),
  ('walkin_period_collections', 'Collections by period', 'walkin_period',
   'Confirmed payments on walk-in sales, net of refunds, by the Kuala Lumpur day, ISO week or month the payment was taken',
   'Period', array['sales.purchases', 'sales.purchase_payments'], 'aggregate',
   'Document totals are historical amounts including unclassified records; collections count reviewed payments only, so the two columns are not expected to match. A sale paid in a later week shows its collection in that later week. Weeks start on Monday.', 'monitored'),
  ('walkin_period_visits', 'Visits and walk-in sales by period', 'walkin_period',
   'Visits by visit date and walk-in sales (visit-linked or recorded as walk-in) by purchase date, in the same period',
   'Period', array['sales.visits', 'sales.purchases'], 'aggregate',
   'Purchases recorded in this app only; accounting remains SQL Account.', 'monitored')
on conflict (key) do nothing;
