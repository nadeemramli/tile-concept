begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(uid text,rol text default 'authenticated') returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',uid,'role',rol)::text,true)
$$;
create function pg_temp.test_config() returns jsonb language sql as $$
 select jsonb_set(jsonb_set(jsonb_set(jsonb_set(sales.default_lead_routing(),'{pools,0,members,0,user_id}','"aaaaaaaa-0000-0000-0000-000000000003"'),
 '{pools,1,members,0,user_id}','"aaaaaaaa-0000-0000-0000-000000000003"'),'{pools,1,members,1,user_id}','"aaaaaaaa-0000-0000-0000-000000000004"'),
 '{pools,1,members,2,user_id}','"aaaaaaaa-0000-0000-0000-000000000002"')
$$;
create function pg_temp.accept(n integer,category text default 'designer') returns uuid language sql as $$
 select (api.accept_intake('11111111-1111-1111-1111-111111111111','meta','facebook','routing-fixture-'||n,'routing-fixture-'||n,
 jsonb_build_object('customer_type',category),jsonb_build_object('name','Routing fixture '||n,'email','routing-fixture-'||n||'@example.test'))->>'lead_id')::uuid
$$;
create temporary table fixture_ids(n integer primary key,id uuid);
insert into ingest.telegram_sales_channels values('11111111-1111-1111-1111-111111111111',-700123);

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is(api.get_lead_routing()->'config'->'pools'->0->'members'->0->>'name','Naufal','default homeowner slot is Naufal');
select is((api.get_lead_routing()->>'version')::int,0,'unconfigured settings have explicit version zero');
reset role;
select lives_ok($$select pg_temp.accept(0,'homeowner')$$,'unlinked default accepts a lead safely');
select is((select reason from sales.lead_routing_assignments where lead_id=(select lead_id from sales.intake_events where idempotency_key='routing-fixture-0')),'No linked active salesperson: configure pool members','unlinked staff does not invent ownership');
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
-- pg_temp helper is owner-only because it reads the internal default template.
reset role;
create temporary table config_fixture as select pg_temp.test_config() config;
grant select on config_fixture to authenticated;
set local role authenticated;
select is((api.save_lead_routing((select config from config_fixture),0)->>'version')::int,1,'admin saves the two pools');
select throws_like($$select api.save_lead_routing((select config from config_fixture),0)$$,'%Routing changed%','stale settings cannot overwrite a newer save');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_like($$select api.save_lead_routing((select config from config_fixture),1)$$,'%permission denied%','salesperson cannot change routing');
select throws_like($$select sales.work_inquiry_as('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','telegram',gen_random_uuid(),'whatsapp_sent',gen_random_uuid())$$,'%permission denied%','private actor command cannot be called directly by staff');
reset role;
select pg_temp.act_as(null,'service_role');
insert into fixture_ids select n,pg_temp.accept(n) from generate_series(1,4) n;
select is((select owner_id::text from sales.leads where id=(select id from fixture_ids where n=1)),'aaaaaaaa-0000-0000-0000-000000000003','trade starts at Beyla slot');
select is((select owner_id::text from sales.leads where id=(select id from fixture_ids where n=2)),'aaaaaaaa-0000-0000-0000-000000000004','trade rotates to Alia slot');
select is((select owner_id::text from sales.leads where id=(select id from fixture_ids where n=3)),'aaaaaaaa-0000-0000-0000-000000000002','trade rotates to Jerry slot');
select is((select owner_id::text from sales.leads where id=(select id from fixture_ids where n=4)),'aaaaaaaa-0000-0000-0000-000000000003','trade wraps equally');
select is(pg_temp.accept(1),(select id from fixture_ids where n=1),'duplicate intake reuses the original lead');
select is((select last_position from sales.lead_pool_cursors where pool_key='trade'),1,'duplicate intake does not consume a turn');
insert into fixture_ids values(5,pg_temp.accept(5,'end user')),(6,pg_temp.accept(6,'business owner')),(7,pg_temp.accept(7,'unrecognized'));
select is((select owner_id::text from sales.leads where id=(select id from fixture_ids where n=5)),'aaaaaaaa-0000-0000-0000-000000000003','end user routes to fixed Naufal slot');
select ok((select owner_id is null from sales.leads where id=(select id from fixture_ids where n=6)),'business owner awaits explicit mapping');
select ok((select owner_id is null from sales.leads where id=(select id from fixture_ids where n=7)),'unknown category stays unassigned');
select is((select count(*)::integer from sales.telegram_lead_cards),8,'one durable card per new intake');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select lives_ok($$select api.begin_telegram_link(encode(extensions.digest('fixture-code','sha256'),'hex'))$$,'staff creates an expiring personal link');
reset role;
select pg_temp.act_as(null, 'service_role');
set local role service_role;
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111','{"update_id":1,"message":{"from":{"id":333},"chat":{"id":333,"type":"private"},"text":"/start tc_fixture-code"}}')->>'kind','message','private bot start consumes the self-link');
reset role;
select is((select user_id::text from sales.telegram_members where telegram_user_id=333),'aaaaaaaa-0000-0000-0000-000000000003','numeric Telegram identity binds to the authenticated code owner');
update sales.telegram_lead_cards set message_id=123 where lead_id=(select id from fixture_ids where n=1);
create temporary table callback_fixture as
 select jsonb_build_object('update_id',2,'callback_query',jsonb_build_object('id','callback-fixture-2','from',jsonb_build_object('id',333),
 'data','tc:'||token||':sent','message',jsonb_build_object('message_id',123,'chat',jsonb_build_object('id',-700123)))) payload
 from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1);
grant select on callback_fixture to service_role;
set local role service_role;
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',(select payload from callback_fixture))->>'text','Saved in Inquiry Box.','verified assigned salesperson can mark WhatsApp sent');
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',(select payload from callback_fixture))->>'text','Saved in Inquiry Box.','duplicate Telegram update replays the committed result');
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',jsonb_set((select payload from callback_fixture),'{update_id}','3'))->>'show_alert','true','old card token cannot repeat the action');
reset role;
select is((select contact_attempts from sales.leads where id=(select id from fixture_ids where n=1)),1,'retry does not double-count attempts');
select ok((select first_whatsapp_sent_at is not null and first_customer_reply_at is null from sales.leads where id=(select id from fixture_ids where n=1)),'outreach never fabricates a customer reply');
select is((select actor_id::text from sales.activities where lead_id=(select id from fixture_ids where n=1)),'aaaaaaaa-0000-0000-0000-000000000003','activity records the linked human actor');
select is((select metadata->>'source' from sales.activities where lead_id=(select id from fixture_ids where n=1)),'telegram','activity identifies Telegram as its source');
select is((select count(*)::integer from audit.audit_events where action='inquiry.whatsapp_sent' and actor_id='aaaaaaaa-0000-0000-0000-000000000003'),1,'business audit identifies the human actor once');

create function pg_temp.callback(p_update integer,p_action text,p_who bigint default 333,p_chat bigint default -700123) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('update_id',p_update,'callback_query',jsonb_build_object('id','fixture-'||p_update,'from',jsonb_build_object('id',p_who),
 'data','tc:'||token||':'||p_action,'message',jsonb_build_object('message_id',123,'chat',jsonb_build_object('id',p_chat))))
 from sales.telegram_lead_cards where lead_id=(select id from pg_temp.fixture_ids where n=1)
$$;
insert into sales.telegram_members(workspace_id,user_id,telegram_user_id) values('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000004',444);
set local role service_role;
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',pg_temp.callback(4,'reply',444))->>'show_alert','true','another salesperson cannot update the assigned lead');
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',pg_temp.callback(5,'reply',333,-700124))->>'show_alert','true','copied card in another group is denied');
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',pg_temp.callback(6,'reply',555))->>'show_alert','true','unlinked numeric Telegram identity is denied');
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',pg_temp.callback(7,'reply'))->>'show_alert','false','assignee can record a real customer reply');
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111',pg_temp.callback(8,'tomorrow'))->>'show_alert','false','assignee can schedule tomorrow follow-up');
select is(api.process_telegram_update('11111111-1111-1111-1111-111111111111','{"update_id":9,"message":{"from":{"id":555},"chat":{"id":555,"type":"private"},"text":"/start tc_fixture-code"}}')->>'text','This link expired. Create a fresh link in the app.','consumed account link cannot be replayed by another person');
reset role;
select ok((select first_customer_reply_at is not null and status='contacted' from sales.leads where id=(select id from fixture_ids where n=1)),'reply is visible in canonical inquiry state');
select is((select (due_at at time zone 'Asia/Kuala_Lumpur')::time::text from sales.tasks where lead_id=(select id from fixture_ids where n=1)),'09:00:00','tomorrow follow-up is 9am Malaysia time');
select is((select (due_at at time zone 'Asia/Kuala_Lumpur')::date from sales.tasks where lead_id=(select id from fixture_ids where n=1)),(now() at time zone 'Asia/Kuala_Lumpur')::date+1,'tomorrow follows the Malaysian calendar');
select ok((select needs_sync from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),'progress changes remain queued until Telegram delivery is confirmed');
select is((select count(*)::integer from sales.activities where lead_id=(select id from fixture_ids where n=1)),3,'denied callbacks do not create progress history');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_like($$select api.process_telegram_update('11111111-1111-1111-1111-111111111111','{"update_id":100}')$$,'%permission denied%','a browser session cannot call the trusted provider adapter');
select throws_like($$select api.accept_intake('11111111-1111-1111-1111-111111111111','meta','facebook','forged-intake','forged-intake','{}','{}')$$,'%permission denied%','sales browser session cannot impersonate an intake connector');
select throws_like($$select * from api.telegram_link_codes$$,'%permission denied%','staff cannot read other account link hashes');
select is((select count(*)::integer from api.telegram_members),1,'member can read only their own Telegram binding');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok($$select api.save_lead_routing(jsonb_set((select config from config_fixture),'{pools,1,members,1,active}','false'),1)$$,'administrator can pause one salesperson slot');
reset role;
insert into fixture_ids values(8,pg_temp.accept(8));
select is((select owner_id::text from sales.leads where id=(select id from fixture_ids where n=8)),'aaaaaaaa-0000-0000-0000-000000000002','rotation skips an inactive Alia slot and chooses Jerry');
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select throws_like($$select api.save_lead_routing(jsonb_set((select config from config_fixture),'{pools,0,mode}','null'),2)$$,'%Invalid or duplicate pool%','direct RPC rejects a missing distribution mode');
select lives_ok($$select api.save_lead_routing(jsonb_set((select config from config_fixture),'{pools,1,active}','false'),2)$$,'administrator can pause the trade pool');
reset role;
insert into fixture_ids values(9,pg_temp.accept(9));
select is((select reason from sales.lead_routing_assignments where lead_id=(select id from fixture_ids where n=9)),'Pool paused: review routing','paused pool leaves a clear unassigned reason');

create temporary table pending_fixture as select api.pending_telegram_cards('11111111-1111-1111-1111-111111111111') cards;
select ok((select jsonb_array_length(cards)>0 from pending_fixture),'queued cards can be leased for delivery');
select is(jsonb_array_length(api.pending_telegram_cards('11111111-1111-1111-1111-111111111111')),0,'concurrent worker cannot claim a leased card');
update sales.telegram_lead_cards set lease_until=now()-interval '1 second';
select ok(jsonb_array_length(api.pending_telegram_cards('11111111-1111-1111-1111-111111111111'))>0,'failed delivery becomes eligible after lease expiry');
create temporary table old_delivery as select lead_id,token from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1);
update sales.telegram_lead_cards set token=gen_random_uuid(),needs_sync=true where lead_id=(select id from fixture_ids where n=1);
select lives_ok($$select api.confirm_telegram_card('11111111-1111-1111-1111-111111111111',(select lead_id from old_delivery),(select token from old_delivery),123)$$,'late delivery acknowledgement is accepted safely');
select ok((select needs_sync from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),'late acknowledgement cannot clear a newer progress change');
update sales.telegram_lead_cards set expires_at=now()-interval '1 second' where lead_id=(select id from fixture_ids where n=1);
select lives_ok($$select api.pending_telegram_cards('11111111-1111-1111-1111-111111111111')$$,'worker refreshes expired button tokens');
select ok((select expires_at>now() from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),'long-lived inquiries receive fresh operational buttons');
select ok(sales.telegram_card_data((select id from fixture_ids where n=1)) ? 'last_customer_reply_at','cards include the latest reply context');
select lives_ok($$select api.confirm_telegram_card('11111111-1111-1111-1111-111111111111',(select id from fixture_ids where n=1),(select token from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),123)$$,'current delivered follow-up snapshot is acknowledged');
update sales.tasks set due_at=due_at+interval '1 day' where lead_id=(select id from fixture_ids where n=1) and status='open';
select ok((select not needs_sync from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),'plain task edit is independent of lead mutation triggers');
select lives_ok($$select api.pending_telegram_cards('11111111-1111-1111-1111-111111111111')$$,'poll reconciles app-side follow-up edits');
select ok((select needs_sync and leased_follow_up_at is distinct from delivered_follow_up_at from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),'changed reminder is queued with its actual delivery snapshot');
select lives_ok($$select api.confirm_telegram_card('11111111-1111-1111-1111-111111111111',(select id from fixture_ids where n=1),(select token from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),123)$$,'changed reminder delivery can be confirmed');
delete from sales.tasks where lead_id=(select id from fixture_ids where n=1);
select lives_ok($$select api.pending_telegram_cards('11111111-1111-1111-1111-111111111111')$$,'removed follow-up is reconciled too');
select ok((select needs_sync and leased_follow_up_at is null from sales.telegram_lead_cards where lead_id=(select id from fixture_ids where n=1)),'Telegram is refreshed when the app removes its last follow-up');

select * from finish();
rollback;
