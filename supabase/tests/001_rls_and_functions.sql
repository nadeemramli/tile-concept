-- pgTAP: RLS scoping and business-function guards.
-- Runs against a freshly seeded local database (`supabase test db`).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- helper to act as a demo user
create or replace function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- 1. anon sees nothing through the api schema
set local role anon;
select throws_like($$select count(*) from api.contacts$$, '%permission denied%', 'anon has no access to the api schema');
reset role;

-- 2. sales rep sees only own/unowned opportunities, manager sees all
-- Scoped to the workspace these users belong to. An unscoped count was correct
-- only while exactly one workspace existed; the demo workspace added by guest
-- mode made it count rows the manager cannot see, and should not see.
create temp table t_counts as
  select (select count(*) from sales.opportunities
          where workspace_id = '11111111-1111-1111-1111-111111111111') as opps;
grant select on t_counts to authenticated;
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select ok((select count(*) from api.opportunities) < (select opps from t_counts), 'sales rep is owner-scoped on opportunities');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select is((select count(*) from api.opportunities), (select opps from t_counts), 'sales manager (sales.read_all) sees all opportunities');

-- 3. catalog operator has no sales visibility
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select is((select count(*) from api.contacts), 0::bigint, 'catalog operator cannot read contacts');
select ok((select count(*) from api.products) > 0, 'catalog operator can read products');

-- 4. sales rep cannot merge identities
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_like(
  $$select api.merge_contacts((select id from identity.contacts order by created_at limit 1), (select id from identity.contacts order by created_at offset 1 limit 1), 'test')$$,
  '%permission denied%', 'sales rep cannot merge contacts');

-- 5. sales rep cannot publish prices
select throws_like($$select api.publish_price((select id from merch.variant_prices limit 1))$$, '%permission denied%', 'sales rep cannot publish prices');

-- 6. stage change to won without reason is rejected
select throws_like(
  $$select api.change_opportunity_stage((select id from sales.opportunities where status = 'open' and (owner_id = 'aaaaaaaa-0000-0000-0000-000000000003' or owner_id is null) limit 1), 'won', null)$$,
  '%reason required%', 'won requires a reason');

-- 7. walk-in + purchase derives repeat and audits
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
select lives_ok(
  $$select api.record_walk_in((select id from identity.contacts where merged_into_contact_id is null order by created_at limit 1), null, '22222222-2222-2222-2222-222222222201', null, now(), 'homeowner', 'Cheras', 'tiktok', 'purchase', 'test', false, null, null, null, '{}', '{"amount": 100, "external_ref":"ORC-T-1", "payments":[{"method":"cash","amount":100}]}'::jsonb)$$,
  'showroom staff can record a walk-in with purchase');
select ok(exists(select 1 from audit.audit_events where action = 'visit.recorded'), 'walk-in emits audit event');

-- 8. price publish conflict detection
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like(
  $$
  with v as (select variant_id, price_list_id, unit_id, currency from merch.variant_prices where state = 'current' limit 1),
  ins as (insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, valid_from, state)
          select '11111111-1111-1111-1111-111111111111', price_list_id, variant_id, 1, currency, unit_id, current_date, 'draft' from v returning id)
  select api.publish_price((select id from ins))
  $$, '%overlapping current price%', 'publishing an overlapping price is blocked without override');

-- 9. audit read for catalog operator limited by permission (audit.read) — can read own rows
select ok((select count(*) from api.audit_events) >= 0, 'audit view readable under permission');

select * from finish();
rollback;
