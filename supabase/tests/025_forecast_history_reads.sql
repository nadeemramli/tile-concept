-- TILE-89: forecast history and the forecast readers read each opportunity with
-- the caller's own active sales.read in that opportunity's workspace, under its
-- existing RLS. Both orientations, the owner restriction, suspended / revoked /
-- non-member / no-reader / anonymous controls, and commands that still act in
-- the acting workspace only. Synthetic fixtures only; everything is rolled back.
--
-- Holds with or without TILE-62 (20261029000002). History follows the per-row
-- rule in every order. The opportunity itself follows its own policy, which
-- before TILE-62 still unions permissions across memberships (TILE-62's repair,
-- not this one); the readers return exactly the visible opportunities, so where
-- that differs the expectation is stated per order with pg_temp.p().
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
create function pg_temp.mkuser(u uuid, email text) returns void language sql as $$
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
    confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
  values('00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false);
$$;
-- Memberships in A are always older, so A is the acting workspace.
create function pg_temp.member(u uuid, w uuid, r text, st text default 'active', age int default 10) returns void language sql as $$
  insert into core.memberships(workspace_id,user_id,role_key,status,created_at) values (w,u,r,st,now() - make_interval(mins => age));
$$;
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('dddddddd-8900-0000-0001-' || lpad(n::text,12,'0'))::uuid $$;
-- "A/B": which of the two fixture opportunities a read returns.
create function pg_temp.ab(ids uuid[]) returns text language sql immutable as $$
  select (case when 'dddddddd-8900-0000-0003-0000000000aa'::uuid = any(ids) then '1' else '0' end) || '/' ||
         (case when 'dddddddd-8900-0000-0003-0000000000bb'::uuid = any(ids) then '1' else '0' end) $$;
create function pg_temp.parents() returns text language sql as $$ select pg_temp.ab(array(select id from api.opportunities)) $$;
create function pg_temp.history() returns text language sql as $$ select pg_temp.ab(array(select opportunity_id from api.opportunity_forecast_history)) $$;
create function pg_temp.rows_now() returns text language sql as $$ select pg_temp.ab(array(select id from api.forecast_rows('current'))) $$;
-- History is stamped with clock_timestamp(), after this transaction's now().
create function pg_temp.rows_recorded() returns text language sql as $$
  select pg_temp.ab(array(select id from api.forecast_rows('recorded',clock_timestamp()) where recorded)) $$;
create function pg_temp.queue_week() returns text language sql as $$
  select pg_temp.ab(array(select id from api.forecast_queue('week','2026-11-02','current',p_as_of=>'2026-11-02T01:00:00Z'))) $$;
create function pg_temp.week_count() returns int language sql as $$
  select (api.forecast_week(p_week_start=>'2026-11-02',p_as_of=>'2026-11-02T01:00:00Z')->>'week_count')::int $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

create temp table tile62 as
  select position('current_workspace_id' in pg_get_functiondef('core.has_permission(text)'::regprocedure)) > 0 as applied;
grant select on tile62 to authenticated;
-- The expected value with TILE-62 applied, else before it.
create function pg_temp.p(with62 text, pre62 text) returns text language sql as $$
  select case when (select applied from tile62) then with62 else pre62 end $$;
grant execute on function pg_temp.p(text,text) to authenticated;

insert into core.workspaces(id,slug,name) values
  ('dddddddd-8900-0000-0000-0000000000aa','tile89-a','TILE-89 A'),
  ('dddddddd-8900-0000-0000-0000000000bb','tile89-b','TILE-89 B');
insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group) values
  ('dddddddd-8900-0000-0000-0000000000aa','quote_sent','Quote sent',1,'open'),
  ('dddddddd-8900-0000-0000-0000000000bb','quote_sent','Quote sent',1,'open');
select pg_temp.mkuser(pg_temp.u(n), 'tile89.u' || n || '@tileconcept.test') from generate_series(1,10) n;
-- 1 admin in A and B.
select pg_temp.member(pg_temp.u(1),'dddddddd-8900-0000-0000-0000000000aa','admin');
select pg_temp.member(pg_temp.u(1),'dddddddd-8900-0000-0000-0000000000bb','admin',age => 5);
-- 2 acting A without sales.read; admin in B (the TILE-89 case).
select pg_temp.member(pg_temp.u(2),'dddddddd-8900-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(2),'dddddddd-8900-0000-0000-0000000000bb','admin',age => 5);
-- 3 admin in A, no sales.read in B.
select pg_temp.member(pg_temp.u(3),'dddddddd-8900-0000-0000-0000000000aa','admin');
select pg_temp.member(pg_temp.u(3),'dddddddd-8900-0000-0000-0000000000bb','catalog_pricing',age => 5);
-- 4 acting A without sales.read; B admin suspended.
select pg_temp.member(pg_temp.u(4),'dddddddd-8900-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(4),'dddddddd-8900-0000-0000-0000000000bb','admin','suspended',5);
-- 5 admin in A; B admin revoked (removed).
select pg_temp.member(pg_temp.u(5),'dddddddd-8900-0000-0000-0000000000aa','admin');
select pg_temp.member(pg_temp.u(5),'dddddddd-8900-0000-0000-0000000000bb','admin',age => 5);
delete from core.memberships where user_id = pg_temp.u(5) and workspace_id = 'dddddddd-8900-0000-0000-0000000000bb';
-- 6 admin in A only.
select pg_temp.member(pg_temp.u(6),'dddddddd-8900-0000-0000-0000000000aa','admin');
-- 7 acting A without sales.read; sales.read without read_all in B, not the owner.
select pg_temp.member(pg_temp.u(7),'dddddddd-8900-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(7),'dddddddd-8900-0000-0000-0000000000bb','marketing_coordinator',age => 5);
-- 8 the same role in B, and the owner of B's opportunity.
select pg_temp.member(pg_temp.u(8),'dddddddd-8900-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(8),'dddddddd-8900-0000-0000-0000000000bb','marketing_coordinator',age => 5);
-- 9 acting A without sales.read; showroom in B (shared inquiries, not opportunities).
select pg_temp.member(pg_temp.u(9),'dddddddd-8900-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(9),'dddddddd-8900-0000-0000-0000000000bb','showroom',age => 5);
-- 10 no sales.read anywhere.
select pg_temp.member(pg_temp.u(10),'dddddddd-8900-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(10),'dddddddd-8900-0000-0000-0000000000bb','catalog_pricing',age => 5);

-- One open opportunity per workspace, closing in the week of Monday 2 Nov 2026
-- (Kuala Lumpur). Each one's own capture trigger writes its history row.
insert into sales.opportunities(id,workspace_id,name,stage_key,status,owner_id,expected_close_date,probability_band,estimated_value,currency) values
  ('dddddddd-8900-0000-0003-0000000000aa','dddddddd-8900-0000-0000-0000000000aa','TILE-89 A','quote_sent','open',null,'2026-11-04','high',1000,'MYR'),
  ('dddddddd-8900-0000-0003-0000000000bb','dddddddd-8900-0000-0000-0000000000bb','TILE-89 B','quote_sent','open',pg_temp.u(8),'2026-11-05','medium',2000,'MYR');
select is((select count(*)::int from sales.opportunity_forecast_history where workspace_id in ('dddddddd-8900-0000-0000-0000000000aa','dddddddd-8900-0000-0000-0000000000bb')),2,
  'fixture: each opportunity''s own trigger wrote one history row');
create temp table hist_before as select h.*, md5(row(h.*)::text) digest from sales.opportunity_forecast_history h
  where workspace_id in ('dddddddd-8900-0000-0000-0000000000aa','dddddddd-8900-0000-0000-0000000000bb');

-- Shape: per-row sales.read for history; the readers refuse only a caller with
-- no sales.read anywhere; the parent guard stays.
select ok((select qual from pg_policies where schemaname='sales' and tablename='opportunity_forecast_history' and policyname='member_read') like '%permitted_workspace_ids(''sales.read''::text)%'
  and position('has_permission' in (select qual from pg_policies where schemaname='sales' and tablename='opportunity_forecast_history' and policyname='member_read')) = 0
  and (select qual from pg_policies where schemaname='sales' and tablename='opportunity_forecast_history' and policyname='member_read') like '%FROM sales.opportunities o%',
  'history needs sales.read in its own workspace and a visible opportunity; no acting-membership check');
select ok(bool_and(position('permitted_workspace_ids(''sales.read'')' in pg_get_functiondef(f)) > 0 and position('require_permission' in pg_get_functiondef(f)) = 0
    and position('has_permission' in pg_get_functiondef(f)) = 0 and not p.prosecdef),
  'the three forecast readers gate on sales.read in any active membership and still run as the caller')
  from (values ('api.forecast_rows(text,timestamptz,uuid)'::regprocedure),('api.forecast_week(date,text,uuid,integer,timestamptz)'::regprocedure),
    ('api.forecast_queue(text,date,text,uuid,integer,integer,integer,timestamptz)'::regprocedure)) x(f) join pg_proc p on p.oid = x.f;
select ok(position('core.require_permission(''sales.write'')' in pg_get_functiondef('api.review_opportunity_forecast(uuid,jsonb,uuid)'::regprocedure)) > 0
  and position('core.require_workspace(ws)' in pg_get_functiondef('api.review_opportunity_forecast(uuid,jsonb,uuid)'::regprocedure)) > 0,
  'the review command still requires sales.write in the acting workspace');

set local role authenticated;

-- 1. admin in A and B.
select pg_temp.act_as(pg_temp.u(1));
select is(pg_temp.parents(),'1/1','admin A + admin B: both opportunities');
select is(pg_temp.history(),'1/1','admin A + admin B: both histories');
select is(pg_temp.rows_now(),'1/1','admin A + admin B: forecast rows');
select is(pg_temp.queue_week(),'1/1','admin A + admin B: week queue');
select is(pg_temp.week_count(),2,'admin A + admin B: week count');

-- 2. The regression: acting A lacks sales.read, B grants it.
select pg_temp.act_as(pg_temp.u(2));
select is(pg_temp.parents(),pg_temp.p('0/1','1/1'),'catalog A + admin B: B''s opportunity (A''s too only through the pre-TILE-62 union)');
select is(pg_temp.history(),'0/1','catalog A + admin B: B''s history is not hidden by the acting membership');
select is(pg_temp.rows_now(),pg_temp.p('0/1','1/1'),'catalog A + admin B: forecast_rows admits B, exactly the visible opportunities');
select is(pg_temp.rows_recorded(),'0/1','catalog A + admin B: the as-recorded view finds B''s history');
select is(pg_temp.queue_week(),pg_temp.p('0/1','1/1'),'catalog A + admin B: forecast_queue admits B, exactly the visible opportunities');
select is(pg_temp.week_count()::text,pg_temp.p('1','2'),'catalog A + admin B: forecast_week counts B');
-- Writes still follow the acting membership: no command scope was widened.
select throws_ok($$select api.review_opportunity_forecast('dddddddd-8900-0000-0003-0000000000bb','{"version":1,"context":"review","probability_band":"high"}',gen_random_uuid())$$,
  '42501',null,'catalog A + admin B: reviewing B''s forecast is still refused (it acts in acting A only: sales.write there, or B not found)');

-- 3. Reader in A, no sales.read in B: B stays closed.
select pg_temp.act_as(pg_temp.u(3));
select is(pg_temp.parents(),pg_temp.p('1/0','1/1'),
  'admin A + catalog B: parent visibility as the opportunity policy decides (B closed once TILE-62 is applied)');
select is(pg_temp.history(),'1/0','admin A + catalog B: no B history from A''s sales.read');
select is(pg_temp.rows_now(),pg_temp.parents(),'admin A + catalog B: forecast_rows returns exactly the visible opportunities');
select is(pg_temp.queue_week(),pg_temp.parents(),'admin A + catalog B: forecast_queue returns exactly the visible opportunities');

-- 4. Suspended B: no sales.read anywhere, so the readers refuse.
select pg_temp.act_as(pg_temp.u(4));
select is(pg_temp.parents() || ' ' || pg_temp.history(),'0/0 0/0','a suspended B membership reads nothing');
select throws_ok($$select pg_temp.rows_now()$$,'42501','permission denied: sales.read','suspended B, no reader anywhere: forecast_rows refused');
select throws_ok($$select pg_temp.queue_week()$$,'42501','permission denied: sales.read','suspended B, no reader anywhere: forecast_queue refused');
select throws_ok($$select pg_temp.week_count()$$,'42501','permission denied: sales.read','suspended B, no reader anywhere: forecast_week refused');

-- 5. Revoked B; 6. not a member of B: A only.
select pg_temp.act_as(pg_temp.u(5));
select is(pg_temp.history() || ' ' || pg_temp.rows_now() || ' ' || pg_temp.queue_week(),'1/0 1/0 1/0','a revoked B membership reads A only');
select pg_temp.act_as(pg_temp.u(6));
select is(pg_temp.history() || ' ' || pg_temp.rows_now() || ' ' || pg_temp.queue_week(),'1/0 1/0 1/0','a non-member of B reads A only');
select is(pg_temp.week_count(),1,'a non-member of B counts A only');

-- 7. sales.read in B without read_all, not the owner: the parent guard decides.
select pg_temp.act_as(pg_temp.u(7));
select is(pg_temp.parents() || ' ' || pg_temp.history() || ' ' || pg_temp.rows_now() || ' ' || pg_temp.queue_week(),pg_temp.p('0/0 0/0 0/0 0/0','1/0 0/0 1/0 1/0'),
  'sales.read without read_all: someone else''s opportunity, its history and its forecast stay hidden');
select is(pg_temp.week_count()::text,pg_temp.p('0','1'),'and it is not counted');

-- 8. The same role, as the owner.
select pg_temp.act_as(pg_temp.u(8));
select is(pg_temp.parents() || ' ' || pg_temp.history() || ' ' || pg_temp.rows_now() || ' ' || pg_temp.queue_week(),pg_temp.p('0/1 0/1 0/1 0/1','1/1 0/1 1/1 1/1'),'the owner reads their opportunity, history and forecast');
select is(pg_temp.week_count()::text,pg_temp.p('1','2'),'the owner''s opportunity is counted');

-- 9. Shared inquiry read does not extend to opportunities.
select pg_temp.act_as(pg_temp.u(9));
select is(pg_temp.parents() || ' ' || pg_temp.history() || ' ' || pg_temp.rows_now() || ' ' || pg_temp.queue_week(),pg_temp.p('0/0 0/0 0/0 0/0','1/0 0/0 1/0 1/0'),'showroom B: no B opportunity forecast or history');

-- 10. No sales.read anywhere: refused, as before.
select pg_temp.act_as(pg_temp.u(10));
select throws_ok($$select pg_temp.rows_now()$$,'42501','permission denied: sales.read','no sales.read anywhere: forecast_rows refused');
select throws_ok($$select pg_temp.queue_week()$$,'42501','permission denied: sales.read','no sales.read anywhere: forecast_queue refused');
select throws_ok($$select pg_temp.week_count()$$,'42501','permission denied: sales.read','no sales.read anywhere: forecast_week refused');
select is(pg_temp.history(),'0/0','no sales.read anywhere: no history');

-- History stays append-only for a reader.
select pg_temp.act_as(pg_temp.u(2));
select throws_ok($$update api.opportunity_forecast_history set evidence='edited' where opportunity_id='dddddddd-8900-0000-0003-0000000000bb'$$,'42501',null,'a reader cannot edit history');
select throws_ok($$delete from api.opportunity_forecast_history where opportunity_id='dddddddd-8900-0000-0003-0000000000bb'$$,'42501',null,'a reader cannot delete history');

-- 11. Anonymous.
set local role anon;
select throws_like($$select count(*) from api.opportunity_forecast_history$$,'%permission denied%','anonymous reads no history');
select throws_like($$select api.forecast_week()$$,'%permission denied%','anonymous cannot run forecast_week');
select throws_like($$select count(*) from api.forecast_rows()$$,'%permission denied%','anonymous cannot run forecast_rows');
select throws_like($$select count(*) from api.forecast_queue('week')$$,'%permission denied%','anonymous cannot run forecast_queue');

reset role;
select is((select array_agg(digest order by seq) from (select h.seq, md5(row(h.*)::text) digest from sales.opportunity_forecast_history h
  where workspace_id in ('dddddddd-8900-0000-0000-0000000000aa','dddddddd-8900-0000-0000-0000000000bb')) x),
  (select array_agg(digest order by seq) from hist_before),'reads and refused writes changed no history');

select * from finish();
rollback;
