-- TILE-4: an inquiry's effective arrival kept apart from its recording, and
-- the reviewed classification backfill. Synthetic people and values only.
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
create temp table ids(name text primary key, id uuid); grant all on ids to authenticated, anon;
create function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;
create function pg_temp.kl(t text) returns timestamptz language sql as $$ select (t::timestamp at time zone 'Asia/Kuala_Lumpur') $$;

select pg_temp.mkuser('cccccccc-2500-0000-0000-000000000001','tile4.arrival.rep@tileconcept.test');
select pg_temp.mkuser('cccccccc-2500-0000-0000-000000000002','tile4.arrival.showroom@tileconcept.test');
select pg_temp.mkuser('cccccccc-2500-0000-0000-000000000003','tile4.arrival.admin@tileconcept.test');
select pg_temp.mkuser('cccccccc-2500-0000-0000-000000000004','tile4.backfill.admin@tileconcept.test');
select pg_temp.mkuser('cccccccc-2500-0000-0000-000000000005','tile4.backfill.rep@tileconcept.test');
insert into core.workspaces(id,slug,name) values
  ('cccccccc-2500-0000-0000-0000000000aa','tile4-arrival','TILE-4 arrival fixture'),
  ('cccccccc-2500-0000-0000-0000000000bb','tile4-backfill','TILE-4 backfill fixture');
insert into core.memberships(workspace_id,user_id,role_key) values
  ('cccccccc-2500-0000-0000-0000000000aa','cccccccc-2500-0000-0000-000000000001','sales_rep'),
  ('cccccccc-2500-0000-0000-0000000000aa','cccccccc-2500-0000-0000-000000000002','showroom'),
  ('cccccccc-2500-0000-0000-0000000000aa','cccccccc-2500-0000-0000-000000000003','admin'),
  ('cccccccc-2500-0000-0000-0000000000bb','cccccccc-2500-0000-0000-000000000004','admin'),
  ('cccccccc-2500-0000-0000-0000000000bb','cccccccc-2500-0000-0000-000000000005','sales_rep');
grant execute on all functions in schema pg_temp to authenticated, anon;

------------------------------------------------------------------------------
-- 1. Native and backdated capture.
------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('cccccccc-2500-0000-0000-000000000001');
insert into ids select 'native', (api.create_manual_inquiry('{"source_channel":"whatsapp","raw_name":"Synthetic live inquiry","owner_id":"cccccccc-2500-0000-0000-000000000001"}',gen_random_uuid())->>'lead_id')::uuid;
select ok((select arrival_basis='native' and arrival_precision='exact' and recorded_at is not null and abs(extract(epoch from recorded_at - created_at)) < 1
  from api.leads where id=pg_temp.id('native')),'a live capture is a native, exact arrival recorded at the same moment');
insert into ids select 'back', (api.create_manual_inquiry(jsonb_build_object('source_channel','call','raw_name','Synthetic phoned last week',
  'owner_id','cccccccc-2500-0000-0000-000000000001','arrived_at',(now() - interval '3 days')::text,'arrival_note','Logged from the call book'),gen_random_uuid())->>'lead_id')::uuid;
select ok((select arrival_basis='backdated' and arrival_precision='exact' and created_at = now() - interval '3 days' and recorded_at >= now() - interval '1 second'
  and arrival_note='Logged from the call book' from api.leads where id=pg_temp.id('back')),'an earlier arrival is saved as backdated, separate from its recording time');
select is((select i.occurred_at from api.intake_events i where i.lead_id=pg_temp.id('back')), now() - interval '3 days','the intake event carries the effective arrival');
select throws_like($$select api.create_manual_inquiry(jsonb_build_object('source_channel','call','raw_name','Synthetic future','arrived_at',(now() + interval '1 day')::text),gen_random_uuid())$$,
  '%cannot arrive in the future%','a future arrival is refused');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"call","raw_name":"Synthetic garbage","arrived_at":"yesterday-ish"}',gen_random_uuid())$$,
  '%valid arrival time%','an unreadable arrival is refused');
select throws_like($$select api.create_manual_inquiry(jsonb_build_object('source_channel','call','raw_name','Synthetic odd date','arrived_at',pg_temp.kl('2026-10-01 10:30')::text,'arrival_precision','date'),gen_random_uuid())$$,
  '%start of that Kuala Lumpur day%','a date-only arrival must be the start of the day');
insert into ids select 'dated', (api.create_manual_inquiry(jsonb_build_object('source_channel','call','raw_name','Synthetic date-only','owner_id','cccccccc-2500-0000-0000-000000000001',
  'arrived_at',pg_temp.kl('2026-10-01 00:00')::text,'arrival_precision','date'),gen_random_uuid())->>'lead_id')::uuid;
select is((select arrival_precision from api.leads where id=pg_temp.id('dated')),'date','a date-only arrival is accepted at the start of the day');

------------------------------------------------------------------------------
-- 2. Chronology: work_inquiry still compares against the effective arrival.
------------------------------------------------------------------------------
select throws_like(format($$select api.work_inquiry(%L,'whatsapp_sent',gen_random_uuid(),p_occurred_at => now() - interval '4 days')$$,pg_temp.id('back')),
  '%Invalid channel or event time%','a response before the arrival is refused');
select lives_ok(format($$select api.work_inquiry(%L,'whatsapp_sent',gen_random_uuid(),p_occurred_at => now() - interval '2 days')$$,pg_temp.id('back')),
  'a response after the backdated arrival but before it was recorded is accepted');
select ok((select first_response_at >= created_at and first_response_at < recorded_at from api.leads where id=pg_temp.id('back')),
  'the first response sits between arrival and recording: no negative duration');
select lives_ok(format($$select api.work_inquiry(%L,'contact_attempt',gen_random_uuid(),p_occurred_at => %L::timestamptz)$$,pg_temp.id('dated'),pg_temp.kl('2026-10-01 09:00')),
  'a response on the day of a date-only arrival is accepted');

------------------------------------------------------------------------------
-- 3. Correcting an arrival.
------------------------------------------------------------------------------
select throws_like($$update api.leads set created_at = now() - interval '5 days' where id = pg_temp.id('native')$$,'%arrival command%','a direct change to the arrival is refused');
select throws_like(format($$select api.set_inquiry_arrival(%L,now() - interval '1 day','native','exact','Should not be native',gen_random_uuid())$$,pg_temp.id('native')),
  '%backdated, import or tracker%','a correction states how the time is known');
select throws_like(format($$select api.set_inquiry_arrival(%L,now() - interval '1 day','backdated','exact','no',gen_random_uuid())$$,pg_temp.id('native')),
  '%at least 5 characters%','a correction needs a reason');
select throws_like(format($$select api.set_inquiry_arrival(%L,now() - interval '1 day','backdated','exact','After the reply, wrongly',gen_random_uuid())$$,pg_temp.id('back')),
  '%cannot arrive after its first response%','an arrival cannot move after a recorded response');
insert into ids values ('arrival_req', gen_random_uuid());
select is(api.set_inquiry_arrival(pg_temp.id('native'),now() - interval '6 hours','backdated','exact','Customer messaged the showroom phone this morning',pg_temp.id('arrival_req'))->>'arrival_basis','backdated',
  'an arrival can be corrected earlier with a basis and reason');
select ok((select created_at = now() - interval '6 hours' and arrival_basis='backdated' and recorded_at >= now() - interval '1 second' from api.leads where id=pg_temp.id('native')),
  'the correction changes the arrival, never the recording time');
select ok((select metadata->'before'->>'arrival_basis'='native' and body='Customer messaged the showroom phone this morning'
  from api.activities where lead_id=pg_temp.id('native') and metadata->>'event'='inquiry_arrival'),'the previous arrival and the reason are kept in the inquiry history');
select lives_ok(format($$select api.set_inquiry_arrival(%L,now() - interval '6 hours','backdated','exact','Customer messaged the showroom phone this morning',%L)$$,pg_temp.id('native'),pg_temp.id('arrival_req')),
  'a retried correction is safe');
select is((select count(*)::int from api.activities where lead_id=pg_temp.id('native') and metadata->>'event'='inquiry_arrival'),1,'a retry records no second correction');
select pg_temp.act_as('cccccccc-2500-0000-0000-000000000002');
select throws_like(format($$select api.set_inquiry_arrival(%L,now() - interval '7 hours','backdated','exact','Not my inquiry to change',gen_random_uuid())$$,pg_temp.id('native')),
  '%not the owner%','staff without sales.read_all cannot correct someone else''s inquiry');
reset role;
select throws_like(format($$update sales.leads set recorded_at = now() - interval '1 day' where id = %L$$,pg_temp.id('native')),'%recorded time is fixed%','the recording time is fixed for every writer');
-- An import (server-side, no member session) states an imported arrival; it is still validated.
select lives_ok(format($$update sales.leads set created_at = now() - interval '3 days 1 hour', arrival_basis = 'import', arrival_precision = 'exact' where id = %L$$,pg_temp.id('back')),
  'an importer can state an imported arrival');
select throws_like(format($$update sales.leads set created_at = now() - interval '2 hours', arrival_basis = 'import', arrival_precision = 'exact' where id = %L$$,pg_temp.id('dated')),
  '%cannot arrive after its first response%','no writer can move an arrival past a recorded response');

------------------------------------------------------------------------------
-- 4. Historical rows: labelled legacy, still editable, corrected only with a basis.
------------------------------------------------------------------------------
set local session_replication_role = replica;
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id,created_at,arrival_basis,arrival_precision)
values('cccccccc-2500-0000-0002-000000000001','cccccccc-2500-0000-0000-0000000000aa','contacted','walk_in','Synthetic historical walk-in',
  'cccccccc-2500-0000-0000-000000000001',pg_temp.kl('2025-03-04 12:00'),'legacy','unknown');
set local session_replication_role = origin;
select lives_ok($$update sales.leads set notes = 'Reviewed' where id = 'cccccccc-2500-0000-0002-000000000001'$$,'a legacy row can still be edited elsewhere');
select throws_like($$update sales.leads set created_at = now() - interval '400 days' where id = 'cccccccc-2500-0000-0002-000000000001'$$,
  '%State how the corrected arrival is known%','a legacy arrival is never silently re-dated');
set local role authenticated;
select pg_temp.act_as('cccccccc-2500-0000-0000-000000000001');
select lives_ok($$select api.set_inquiry_arrival('cccccccc-2500-0000-0002-000000000001',(timestamp '2025-03-04 00:00' at time zone 'Asia/Kuala_Lumpur'),'tracker','date','Daily Tracker Mar25 gives the date only',gen_random_uuid())$$,
  'a legacy tracker arrival is corrected to a date-only tracker arrival');
select ok((select arrival_basis='tracker' and arrival_precision='date' and recorded_at is null from api.leads where id='cccccccc-2500-0000-0002-000000000001'),
  'its unknown recording time stays unknown');

------------------------------------------------------------------------------
-- 5. Response time: never negative, date-only arrivals left out of the median.
------------------------------------------------------------------------------
select pg_temp.act_as('cccccccc-2500-0000-0000-000000000003');
select ok((select bool_and(median_response_minutes is null or median_response_minutes >= 0) from api.report_lead_source()),'no median response time is negative');
select is((select median_response_minutes from api.report_lead_source() where source_channel='call'),
  (select round((extract(epoch from first_response_at - created_at)/60)::numeric,1) from api.leads where id=pg_temp.id('back')),
  'the call median uses the exact backdated arrival and ignores the date-only one');

------------------------------------------------------------------------------
-- 6. Reviewed backfill: dry run reconciles, apply writes only known rows, rerun is idempotent.
------------------------------------------------------------------------------
reset role;
-- Records as they stood before classification existed: written with triggers
-- off, so their classification is the untouched legacy Unknown.
set local session_replication_role = replica;
insert into identity.contacts(id,workspace_id,display_name,customer_type) values
  ('cccccccc-2500-0000-0003-000000000001','cccccccc-2500-0000-0000-0000000000bb','Synthetic one-pursuit contractor','contractor'),
  ('cccccccc-2500-0000-0003-000000000002','cccccccc-2500-0000-0000-0000000000bb','Synthetic two-pursuit homeowner','homeowner'),
  ('cccccccc-2500-0000-0003-000000000003','cccccccc-2500-0000-0000-0000000000bb','Synthetic designer visitor',null),
  ('cccccccc-2500-0000-0003-000000000009','cccccccc-2500-0000-0000-0000000000bb','Synthetic already-classified buyer','contractor');
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,contact_id,created_at,arrival_basis,arrival_precision) values
  ('cccccccc-2500-0000-0004-000000000001','cccccccc-2500-0000-0000-0000000000bb','contacted','call','BF one pursuit','cccccccc-2500-0000-0003-000000000001',now(),'legacy','unknown'),
  ('cccccccc-2500-0000-0004-000000000021','cccccccc-2500-0000-0000-0000000000bb','contacted','call','BF homeowner A','cccccccc-2500-0000-0003-000000000002',now(),'legacy','unknown'),
  ('cccccccc-2500-0000-0004-000000000022','cccccccc-2500-0000-0000-0000000000bb','contacted','call','BF homeowner B','cccccccc-2500-0000-0003-000000000002',now(),'legacy','unknown'),
  ('cccccccc-2500-0000-0004-000000000003','cccccccc-2500-0000-0000-0000000000bb','contacted','walk_in','BF linked visit','cccccccc-2500-0000-0003-000000000003',now(),'legacy','unknown'),
  ('cccccccc-2500-0000-0004-000000000004','cccccccc-2500-0000-0000-0000000000bb','contacted','walk_in','BF legacy visit',null,now(),'legacy','unknown');
insert into sales.visits(workspace_id,occurred_at,contact_id,lead_id,customer_type,inquiry_link_state) values
  ('cccccccc-2500-0000-0000-0000000000bb',now(),'cccccccc-2500-0000-0003-000000000003','cccccccc-2500-0000-0004-000000000003','Designer','linked'),
  ('cccccccc-2500-0000-0000-0000000000bb',now(),null,'cccccccc-2500-0000-0004-000000000004','architect','legacy');
insert into identity.projects(id,workspace_id,name,project_type) values
  ('cccccccc-2500-0000-0005-000000000005','cccccccc-2500-0000-0000-0000000000bb','BF reno','renovation'),
  ('cccccccc-2500-0000-0005-000000000006','cccccccc-2500-0000-0000-0000000000bb','BF residential','residential'),
  ('cccccccc-2500-0000-0005-000000000008','cccccccc-2500-0000-0000-0000000000bb','BF defaulted','other');
insert into sales.opportunities(id,workspace_id,name,stage_key,segment,project_id,contact_id,buyer_role,project_use) values
  ('cccccccc-2500-0000-0006-000000000005','cccccccc-2500-0000-0000-0000000000bb','BF residential reno','new','residential','cccccccc-2500-0000-0005-000000000005',null,'unknown','unknown'),
  ('cccccccc-2500-0000-0006-000000000006','cccccccc-2500-0000-0000-0000000000bb','BF disagreeing use','new','commercial','cccccccc-2500-0000-0005-000000000006',null,'unknown','unknown'),
  ('cccccccc-2500-0000-0006-000000000007','cccccccc-2500-0000-0000-0000000000bb','BF institutional','new','institutional',null,null,'unknown','unknown'),
  ('cccccccc-2500-0000-0006-000000000008','cccccccc-2500-0000-0000-0000000000bb','BF defaulted type','new',null,'cccccccc-2500-0000-0005-000000000008',null,'unknown','unknown'),
  ('cccccccc-2500-0000-0006-000000000009','cccccccc-2500-0000-0000-0000000000bb','BF already end user','new',null,null,'cccccccc-2500-0000-0003-000000000009','end_user','unknown'),
  ('cccccccc-2500-0000-0006-000000000010','cccccccc-2500-0000-0000-0000000000bb','BF already residential','new','residential',null,null,'unknown','residential');
set local session_replication_role = origin;

set local role authenticated;
select pg_temp.act_as('cccccccc-2500-0000-0000-000000000005');
select throws_like($$select api.preview_classification_backfill()$$,'%permission denied%','the dry run is an administrator''s tool');
select throws_like($$select api.apply_classification_backfill(0,'Not authorised')$$,'%permission denied%','so is applying it');
select pg_temp.act_as('cccccccc-2500-0000-0000-000000000004');
select is(api.preview_classification_backfill()->'summary','{"known":4,"already_set":1,"conflicting":2,"unmatched":3}'::jsonb,'the dry run reconciles known, already set, conflicting and unmatched rows');
create temp table plan as select value as x from jsonb_array_elements(api.preview_classification_backfill()->'rows');
select results_eq($$select x->>'dimension', x->>'proposed_value' from plan where x->>'outcome'='known' order by 1,2$$,
  $$values ('buyer_role','contractor'),('buyer_role','interior_designer'),('project_use','residential'),('work_type','renovation')$$,
  'known rows come from a one-pursuit contact, a matched visit, a segment and a project type');
select is((select count(*)::int from plan where x->>'opportunity_id'='cccccccc-2500-0000-0006-000000000009' and x->>'outcome'='conflicting'),1,'a contact default that disagrees with a recorded pursuit value is a conflict');
select is((select count(*)::int from plan where x->>'outcome'='unmatched' and x->'evidence'->0->>'contact_pursuits'='2'),2,'a contact with two pursuits says nothing about either');
select is((select count(*)::int from plan where x->>'opportunity_id'='cccccccc-2500-0000-0006-000000000007' and x->>'outcome'='unmatched'),1,'an institutional segment is reported, never mapped to GLC');
select is((select count(*)::int from plan where x->>'lead_id'='cccccccc-2500-0000-0004-000000000004'),0,'a legacy-linked visit is not evidence');
select is((select count(*)::int from plan where x->>'opportunity_id'='cccccccc-2500-0000-0006-000000000008'),0,'a defaulted project type is not evidence');
select throws_ok($$select api.apply_classification_backfill(5,'Authorised in test')$$,'40001',null,'applying needs the reviewed count');
select throws_like($$select api.apply_classification_backfill(4,'ok')$$,'%who authorised%','applying needs an authorisation note');
select is(api.apply_classification_backfill(4,'Synthetic authorisation for the test')->>'applied','4','apply writes exactly the reviewed known rows');
select ok((select buyer_role='contractor' and classification_basis='backfill' from api.leads where id='cccccccc-2500-0000-0004-000000000001'),'a known value is written with a backfill basis');
select ok((select project_use='residential' and work_type='renovation' from api.opportunities where id='cccccccc-2500-0000-0006-000000000005'),'two dimensions of one opportunity are written independently');
select ok((select buyer_role='end_user' from api.opportunities where id='cccccccc-2500-0000-0006-000000000009'),'a recorded pursuit value is never overwritten');
select ok((select project_use='unknown' from api.opportunities where id='cccccccc-2500-0000-0006-000000000006'),'a conflicting dimension stays Unknown for a person to decide');
select is((select count(*)::int from api.classification_events e join api.opportunities o on o.id=e.opportunity_id where o.workspace_id='cccccccc-2500-0000-0000-0000000000bb' and e.basis='backfill')
  + (select count(*)::int from api.classification_events e join api.leads l on l.id=e.lead_id where l.workspace_id='cccccccc-2500-0000-0000-0000000000bb' and e.basis='backfill' and e.opportunity_id is null),
  4,'each written value has a history row');
select ok((select bool_and(source_values ? 'evidence') from api.classification_events e join api.leads l on l.id=e.lead_id where l.workspace_id='cccccccc-2500-0000-0000-0000000000bb' and e.basis='backfill'),
  'the history row keeps the evidence it was written from');
select is(api.preview_classification_backfill()->'summary','{"known":0,"already_set":5,"conflicting":2,"unmatched":3}'::jsonb,'a second dry run finds nothing left to write');
select is(api.apply_classification_backfill(0,'Synthetic authorisation for the rerun')->>'applied','0','a rerun writes nothing');
select pg_temp.act_as('cccccccc-2500-0000-0000-000000000003');
select is((select count(*)::int from jsonb_array_elements(api.preview_classification_backfill()->'rows') x where x->>'lead_id' like 'cccccccc-2500-0000-0004%'),0,
  'an administrator of another workspace never sees these rows');

select * from finish();
rollback;
