begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create temp table result(data jsonb); grant all on result to authenticated;
create function pg_temp.login(uid uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true); end $$;
create function pg_temp.pid() returns uuid language sql as $$select (data->>'project_id')::uuid from result limit 1$$;
create function pg_temp.input(extra jsonb default '{}') returns jsonb language sql as $$select jsonb_build_object('id',pg_temp.pid(),'version',(select version from api.projects where id=pg_temp.pid()))||extra$$;
insert into core.workspaces(id,slug,name) values('99999999-3422-0000-0000-000000000099','shared-project-test','Synthetic foreign workspace');
insert into identity.projects(id,workspace_id,name) values('bbbbbbbb-3422-0000-0000-000000000099','99999999-3422-0000-0000-000000000099','Synthetic foreign project');
insert into identity.accounts(id,workspace_id,name) values('aaaaaaaa-3422-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic Registration Company');
insert into identity.contacts(id,workspace_id,display_name) values('cccccccc-3422-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic Registration Contact');
insert into identity.account_contact_relationships(workspace_id,account_id,contact_id) values('11111111-1111-1111-1111-111111111111','aaaaaaaa-3422-0000-0000-000000000001','cccccccc-3422-0000-0000-000000000001');
insert into identity.contact_points(workspace_id,contact_id,kind,raw_value,normalized_value) values('11111111-1111-1111-1111-111111111111','cccccccc-3422-0000-0000-000000000001','phone','+60 12-934 2271','60129342271');
set local role authenticated;
-- Catalog staff have project access without receiving general CRM write or assignment permissions.
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000006');
select ok(core.has_permission('projects.write') and not core.has_permission('sales.write'),'non-sales staff can enrich projects without broad sales write');
select ok(not core.has_permission('projects.follow_up'),'non-sales staff cannot own sales follow-up');
select lives_ok($$insert into result select api.project_command('create','{"name":"Synthetic quick project"}','dddddddd-3422-0000-0000-000000000001')$$,'non-sales staff register with only a title');
select ok((select account_id is null and primary_contact_id is null and owner_id is null and created_by='aaaaaaaa-0000-0000-0000-000000000006' from api.projects where id=pg_temp.pid()),'title-only registration stays unassigned and records creator');
select is(api.project_command('create','{"name":"Synthetic quick project"}','dddddddd-3422-0000-0000-000000000001'),(select data from result),'uncertain create retry does not duplicate project');
select throws_ok($$select api.project_command('create','{"name":"Changed title"}','dddddddd-3422-0000-0000-000000000001')$$,'23514','Retry differs from original project command','changed request rejected');
select is((select count(*) from api.projects where id=pg_temp.pid()),1::bigint,'catalog staff can read shared project view');
select is(api.project_directory('bbbbbbbb-3422-0000-0000-000000000099'),'[]'::jsonb,'directory hides foreign workspace project');
select lives_ok($$select api.project_command('edit',pg_temp.input('{"name":"Synthetic enriched project","account_id":"aaaaaaaa-3422-0000-0000-000000000001","contact_id":"cccccccc-3422-0000-0000-000000000001","follow_up_contact_id":"cccccccc-3422-0000-0000-000000000001","product_specification":"Matte tile 600 x 600 mm","site_address":"Synthetic site 68100","notes":"Customer needs car porch tiles"}'),gen_random_uuid())$$,'non-sales staff enrich contacts, site and specifications later');
select is((api.project_directory(pg_temp.pid())->0->>'account_name'),'Synthetic Registration Company','project directory exposes linked company display name');
select is((select count(*) from api.project_identity_search('contact','Registration')),1::bigint,'project-only identity lookup works without general sales access');
select is((select count(*) from api.contacts where id='cccccccc-3422-0000-0000-000000000001'),0::bigint,'project lookup does not grant raw CRM access');
select is((select count(*) from api.project_identity_search('contact','9342271')),0::bigint,'staff without sales access cannot find a customer by phone digits');
select throws_ok($$select api.project_command('assign',pg_temp.input('{"owner_id":"aaaaaaaa-0000-0000-0000-000000000006"}'),gen_random_uuid())$$,'42501',null,'non-sales staff cannot claim projects');
select throws_ok($$select api.project_command('follow_up',pg_temp.input('{"note":"No rights"}'),gen_random_uuid())$$,'42501',null,'non-sales staff cannot record sales follow-up');
-- A NULL or unknown action must not fall through to the follow-up branch.
reset role;
create temp table snapshot as select (select to_jsonb(p) from identity.projects p where p.id=pg_temp.pid()) own,(select to_jsonb(p) from identity.projects p where p.id='bbbbbbbb-3422-0000-0000-000000000099') foreign_row,(select count(*) from identity.project_events) events,(select count(*) from identity.project_requests) requests;
set local role authenticated;
select throws_ok($$select api.project_command(null,jsonb_build_object('id',pg_temp.pid(),'note','NULL action, no version'),gen_random_uuid())$$,'23514','Invalid project command','NULL action on own project without version rejected');
select throws_ok($$select api.project_command(null,jsonb_build_object('id',pg_temp.pid(),'version',99,'note','NULL action, stale version'),gen_random_uuid())$$,'23514','Invalid project command','NULL action on own project with stale version rejected');
select throws_ok($$select api.project_command(null,'{"id":"bbbbbbbb-3422-0000-0000-000000000099","note":"NULL action, foreign"}',gen_random_uuid())$$,'23514','Invalid project command','NULL action on foreign project rejected');
select throws_ok($$select api.project_command('delete',jsonb_build_object('id',pg_temp.pid(),'note','Unknown action'),gen_random_uuid())$$,'23514','Invalid project command','unknown action rejected');
reset role;
select ok((select own=(select to_jsonb(p) from identity.projects p where p.id=pg_temp.pid()) and foreign_row=(select to_jsonb(p) from identity.projects p where p.id='bbbbbbbb-3422-0000-0000-000000000099') and events=(select count(*) from identity.project_events) and requests=(select count(*) from identity.project_requests) from snapshot),'non-sales malformed actions changed no project, event or request rows');
set local role authenticated;
select lives_ok($$select api.project_command('create','{"name":"Synthetic direct assignment","owner_id":"aaaaaaaa-0000-0000-0000-000000000003"}',gen_random_uuid())$$,'registrar can route a new project directly to an eligible salesperson');
select throws_ok($$select api.project_command('create','{"name":"Synthetic invalid assignment","owner_id":"aaaaaaaa-0000-0000-0000-000000000006"}',gen_random_uuid())$$,'23514','Choose an active salesperson in this company','registrar cannot assign follow-up to a non-sales member');
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000003');
select ok(not core.has_permission('sales.assign') and core.has_permission('projects.follow_up'),'salespeople gain project assignment without lead assignment rights');
reset role;
drop table snapshot;
create temp table snapshot as select (select to_jsonb(p) from identity.projects p where p.id=pg_temp.pid()) own,(select to_jsonb(p) from identity.projects p where p.id='bbbbbbbb-3422-0000-0000-000000000099') foreign_row,(select count(*) from identity.project_events) events,(select count(*) from identity.project_requests) requests;
set local role authenticated;
select throws_ok($$select api.project_command(null,'{"id":"bbbbbbbb-3422-0000-0000-000000000099","note":"NULL action, foreign"}',gen_random_uuid())$$,'23514','Invalid project command','salesperson NULL action on foreign project rejected');
select throws_ok($$select api.project_command(null,jsonb_build_object('id',pg_temp.pid(),'note','NULL action, no version'),gen_random_uuid())$$,'23514','Invalid project command','salesperson NULL action without version rejected');
reset role;
select ok((select own=(select to_jsonb(p) from identity.projects p where p.id=pg_temp.pid()) and foreign_row=(select to_jsonb(p) from identity.projects p where p.id='bbbbbbbb-3422-0000-0000-000000000099') and events=(select count(*) from identity.project_events) and requests=(select count(*) from identity.project_requests) from snapshot),'salesperson malformed actions changed no project, event or request rows');
set local role authenticated;
select is((select count(*) from api.project_identity_search('contact','9342271')),1::bigint,'salespeople can still find a customer by phone digits');
select lives_ok($$select api.project_command('assign',pg_temp.input('{"owner_id":"aaaaaaaa-0000-0000-0000-000000000003","note":"Claimed"}'),'dddddddd-3422-0000-0000-000000000002')$$,'salesperson claims an unassigned project');
select throws_ok($$select api.project_command('assign',jsonb_build_object('id',pg_temp.pid(),'version',2,'owner_id','aaaaaaaa-0000-0000-0000-000000000004','note','Claimed from stale list'),gen_random_uuid())$$,'40001','Project changed. Refresh before saving or assigning it.','stale concurrent claim cannot overwrite current handler');
select throws_ok($$update api.projects set owner_id='aaaaaaaa-0000-0000-0000-000000000004' where id=pg_temp.pid()$$,'42501',null,'direct update cannot bypass assignment history or concurrency checks');
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000004');
select is((select count(*) from api.projects where id=pg_temp.pid()),1::bigint,'assigned project remains visible to another salesperson');
select lives_ok($$select api.project_command('follow_up',pg_temp.input('{"note":"Customer confirmed sizes","next_action":"Send samples","next_action_due_at":"2026-10-01T10:00:00+08:00"}'),'dddddddd-3422-0000-0000-000000000003')$$,'another salesperson can contribute a follow-up');
select ok((select owner_id='aaaaaaaa-0000-0000-0000-000000000003' and last_follow_up_by='aaaaaaaa-0000-0000-0000-000000000004' and last_follow_up_at is not null and next_action='Send samples' from api.projects where id=pg_temp.pid()),'handler and latest follow-up actor remain distinct');
select throws_ok($$select api.project_command('assign',pg_temp.input('{"owner_id":"aaaaaaaa-0000-0000-0000-000000000004"}'),gen_random_uuid())$$,'23514','Add a handover reason when changing the handler','taking over an assigned project requires a handover reason');
select lives_ok($$select api.project_command('assign',pg_temp.input('{"owner_id":"aaaaaaaa-0000-0000-0000-000000000004","note":"Agreed cover while colleague is away"}'),gen_random_uuid())$$,'salesperson can take over with an explicit handover');
select ok(exists(select 1 from api.project_events where project_id=pg_temp.pid() and kind='assigned' and previous_owner_id='aaaaaaaa-0000-0000-0000-000000000003' and owner_id='aaaaaaaa-0000-0000-0000-000000000004' and actor_id='aaaaaaaa-0000-0000-0000-000000000004'),'handover retains old handler, new handler and actor');
select throws_ok($$select api.project_command('edit','{"id":"bbbbbbbb-3422-0000-0000-000000000099","version":1,"name":"Foreign edit"}',gen_random_uuid())$$,'42501','Project not found','cross-workspace commands rejected');
select throws_ok($$select api.project_command('follow_up',pg_temp.input('{"note":"Talked","next_action_due_at":"2026-10-01"}'),gen_random_uuid())$$,'23514','Describe the next action for its due date','due dates require an actual next action');
select throws_ok($$delete from api.project_events where project_id=pg_temp.pid()$$,'42501',null,'staff cannot delete follow-up history');
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000006');
select is((select count(*) from api.projects where id=pg_temp.pid()),1::bigint,'non-sales registrar retains visibility after assignment');
select ok((select count(*) from api.project_events where project_id=pg_temp.pid())>=5,'all staff can see project follow-up and handover history');
select lives_ok($$select api.project_command('edit',pg_temp.input('{"name":"Synthetic enriched project","owner_id":"aaaaaaaa-0000-0000-0000-000000000006"}'),gen_random_uuid())$$,'detail edits accept staff enrichment independently of assignment');
select is((select owner_id from api.projects where id=pg_temp.pid()),'aaaaaaaa-0000-0000-0000-000000000004'::uuid,'owner hidden in detail payload cannot change assignment');
reset role;
select is((select count(*) from sales.opportunities where project_id=pg_temp.pid()),0::bigint,'quick registration creates no invented opportunity');
select ok(not has_function_privilege('anon','api.project_command(text,jsonb,uuid)','EXECUTE'),'anonymous registration denied');
select ok(not has_function_privilege('anon','api.project_directory(uuid)','EXECUTE'),'shared directory is not public internet access');
select ok(not has_table_privilege('authenticated','identity.project_requests','SELECT'),'idempotency payloads are private');
-- TILE-62: a permission held in one workspace never authorizes another.
-- The catalogue user acts in A (oldest membership) and gains a later sales-rep membership in B.
insert into core.memberships(workspace_id,user_id,role_key,status,created_at)
select core.demo_workspace_id(),m.user_id,'sales_rep','active',m.created_at+interval '1 day' from core.memberships m
where m.user_id='aaaaaaaa-0000-0000-0000-000000000006' and m.workspace_id='11111111-1111-1111-1111-111111111111';
-- A salesperson acting in A gains a later catalogue membership in B.
insert into core.memberships(workspace_id,user_id,role_key,status,created_at)
select core.demo_workspace_id(),m.user_id,'catalog_pricing','active',m.created_at+interval '1 day' from core.memberships m
where m.user_id='aaaaaaaa-0000-0000-0000-000000000003' and m.workspace_id='11111111-1111-1111-1111-111111111111';
insert into identity.projects(id,workspace_id,name) values('bbbbbbbb-3422-0000-0000-000000000062',core.demo_workspace_id(),'Synthetic demo-workspace project');
-- A member whose A role holds nothing (test-only role) and whose later B role is sales_rep.
insert into core.roles(key,label,rank) values('synthetic_no_access','Synthetic role without permissions (test only)',999);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
values('00000000-0000-0000-0000-000000000000','dddddddd-3422-0000-0000-000000000062','authenticated','authenticated','synthetic.projects.none-a.rep-b@tileconcept.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false);
insert into core.memberships(workspace_id,user_id,role_key,status,created_at) values
 ('11111111-1111-1111-1111-111111111111','dddddddd-3422-0000-0000-000000000062','synthetic_no_access','active',now()-interval '2 days'),
 (core.demo_workspace_id(),'dddddddd-3422-0000-0000-000000000062','sales_rep','active',now()-interval '1 day');
create temp table snapshot62 as select (select to_jsonb(p) from identity.projects p where p.id=pg_temp.pid()) own,(select to_jsonb(p) from identity.projects p where p.id='bbbbbbbb-3422-0000-0000-000000000062') b_row,(select count(*) from identity.project_events) events,(select count(*) from identity.project_requests) requests;
set local role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000006');
select ok(core.current_workspace_id()='11111111-1111-1111-1111-111111111111' and core.current_role_key()='catalog_pricing','catalogue A + rep B: acts in A as catalogue');
select ok(not core.has_permission('projects.follow_up') and not core.has_permission('sales.read') and not exists(select 1 from api.my_permissions() p where p in('projects.follow_up','sales.read')),'catalogue A + rep B: acting and session permissions carry nothing from the B sales role');
select throws_ok($$select api.project_command('follow_up',pg_temp.input('{"note":"Through the B role"}'),gen_random_uuid())$$,'42501','permission denied: projects.follow_up','catalogue A + rep B: cannot follow up an A project');
select throws_ok($$select api.project_command('assign',pg_temp.input('{"owner_id":"aaaaaaaa-0000-0000-0000-000000000003","note":"Through the B role"}'),gen_random_uuid())$$,'42501','permission denied: projects.follow_up','catalogue A + rep B: cannot assign an A project');
select throws_ok($$select api.project_command('follow_up','{"id":"bbbbbbbb-3422-0000-0000-000000000062","version":1,"note":"From A into B"}',gen_random_uuid())$$,'42501',null,'catalogue A + rep B: commands do not reach B projects');
select is((select count(*) from api.project_identity_search('contact','9342271')),0::bigint,'catalogue A + rep B: no phone-digit match in A');
select is((select count(*) from api.project_identity_search('contact','Registration')),1::bigint,'catalogue A + rep B: name lookup for registration still works');
reset role;
select ok((select own=(select to_jsonb(p) from identity.projects p where p.id=pg_temp.pid()) and b_row=(select to_jsonb(p) from identity.projects p where p.id='bbbbbbbb-3422-0000-0000-000000000062') and events=(select count(*) from identity.project_events) and requests=(select count(*) from identity.project_requests) from snapshot62),'refused two-membership commands changed no project, event or request rows');
set local role authenticated;
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000006');
select lives_ok($$select api.project_command('create','{"name":"Synthetic dual-membership registration"}',gen_random_uuid())$$,'catalogue A + rep B: still registers in A');
select lives_ok($$select api.project_command('edit',pg_temp.input('{"name":"Synthetic enriched project","notes":"Enriched by catalogue A"}'),gen_random_uuid())$$,'catalogue A + rep B: still enriches A projects');
select is((select count(*) from api.projects where id='bbbbbbbb-3422-0000-0000-000000000062'),1::bigint,'catalogue A + rep B: reads the B project through the B membership');
select is((select count(*) from jsonb_array_elements(api.project_directory()) e where e->>'workspace_id'<>'11111111-1111-1111-1111-111111111111'),0::bigint,'catalogue A + rep B: the directory lists the acting workspace only');
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000003');
select ok(core.has_permission('projects.follow_up') and core.has_permission('sales.read'),'rep A + catalogue B: keeps the A sales role');
select lives_ok($$select api.project_command('follow_up',pg_temp.input('{"note":"Rep acting in A"}'),gen_random_uuid())$$,'rep A + catalogue B: follows up an A project');
select is((select count(*) from api.project_identity_search('contact','9342271')),1::bigint,'rep A + catalogue B: phone-digit match in A');
select pg_temp.login('dddddddd-3422-0000-0000-000000000062');
select is((select count(*) from api.projects where workspace_id='11111111-1111-1111-1111-111111111111'),0::bigint,'no project role in A + rep B: reads no A projects');
select is((select count(*) from api.project_sites where workspace_id='11111111-1111-1111-1111-111111111111')+(select count(*) from api.project_events where workspace_id='11111111-1111-1111-1111-111111111111'),0::bigint,'no project role in A + rep B: reads no A sites or history');
select is((select count(*) from api.projects where id='bbbbbbbb-3422-0000-0000-000000000062'),1::bigint,'no project role in A + rep B: reads B projects through the B membership');
select throws_ok($$select api.project_command('create','{"name":"Synthetic no-access registration"}',gen_random_uuid())$$,'42501',null,'no project role in A + rep B: cannot register in A');
select throws_ok($$select * from api.project_identity_search('contact','Registration')$$,'42501',null,'no project role in A + rep B: no identity lookup in A');
reset role;
select throws_ok($$delete from identity.projects where id=pg_temp.pid()$$,'23503',null,'project history cannot be deleted by deleting its project');
-- The weekly demo reset deletes the demo workspace; a guest-registered project must not block it.
select set_config('request.jwt.claims','{"sub":"00000000-9999-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select api.project_command('create','{"name":"Synthetic guest project"}',gen_random_uuid())$$,'guest registers a project in the demo workspace');
select lives_ok($$select core.reset_demo_workspace()$$,'demo reset still deletes a workspace holding project requests and events');
select * from finish();
rollback;
