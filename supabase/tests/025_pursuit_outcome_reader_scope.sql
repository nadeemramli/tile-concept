-- TILE-88: outcome history and the outcome report read per row workspace.
-- Synthetic fixtures only; rolled back. Holds with or without TILE-62 applied
-- first (assertions avoid parent-table rules that TILE-62 itself changes).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
$$;
-- Subject is a member of A (oldest, so the acting membership) and of B.
create function pg_temp.member(a text, b text, b_status text default 'active') returns void language sql as $$
  update core.memberships set role_key = a where user_id = 'aaaaaaaa-2910-0088-0000-000000000001' and workspace_id = '99999999-2910-0088-0000-00000000000a';
  delete from core.memberships where user_id = 'aaaaaaaa-2910-0088-0000-000000000001' and workspace_id = '99999999-2910-0088-0000-00000000000b';
  insert into core.memberships(workspace_id,user_id,role_key,status,created_at)
    select '99999999-2910-0088-0000-00000000000b','aaaaaaaa-2910-0088-0000-000000000001',b,b_status,now()-interval '1 day' where b is not null;
$$;
create function pg_temp.raw() returns bigint language sql as $$ select count(*) from api.pursuit_outcome_events where workspace_id = '99999999-2910-0088-0000-00000000000b' $$;
create function pg_temp.derived() returns bigint language sql as $$ select count(*) from api.pursuit_outcome_history where workspace_id = '99999999-2910-0088-0000-00000000000b' $$;
create function pg_temp.reported() returns bigint language sql as $$ select coalesce(sum(events),0)::bigint from api.report_pursuit_outcomes() $$;

insert into auth.users(id,email,aud,role) values
  ('aaaaaaaa-2910-0088-0000-000000000001','reader-scope-subject@example.test','authenticated','authenticated'),
  ('aaaaaaaa-2910-0088-0000-000000000002','reader-scope-seller@example.test','authenticated','authenticated');
insert into core.workspaces(id,slug,name) values
  ('99999999-2910-0088-0000-00000000000a','reader-scope-a','Synthetic reader scope A'),
  ('99999999-2910-0088-0000-00000000000b','reader-scope-b','Synthetic reader scope B');
insert into core.memberships(workspace_id,user_id,role_key,created_at) values
  ('99999999-2910-0088-0000-00000000000a','aaaaaaaa-2910-0088-0000-000000000001','admin',now()-interval '2 days'),
  ('99999999-2910-0088-0000-00000000000b','aaaaaaaa-2910-0088-0000-000000000002','sales_rep',now());
-- B: an inquiry (shared inquiry access) and an opportunity owned by the subject.
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id) values
  ('cccccccc-2910-0088-0000-000000000001','99999999-2910-0088-0000-00000000000b','disqualified','tiktok','Synthetic reader scope lead','aaaaaaaa-2910-0088-0000-000000000002');
insert into sales.opportunities(id,workspace_id,name,owner_id,stage_key,status) values
  ('eeeeeeee-2910-0088-0000-000000000001','99999999-2910-0088-0000-00000000000b','Synthetic reader scope opportunity','aaaaaaaa-2910-0088-0000-000000000001','deferred','deferred');
-- Append-only history: a loss with a superseding correction, and a deferral.
insert into sales.pursuit_outcome_events(id,workspace_id,lead_id,closes_lead,closes_opportunity,outcome_type,reason_code,effective_date,request_id,command,actor_id) values
  ('dddddddd-2910-0088-0000-000000000001','99999999-2910-0088-0000-00000000000b','cccccccc-2910-0088-0000-000000000001',true,false,'lost','unknown',current_date,gen_random_uuid(),'{}','aaaaaaaa-2910-0088-0000-000000000002');
insert into sales.pursuit_outcome_events(workspace_id,lead_id,closes_lead,closes_opportunity,outcome_type,corrects_event_id,reason_code,effective_date,request_id,command,actor_id) values
  ('99999999-2910-0088-0000-00000000000b','cccccccc-2910-0088-0000-000000000001',true,false,'lost','dddddddd-2910-0088-0000-000000000001','price',current_date,gen_random_uuid(),'{}','aaaaaaaa-2910-0088-0000-000000000002');
insert into sales.pursuit_outcome_events(workspace_id,opportunity_id,closes_lead,closes_opportunity,outcome_type,reason_code,effective_date,review_date,request_id,command,actor_id) values
  ('99999999-2910-0088-0000-00000000000b','eeeeeeee-2910-0088-0000-000000000001',false,true,'deferred','timing',current_date,current_date+30,gen_random_uuid(),'{}','aaaaaaaa-2910-0088-0000-000000000002');

select ok((select qual not like '%has_permission(%' and qual like '%permitted_workspace_ids(''sales.read''%' and qual like '%sales.leads l%' and qual like '%sales.opportunities o%'
  from pg_policies where schemaname = 'sales' and tablename = 'pursuit_outcome_events' and policyname = 'member_read'),
  'history policy judges sales.read per row and keeps the inquiry-or-opportunity guard');
select ok((select not prosecdef from pg_proc where oid = 'api.report_pursuit_outcomes(date,date)'::regprocedure), 'report stays security invoker');

-- Both readers.
select pg_temp.member('admin','admin');
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-2910-0088-0000-000000000001');
select is(pg_temp.raw(), 3::bigint, 'A and B readers: raw history includes the correction');
select is(pg_temp.derived(), 2::bigint, 'A and B readers: derived history counts each outcome once');
select is(pg_temp.reported(), 2::bigint, 'A and B readers: report aggregates B');
select ok((select reason_code = 'price' from api.pursuit_outcome_history where lead_id = 'cccccccc-2910-0088-0000-000000000001'), 'derived history keeps the corrected reason');

-- A denied, B reader: B stays readable and reportable.
reset role;
select pg_temp.member('catalog_pricing','admin');
set local role authenticated;
select is(pg_temp.raw(), 3::bigint, 'A denied, B reader: raw B history kept');
select is(pg_temp.derived(), 2::bigint, 'A denied, B reader: derived B history kept');
select is(pg_temp.reported(), 2::bigint, 'A denied, B reader: B is reported');
select is((select count(*) from api.pursuit_outcome_history where lead_id is not null), 1::bigint, 'inquiry branch readable');
select is((select count(*) from api.pursuit_outcome_history where opportunity_id is not null and lead_id is null), 1::bigint, 'opportunity branch readable');

-- A report-only, B reader.
reset role;
select pg_temp.member('analyst','admin');
set local role authenticated;
select is(pg_temp.derived(), 2::bigint, 'A report-only, B reader: B history readable');
select is(pg_temp.reported(), 2::bigint, 'A report-only, B reader: B is reported');

-- A reader, B denied: nothing of B.
reset role;
select pg_temp.member('admin','catalog_pricing');
set local role authenticated;
select is(pg_temp.raw(), 0::bigint, 'A reader, B denied: no raw B history');
select is(pg_temp.derived(), 0::bigint, 'A reader, B denied: no derived B history');
select is(pg_temp.reported(), 0::bigint, 'A reader, B denied: report is empty, not refused');

-- B grants sales.read but not report.read: rows readable, never reported.
reset role;
select pg_temp.member('admin','showroom');
set local role authenticated;
select is((select count(*) from api.pursuit_outcome_history where lead_id = 'cccccccc-2910-0088-0000-000000000001'), 1::bigint, 'B showroom: shared inquiry outcome readable');
select is((select count(*) from api.pursuit_outcome_history where opportunity_id = 'eeeeeeee-2910-0088-0000-000000000001'), 1::bigint, 'B showroom: own opportunity outcome readable');
select is(pg_temp.reported(), 0::bigint, 'B showroom: report.read of A does not report B');

-- No report reader in any membership: refused as before.
reset role;
select pg_temp.member('catalog_pricing','showroom');
set local role authenticated;
select is((select count(*) from api.pursuit_outcome_history where lead_id = 'cccccccc-2910-0088-0000-000000000001'), 1::bigint, 'no report reader: B history still readable through B');
select throws_ok($$select * from api.report_pursuit_outcomes()$$, '42501', 'permission denied: report.read', 'no report reader anywhere: refused');

-- Inactive and revoked B membership.
reset role;
select pg_temp.member('admin','admin','suspended');
set local role authenticated;
select is(pg_temp.raw(), 0::bigint, 'suspended B membership: no B history');
select is(pg_temp.reported(), 0::bigint, 'suspended B membership: B not reported');
reset role;
select pg_temp.member('admin',null);
set local role authenticated;
select is(pg_temp.raw(), 0::bigint, 'revoked B membership: no B history');
select is(pg_temp.reported(), 0::bigint, 'revoked B membership: B not reported');

-- Anonymous and unauthenticated.
select set_config('request.jwt.claims', '', true);
select throws_ok($$select * from api.report_pursuit_outcomes()$$, '28000', 'not authenticated', 'no caller: refused as not authenticated');
reset role;
set local role anon;
select throws_ok($$select count(*) from api.pursuit_outcome_events$$, '42501', null, 'anonymous: raw history refused');
select throws_ok($$select count(*) from api.pursuit_outcome_history$$, '42501', null, 'anonymous: derived history refused');
select throws_ok($$select * from api.report_pursuit_outcomes()$$, '42501', null, 'anonymous: report refused');
reset role;

select * from finish();
rollback;
