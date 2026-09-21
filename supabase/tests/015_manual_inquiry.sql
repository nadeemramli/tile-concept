begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.manual_act_as(uid text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
$$;
insert into identity.contacts(id,workspace_id,display_name,is_provisional) values
('eeeeeeee-2109-0015-0000-000000000001','11111111-1111-1111-1111-111111111111','Unique manual match',false),
('eeeeeeee-2109-0015-0000-000000000002','11111111-1111-1111-1111-111111111111','Other manual match',false),
('eeeeeeee-2109-0015-0000-000000000003','11111111-1111-1111-1111-111111111111','Shared manual point',false),
('eeeeeeee-2109-0015-0000-000000000004','11111111-1111-1111-1111-111111111111','Provisional manual match',true),
('eeeeeeee-2109-0015-0000-000000000005','11111111-1111-1111-1111-111111111111','Duplicate phone A',false),
('eeeeeeee-2109-0015-0000-000000000006','11111111-1111-1111-1111-111111111111','Duplicate phone B',false);
insert into identity.contact_points(workspace_id,contact_id,kind,raw_value,normalized_value,is_shared) values
('11111111-1111-1111-1111-111111111111','eeeeeeee-2109-0015-0000-000000000001','phone','+60178881501','+60178881501',false),
('11111111-1111-1111-1111-111111111111','eeeeeeee-2109-0015-0000-000000000002','email','other-manual@test.invalid','other-manual@test.invalid',false),
('11111111-1111-1111-1111-111111111111','eeeeeeee-2109-0015-0000-000000000003','phone','+60178881503','+60178881503',true),
('11111111-1111-1111-1111-111111111111','eeeeeeee-2109-0015-0000-000000000004','phone','+60178881504','+60178881504',false),
('11111111-1111-1111-1111-111111111111','eeeeeeee-2109-0015-0000-000000000005','phone','+60178881505','+60178881505',false),
('11111111-1111-1111-1111-111111111111','eeeeeeee-2109-0015-0000-000000000006','whatsapp','+60178881505','+60178881505',false);
insert into core.workspaces(id,slug,name) values('99999999-2109-0015-0000-000000000001','manual-inquiry-isolation','Manual inquiry isolation');
insert into core.business_locations(id,workspace_id,code,name) values('eeeeeeee-2109-0015-0002-000000000001','99999999-2109-0015-0000-000000000001','FAKE','Other workspace location');
create function pg_temp.manual_fail_link() returns trigger language plpgsql as $$
begin
 if exists(select 1 from sales.leads where id=new.lead_id and raw_name='Manual rollback fixture') then raise exception 'Simulated intake-link failure'; end if;
 return new;
end $$;
create trigger manual_test_link_failure before insert on sales.lead_intake_links for each row execute function pg_temp.manual_fail_link();

set local role authenticated;
select pg_temp.manual_act_as('aaaaaaaa-0000-0000-0000-000000000003');
select is(api.create_manual_inquiry('{"source_channel":"instagram","raw_name":"Manual unique fixture","raw_phone":"017-888-1501","product_interest":[],"owner_id":"aaaaaaaa-0000-0000-0000-000000000003"}',
 'eeeeeeee-2109-0015-0001-000000000001')->>'identity_state','matched','unique normalized identifier links confirmed contact');
select lives_ok($$select api.create_manual_inquiry('{"source_channel":"instagram","raw_name":"Manual unique fixture","raw_phone":"017-888-1501","product_interest":[],"owner_id":"aaaaaaaa-0000-0000-0000-000000000003"}',
 'eeeeeeee-2109-0015-0001-000000000001')$$,'uncertain save retries safely');
select is((select count(*)::int from api.leads where raw_name='Manual unique fixture'),1,'retry creates only one inquiry');
select is((select count(*)::int from api.intake_events where idempotency_key='manual:eeeeeeee-2109-0015-0001-000000000001'),1,'retry creates only one intake');
select is((select count(*)::int from api.lead_intake_links x join api.leads l on l.id=x.lead_id where l.raw_name='Manual unique fixture'),1,'exactly one intake link committed');
select ok((select i.lead_id=l.id and l.contact_id='eeeeeeee-2109-0015-0000-000000000001' and l.source_channel='instagram'
 from api.intake_events i join api.leads l on l.id=i.lead_id where l.raw_name='Manual unique fixture'),'lead, intake and safe identity agree');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"instagram","raw_name":"Changed payload"}','eeeeeeee-2109-0015-0001-000000000001')$$,'%Request ID already used%','changed payload cannot reuse request ID');
select is(api.create_manual_inquiry('{"source_channel":"facebook","raw_name":"Manual phone conflict","raw_phone":"+60178881505"}',gen_random_uuid())->>'identity_state','needs_review','shared phone on two contacts requires review');
select is((select contact_id from api.leads where raw_name='Manual phone conflict'),null::uuid,'conflicting phone never picks first contact');
select is(api.create_manual_inquiry('{"source_channel":"facebook","raw_name":"Manual email conflict","raw_phone":"+60178881501","raw_email":"other-manual@test.invalid"}',gen_random_uuid())->>'identity_state','needs_review','phone and email pointing at different contacts require review');
select is((select contact_id from api.leads where raw_name='Manual email conflict'),null::uuid,'conflicting phone and email remain unlinked');
select is(api.create_manual_inquiry('{"source_channel":"tiktok","raw_name":"Manual shared fixture","raw_phone":"+60178881503"}',gen_random_uuid())->>'identity_state','needs_review','explicit shared flag blocks auto-link even with one contact');
select is(api.create_manual_inquiry('{"source_channel":"tiktok","raw_name":"Manual provisional fixture","raw_phone":"+60178881504"}',gen_random_uuid())->>'identity_state','needs_review','provisional contact requires confirmation');
select is(api.create_manual_inquiry('{"source_channel":"other","raw_name":"Unique manual match"}',gen_random_uuid())->>'identity_state','unlinked','matching name alone never links');
select is(api.create_manual_inquiry('{"source_channel":"google_ads","raw_name":"Manual new identity"}',gen_random_uuid())->>'identity_state','unlinked','unknown identity still saves inquiry safely');
select lives_ok($$select api.annotate_inquiry((select id from api.leads where raw_name='Manual new identity'),gen_random_uuid(),'remark','Context before identity confirmation')$$,'unlinked inquiry can receive a remark');
select lives_ok($$select api.link_lead_contact((select id from api.leads where raw_name='Manual new identity'),'eeeeeeee-2109-0015-0000-000000000001',null,'Staff confirmed the customer')$$,'identity confirmation still works after an immutable remark');
select ok((select a.contact_id='eeeeeeee-2109-0015-0000-000000000001' and a.body='Context before identity confirmation'
  from api.activities a join api.leads l on l.id=a.lead_id where l.raw_name='Manual new identity' and a.metadata->>'event'='inquiry_remark'),'identity attachment preserves authored remark and exposes it on customer history');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"tiktok","raw_name":"Manual invalid owner","owner_id":"aaaaaaaa-0000-0000-0000-000000000004"}',gen_random_uuid())$$,'%permission denied%','rep cannot assign another owner during capture');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"tiktok","raw_name":"Manual invalid location","location_id":"eeeeeeee-2109-0015-0002-000000000001"}',gen_random_uuid())$$,'%location in this workspace%','foreign location rejected');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"tiktok","raw_name":"Manual rollback fixture"}','eeeeeeee-2109-0015-0001-000000000099')$$,'%Simulated intake-link failure%','failed final link aborts command');
select is((select count(*)::int from api.leads where raw_name='Manual rollback fixture'),0,'failed final link rolls back inquiry');
select is((select count(*)::int from api.intake_events where idempotency_key='manual:eeeeeeee-2109-0015-0001-000000000099'),0,'failed final link rolls back intake too');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"tiktok"}',gen_random_uuid())$$,'%Provide at least%','empty capture rejected by DB');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"tiktok","raw_name":"Bad interest","product_interest":["wrong"]}',gen_random_uuid())$$,'%valid product interests%','product validation enforced by DB');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"tiktok","raw_name":"Bad email","raw_email":"invalid"}',gen_random_uuid())$$,'%valid email%','email validation enforced by DB');
select pg_temp.manual_act_as('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok($$select api.create_manual_inquiry('{"source_channel":"facebook","raw_name":"Manager assigned fixture","owner_id":"aaaaaaaa-0000-0000-0000-000000000004"}',gen_random_uuid())$$,'manager can assign valid teammate during capture');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"instagram","raw_name":"Manual unique fixture","raw_phone":"017-888-1501","product_interest":[],"owner_id":"aaaaaaaa-0000-0000-0000-000000000003"}','eeeeeeee-2109-0015-0001-000000000001')$$,'%Request ID already used%','request replay is scoped to original actor');
select pg_temp.manual_act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"other","raw_name":"No sales access"}',gen_random_uuid())$$,'%permission denied%','non-sales capture rejected');
reset role;
select is((select count(*)::int from sales.manual_inquiry_requests where request_id='eeeeeeee-2109-0015-0001-000000000099'),0,'failed save leaves no idempotency record');
set local role anon;
select throws_like($$select api.create_manual_inquiry('{"source_channel":"other","raw_name":"Anonymous"}',gen_random_uuid())$$,'%permission denied%','anonymous capture rejected');
select * from finish();
rollback;
