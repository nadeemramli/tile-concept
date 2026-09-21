-- Synthetic inbox annotations and live-update authorization coverage.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.inbox_act_as(uid text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
$$;
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id,created_at)
values
('eeeeeeee-2109-0011-0000-000000000001','11111111-1111-1111-1111-111111111111','new','meta','Inbox live fixture','aaaaaaaa-0000-0000-0000-000000000003',now()-interval '1 day'),
('eeeeeeee-2109-0011-0000-000000000002','11111111-1111-1111-1111-111111111111','disqualified','tiktok','Lost remark fixture','aaaaaaaa-0000-0000-0000-000000000003',now()-interval '1 day');
insert into core.workspaces(id,slug,name) values ('99999999-2109-0011-0000-000000000001','inbox-live-isolation','Inbox live isolation');
insert into sales.leads(id,workspace_id,status,source_channel,raw_name)
values ('eeeeeeee-2109-0011-0000-000000000099','99999999-2109-0011-0000-000000000001','new','other','Foreign inquiry');

set local role authenticated;
select pg_temp.inbox_act_as('aaaaaaaa-0000-0000-0000-000000000003');
select lives_ok($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001','eeeeeeee-2109-0011-0001-000000000001','remark','Customer asked about matte kitchen tiles')$$,'owner can add a standalone remark');
select lives_ok($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001','eeeeeeee-2109-0011-0001-000000000001','remark','Customer asked about matte kitchen tiles')$$,'identical retry succeeds');
select is((select count(*)::int from api.activities where lead_id='eeeeeeee-2109-0011-0000-000000000001'),1,'remark retry does not duplicate activity');
select ok((select status='new' and first_whatsapp_sent_at is null and first_customer_reply_at is null and open_follow_ups=0 from api.inbox_leads where id='eeeeeeee-2109-0011-0000-000000000001'),'remark never fabricates a contact, reply or follow-up');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001','eeeeeeee-2109-0011-0001-000000000001','remark','Different wording')$$,'%Request ID already used%','changed payload cannot reuse request ID');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'remark','  ')$$,'%Add a remark%','blank remarks rejected');
select lives_ok($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000002',gen_random_uuid(),'remark','Customer has postponed the project')$$,'lost inquiry still accepts contextual remarks');
select is((select status from api.leads where id='eeeeeeee-2109-0011-0000-000000000002'),'disqualified','remark does not reopen a lost inquiry');

select lives_ok($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001','eeeeeeee-2109-0011-0001-000000000002','source','Customer confirmed Instagram DM','instagram','Kitchen collection DM','meta',null)$$,'explicit evidence corrects Meta into Instagram');
select is((select source_channel from api.leads where id='eeeeeeee-2109-0011-0000-000000000001'),'instagram','specific origin saved');
select is((api.inquiry_page('all','Inbox live fixture',p_source=>'instagram')->>'total')::int,1,'source filter includes corrected Instagram inquiry');
select is((select metadata->'before'->>'source_channel' from api.activities where lead_id='eeeeeeee-2109-0011-0000-000000000001' and metadata->>'event'='inquiry_source'),'meta','previous source remains in correction history');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'source','Stale browser attempt','facebook','Old field','meta',null)$$,'%source changed%','stale browser cannot overwrite a more recent correction');
select lives_ok($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001','eeeeeeee-2109-0011-0001-000000000002','source','Customer confirmed Instagram DM','instagram','Kitchen collection DM','meta',null)$$,'retry of successful source correction remains idempotent');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'source','Invalid source rejected','fabricated','', 'instagram','Kitchen collection DM')$$,'%valid source%','unsupported origin rejected');
select lives_ok($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'source','Campaign click reference reviewed','google_ads','Synthetic click reference','instagram','Kitchen collection DM')$$,'explicit Google Ads origin supported');
select is((select source_channel from api.leads where id='eeeeeeee-2109-0011-0000-000000000001'),'google_ads','Google Ads is distinct from generic website');

select pg_temp.inbox_act_as('aaaaaaaa-0000-0000-0000-000000000004');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'remark','Other owner attempted write')$$,'%not the owner%','teammate read access does not grant remark writes');
select pg_temp.inbox_act_as('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'remark','Manager follow-up context')$$,'manager can annotate team inquiry');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000099',gen_random_uuid(),'remark','Wrong workspace attempt')$$,'%workspace%','cross-workspace write denied');
select pg_temp.inbox_act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'remark','Non-sales attempted write')$$,'%permission denied%','non-sales role cannot annotate');
reset role;
select throws_like($$update sales.activities set body='Overwritten history' where lead_id='eeeeeeee-2109-0011-0000-000000000001' and metadata->>'event'='inquiry_remark'$$,'%Add a new remark%','annotation history is immutable');

-- Trigger messages have no customer payload, and RLS scopes topic subscriptions.
select ok(exists(select 1 from realtime.messages where topic='inquiries:11111111-1111-1111-1111-111111111111' and event='inbox_changed' and private),'database changes emit a private signal');
select ok(not exists(select 1 from realtime.messages where topic like 'inquiries:%' and event='inbox_changed' and (payload-'id') is distinct from '{"changed":true}'::jsonb),'signal contains only a changed flag plus the Realtime message ID');
set local role authenticated;
select pg_temp.inbox_act_as('aaaaaaaa-0000-0000-0000-000000000003');
select set_config('realtime.topic','inquiries:11111111-1111-1111-1111-111111111111',true);
select ok(exists(select 1 from realtime.messages where event='inbox_changed'),'authorized sales rep can read workspace invalidations');
select is((select count(*)::int from realtime.messages where topic='inquiries:99999999-2109-0011-0000-000000000001'),0,'row policy prevents reading other topics through own topic authorization');
select set_config('realtime.topic','inquiries:99999999-2109-0011-0000-000000000001',true);
select is((select count(*)::int from realtime.messages),0,'sales rep cannot subscribe to another workspace');
select set_config('realtime.topic','inquiries:11111111-1111-1111-1111-111111111111',true);
select pg_temp.inbox_act_as('aaaaaaaa-0000-0000-0000-000000000006');
select is((select count(*)::int from realtime.messages),0,'non-sales role cannot subscribe to inbox invalidations');
reset role;
set local role anon;
select throws_like($$select api.annotate_inquiry('eeeeeeee-2109-0011-0000-000000000001',gen_random_uuid(),'remark','Anonymous attempt')$$,'%permission denied%','anonymous annotation denied');
select * from finish();
rollback;
