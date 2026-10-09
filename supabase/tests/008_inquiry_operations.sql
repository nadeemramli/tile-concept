-- Synthetic regression coverage for the reporting foundation. No production data.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text,true);
$$;
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,raw_phone,owner_id,created_at)
values
('cccccccc-2109-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','new','tiktok','Inquiry Workflow Fixture','+60178880001',null,now()-interval '1 day'),
('cccccccc-2109-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','new','meta','Other Owner Fixture','+60178880002','aaaaaaaa-0000-0000-0000-000000000004',now()-interval '1 day'),
('cccccccc-2109-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','converted','meta','Opportunity Only Fixture',null,'aaaaaaaa-0000-0000-0000-000000000003',now()-interval '1 day');
-- More than the former 500 lead / 1,000 task caps, deliberately older than fixtures.
insert into sales.leads(workspace_id,status,source_channel,raw_name,owner_id,created_at)
select '11111111-1111-1111-1111-111111111111','contact_attempted','tiktok','Pagination fixture ' || n,
  'aaaaaaaa-0000-0000-0000-000000000003',now()-interval '30 days' from generate_series(1,1100) n;
insert into sales.tasks(workspace_id,title,lead_id,assignee_id,created_by,due_at)
select workspace_id,'Private follow-up note',id,owner_id,owner_id,now()+interval '4 days'
from sales.leads where raw_name like 'Pagination fixture %';
insert into core.workspaces(id,slug,name) values('99999999-2109-0000-0000-000000000001','inquiry-isolation-fixture','Isolation fixture');
insert into sales.leads(id,workspace_id,status,source_channel,raw_name)
values('cccccccc-2109-0000-0000-000000000099','99999999-2109-0000-0000-000000000001','new','other','Cross-workspace inquiry');
create function pg_temp.reject_test_history() returns trigger language plpgsql as $$
begin
  if new.request_id='dddddddd-2109-0000-0000-000000000099' then raise exception 'Simulated history failure'; end if;
  return new;
end $$;
create trigger test_history_failure before insert on sales.activities for each row execute function pg_temp.reject_test_history();

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select is((api.inquiry_page('needs-action','Opportunity Only Fixture')->>'total')::int,1,'creating an opportunity does not close an inquiry that still needs action');
select is((api.inquiry_page('mine','Opportunity Only Fixture')->>'total')::int,1,'opportunity-created inquiries remain in their ownership view');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','whatsapp_sent','dddddddd-2109-0000-0000-000000000001')$$,'record outgoing WhatsApp');
select is((select owner_id::text from api.leads where id='cccccccc-2109-0000-0000-000000000001'),'aaaaaaaa-0000-0000-0000-000000000003','first work claims the unassigned inquiry');
select ok((select first_whatsapp_sent_at is not null and first_customer_reply_at is null and first_response_at is not null from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'staff outreach does not fabricate a reply');
select is((api.inquiry_page('waiting','Inquiry Workflow Fixture')->>'total')::int,1,'sent inquiry remains findable in Awaiting reply');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','whatsapp_sent','dddddddd-2109-0000-0000-000000000001')$$,'safe retry succeeds');
select is((select contact_attempts from api.leads where id='cccccccc-2109-0000-0000-000000000001'),1,'safe retry does not double count attempts');
select is((select count(*)::int from api.activities where lead_id='cccccccc-2109-0000-0000-000000000001'),1,'safe retry does not duplicate history');
select throws_like($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','whatsapp_sent','dddddddd-2109-0000-0000-000000000099')$$,'%Simulated history failure%','history failure aborts transaction');
select is((select contact_attempts from api.leads where id='cccccccc-2109-0000-0000-000000000001'),1,'failed history write rolls back lead progress too');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','no_response','dddddddd-2109-0000-0000-000000000011')$$,'explicit no-response outcome recorded');
select is((api.inquiry_page('no-response','Inquiry Workflow Fixture')->>'total')::int,1,'No response view means unanswered outreach, not missing staff response');
select throws_like($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','customer_replied','dddddddd-2109-0000-0000-000000000001')$$,'%Request ID already used%','a request cannot be reused for a different event');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','schedule','dddddddd-2109-0000-0000-000000000002',now()+interval '3 days')$$,'schedule future follow-up');
select is((api.inquiry_page('upcoming','Inquiry Workflow Fixture')->>'total')::int,1,'future follow-up appears immediately in Upcoming');
select is((api.inquiry_page('follow-ups-due','Inquiry Workflow Fixture')->>'total')::int,0,'future reminder does not inflate due count');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','schedule','dddddddd-2109-0000-0000-000000000003',now()+interval '5 days')$$,'scheduling again updates existing reminder');
select is((select open_follow_ups::int from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),1,'one outstanding reminder after repeat schedule');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','reschedule','dddddddd-2109-0000-0000-000000000004',now()-interval '1 hour')$$,'reschedule earlier');
select is((api.inquiry_page('follow-ups-due','Inquiry Workflow Fixture')->>'total')::int,1,'overdue reminder remains visible');
select throws_like($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','complete','dddddddd-2109-0000-0000-000000000005')$$,'%Record an outcome%','completion requires outcome');
select lives_ok($$select api.complete_sales_task((select next_follow_up_task_id from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'Sent requested samples')$$,'Tasks screen uses transactional lead completion');
select ok((select completed_follow_ups=1 and open_follow_ups=0 and needs_action and first_customer_reply_at is null from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'completed reminder retains history and returns inquiry to Needs action without inventing a reply');
select is((api.inquiry_page('follow-ups-completed','Inquiry Workflow Fixture')->>'total')::int,1,'completed follow-ups have a discoverable view');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','no_next_action','dddddddd-2109-0000-0000-000000000006',p_body=>'Customer will call next month')$$,'explicit reason can resolve no-next-action queue');
select ok((select not needs_action from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'no-next-action reason resolves queue when already contacted');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','customer_replied','dddddddd-2109-0000-0000-000000000007')$$,'record actual inbound reply');
select ok((select first_customer_reply_at is not null and first_whatsapp_reply_at is not null and needs_action from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'reply timestamp stored and next action reconsidered');
select is((api.inquiry_page('replied','Inquiry Workflow Fixture')->>'total')::int,1,'customer reply has its own view');
select is((api.inquiry_page('waiting','Inquiry Workflow Fixture')->>'total')::int,0,'replied inquiry leaves Awaiting reply');
select is((api.inquiry_page('no-response','Inquiry Workflow Fixture')->>'total')::int,0,'reply resolves the no-response view');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','schedule','dddddddd-2109-0000-0000-000000000008',now()+interval '2 days')$$,'schedule before closing');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','lost','dddddddd-2109-0000-0000-000000000009',p_body=>'Project cancelled')$$,'mark lost with reason');
select ok((select status='disqualified' and open_follow_ups=0 and completed_follow_ups=1 from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'lost cancels open reminders and retains completed work');
select is((api.inquiry_page('disqualified','Inquiry Workflow Fixture')->>'total')::int,1,'lost inquiries remain discoverable');
select throws_like($$update api.tasks set status='open' where lead_id='cccccccc-2109-0000-0000-000000000001' and status='cancelled'$$,'%Reopen the inquiry%','Tasks screen cannot reopen follow-up on lost inquiry');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','reopen','dddddddd-2109-0000-0000-000000000010',now()+interval '1 day',p_body=>'Customer restarted project')$$,'reopen with reason and next action');
select ok((select status='contacted' and open_follow_ups=1 and first_customer_reply_at is not null from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'reopening preserves reply history');

select is((api.inquiry_page('all','Pagination fixture')->>'total')::int,1100,'total covers every inquiry beyond old cap');
select is((api.inquiry_page('upcoming','Pagination fixture')->>'total')::int,1100,'shared summaries cover reminders beyond old task cap');
select is(jsonb_array_length(api.inquiry_page('all','Pagination fixture',p_page=>44)->'rows'),25,'last page retrieves records beyond old cap');
select is((api.inquiry_page('all','Pagination fixture',p_page=>999)->>'page')::int,44,'out-of-range pages clamp to last actual page');
select is((api.inquiry_page('all','Pagination fixture 1100')->>'total')::int,1,'search is server-wide, including oldest records');
select is((api.inquiry_page('all','017-888-0001')->>'total')::int,1,'formatted phone search matches normalized phone');
select is((api.inquiry_page('all','%',p_size=>25)->>'total')::int,0,'search wildcard is literal');
select is((api.inquiry_page('all','Pagination fixture',p_source=>'meta')->>'total')::int,0,'source filter applies before counts');
select is((api.inquiry_page('all','Pagination fixture')->'counts'->>'upcoming')::int,1100,'view counts use same untruncated search scope');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000002','whatsapp_sent',gen_random_uuid())$$,'deployed shared-edit grant permits a teammate WhatsApp marker');
select is((api.inquiry_page('all','Cross-workspace inquiry')->>'total')::int,0,'server search cannot leak another workspace');
select throws_like($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000099','whatsapp_sent',gen_random_uuid())$$,'%workspace%','direct RPC cannot mutate another workspace');
select throws_like($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001',null,gen_random_uuid())$$,'%Unknown inquiry action%','null action rejected');
select throws_like($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','customer_replied',gen_random_uuid(),p_occurred_at=>now()+interval '1 day')$$,'%Invalid channel or event time%','future customer reply rejected');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000004');
select is((select open_follow_ups::int from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),1,'teammate sees the shared reminder summary');
select is((select count(*)::int from api.tasks where lead_id='cccccccc-2109-0000-0000-000000000001'),3,'teammate can read shared open and historical task records');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok($$select api.assign_lead('cccccccc-2109-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000004','Cover colleague')$$,'manager reassigns inquiry');
select is((select follow_up_owner_id::text from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),'aaaaaaaa-0000-0000-0000-000000000004','reassignment transfers outstanding reminder');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select lives_ok($$select api.work_inquiry('cccccccc-2109-0000-0000-000000000001','complete',gen_random_uuid(),p_body=>'Shared teammate follow-up outcome')$$,'shared-edit permission survives a change of inquiry owner');
select is((select completed_follow_ups::int from api.inbox_leads where id='cccccccc-2109-0000-0000-000000000001'),2,'teammate completion persists alongside prior follow-up history');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like($$select api.inquiry_page()$$,'%permission denied%','non-sales role cannot query inquiry dashboard');
reset role;
set local role anon;
select throws_like($$select api.inquiry_page()$$,'%permission denied%','anonymous caller cannot query inquiries');
select * from finish();
rollback;
