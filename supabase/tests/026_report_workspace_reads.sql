-- TILE-86: the pursuit segmentation and lead-source reports read each workspace
-- only with the caller's own active report.read there. Both orientations, the
-- inactive / revoked / non-member / anonymous controls, and the report
-- semantics that must not move. Synthetic fixtures only.
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
create function pg_temp.seg_total(dim text) returns bigint language sql as $$
  select coalesce(sum(pursuits),0)::bigint from api.report_pursuit_segments(null,null,'week') where dimension = dim $$;
create function pg_temp.src_total() returns bigint language sql as $$ select coalesce(sum(leads),0)::bigint from api.report_lead_source() $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into core.workspaces(id,slug,name) values
  ('cccccccc-2600-0000-0000-0000000000aa','tile86-a','TILE-86 A'),
  ('cccccccc-2600-0000-0000-0000000000bb','tile86-b','TILE-86 B'),
  ('cccccccc-2600-0000-0000-0000000000cc','tile86-c','TILE-86 C');
insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group) values
  ('cccccccc-2600-0000-0000-0000000000bb','new','New',1,'open');
select pg_temp.mkuser('cccccccc-2600-0000-0001-000000000001','tile86.reader.a@tileconcept.test');
select pg_temp.mkuser('cccccccc-2600-0000-0001-000000000002','tile86.reader.b@tileconcept.test');
select pg_temp.mkuser('cccccccc-2600-0000-0001-000000000003','tile86.suspended.b@tileconcept.test');
select pg_temp.mkuser('cccccccc-2600-0000-0001-000000000004','tile86.revoked.b@tileconcept.test');
select pg_temp.mkuser('cccccccc-2600-0000-0001-000000000005','tile86.no.reader@tileconcept.test');
-- report.read in acting A only; B membership without it.
select pg_temp.member('cccccccc-2600-0000-0001-000000000001','cccccccc-2600-0000-0000-0000000000aa','admin');
select pg_temp.member('cccccccc-2600-0000-0001-000000000001','cccccccc-2600-0000-0000-0000000000bb','catalog_pricing',age => 5);
-- acting A without report.read; legitimate reader in B.
select pg_temp.member('cccccccc-2600-0000-0001-000000000002','cccccccc-2600-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member('cccccccc-2600-0000-0001-000000000002','cccccccc-2600-0000-0000-0000000000bb','analyst',age => 5);
-- reader in A; B admin membership suspended.
select pg_temp.member('cccccccc-2600-0000-0001-000000000003','cccccccc-2600-0000-0000-0000000000aa','admin');
select pg_temp.member('cccccccc-2600-0000-0001-000000000003','cccccccc-2600-0000-0000-0000000000bb','admin','suspended',5);
-- reader in A; B admin membership revoked (removed).
select pg_temp.member('cccccccc-2600-0000-0001-000000000004','cccccccc-2600-0000-0000-0000000000aa','admin');
select pg_temp.member('cccccccc-2600-0000-0001-000000000004','cccccccc-2600-0000-0000-0000000000bb','admin',age => 5);
delete from core.memberships where user_id='cccccccc-2600-0000-0001-000000000004' and workspace_id='cccccccc-2600-0000-0000-0000000000bb';
-- no report.read anywhere.
select pg_temp.member('cccccccc-2600-0000-0001-000000000005','cccccccc-2600-0000-0000-0000000000aa','catalog_pricing');
select pg_temp.member('cccccccc-2600-0000-0001-000000000005','cccccccc-2600-0000-0000-0000000000bb','catalog_pricing',age => 5);

-- B: an exact arrival answered after 30 minutes, a date-only arrival answered
-- later the same day, and an inquiry converted to an opportunity (one pursuit).
-- C: a lead nobody here belongs to. A: nothing.
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,created_at,arrival_precision,first_response_at) values
  ('cccccccc-2600-0000-0002-000000000001','cccccccc-2600-0000-0000-0000000000bb','contacted','call','TILE-86 exact',
    timestamptz '2026-10-05 10:00:00+08', 'exact', timestamptz '2026-10-05 10:30:00+08'),
  ('cccccccc-2600-0000-0002-000000000002','cccccccc-2600-0000-0000-0000000000bb','contacted','call','TILE-86 date only',
    timestamptz '2026-10-06 00:00:00+08', 'date', timestamptz '2026-10-06 10:00:00+08'),
  ('cccccccc-2600-0000-0002-000000000003','cccccccc-2600-0000-0000-0000000000bb','contacted','call','TILE-86 converted',
    timestamptz '2026-10-07 09:00:00+08', 'exact', null),
  ('cccccccc-2600-0000-0002-000000000009','cccccccc-2600-0000-0000-0000000000cc','new','call','TILE-86 other workspace',
    timestamptz '2026-10-05 11:00:00+08', 'exact', null);
insert into sales.opportunities(id,workspace_id,name,stage_key,lead_id) values
  ('cccccccc-2600-0000-0003-000000000003','cccccccc-2600-0000-0000-0000000000bb','TILE-86 opportunity','new','cccccccc-2600-0000-0002-000000000003');
update sales.leads set status='converted', converted_opportunity_id='cccccccc-2600-0000-0003-000000000003' where id='cccccccc-2600-0000-0002-000000000003';

select isnt(to_regprocedure('core.permitted_workspace_ids(text)'), null, 'the per-row permission helper exists');
select ok(position('permitted_workspace_ids(''report.read'')' in pg_get_functiondef('api.report_pursuit_segments(date,date,text)'::regprocedure)) > 0
  and position('member_workspace_ids' in pg_get_functiondef('api.report_pursuit_segments(date,date,text)'::regprocedure)) = 0
  and position('has_permission(' in pg_get_functiondef('api.report_pursuit_segments(date,date,text)'::regprocedure)) = 0,
  'segmentation filters rows by report.read in each row''s workspace, with no global check or membership-only filter');
select ok(position('permitted_workspace_ids(''report.read'')' in pg_get_functiondef('api.report_lead_source(date,date)'::regprocedure)) > 0
  and position('member_workspace_ids' in pg_get_functiondef('api.report_lead_source(date,date)'::regprocedure)) = 0
  and position('has_permission(' in pg_get_functiondef('api.report_lead_source(date,date)'::regprocedure)) = 0,
  'lead source filters rows by report.read in each row''s workspace, with no global check or membership-only filter');

set local role authenticated;

-- 1. Reader in acting A, no report.read in B: B is not read.
select pg_temp.act_as('cccccccc-2600-0000-0001-000000000001');
select is((select count(*)::int from api.report_pursuit_segments(null,null,'week')),0,'A reader sees no B pursuits (A has none)');
select is((select count(*)::int from api.report_lead_source()),0,'A reader sees no B leads');

-- 2. Acting A denied, legitimate reader in B: B is read in full, and only B.
select pg_temp.act_as('cccccccc-2600-0000-0001-000000000002');
select is(pg_temp.seg_total('buyer_role'),3::bigint,'B reader sees B''s three pursuits; the converted inquiry and its opportunity count once');
select is((select count(distinct total)::int from (select dimension, sum(pursuits) total from api.report_pursuit_segments(null,null,'week')
  where dimension <> 'glc_party_role' group by dimension) x),1,'every dimension counts the same pursuits');
select is((select sum(pursuits)::int from api.report_pursuit_segments(null,null,'month') where dimension='buyer_role' and value='unknown'),3,'Unknown stays its own bucket');
select ok((select bool_and(extract(isodow from period_start) = 1 and period_end = period_start + 6) from api.report_pursuit_segments(null,null,'week')),
  'weekly buckets run Monday to Sunday on the Kuala Lumpur calendar');
select is((select count(*)::int from api.report_pursuit_segments('2026-10-05','2026-10-05','day') where dimension='buyer_role'),1,'a one-day range keeps only that local day');
select throws_like($$select * from api.report_pursuit_segments(null,null,'fortnight')$$,'%daily, weekly or monthly%','grain validation unchanged');
select is(pg_temp.src_total(),3::bigint,'B reader sees B''s three leads, not C''s');
select is((select median_response_minutes from api.report_lead_source() where source_channel='call'),30.0,
  'median uses the exact arrival only; the date-only arrival is left out');
select is((select responded from api.report_lead_source() where source_channel='call'),2::bigint,'both responses still count as responded');
-- The lead-source date filter keeps its existing (unchanged) date comparison;
-- 2026-10-07 09:00 Kuala Lumpur is on 2026-10-07 either way.
select is((select leads from api.report_lead_source('2026-10-07','2026-10-07') where source_channel='call'),1::bigint,'the date filter still applies');

-- 3. Suspended B reader with no report.read in acting A: refused / empty.
select pg_temp.act_as('cccccccc-2600-0000-0001-000000000003');
select is((select count(*)::int from api.report_pursuit_segments(null,null,'week')),0,'a suspended B membership grants nothing (A reader sees only A)');
select is(pg_temp.src_total(),0::bigint,'a suspended B membership grants no lead counts');

-- 4. Revoked B membership.
select pg_temp.act_as('cccccccc-2600-0000-0001-000000000004');
select is((select count(*)::int from api.report_pursuit_segments(null,null,'week')),0,'a revoked B membership grants nothing');
select is(pg_temp.src_total(),0::bigint,'a revoked B membership grants no lead counts');

-- 5. No report.read in any workspace: segmentation refused, lead source empty.
select pg_temp.act_as('cccccccc-2600-0000-0001-000000000005');
select throws_ok($$select * from api.report_pursuit_segments()$$,'42501','Permission denied: report.read','no report.read anywhere: segmentation refused');
select is(pg_temp.src_total(),0::bigint,'no report.read anywhere: lead source empty');

-- 6. Anonymous.
set local role anon;
select throws_like($$select * from api.report_pursuit_segments()$$,'%permission denied%','anonymous cannot run segmentation');

select * from finish();
rollback;
