-- TILE-4: buyer role and project segmentation on the pursuit.
-- Taxonomy, raw capture with Unknown, qualification that classifies or flags,
-- independence of the dimensions, one pursuit however many visits, per-pursuit
-- roles for one person, conflicts held instead of overwritten, correction
-- history, inquiry/opportunity sync, the review queue, the report grain, and
-- role and workspace boundaries. Synthetic people and values only.
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
-- Classification input for a pursuit, as the classification command takes it.
create function pg_temp.cls(subject jsonb, mode text, ver int, role text, use_ text, work text, glc text, extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select subject || jsonb_build_object('mode',mode,'expected_version',ver,'buyer_role',role,'project_use',use_,'work_type',work,'glc_involvement',glc) || extra
$$;
create function pg_temp.lead(n text) returns jsonb language sql as $$ select jsonb_build_object('lead_id',pg_temp.id(n)) $$;
create function pg_temp.ver(n text) returns int language sql as $$ select classification_version from api.leads where id = pg_temp.id(n) $$;

select pg_temp.mkuser('cccccccc-2400-0000-0000-000000000001','tile4.rep.a@tileconcept.test');
select pg_temp.mkuser('cccccccc-2400-0000-0000-000000000002','tile4.rep.b@tileconcept.test');
select pg_temp.mkuser('cccccccc-2400-0000-0000-000000000003','tile4.manager@tileconcept.test');
select pg_temp.mkuser('cccccccc-2400-0000-0000-000000000004','tile4.admin@tileconcept.test');
select pg_temp.mkuser('cccccccc-2400-0000-0000-000000000005','tile4.catalog@tileconcept.test');
select pg_temp.mkuser('cccccccc-2400-0000-0000-000000000006','tile4.other.rep@tileconcept.test');
select pg_temp.mkuser('cccccccc-2400-0000-0000-000000000007','tile4.showroom@tileconcept.test');
insert into core.workspaces(id,slug,name) values
  ('cccccccc-2400-0000-0000-0000000000aa','tile4-classification','TILE-4 classification fixture'),
  ('cccccccc-2400-0000-0000-0000000000bb','tile4-other','TILE-4 other workspace');
insert into core.memberships(workspace_id,user_id,role_key) values
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0000-000000000001','sales_rep'),
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0000-000000000002','sales_rep'),
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0000-000000000003','sales_manager'),
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0000-000000000004','admin'),
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0000-000000000005','catalog_pricing'),
  ('cccccccc-2400-0000-0000-0000000000bb','cccccccc-2400-0000-0000-000000000006','sales_rep'),
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0000-000000000007','showroom');
insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group) values
  ('cccccccc-2400-0000-0000-0000000000aa','new_inquiry','New',1,'open'),('cccccccc-2400-0000-0000-0000000000aa','contacted','Contacted',2,'open'),
  ('cccccccc-2400-0000-0000-0000000000aa','consult','Consultation',3,'open'),('cccccccc-2400-0000-0000-0000000000aa','qualified','Qualified',4,'open'),
  ('cccccccc-2400-0000-0000-0000000000aa','won','Won',10,'won'),('cccccccc-2400-0000-0000-0000000000aa','lost','Lost',11,'lost');
insert into identity.contacts(id,workspace_id,display_name,customer_type) values
  ('cccccccc-2400-0000-0001-000000000001','cccccccc-2400-0000-0000-0000000000aa','Synthetic two-pursuit buyer','contractor'),
  ('cccccccc-2400-0000-0001-000000000002','cccccccc-2400-0000-0000-0000000000aa','Synthetic earlier homeowner','homeowner'),
  ('cccccccc-2400-0000-0001-000000000003','cccccccc-2400-0000-0000-0000000000aa','Synthetic walk-in person',null);
insert into identity.contact_points(workspace_id,contact_id,kind,raw_value,normalized_value) values
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0001-000000000001','phone','+60170002401','+60170002401'),
  ('cccccccc-2400-0000-0000-0000000000aa','cccccccc-2400-0000-0001-000000000003','phone','+60170002403','+60170002403');
grant execute on all functions in schema pg_temp to authenticated, anon;

------------------------------------------------------------------------------
-- 1. Taxonomy: reportable primary roles, legacy identities preserved, independent dimensions.
------------------------------------------------------------------------------
select results_eq($$select key from core.classification_values where dimension='buyer_role' and not is_legacy order by position$$,
  $$values ('end_user'),('contractor'),('interior_designer'),('other'),('unknown')$$, 'end user, contractor, interior designer, other and unknown are the primary buyer roles');
select results_eq($$select key from core.classification_values where dimension='buyer_role' and is_legacy order by position$$,
  $$values ('developer'),('architect'),('retailer')$$, 'developer, architect and retailer are preserved as earlier-record roles');
select is((select count(*)::int from core.classification_values where reporting_group <> key),0,'no value is folded into another value''s reporting group');
select results_eq($$select key from core.classification_values where dimension='project_use' order by position$$,
  $$values ('residential'),('commercial'),('hospitality'),('mixed'),('other'),('unknown')$$,'project use values');
select results_eq($$select key from core.classification_values where dimension='glc_involvement' order by position$$,
  $$values ('yes'),('no'),('unknown')$$,'GLC involvement is yes/no/unknown, a dimension of its own');
select results_eq($$select key from core.classification_values where dimension='work_type' order by position$$,
  $$values ('new_build'),('renovation'),('other'),('unknown')$$,'work type values');
select is((select count(*)::int from (select dimension, a from core.classification_values cross join unnest(aliases) a group by 1,2 having count(*)>1) x),0,'no source spelling maps to two values of one dimension');
select is((select count(*)::int from core.classification_values where length(btrim(hint)) = 0),0,'every value explains itself');
select is(core.classification_key('buyer_role','Home Owner'),'end_user','homeowner spelling maps to end user');
select is(core.classification_key('buyer_role','Designer'),'interior_designer','earlier designer label maps to interior designer');
select is(core.classification_key('buyer_role','Developer'),'developer','legacy developer keeps its own identity');
select is(core.classification_key('buyer_role','Pemilik rumah'),null::text,'an unrecognised spelling stays unmatched, never guessed');
select is(core.classification_key('work_type','New-Build'),'new_build','hyphen and case variations map');
select is(core.classification_key('project_use','Mixed Use'),'mixed','mixed use maps');

-- A person's own type accepts the new keys and keeps the earlier labels.
select is((select customer_type from identity.contacts where id='cccccccc-2400-0000-0001-000000000002'),'homeowner','an earlier homeowner label is preserved on the person');
select lives_ok($$update identity.contacts set customer_type='unknown' where id='cccccccc-2400-0000-0001-000000000003'$$,'unknown is accepted on a person');
select is((select customer_type from identity.contacts where id='cccccccc-2400-0000-0001-000000000003'),null::text,'unknown on a person is stored as not stated');
select throws_ok($$update identity.contacts set customer_type='landlord' where id='cccccccc-2400-0000-0001-000000000003'$$,'23514',null,'an unlisted person type is refused');

------------------------------------------------------------------------------
-- 2. Raw capture: unknowns are saved and stated, not defaulted.
------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000001');
insert into ids select 'raw', (api.create_manual_inquiry('{"source_channel":"whatsapp","raw_name":"Synthetic raw inquiry","owner_id":"cccccccc-2400-0000-0000-000000000001"}', gen_random_uuid())->>'lead_id')::uuid;
select ok((select buyer_role='unknown' and project_use='unknown' and work_type='unknown' and glc_involvement='unknown' and glc_party_role is null
  and classification_state='unreviewed' and classification_version=0 and classification_basis='capture' from api.leads where id=pg_temp.id('raw')),
  'a raw inquiry saves with every dimension explicitly Unknown');
select is((select count(*)::int from api.classification_events where lead_id=pg_temp.id('raw')),0,'saving only unknowns writes no classification history');
select is((select count(*)::int from api.classification_queue where lead_id=pg_temp.id('raw')),0,'a raw, unqualified inquiry is not yet a correction item');

-- Three independent attributes: a commercial renovation with a GLC end client.
insert into ids select 'glc', (api.create_manual_inquiry('{"source_channel":"email","raw_name":"Synthetic GLC renovation","owner_id":"cccccccc-2400-0000-0000-000000000001","buyer_role":"contractor","project_use":"commercial","work_type":"renovation","glc_involvement":"yes","glc_party_role":"end_client"}', gen_random_uuid())->>'lead_id')::uuid;
select ok((select buyer_role='contractor' and project_use='commercial' and work_type='renovation' and glc_involvement='yes' and glc_party_role='end_client'
  and classification_state='complete' and classification_version=1 from api.leads where id=pg_temp.id('glc')),
  'commercial use, renovation work and a GLC end client are held as independent attributes');
select is((select after_values->>'project_use' from api.classification_events where lead_id=pg_temp.id('glc') and basis='capture'),'commercial','capture is recorded in history');
insert into ids select 'resglc', (api.create_manual_inquiry('{"source_channel":"email","raw_name":"Synthetic residential GLC","owner_id":"cccccccc-2400-0000-0000-000000000001","buyer_role":"end_user","project_use":"residential","work_type":"new_build","glc_involvement":"yes"}', gen_random_uuid())->>'lead_id')::uuid;
select ok((select project_use='residential' and glc_involvement='yes' and glc_party_role='unknown' and classification_state='unreviewed' from api.leads where id=pg_temp.id('resglc')),
  'residential GLC work is representable; an unstated GLC party role is Unknown');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"email","raw_name":"Bad party","glc_involvement":"no","glc_party_role":"developer"}',gen_random_uuid())$$,
  '%GLC party role applies only when a GLC is involved%','a GLC party role needs GLC involvement');
select throws_like($$select api.create_manual_inquiry('{"source_channel":"email","raw_name":"Bad value","buyer_role":"homeowner","project_use":"institutional"}',gen_random_uuid())$$,
  '%Choose a listed value for: buyer_role, project_use%','every unlisted value is named in one refusal');

------------------------------------------------------------------------------
-- 3. Qualification classifies or explicitly flags what is missing.
------------------------------------------------------------------------------
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,
  pg_temp.cls(pg_temp.lead('raw'),'qualification',0,'end_user','unknown','unknown','unknown')),
  '%Classify the project use, work type, GLC involvement or flag it as missing before qualifying%','qualification refuses a silent Unknown');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,
  pg_temp.cls(pg_temp.lead('raw'),'qualification',0,'end_user','unknown','unknown','unknown','{"flag_missing":true}')),
  '%Say what is missing and why%','a flag needs a note');
select is(api.classify_pursuit(pg_temp.cls(pg_temp.lead('raw'),'qualification',0,'end_user','unknown','unknown','unknown',
  '{"flag_missing":true,"reason":"Customer has not described the site yet"}'),gen_random_uuid())->>'classification_state','missing_flagged',
  'qualification can proceed with the missing values flagged');
select ok((select status='qualified' and qualified_at is not null and buyer_role='end_user' and classification_flagged_at is not null from api.leads where id=pg_temp.id('raw')),
  'a flagged qualification qualifies the inquiry and keeps what was stated');
select ok((select subject_type='inquiry' and lead_id=pg_temp.id('raw') and opportunity_id is null and classification_state='missing_flagged'
  from api.classification_queue where lead_id=pg_temp.id('raw')),'the correction queue links the flagged inquiry itself');
select is(api.classify_pursuit(pg_temp.cls(pg_temp.lead('raw'),'capture',pg_temp.ver('raw'),'end_user','residential','renovation','no'),gen_random_uuid())->>'classification_state','complete',
  'filling the unknowns needs no reason and completes the classification');
select ok((select classification_flagged_at is null from api.leads where id=pg_temp.id('raw')),'completing clears the missing flag');
select is((select count(*)::int from api.classification_queue where lead_id=pg_temp.id('raw')),0,'a complete pursuit leaves the queue');

------------------------------------------------------------------------------
-- 4. One person, two pursuits, two roles; contact defaults never overwrite.
------------------------------------------------------------------------------
insert into ids select 'p1', (api.create_manual_inquiry('{"source_channel":"whatsapp","raw_name":"Synthetic buyer for a client","owner_id":"cccccccc-2400-0000-0000-000000000001","raw_phone":"+60170002401","buyer_role":"contractor","project_use":"residential","work_type":"renovation","glc_involvement":"no"}', gen_random_uuid())->>'lead_id')::uuid;
insert into ids select 'p2', (api.create_manual_inquiry('{"source_channel":"whatsapp","raw_name":"Synthetic buyer for own home","owner_id":"cccccccc-2400-0000-0000-000000000001","raw_phone":"+60170002401","buyer_role":"end_user","project_use":"residential","work_type":"new_build","glc_involvement":"no"}', gen_random_uuid())->>'lead_id')::uuid;
select is((select count(distinct contact_id)::int from api.leads where id in (pg_temp.id('p1'),pg_temp.id('p2')) and contact_id='cccccccc-2400-0000-0001-000000000001'),1,'both pursuits belong to the same person');
select results_eq($$select buyer_role from api.leads where id in (pg_temp.id('p1'),pg_temp.id('p2')) order by raw_name$$,$$values ('contractor'),('end_user')$$,
  'the same person holds a different role in each pursuit');
reset role;
update identity.contacts set customer_type = 'interior_designer' where id = 'cccccccc-2400-0000-0001-000000000001';
set local role authenticated;
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000001');
select results_eq($$select buyer_role from api.leads where id in (pg_temp.id('p1'),pg_temp.id('p2')) order by raw_name$$,$$values ('contractor'),('end_user')$$,
  'changing the person''s own type does not touch either pursuit');

-- Visits and stakeholders do not add pursuits; the visit's role does not overwrite.
select lives_ok(format($$select api.record_showroom_visit(%L,gen_random_uuid())$$, jsonb_build_object('contact_id','cccccccc-2400-0000-0001-000000000001',
  'occurred_at',now(),'inquiry_mode','choose','inquiry_lead_id',pg_temp.id('p1'),'inquiry_reason','Same buyer, same client job','customer_type','contractor','purpose','consultation')),
  'a showroom visit is recorded against the first pursuit');
select lives_ok(format($$select api.record_showroom_visit(%L,gen_random_uuid())$$, jsonb_build_object('contact_id','cccccccc-2400-0000-0001-000000000001',
  'occurred_at',now(),'inquiry_mode','choose','inquiry_lead_id',pg_temp.id('p1'),'inquiry_reason','Came back with samples','customer_type','contractor','purpose','sample')),
  'a repeat visit is recorded against the same pursuit');
select is((select count(*)::int from api.classification_events where lead_id=pg_temp.id('p1')),1,'visits agreeing with the recorded role write no new history');
select lives_ok(format($$select api.record_showroom_visit(%L,gen_random_uuid())$$, jsonb_build_object('contact_id','cccccccc-2400-0000-0001-000000000001',
  'occurred_at',now(),'inquiry_mode','choose','inquiry_lead_id',pg_temp.id('p2'),'inquiry_reason','Own home visit with partner','customer_type','contractor','purpose','browse')),
  'a visit to the second pursuit states a different role');
select ok((select buyer_role='end_user' and classification_state='conflict' and classification_conflict->'buyer_role'->>'proposed'='contractor'
  and classification_conflict->'buyer_role'->>'recorded'='end_user' from api.leads where id=pg_temp.id('p2')),
  'a conflicting visit is held for review; the recorded role is not overwritten');
select ok((select classification_state='conflict' and subject_type='inquiry' from api.classification_queue where lead_id=pg_temp.id('p2')),'the conflict appears in the correction queue');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,
  pg_temp.cls(pg_temp.lead('p2'),'correction',pg_temp.ver('p2'),'end_user','residential','new_build','no')),
  '%Explain how the conflicting classification was resolved%','dismissing a conflict needs a reason');
select is(api.classify_pursuit(pg_temp.cls(pg_temp.lead('p2'),'correction',pg_temp.ver('p2'),'end_user','residential','new_build','no',
  '{"reason":"Buying for own home; the visit form was filled from the person record"}'),gen_random_uuid())->>'classification_state','complete','the conflict is resolved with a reason');
select ok((select e.conflict is null and e.reason like 'Buying for own home%' and e.before_values->>'classification_state'='conflict'
  from api.classification_events e where e.lead_id=pg_temp.id('p2') and e.basis='correction'),'the resolution is in the history');

-- A direct walk-in inquiry takes the role stated at the counter.
insert into ids select 'walkin', (api.record_showroom_visit(jsonb_build_object('contact_id','cccccccc-2400-0000-0001-000000000003',
  'occurred_at',now() - interval '2 days','inquiry_mode','automatic','customer_type','interior_designer','purpose','browse'),gen_random_uuid())->>'lead_id')::uuid;
select ok((select buyer_role='interior_designer' and classification_basis='walk_in' and source_channel='walk_in' and arrival_basis='backdated'
  from api.leads where id=pg_temp.id('walkin')),'a new walk-in inquiry carries the role stated at the visit, and its earlier visit time is a backdated arrival');
reset role;
-- A visit linked before matching existed is never re-read as classification evidence.
insert into sales.visits(workspace_id,occurred_at,contact_id,lead_id,customer_type,inquiry_link_state)
values('cccccccc-2400-0000-0000-0000000000aa',now(),'cccccccc-2400-0000-0001-000000000003',pg_temp.id('walkin'),'architect','legacy');
set local role authenticated;
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000001');
select is((select buyer_role from api.leads where id=pg_temp.id('walkin')),'interior_designer','a legacy-linked visit does not change the pursuit');
select is((select count(*)::int from api.visits where lead_id=pg_temp.id('walkin') and inquiry_link_state='legacy'),1,'the legacy repeat visit stays visible with its historical label');

------------------------------------------------------------------------------
-- 5. Inquiry and opportunity are one pursuit: inherit, stay in step, one history.
------------------------------------------------------------------------------
insert into ids select 'opp', (api.convert_lead(pg_temp.id('p1'),'cccccccc-2400-0000-0001-000000000001',null,'Synthetic client project','Synthetic client opportunity')->>'opportunity_id')::uuid;
select ok((select buyer_role='contractor' and project_use='residential' and work_type='renovation' and glc_involvement='no' and classification_basis='inherited'
  and classification_state='complete' from api.opportunities where id=pg_temp.id('opp')),'the opportunity inherits the inquiry''s classification');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,
  pg_temp.cls(jsonb_build_object('opportunity_id',pg_temp.id('opp')),'correction',(select classification_version from api.opportunities where id=pg_temp.id('opp')),'interior_designer','residential','renovation','no')),
  '%Explain why the buyer role changed%','changing a known value needs a reason');
select throws_ok(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,
  pg_temp.cls(jsonb_build_object('opportunity_id',pg_temp.id('opp')),'correction',0,'interior_designer','residential','renovation','no','{"reason":"Stale screen"}')),
  '40001',null,'a stale screen cannot overwrite a newer classification');
insert into ids values ('req', gen_random_uuid());
select is(api.classify_pursuit(pg_temp.cls(jsonb_build_object('opportunity_id',pg_temp.id('opp')),'correction',(select classification_version from api.opportunities where id=pg_temp.id('opp')),
  'interior_designer','residential','renovation','no','{"reason":"Designer is specifying; the contractor only installs"}'),pg_temp.id('req'))->>'classification_state','complete','an opportunity correction with a reason is saved');
select is((select buyer_role from api.leads where id=pg_temp.id('p1')),'interior_designer','the inquiry stays in step with its opportunity');
select is((select count(*)::int from api.classification_events where opportunity_id=pg_temp.id('opp') and basis='correction'),1,'one decision, one history row for the pursuit');
select ok((select lead_id=pg_temp.id('p1') and before_values->>'buyer_role'='contractor' and after_values->>'buyer_role'='interior_designer'
  from api.classification_events where opportunity_id=pg_temp.id('opp') and basis='correction'),'the history row names the inquiry, the before and the after');
select is(api.classify_pursuit(pg_temp.cls(jsonb_build_object('opportunity_id',pg_temp.id('opp')),'correction',
  (select classification_version from api.opportunities where id=pg_temp.id('opp'))-1,'interior_designer','residential','renovation','no',
  '{"reason":"Designer is specifying; the contractor only installs"}'),pg_temp.id('req'))->>'classification_state','complete','a retried request returns its first result');
select is((select count(*)::int from api.classification_events where opportunity_id=pg_temp.id('opp') and basis='correction'),1,'a retry writes no second history row');
select throws_like(format($$select api.classify_pursuit(%L,%L)$$,pg_temp.cls(jsonb_build_object('opportunity_id',pg_temp.id('opp')),'correction',0,'other','residential','renovation','no'),pg_temp.id('req')),
  '%Request ID already used%','a request ID cannot be reused for a different classification');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,
  pg_temp.cls(jsonb_build_object('opportunity_id',pg_temp.id('opp')),'qualification',0,'other','residential','renovation','no')),'%Qualify the inquiry%','an opportunity is not qualified like an inquiry');

------------------------------------------------------------------------------
-- 6. Boundaries: role, owner, workspace, direct writes.
------------------------------------------------------------------------------
select throws_like($$update api.leads set buyer_role='end_user' where id=pg_temp.id('glc')$$,'%through the classification command%','a direct write to a classification is refused');
select throws_ok($$update api.classification_events set reason='edited' where lead_id=pg_temp.id('glc')$$,'42501',null,'history cannot be edited by a member');
-- sales_rep holds sales.read_all (20260921073229), so the owner rule binds roles without it, such as showroom staff.
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000007');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,pg_temp.cls(pg_temp.lead('glc'),'correction',pg_temp.ver('glc'),'contractor','commercial','renovation','unknown','{"reason":"Not my inquiry"}')),
  '%not the owner%','staff without sales.read_all cannot classify an inquiry someone else owns');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,pg_temp.cls(jsonb_build_object('opportunity_id',pg_temp.id('opp')),'correction',0,'other','residential','renovation','no','{"reason":"Not mine either"}')),
  '%Only the owner or a sales manager%','staff without sales.read_all cannot classify an opportunity someone else owns');
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000002');
select is(api.classify_pursuit(pg_temp.cls(pg_temp.lead('glc'),'correction',pg_temp.ver('glc'),'contractor','commercial','renovation','yes','{"glc_party_role":"end_client","reason":"Second rep confirms"}'),gen_random_uuid())->>'classification_state','complete',
  'a rep with sales.read_all may classify a colleague''s inquiry');
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000003');
select is(api.classify_pursuit(pg_temp.cls(pg_temp.lead('resglc'),'correction',pg_temp.ver('resglc'),'end_user','residential','new_build','yes','{"glc_party_role":"developer"}'),gen_random_uuid())->>'classification_state','complete',
  'a sales manager can classify any pursuit in the workspace');
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000005');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,pg_temp.cls(pg_temp.lead('glc'),'correction',0,'contractor','commercial','renovation','yes')),
  '%permission denied%','a role without sales.write cannot classify');
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000006');
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,pg_temp.cls(pg_temp.lead('glc'),'correction',0,'contractor','commercial','renovation','yes')),
  '%Inquiry not found%','a member of another workspace cannot reach the inquiry');
select is((select count(*)::int from api.classification_events where lead_id=pg_temp.id('glc')),0,'another workspace sees none of its history');
select is((select count(*)::int from api.classification_queue where workspace_id='cccccccc-2400-0000-0000-0000000000aa'),0,'another workspace sees none of its queue');
set local role anon;
select throws_like(format($$select api.classify_pursuit(%L,gen_random_uuid())$$,pg_temp.cls(pg_temp.lead('glc'),'correction',0,'contractor','commercial','renovation','yes')),
  '%permission denied%','an anonymous caller cannot classify');
set local role authenticated;

------------------------------------------------------------------------------
-- 7. Report: one row per pursuit per dimension, Unknown kept, legacy grouped on its own.
------------------------------------------------------------------------------
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000004');
create temp table seg as select * from api.report_pursuit_segments(null,null,'month');
select is((select count(distinct total)::int from (select dimension, sum(pursuits) as total from seg where dimension <> 'glc_party_role' group by dimension) x),1,
  'every dimension counts the same pursuits once');
reset role;
select is((select sum(pursuits)::int from seg where dimension='buyer_role'),
  (select count(*)::int from sales.pursuits where workspace_id='cccccccc-2400-0000-0000-0000000000aa'),'the report counts pursuits, not inquiries plus opportunities');
set local role authenticated;
select is((select sum(pursuits)::int from seg where dimension='buyer_role'),6,'raw, GLC, residential GLC, the buyer''s two pursuits (one converted) and the walk-in: six pursuits; visits and conversion add none');
select is((select sum(pursuits)::int from seg where dimension='glc_involvement' and value='yes'),2,'GLC involvement counts the commercial and the residential GLC pursuits');
select is((select sum(pursuits)::int from seg where dimension='project_use' and value='residential'),4,'residential includes the residential GLC job without counting it twice');
select is((select dimension_label from seg where dimension='glc_involvement' limit 1),'GLC involvement','dimensions are labelled');
select ok((select bool_and(period_start = date_trunc('month', period_start)::date) from seg),'periods are calendar buckets');
select throws_like($$select * from api.report_pursuit_segments(null,null,'fortnight')$$,'%daily, weekly or monthly%','an unknown grain is refused');
select pg_temp.act_as('cccccccc-2400-0000-0000-000000000007');
select throws_like($$select * from api.report_pursuit_segments()$$,'%report.read%','a role without report.read cannot run it');

select * from finish();
rollback;
