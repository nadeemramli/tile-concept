-- TILE-87: classification history is read with the caller's own active
-- sales.read in the event's workspace AND a linked lead or opportunity the
-- caller can see under its own RLS. Both parent branches, the owner and
-- shared-read restrictions, and the inactive / revoked / non-member / anonymous
-- controls. Synthetic fixtures only.
--
-- Holds with or without TILE-62 (20261029000002). Only the parent lead's own
-- visibility for "admin in A, no sales.read in B" differs: before TILE-62 the
-- lead policy still unions permissions across memberships; that is TILE-62's
-- repair, not this one, so the parent count is asserted for the order applied.
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
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('cccccccc-2700-0000-0001-' || lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.lead_history() returns int language sql as $$
  select count(*)::int from api.classification_events where lead_id = 'cccccccc-2700-0000-0002-000000000001' $$;
create function pg_temp.opp_history() returns int language sql as $$
  select count(*)::int from api.classification_events where opportunity_id = 'cccccccc-2700-0000-0003-000000000001' $$;
create function pg_temp.parents() returns text language sql as $$
  select (select count(*) from api.leads where id = 'cccccccc-2700-0000-0002-000000000001') || '/' ||
         (select count(*) from api.opportunities where id = 'cccccccc-2700-0000-0003-000000000001') $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

create temp table tile62 as
  select position('current_workspace_id' in pg_get_functiondef('core.has_permission(text)'::regprocedure)) > 0 as applied;
grant select on tile62 to authenticated;

insert into core.workspaces(id,slug,name) values
  ('cccccccc-2700-0000-0000-0000000000aa','tile87-a','TILE-87 A'),
  ('cccccccc-2700-0000-0000-0000000000bb','tile87-b','TILE-87 B');
insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group) values
  ('cccccccc-2700-0000-0000-0000000000bb','new','New',1,'open');
select pg_temp.mkuser(pg_temp.u(n), 'tile87.u' || n || '@tileconcept.test') from generate_series(1,9) n;
-- 1 admin in A, sales_rep in B.
select pg_temp.member(pg_temp.u(1),'cccccccc-2700-0000-0000-0000000000aa','admin');
select pg_temp.member(pg_temp.u(1),'cccccccc-2700-0000-0000-0000000000bb','sales_rep',age => 5);
-- 2 acting A without sales.read; legitimate sales_rep in B (the TILE-87 case).
select pg_temp.member(pg_temp.u(2),'cccccccc-2700-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(2),'cccccccc-2700-0000-0000-0000000000bb','sales_rep',age => 5);
-- 3 admin in A, no sales.read in B.
select pg_temp.member(pg_temp.u(3),'cccccccc-2700-0000-0000-0000000000aa','admin');
select pg_temp.member(pg_temp.u(3),'cccccccc-2700-0000-0000-0000000000bb','catalog_pricing',age => 5);
-- 4 acting A without sales.read; B sales_rep membership suspended.
select pg_temp.member(pg_temp.u(4),'cccccccc-2700-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(4),'cccccccc-2700-0000-0000-0000000000bb','sales_rep','suspended',5);
-- 5 admin in A; B sales_rep membership revoked (removed).
select pg_temp.member(pg_temp.u(5),'cccccccc-2700-0000-0000-0000000000aa','admin');
select pg_temp.member(pg_temp.u(5),'cccccccc-2700-0000-0000-0000000000bb','sales_rep',age => 5);
delete from core.memberships where user_id = pg_temp.u(5) and workspace_id = 'cccccccc-2700-0000-0000-0000000000bb';
-- 6 admin in A only: not a member of B.
select pg_temp.member(pg_temp.u(6),'cccccccc-2700-0000-0000-0000000000aa','admin');
-- 7 acting A without sales.read; B sales.read without read_all, not the owner.
select pg_temp.member(pg_temp.u(7),'cccccccc-2700-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(7),'cccccccc-2700-0000-0000-0000000000bb','marketing_coordinator',age => 5);
-- 8 the same role in B, and the owner of B's lead and opportunity.
select pg_temp.member(pg_temp.u(8),'cccccccc-2700-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(8),'cccccccc-2700-0000-0000-0000000000bb','marketing_coordinator',age => 5);
-- 9 acting A without sales.read; showroom in B (shared inquiry read, not the opportunity).
select pg_temp.member(pg_temp.u(9),'cccccccc-2700-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member(pg_temp.u(9),'cccccccc-2700-0000-0000-0000000000bb','showroom',age => 5);

-- B: one owned lead, one owned opportunity, and three history rows: lead only,
-- opportunity only, and one naming both.
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id) values
  ('cccccccc-2700-0000-0002-000000000001','cccccccc-2700-0000-0000-0000000000bb','new','call','TILE-87 lead',pg_temp.u(8));
insert into sales.opportunities(id,workspace_id,name,stage_key,owner_id) values
  ('cccccccc-2700-0000-0003-000000000001','cccccccc-2700-0000-0000-0000000000bb','TILE-87 opportunity','new',pg_temp.u(8));
insert into sales.classification_events(id,workspace_id,lead_id,opportunity_id,basis,before_values,after_values,reason) values
  ('cccccccc-2700-0000-0004-000000000001','cccccccc-2700-0000-0000-0000000000bb','cccccccc-2700-0000-0002-000000000001',null,
    'correction','{"buyer_role":"end_user"}','{"buyer_role":"contractor"}','TILE-87 lead correction'),
  ('cccccccc-2700-0000-0004-000000000002','cccccccc-2700-0000-0000-0000000000bb',null,'cccccccc-2700-0000-0003-000000000001',
    'correction','{"work_type":"unknown"}','{"work_type":"renovation"}','TILE-87 opportunity correction'),
  ('cccccccc-2700-0000-0004-000000000003','cccccccc-2700-0000-0000-0000000000bb','cccccccc-2700-0000-0002-000000000001','cccccccc-2700-0000-0003-000000000001',
    'correction','{"project_use":"unknown"}','{"project_use":"residential"}','TILE-87 pursuit correction');
select is((select count(*)::int from sales.classification_events where workspace_id='cccccccc-2700-0000-0000-0000000000bb'),3,'fixture: exactly the three history rows');

-- The reader: per-row sales.read, both parent branches, no acting-membership check.
select ok((select qual from pg_policies where schemaname='sales' and tablename='classification_events' and policyname='member_read')
    like '%permitted_workspace_ids(''sales.read''::text)%'
  and position('has_permission' in (select qual from pg_policies where schemaname='sales' and tablename='classification_events' and policyname='member_read')) = 0
  and (select qual from pg_policies where schemaname='sales' and tablename='classification_events' and policyname='member_read') like '%FROM sales.leads l%'
  and (select qual from pg_policies where schemaname='sales' and tablename='classification_events' and policyname='member_read') like '%FROM sales.opportunities o%',
  'history rows need sales.read in their own workspace and a visible lead or opportunity; no acting-membership check');
select is((select array_agg(policyname::text || ':' || cmd order by policyname) from pg_policies where schemaname='sales' and tablename='classification_events'),
  array['member_read:SELECT'],'history keeps its single read policy; members write it only through the commands');

set local role authenticated;

-- 1. admin in A, sales_rep in B.
select pg_temp.act_as(pg_temp.u(1));
select is(pg_temp.parents(),'1/1','admin A + sales_rep B: sees B''s lead and opportunity');
select is(pg_temp.lead_history(),2,'admin A + sales_rep B: lead history');
select is(pg_temp.opp_history(),2,'admin A + sales_rep B: opportunity history');

-- 2. The regression: acting A has no sales.read, B grants it.
select pg_temp.act_as(pg_temp.u(2));
select is(pg_temp.parents(),'1/1','catalog A + sales_rep B: sees B''s lead and opportunity');
select is(pg_temp.lead_history(),2,'catalog A + sales_rep B: lead history is not hidden by the acting membership');
select is(pg_temp.opp_history(),2,'catalog A + sales_rep B: opportunity history is not hidden by the acting membership');
select is((select reason from api.classification_events where id='cccccccc-2700-0000-0004-000000000001'),'TILE-87 lead correction','the correction itself reads back unchanged');

-- 3. Reader in A, no sales.read in B: B's history stays closed.
select pg_temp.act_as(pg_temp.u(3));
select is(pg_temp.parents(),case when (select applied from tile62) then '0/0' else '1/1' end,
  'admin A + catalog B: parent visibility as the lead/opportunity policies decide (closed once TILE-62 is applied)');
select is(pg_temp.lead_history(),0,'admin A + catalog B: no B lead history from A''s sales.read');
select is(pg_temp.opp_history(),0,'admin A + catalog B: no B opportunity history from A''s sales.read');

-- 4. Suspended B membership.
select pg_temp.act_as(pg_temp.u(4));
select is(pg_temp.lead_history() + pg_temp.opp_history(),0,'a suspended B membership reads no history');

-- 5. Revoked B membership.
select pg_temp.act_as(pg_temp.u(5));
select is(pg_temp.lead_history() + pg_temp.opp_history(),0,'a revoked B membership reads no history');

-- 6. Not a member of B.
select pg_temp.act_as(pg_temp.u(6));
select is(pg_temp.lead_history() + pg_temp.opp_history(),0,'a non-member of B reads no history');

-- 7. sales.read in B without read_all, not the owner: the parent guard decides.
select pg_temp.act_as(pg_temp.u(7));
select is(pg_temp.parents(),'0/0','sales.read without read_all: someone else''s lead and opportunity are hidden');
select is(pg_temp.lead_history() + pg_temp.opp_history(),0,'and so is their history');

-- 8. The same role, as the owner.
select pg_temp.act_as(pg_temp.u(8));
select is(pg_temp.parents(),'1/1','the owner sees their lead and opportunity');
select is(pg_temp.lead_history(),2,'the owner reads the lead history');
select is(pg_temp.opp_history(),2,'the owner reads the opportunity history');

-- 9. Shared inquiry read: the lead branch, not the opportunity's.
select pg_temp.act_as(pg_temp.u(9));
select is(pg_temp.parents(),'1/0','showroom B: the shared inquiry, not the opportunity');
select is(pg_temp.lead_history(),2,'showroom B: the inquiry''s history');
select is((select array_agg(reason order by reason) from api.classification_events where opportunity_id='cccccccc-2700-0000-0003-000000000001'),
  array['TILE-87 pursuit correction'],'showroom B: of the opportunity''s history, only the row that also names the visible inquiry');

-- History stays append-only for a reader.
select pg_temp.act_as(pg_temp.u(2));
select throws_ok($$update api.classification_events set reason='edited' where id='cccccccc-2700-0000-0004-000000000001'$$,'42501',null,'a reader cannot edit history');
select throws_ok($$delete from api.classification_events where id='cccccccc-2700-0000-0004-000000000001'$$,'42501',null,'a reader cannot delete history');

-- 10. Anonymous.
set local role anon;
select throws_like($$select count(*) from api.classification_events$$,'%permission denied%','anonymous reads no history');

reset role;
select is((select count(*)::int from sales.classification_events where workspace_id='cccccccc-2700-0000-0000-0000000000bb'),3,'reads changed no history');

select * from finish();
rollback;
