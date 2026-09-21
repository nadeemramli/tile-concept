-- Synthetic customers only. Exercise the public RPCs under real member roles.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
$$;
insert into identity.contacts(id,workspace_id,display_name,is_provisional)
select ('bbbbbbbb-2209-0000-0000-'||lpad(n::text,12,'0'))::uuid,'11111111-1111-1111-1111-111111111111','Showroom Fixture '||n,n=7 from generate_series(1,8) n;
insert into identity.contact_points(workspace_id,contact_id,kind,raw_value,normalized_value,is_shared)
select '11111111-1111-1111-1111-111111111111',id,'phone','+6017999900'||right(display_name,1),'+6017999900'||right(display_name,1),false
from identity.contacts where display_name like 'Showroom Fixture %';
update identity.contact_points set raw_value='+60179999004',normalized_value='+60179999004' where contact_id='bbbbbbbb-2209-0000-0000-000000000005';
insert into identity.contact_points(workspace_id,contact_id,kind,raw_value,normalized_value)
values('11111111-1111-1111-1111-111111111111','bbbbbbbb-2209-0000-0000-000000000005','email','different-fixture@example.test','different-fixture@example.test');
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,raw_phone,owner_id,created_at)
select ('cccccccc-2209-0000-0000-'||lpad(n::text,12,'0'))::uuid,'11111111-1111-1111-1111-111111111111',case when n=8 then 'disqualified' else 'new' end,
  case when n=1 then 'tiktok' else 'meta' end,'Showroom Inquiry Fixture '||n,'+6017999900'||n,'aaaaaaaa-0000-0000-0000-000000000004',now()-interval '2 days'
from unnest(array[1,2,4,6,7,8]) n;
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,contact_id,created_at)
values('cccccccc-2209-0000-0000-000000000012','11111111-1111-1111-1111-111111111111','new','website','Second buying inquiry','bbbbbbbb-2209-0000-0000-000000000002',now()-interval '1 day');
update sales.leads set raw_email='different-fixture@example.test' where id='cccccccc-2209-0000-0000-000000000006';
insert into identity.accounts(id,workspace_id,name) values
('eeeeeeee-2209-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Showroom fixture account A'),
('eeeeeeee-2209-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Showroom fixture account B');
update sales.leads set account_id='eeeeeeee-2209-0000-0000-000000000002' where id='cccccccc-2209-0000-0000-000000000012';
insert into core.workspaces(id,slug,name) values('99999999-2209-0000-0000-000000000001','showroom-isolation','Showroom isolation fixture');
insert into identity.contacts(id,workspace_id,display_name) values('bbbbbbbb-2209-0000-0000-000000000099','99999999-2209-0000-0000-000000000001','Foreign showroom fixture');
insert into core.business_locations(id,workspace_id,name,code) values('eeeeeeee-2209-0000-0000-000000000099','99999999-2209-0000-0000-000000000001','Foreign location','FOREIGN');
create function pg_temp.visit_input(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('contact_id','bbbbbbbb-2209-0000-0000-'||lpad(n::text,12,'0'),
    'occurred_at',now()-interval '1 hour','purpose','consultation','renovation_area','Synthetic kitchen','quotation_ref','TEST-SQ','quotation_amount',1200) || extra;
$$;
create function pg_temp.record_visit(n int, req int, extra jsonb default '{}') returns jsonb language sql as $$
  select api.record_showroom_visit(pg_temp.visit_input(n,extra),('dddddddd-2209-0000-0000-'||lpad(req::text,12,'0'))::uuid);
$$;
create temp table outcomes(name text primary key, result jsonb);
grant all on outcomes to authenticated;
create function pg_temp.reject_visit_history() returns trigger language plpgsql as $$
begin
  if new.kind='walk_in' and new.body='TEST ABORT HISTORY' then raise exception 'Synthetic history failure'; end if;
  return new;
end $$;
create trigger reject_visit_history before insert on sales.activities for each row execute function pg_temp.reject_visit_history();

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
select is(api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000001')->>'automatic_lead_id','cccccccc-2209-0000-0000-000000000001','single exact match can link across salesperson ownership');
insert into outcomes values('first',pg_temp.record_visit(1,1));
select is((select result->>'lead_id' from outcomes where name='first'),'cccccccc-2209-0000-0000-000000000001','visit reuses original TikTok inquiry');
select is((select result->>'inquiry_link_state' from outcomes where name='first'),'linked','visit reports its confirmed link');
select is((select count(*)::int from api.leads where raw_phone_normalized='+60179999001'),1,'walk-in does not manufacture another acquisition');
select ok((select source_channel='tiktok' and owner_id='aaaaaaaa-0000-0000-0000-000000000004' and first_whatsapp_sent_at is null and first_customer_reply_at is null from api.inbox_leads where id='cccccccc-2209-0000-0000-000000000001'),'original source, owner and WhatsApp milestones remain unchanged');
select ok((select first_showroom_at=now()-interval '1 hour' and showroom_visits=1 from api.inbox_leads where id='cccccccc-2209-0000-0000-000000000001'),'inbox derives first showroom milestone from confirmed visit');
select is((api.inquiry_page('showroom','Showroom Inquiry Fixture 1')->>'total')::int,1,'showroom inbox view finds original inquiry');
select is((select original_acquisition_source from api.contacts where id='bbbbbbbb-2209-0000-0000-000000000001'),'tiktok','unknown contact acquisition inherits original inquiry source');
select ok((select renovation_area='Synthetic kitchen' and quotation_ref='TEST-SQ' and quotation_amount=1200 from api.visits where id=(select (result->>'visit_id')::uuid from outcomes where name='first')),'tracker values commit with visit');
select is(pg_temp.record_visit(1,1),(select result from outcomes where name='first'),'same request returns same result');
select is((select count(*)::int from api.visits where lead_id='cccccccc-2209-0000-0000-000000000001'),1,'retry does not duplicate visits');
select throws_like($$select pg_temp.record_visit(1,1,'{"purpose":"browse"}')$$,'%Request ID already used%','same key cannot save changed details');
insert into outcomes values('repeat',pg_temp.record_visit(1,2,jsonb_build_object('occurred_at',now()-interval '30 minutes')));
select ok((select first_showroom_at=now()-interval '1 hour' and showroom_visits=2 from api.inbox_leads where id='cccccccc-2209-0000-0000-000000000001'),'repeat visits keep first milestone and two distinct visits');
select is((api.inquiry_page('showroom','Showroom Inquiry Fixture 1')->>'total')::int,1,'repeat visit does not count a second converted inquiry');
select is((select (result->>'new_customer')::boolean from outcomes where name='repeat'),false,'repeat visit is not a first showroom visit');
select throws_like($$select pg_temp.record_visit(1,21,'{"create_opportunity":true}')$$,'%owner%','counter can link a visit but cannot convert another salesperson inquiry');

select is(api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000002')->>'automatic_lead_id',null::text,'multiple buying inquiries never pick latest automatically');
insert into outcomes values('ambiguous',pg_temp.record_visit(2,3));
select ok((select result->>'lead_id' is null and result->>'inquiry_link_state'='needs_linking' from outcomes where name='ambiguous'),'ambiguous visit remains saved and explicitly unresolved');
select lives_ok($$select api.resolve_visit_inquiry((select (result->>'visit_id')::uuid from outcomes where name='ambiguous'),'choose','cccccccc-2209-0000-0000-000000000002','Customer confirmed the Meta kitchen inquiry',1)$$,'staff can resolve ambiguous visit with a reason');
select ok((select first_showroom_at is not null and showroom_visits=1 from api.inbox_leads where id='cccccccc-2209-0000-0000-000000000002'),'resolved visit reaches original inquiry');
select throws_like($$select api.resolve_visit_inquiry((select (result->>'visit_id')::uuid from outcomes where name='ambiguous'),'unlinked',null,'Remove stale link',1)$$,'%Visit link changed%','stale correction cannot overwrite newer decision');
select lives_ok($$select api.resolve_visit_inquiry((select (result->>'visit_id')::uuid from outcomes where name='ambiguous'),'choose','cccccccc-2209-0000-0000-000000000012','Correction: customer confirmed the second project',2)$$,'correction can move visit to another confirmed inquiry');
select ok((select first_showroom_at is null and showroom_visits=0 from api.inbox_leads where id='cccccccc-2209-0000-0000-000000000002'),'correction removes unsupported original milestone');
select ok((select first_showroom_at is not null and showroom_visits=1 from api.inbox_leads where id='cccccccc-2209-0000-0000-000000000012'),'correction updates target milestone');
select is((select count(*)::int from api.activities where visit_id=(select (result->>'visit_id')::uuid from outcomes where name='ambiguous') and subject='Visit inquiry link corrected'),2,'every correction retains a history entry');
insert into outcomes values('account-visit',pg_temp.record_visit(2,25,'{"account_id":"eeeeeeee-2209-0000-0000-000000000001","inquiry_mode":"choose","inquiry_lead_id":"cccccccc-2209-0000-0000-000000000002","inquiry_reason":"Customer confirmed account A inquiry"}'));
select throws_like($$select api.resolve_visit_inquiry((select (result->>'visit_id')::uuid from outcomes where name='account-visit'),'choose','cccccccc-2209-0000-0000-000000000012','Attempt another account',1)$$,'%different account%','correction cannot move visit to an inquiry for another account');

insert into outcomes values('direct',pg_temp.record_visit(3,4));
insert into outcomes values('direct-repeat',pg_temp.record_visit(3,5,jsonb_build_object('occurred_at',now()-interval '20 minutes')));
select is((select result->>'lead_id' from outcomes where name='direct-repeat'),(select result->>'lead_id' from outcomes where name='direct'),'repeat direct walk-in reuses same inquiry');
select is((select source_channel from api.leads where id=(select (result->>'lead_id')::uuid from outcomes where name='direct')),'walk_in','unattributed walk-in never receives paid platform credit');
select is((select result->>'inquiry_link_state' from outcomes where name='direct'),'direct','direct walk-in is distinguished from pending attribution');

select is(api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000004')->>'automatic_lead_id',null::text,'shared normalized phone needs explicit confirmation');
insert into outcomes values('shared',pg_temp.record_visit(4,6));
select is((select result->>'inquiry_link_state' from outcomes where name='shared'),'needs_linking','shared number does not silently credit a platform');
select lives_ok($$select api.resolve_visit_inquiry((select (result->>'visit_id')::uuid from outcomes where name='shared'),'choose','cccccccc-2209-0000-0000-000000000004','Customer confirmed this shared-phone inquiry',1)$$,'staff may explicitly confirm shared-phone identity');
select is(api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000006')->'candidates'->0->>'can_link','false','conflicting secondary identifier blocks unsafe link');
select throws_like($$select pg_temp.record_visit(6,7,'{"inquiry_mode":"choose","inquiry_lead_id":"cccccccc-2209-0000-0000-000000000006","inquiry_reason":"Force wrong identity"}')$$,'%does not match%','staff cannot override an unresolved conflicting identity');
select is(api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000007')->>'automatic_lead_id',null::text,'provisional customer prevents automatic attribution');
select is(api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000008')->>'automatic_lead_id',null::text,'lost inquiry is not automatically revived');
insert into outcomes values('closed-continued',pg_temp.record_visit(8,8,'{"inquiry_mode":"choose","inquiry_lead_id":"cccccccc-2209-0000-0000-000000000008","inquiry_reason":"Customer collecting a previously discussed sample"}'));
select is((select status from api.leads where id='cccccccc-2209-0000-0000-000000000008'),'disqualified','explicit continuation does not change previous lost outcome');
select throws_like($$select pg_temp.record_visit(8,9,'{"inquiry_mode":"choose","inquiry_lead_id":"cccccccc-2209-0000-0000-000000000008","inquiry_reason":"Create from lost","create_opportunity":true}')$$,'%reopen%','visit cannot implicitly reopen a closed inquiry by creating an opportunity');
select throws_like($$select pg_temp.record_visit(2,10,'{"inquiry_mode":"choose","inquiry_lead_id":"cccccccc-2209-0000-0000-000000000001","inquiry_reason":"Wrong customer"}')$$,'%does not match%','foreign customer inquiry is rejected');
select throws_like($$select pg_temp.record_visit(1,11,'{"occurred_at":"infinity"}')$$,'%Visit time%','infinite visit time rejected');
select throws_like($$select pg_temp.record_visit(1,12,jsonb_build_object('occurred_at',now()+interval '1 day'))$$,'%Visit time%','future visit rejected');
select throws_like($$select pg_temp.record_visit(99,13)$$,'%Active customer not found%','foreign workspace contact rejected');
select throws_like($$select pg_temp.record_visit(1,14,'{"location_id":"eeeeeeee-2209-0000-0000-000000000099"}')$$,'%Location not in this workspace%','foreign workspace location rejected');
select throws_like($$select pg_temp.record_visit(1,15,'{"staff_user_id":"ffffffff-2209-0000-0000-000000000099"}')$$,'%Active staff member%','unrelated staff ID rejected');
select throws_like($$update api.visits set lead_id=null where id=(select (result->>'visit_id')::uuid from outcomes where name='first')$$,'%showroom visit commands%','direct table update cannot bypass audited link correction');
select throws_like($$select pg_temp.record_visit(1,16,'{"notes":"TEST ABORT HISTORY"}')$$,'%Synthetic history failure%','history failure aborts entire save');
select is((select count(*)::int from api.visits where lead_id='cccccccc-2209-0000-0000-000000000001'),2,'history failure leaves no orphan visit');
select throws_like($$select pg_temp.record_visit(1,17,'{"quotation_amount":-1}')$$,'%check constraint%','invalid tracker field rejects whole transaction');
select is((select count(*)::int from api.visits where lead_id='cccccccc-2209-0000-0000-000000000001'),2,'tracker failure leaves no orphan visit');
select throws_like($$select pg_temp.record_visit(2,18,'{"create_opportunity":true}')$$,'%Resolve the inquiry%','ambiguous inquiry cannot create opportunity with guessed attribution');
select throws_like($$select pg_temp.record_visit(1,19,'{"inquiry_mode":"new","inquiry_reason":"x"}')$$,'%Explain the inquiry%','new buying inquiry requires a reason');
select is(jsonb_array_length(api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000001',now()-interval '3 days')->'candidates'),0,'a later inquiry is not credited with an earlier visit');
insert into outcomes values('new-staff',pg_temp.record_visit(8,40,'{"inquiry_mode":"new","inquiry_reason":"Customer confirmed a separate renovation","account_id":"eeeeeeee-2209-0000-0000-000000000001","staff_user_id":"aaaaaaaa-0000-0000-0000-000000000004","create_opportunity":true,"product_interest":["tile"],"notes":"Synthetic new buying inquiry"}'));
select ok((select owner_id='aaaaaaaa-0000-0000-0000-000000000004' and account_id='eeeeeeee-2209-0000-0000-000000000001' and source_channel='walk_in' and product_interest=array['tile'] and interest='Synthetic new buying inquiry' from api.leads where id=(select (result->>'lead_id')::uuid from outcomes where name='new-staff')),'new showroom inquiry retains served-by ownership, account and interest while closed inquiry stays separate');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
insert into outcomes values('purchase-opp',pg_temp.record_visit(1,30,'{"create_opportunity":true,"project_name":"Synthetic showroom project","purchase":{"amount":150,"external_ref":"TEST-ORC","payments":[{"method":"cash","amount":150}],"items":[]}}'));
select is((select source_channel from api.opportunities where id=(select (result->>'opportunity_id')::uuid from outcomes where name='purchase-opp')),'tiktok','new opportunity inherits original acquisition source');
select ok((select amount=150 and visit_id=(select (result->>'visit_id')::uuid from outcomes where name='purchase-opp') from api.purchases where id=(select (result->>'purchase_id')::uuid from outcomes where name='purchase-opp')),'optional purchase belongs to committed visit');
select is(pg_temp.record_visit(1,30,'{"create_opportunity":true,"project_name":"Synthetic showroom project","purchase":{"amount":150,"external_ref":"TEST-ORC","payments":[{"method":"cash","amount":150}],"items":[]}}'),(select result from outcomes where name='purchase-opp'),'retry does not duplicate project, opportunity or purchase');
select throws_like($$select api.resolve_visit_inquiry((select (result->>'visit_id')::uuid from outcomes where name='purchase-opp'),'unlinked',null,'Unlink opportunity visit',1)$$,'%must stay consistent%','correction cannot silently contradict an attached opportunity');
select throws_like($$select pg_temp.record_visit(2,31,jsonb_build_object('opportunity_id',(select result->>'opportunity_id' from outcomes where name='purchase-opp')))$$,'%for this customer%','another customer opportunity is rejected');
select throws_like($$select pg_temp.record_visit(1,32,jsonb_build_object('inquiry_mode','new','inquiry_reason','Different buying project','opportunity_id',(select result->>'opportunity_id' from outcomes where name='purchase-opp')))$$,'%same buying inquiry%','same customer is insufficient to link an unrelated buying inquiry and opportunity');
select lives_ok($$select api.record_walk_in('bbbbbbbb-2209-0000-0000-000000000003')$$,'compatibility RPC reuses safe matching');
select is((select count(*)::int from api.leads where contact_id='bbbbbbbb-2209-0000-0000-000000000003'),1,'compatibility RPC also avoids another direct inquiry');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000004');
select throws_like($$select pg_temp.record_visit(1,1)$$,'%Request ID already used%','another actor cannot reuse request token');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like($$select pg_temp.record_visit(1,20)$$,'%permission denied%','non-sales role cannot record visit');
reset role;
set local role anon;
select throws_like($$select api.walk_in_inquiries('bbbbbbbb-2209-0000-0000-000000000001')$$,'%permission denied%','anonymous user cannot inspect identity matches');
select throws_like($$select api.record_showroom_visit('{}',gen_random_uuid())$$,'%permission denied%','anonymous user cannot save visits');
select * from finish();
rollback;
