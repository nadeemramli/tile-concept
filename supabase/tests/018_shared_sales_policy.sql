-- Pin the existing deployed grant, not the unselected owner-only candidate.
-- Synthetic fixtures and role changes are rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.shared_act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
$$;
insert into core.workspaces(id,slug,name) values
('99999999-2210-0018-0000-000000000001','shared-sales-isolation','Synthetic isolated workspace');
insert into identity.contacts(id,workspace_id,display_name) values
('eeeeeeee-2210-0018-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic shared contact');
insert into sales.leads(id,workspace_id,source_channel,raw_name,owner_id) values
('eeeeeeee-2210-0018-0001-000000000001','11111111-1111-1111-1111-111111111111','tiktok','Synthetic teammate inquiry','aaaaaaaa-0000-0000-0000-000000000004'),
('eeeeeeee-2210-0018-0001-000000000099','99999999-2210-0018-0000-000000000001','other','Synthetic foreign inquiry',null);
insert into sales.opportunities(id,workspace_id,name,contact_id,owner_id,stage_key,next_action,next_action_due_at) values
('eeeeeeee-2210-0018-0002-000000000001','11111111-1111-1111-1111-111111111111','Synthetic teammate opportunity','eeeeeeee-2210-0018-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000004','new','Send sample',now()+interval '1 day'),
('eeeeeeee-2210-0018-0002-000000000099','99999999-2210-0018-0000-000000000001','Synthetic foreign opportunity',null,null,'new','Send sample',now()+interval '1 day');
insert into sales.tasks(id,workspace_id,title,assignee_id,created_by) values
('eeeeeeee-2210-0018-0003-000000000001','11111111-1111-1111-1111-111111111111','Synthetic teammate task','aaaaaaaa-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000004'),
('eeeeeeee-2210-0018-0003-000000000099','99999999-2210-0018-0000-000000000001','Synthetic foreign task',null,null);

set local role authenticated;
select pg_temp.shared_act_as('aaaaaaaa-0000-0000-0000-000000000003');
select ok(core.has_permission('sales.read_all') and core.has_permission('sales.write'),'sales rep has deployed shared-view and shared-edit combination');
select ok(core.has_permission('report.read') and core.has_permission('review.approve'),'sales rep retains deployed reports and import-review grants');
select ok(not core.has_permission('sales.assign') and not core.has_permission('settings.manage'),'shared editing does not grant assignment or administration');
select is((select count(*) from api.leads where id='eeeeeeee-2210-0018-0001-000000000001'),1::bigint,'teammate inquiry visible');
select isnt_empty($$update api.leads set notes='Synthetic shared edit' where id='eeeeeeee-2210-0018-0001-000000000001' returning id$$,'teammate inquiry can be updated');
select is((select notes from api.leads where id='eeeeeeee-2210-0018-0001-000000000001'),'Synthetic shared edit','shared inquiry edit persists');
select lives_ok($$select api.link_lead_contact('eeeeeeee-2210-0018-0001-000000000001','eeeeeeee-2210-0018-0000-000000000001')$$,'rep can link teammate inquiry to a workspace contact');
select lives_ok($$select api.work_inquiry('eeeeeeee-2210-0018-0001-000000000001','schedule',gen_random_uuid(),now()+interval '1 day')$$,'rep can schedule teammate follow-up');
select lives_ok($$select api.complete_sales_task((select next_follow_up_task_id from api.inbox_leads where id='eeeeeeee-2210-0018-0001-000000000001'),'Synthetic shared follow-up')$$,'rep can complete teammate inquiry task');
select is((select completed_follow_ups::int from api.inbox_leads where id='eeeeeeee-2210-0018-0001-000000000001'),1,'shared follow-up completion persists');
select is((select owner_id from api.leads where id='eeeeeeee-2210-0018-0001-000000000001'),'aaaaaaaa-0000-0000-0000-000000000004'::uuid,'shared workflow retains existing inquiry owner');
select throws_like($$select api.assign_lead('eeeeeeee-2210-0018-0001-000000000001','aaaaaaaa-0000-0000-0000-000000000003','Synthetic reassignment')$$,'%sales.assign%','shared editor still cannot reassign inquiries');
select lives_ok($$select api.change_opportunity_stage('eeeeeeee-2210-0018-0002-000000000001','qualified','Synthetic shared progress','Follow up',now()+interval '1 day')$$,'rep can move teammate opportunity stage');
select is((select stage_key from api.opportunities where id='eeeeeeee-2210-0018-0002-000000000001'),'qualified','shared stage change persists');
select lives_ok($$select api.opportunity_command('edit',jsonb_build_object('id',id,'version',version,'name','Synthetic shared opportunity edit','next_action','Send revised options','next_action_due_at',now()+interval '2 days'),gen_random_uuid()) from api.opportunities where id='eeeeeeee-2210-0018-0002-000000000001'$$,'rep can edit teammate opportunity');
select is((select name from api.opportunities where id='eeeeeeee-2210-0018-0002-000000000001'),'Synthetic shared opportunity edit','shared opportunity edit persists');
select throws_like($$select api.opportunity_command('reassign',jsonb_build_object('id',id,'version',version,'owner_id','aaaaaaaa-0000-0000-0000-000000000003'),gen_random_uuid()) from api.opportunities where id='eeeeeeee-2210-0018-0002-000000000001'$$,'%sales.assign%','shared editor still cannot reassign opportunities');
select lives_ok($$select api.opportunity_photo_command('prepare','eeeeeeee-2210-0018-0002-000000000001','eeeeeeee-2210-0018-0004-000000000001','{"file_name":"shared.png","content_type":"image/png","file_size":100,"remark":"Synthetic shared sample"}')$$,'rep can reserve teammate opportunity photo');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) select 'opportunity-photos',object_path,'{"size":100,"mimetype":"image/png"}' from api.opportunity_photos where id='eeeeeeee-2210-0018-0004-000000000001'$$,'shared editor can upload their reserved photo');
select lives_ok($$select api.opportunity_photo_command('finish','eeeeeeee-2210-0018-0002-000000000001','eeeeeeee-2210-0018-0004-000000000001')$$,'shared editor can finalize actual uploaded photo');
select isnt_empty($$update api.tasks set title='Synthetic shared task edit' where id='eeeeeeee-2210-0018-0003-000000000001' returning id$$,'rep can edit teammate general task');
select lives_ok($$select api.complete_sales_task('eeeeeeee-2210-0018-0003-000000000001','Synthetic shared task outcome')$$,'rep can complete teammate general task');
select is((select status from api.tasks where id='eeeeeeee-2210-0018-0003-000000000001'),'done','shared general task completion persists');
select is((select actor_id from api.activities where metadata->>'task_id'='eeeeeeee-2210-0018-0003-000000000001'),'aaaaaaaa-0000-0000-0000-000000000003'::uuid,'task history records actual shared editor');

-- Shared means the member workspace, never another tenant.
select is((select count(*) from api.leads where id='eeeeeeee-2210-0018-0001-000000000099'),0::bigint,'foreign inquiry hidden');
select is((select count(*) from api.opportunities where id='eeeeeeee-2210-0018-0002-000000000099'),0::bigint,'foreign opportunity hidden');
select is((select count(*) from api.tasks where id='eeeeeeee-2210-0018-0003-000000000099'),0::bigint,'foreign task hidden');
select is_empty($$update api.leads set notes='Forbidden' where id='eeeeeeee-2210-0018-0001-000000000099' returning id$$,'direct foreign inquiry write affects no rows');
select is_empty($$update api.tasks set status='done' where id='eeeeeeee-2210-0018-0003-000000000099' returning id$$,'direct foreign task write affects no rows');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2210-0018-0001-000000000099',gen_random_uuid(),'remark','Forbidden tenant remark')$$,'%workspace%','shared rep cannot annotate foreign inquiry');
select throws_like($$select api.work_inquiry('eeeeeeee-2210-0018-0001-000000000099','whatsapp_sent',gen_random_uuid())$$,'%workspace%','shared rep cannot work foreign inquiry');
select throws_like($$select api.change_opportunity_stage('eeeeeeee-2210-0018-0002-000000000099','qualified','Forbidden','Follow up',now()+interval '1 day')$$,'%workspace%','shared rep cannot move foreign opportunity');
select throws_ok($$select api.opportunity_command('archive','{"id":"eeeeeeee-2210-0018-0002-000000000099","version":1,"reason":"Forbidden"}',gen_random_uuid())$$,'42501','Opportunity not found','shared rep cannot archive foreign opportunity');
select throws_ok($$select api.opportunity_photo_command('prepare','eeeeeeee-2210-0018-0002-000000000099',gen_random_uuid(),'{}')$$,'42501',null,'shared rep cannot prepare foreign photo');
select throws_ok($$select api.complete_sales_task('eeeeeeee-2210-0018-0003-000000000099','Forbidden')$$,'P0002','Task not found','shared rep cannot complete foreign task');

-- Showroom has sales.write but not the sales_rep cross-owner override.
select pg_temp.shared_act_as('aaaaaaaa-0000-0000-0000-000000000005');
select ok(core.has_permission('sales.write') and not core.has_permission('sales.read_all'),'showroom retains narrower sales scope');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2210-0018-0001-000000000001',gen_random_uuid(),'remark','Forbidden showroom remark')$$,'%not the owner%','showroom cannot remark another owner inquiry');
select throws_like($$select api.work_inquiry('eeeeeeee-2210-0018-0001-000000000001','whatsapp_sent',gen_random_uuid())$$,'%not the owner%','showroom cannot change another owner inquiry workflow');
select throws_like($$select api.change_opportunity_stage('eeeeeeee-2210-0018-0002-000000000001','qualified','Forbidden','Follow up',now()+interval '1 day')$$,'%not the owner%','showroom cannot move another owner opportunity');
select throws_ok($$select api.opportunity_command('archive','{"id":"eeeeeeee-2210-0018-0002-000000000001","version":1,"reason":"Forbidden"}',gen_random_uuid())$$,'42501','Only the owner or a sales manager can change this opportunity','showroom cannot archive another owner opportunity');

-- Temporarily turn one synthetic account into management to exercise actual
-- RPC and UPDATE denial, rather than merely checking a permission list.
reset role;
update core.memberships set role_key='management' where user_id='aaaaaaaa-0000-0000-0000-000000000004' and workspace_id='11111111-1111-1111-1111-111111111111';
set local role authenticated;
select pg_temp.shared_act_as('aaaaaaaa-0000-0000-0000-000000000004');
select ok(core.has_permission('sales.read_all') and not core.has_permission('sales.write'),'management remains a shared reader');
select is((select count(*) from api.opportunities where id='eeeeeeee-2210-0018-0002-000000000001'),1::bigint,'management can inspect shared opportunity');
select is_empty($$update api.leads set notes='Forbidden management edit' where id='eeeeeeee-2210-0018-0001-000000000001' returning id$$,'management cannot update inquiry even when it owns it');
select is_empty($$update api.tasks set title='Forbidden management edit' where id='eeeeeeee-2210-0018-0003-000000000001' returning id$$,'management cannot update its task');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2210-0018-0001-000000000001',gen_random_uuid(),'remark','Forbidden management remark')$$,'%permission denied%','management cannot add inquiry remarks');
select throws_like($$select api.work_inquiry('eeeeeeee-2210-0018-0001-000000000001','whatsapp_sent',gen_random_uuid())$$,'%permission denied%','management cannot change inquiry workflow');
select throws_like($$select api.opportunity_command('archive','{"id":"eeeeeeee-2210-0018-0002-000000000001","version":1,"reason":"Forbidden"}',gen_random_uuid())$$,'%permission denied%','management cannot change opportunity');
select throws_like($$select api.complete_sales_task('eeeeeeee-2210-0018-0003-000000000001','Forbidden')$$,'%permission denied%','management cannot complete tasks');
reset role;
select is((select notes from sales.leads where id='eeeeeeee-2210-0018-0001-000000000099'),null::text,'foreign inquiry unchanged after denied writes');
select is((select status from sales.tasks where id='eeeeeeee-2210-0018-0003-000000000099'),'open','foreign task unchanged after denied writes');
select is((select notes from sales.leads where id='eeeeeeee-2210-0018-0001-000000000001'),'Synthetic shared edit','read-only denial preserves accepted shared edit');
select * from finish();
rollback;
