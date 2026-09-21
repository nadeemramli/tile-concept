begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create or replace function pg_temp.review_actor(uid text) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,false);
$$;
create temp table review_case(id uuid,visit_id uuid,other_visit_id uuid,input jsonb);
insert into core.workspaces(id,slug,name) values('13131313-0000-0000-0000-000000000080','reviews-qc-isolation','Synthetic reviews isolation');
insert into identity.contacts(id,workspace_id,display_name) values('13131313-0000-0000-0000-000000000081','13131313-0000-0000-0000-000000000080','Synthetic other-workspace customer');
insert into sales.visits(id,workspace_id,contact_id) values('13131313-0000-0000-0000-000000000082','13131313-0000-0000-0000-000000000080','13131313-0000-0000-0000-000000000081');
insert into feedback.requests(id,workspace_id,visit_id,contact_id,created_by) values('13131313-0000-0000-0000-000000000083','13131313-0000-0000-0000-000000000080','13131313-0000-0000-0000-000000000082','13131313-0000-0000-0000-000000000081','aaaaaaaa-0000-0000-0000-000000000005');
insert into sales.visits(id,workspace_id,contact_id) values('13131313-0000-0000-0000-000000000084','11111111-1111-1111-1111-111111111111','13131313-0000-0000-0000-000000000081');
insert into sales.visits(id,workspace_id,contact_id,staff_user_id,purpose)
select '13131313-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',id,'aaaaaaaa-0000-0000-0000-000000000005','browse'
from identity.contacts where workspace_id='11111111-1111-1111-1111-111111111111' and not is_provisional and archived_at is null and merged_into_contact_id is null order by id limit 1;
insert into sales.visits(id,workspace_id,contact_id,staff_user_id,purpose)
select '13131313-0000-0000-0000-000000000002',workspace_id,contact_id,staff_user_id,'browse' from sales.visits where id='13131313-0000-0000-0000-000000000001';
insert into review_case(visit_id,other_visit_id,input) values('13131313-0000-0000-0000-000000000001','13131313-0000-0000-0000-000000000002',jsonb_build_object(
  'visit_id','13131313-0000-0000-0000-000000000001','answers','[
  {"question_key":"goal","question_text":"Goal?","answer_text":"Kitchen tiles","position":1},
  {"question_key":"help","question_text":"Help?","answer_text":"Useful advice but a long wait","position":2},
  {"question_key":"choice","question_text":"Choice?","answer_text":"","position":3},
  {"question_key":"overall","question_text":"Overall?","answer_text":"","position":4},
  {"question_key":"improve","question_text":"Improve?","answer_text":"","position":5}]'::jsonb,
  'token_hash',repeat('1',64),'expires_at',now()+interval '7 days','generated_text','Useful advice but a long wait.',
  'generation_mode','deterministic','prompt_version','test-v1','input_hash',repeat('2',64),
  'review_url','https://search.google.com/local/writereview?placeid=synthetic','whatsapp_consent',true,'photo_permission',true));
grant all on review_case to authenticated,service_role;
set local role authenticated;
select pg_temp.review_actor('aaaaaaaa-0000-0000-0000-000000000005');
select lives_ok($$select api.feedback_workbench(p_visit_id=>(select visit_id from review_case))$$,'showroom staff can open a visit without a purchase');
select ok(api.feedback_workbench(p_visit_id=>(select visit_id from review_case))->>'phone' is not null,'showroom can access audited feedback recipient without general contact reveal');
select is(core.has_permission('contact.reveal'),false,'scoped feedback grant does not reveal unrelated contact details');
select throws_ok($$select api.feedback_workbench(p_visit_id=>'13131313-0000-0000-0000-000000000082')$$,'P0002','Visit or eligible purchase not found','other workspace visit cannot reveal customer');
select throws_ok($$select api.feedback_workbench(p_visit_id=>'13131313-0000-0000-0000-000000000084')$$,'P0002','Visit or eligible purchase not found','inconsistent historical contact reference cannot leak another workspace');
select throws_ok($$select api.manage_feedback_request('13131313-0000-0000-0000-000000000083','whatsapp_sent')$$,'P0002','Feedback request not found','other workspace request cannot mutate');
select is((select count(*) from api.feedback_requests where id='13131313-0000-0000-0000-000000000083'),0::bigint,'other workspace tracking row hidden by RLS');
select throws_ok($$select api.prepare_visit_feedback((select input||'{"whatsapp_consent":false}'::jsonb from review_case))$$,'23514','Customer agreement to receive the link is required','consent is enforced by DB');
select lives_ok($$update review_case set id=api.prepare_visit_feedback(input)$$,'showroom staff prepares feedback from visit');
select is((select purchase_id from api.feedback_requests where id=(select id from review_case)),null::uuid,'no fake purchase is created');
select is((select review_outcome from api.feedback_requests where id=(select id from review_case)),'unknown','prepared draft does not claim posted review');
select throws_ok($$select api.prepare_visit_feedback((select input from review_case))$$,'23505','Feedback already exists; open the existing request','repeat create recovers through existing request');
select is(api.feedback_workbench(p_visit_id=>(select visit_id from review_case))->>'existing_request_id',(select id::text from review_case),'visit reopens same request');
select lives_ok($$select api.log_feedback_staff_event((select id from review_case),'whatsapp_opened')$$,'WhatsApp opening recorded separately');
select is((select whatsapp_sent_at from api.feedback_requests where id=(select id from review_case)),null::timestamptz,'open does not mark sent');
select lives_ok($$select api.manage_feedback_request((select id from review_case),'whatsapp_sent')$$,'manual sent state accepted');
select lives_ok($$select api.manage_feedback_request((select id from review_case),'whatsapp_sent')$$,'sent retry is idempotent');
select is((select count(*) from feedback.handoff_events where request_id=(select id from review_case) and event_type='whatsapp_sent'),1::bigint,'one manual sent event');
select throws_ok($$select api.manage_feedback_request((select id from review_case),'review_staff_verified')$$,'23514','Record a reason or verification evidence (at least 5 characters)','review verification needs evidence');
select lives_ok($$select api.manage_feedback_request((select id from review_case),'review_customer_reported','Customer said they posted')$$,'customer report kept separate');
select is((select review_outcome from api.feedback_requests where id=(select id from review_case)),'customer_reported','reported is not verified');
select lives_ok($$select api.manage_feedback_request((select id from review_case),'review_staff_verified','Viewed synthetic review dated today')$$,'staff can record verification evidence');
select lives_ok($$select api.prepare_feedback_photo((select id from review_case),'13131313-0000-0000-0000-000000000010','image/png',100)$$,'photo intent authorized');
select is((select has_photo from api.feedback_requests where id=(select id from review_case)),false,'intent alone is not an uploaded photo');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) select 'feedback-media',object_path,'{"size":100,"mimetype":"image/png"}'::jsonb from feedback.media where id='13131313-0000-0000-0000-000000000010'$$,'own intended image passes storage RLS');
select throws_ok($$insert into storage.objects(bucket_id,name) values('feedback-media','11111111-1111-1111-1111-111111111111/unapproved.png')$$,'42501',null,'arbitrary storage object rejected');
select lives_ok($$select api.prepare_feedback_photo((select id from review_case),'13131313-0000-0000-0000-000000000011','image/jpeg',120)$$,'second photo supported');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) select 'feedback-media',object_path,'{"size":120,"mimetype":"image/jpeg"}'::jsonb from feedback.media where id='13131313-0000-0000-0000-000000000011'$$,'second image uploaded');
select is((select count(*) from api.feedback_requests where id=(select id from review_case)),1::bigint,'multiple photos do not duplicate tracking rows');
select throws_ok($$select * from api.feedback_photos_by_token(repeat('1',64))$$,'42501',null,'staff cannot use customer-token API directly');
reset role;
set local role service_role;
select is((select count(*) from api.get_feedback_by_token(repeat('1',64))),1::bigint,'visit token returns one customer view');
select is((select count(*) from api.feedback_photos_by_token(repeat('1',64))),2::bigint,'customer sees both uploaded photos');
select is(api.confirm_feedback_by_token(repeat('1',64),'Helpful advice, but a long wait.'),true,'critical customer draft can be confirmed');
select is(api.log_feedback_customer_event(repeat('1',64),'google_handoff_opened'),true,'critical customer gets same Google handoff');
reset role;
set local role authenticated;
select pg_temp.review_actor('aaaaaaaa-0000-0000-0000-000000000005');
select lives_ok($$select api.manage_feedback_request((select id from review_case),'reissue','',repeat('3',64),now()+interval '7 days')$$,'lost link can be replaced');
reset role;
set local role service_role;
select is((select count(*) from api.get_feedback_by_token(repeat('1',64))),0::bigint,'old token invalid after rotation');
select is((select status from api.get_feedback_by_token(repeat('3',64))),'confirmed','rotation preserves private confirmation');
reset role;
set local role authenticated;
select pg_temp.review_actor('aaaaaaaa-0000-0000-0000-000000000005');
select lives_ok($$select api.manage_feedback_request((select id from review_case),'revoke','Customer withdrew sharing agreement')$$,'staff can revoke private link');
reset role;
set local role service_role;
select is((select count(*) from api.get_feedback_by_token(repeat('3',64))),0::bigint,'revoked token cannot read answers');
select is((select count(*) from api.feedback_photos_by_token(repeat('3',64))),0::bigint,'revoked token cannot read photos');
reset role;
set local role authenticated;
select pg_temp.review_actor('aaaaaaaa-0000-0000-0000-000000000006');
select throws_ok($$select api.feedback_workbench(p_visit_id=>(select visit_id from review_case))$$,'42501',null,'catalog role denied customer feedback workbench');
reset role;
select * from finish();
rollback;
