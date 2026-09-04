-- pgTAP: additive post-purchase feedback, token safety and benefit separation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create or replace function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;

create temp table t_feedback_purchase as
select id from sales.purchases
where workspace_id = '11111111-1111-1111-1111-111111111111'
  and contact_id is not null and status <> 'voided'
order by purchased_at desc limit 1;
grant select on t_feedback_purchase to authenticated, service_role;

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003'); -- sales rep

select lives_ok(
  $$select * from api.feedback_purchase_context((select id from t_feedback_purchase))$$,
  'sales rep can load a typed purchase context');

select lives_ok(
  $$select api.create_feedback_request(
    (select id from t_feedback_purchase),
    '[
      {"question_key":"visit_goal","question_text":"What did you come in looking for today?","answer_text":"Kitchen tiles","position":1},
      {"question_key":"useful_help","question_text":"What part of the service or advice was useful, if any?","answer_text":"Finish explanation","position":2},
      {"question_key":"choice_reason","question_text":"Which product or option did you choose, and what influenced that choice?","answer_text":"A matte option","position":3},
      {"question_key":"overall_experience","question_text":"How would you describe the overall experience in your own words?","answer_text":"Clear but busy","position":4},
      {"question_key":"improvement","question_text":"What could we improve for your next visit?","answer_text":"Shorter waiting time","position":5}
    ]'::jsonb,
    repeat('a', 64), now() + interval '7 days',
    'I came for kitchen tiles. The explanation was clear, but the waiting time could be shorter.',
    'deterministic', '', 'customer-review-v1', repeat('b', 64),
    'https://search.google.com/local/writereview?placeid=demo', false, true,
    'granted_for_private_feedback', 'TEST-PRIVATE-FEEDBACK'
  )$$,
  'sales rep can create one post-purchase feedback request');

select is((select count(*) from feedback.requests where purchase_id = (select id from t_feedback_purchase)), 1::bigint, 'one request is linked to the existing purchase');
select is((select count(*) from feedback.answers where request_id = (select id from feedback.requests where purchase_id = (select id from t_feedback_purchase))), 5::bigint, 'five versioned answers are stored');
select is((select benefit_status from feedback.requests where purchase_id = (select id from t_feedback_purchase)), 'granted_for_private_feedback', 'benefit is explicitly for private feedback');
select ok(exists(select 1 from audit.audit_events where action = 'feedback.request_created'), 'request creation emits minimum audit evidence');

reset role;
set local role service_role;
select is((select status from api.get_feedback_by_token(repeat('a',64))), 'awaiting_customer', 'valid token returns the customer-scoped request');
select is(api.confirm_feedback_by_token(repeat('a',64), 'My honest customer-edited review draft.'), true, 'customer can confirm an edited draft');
select is((select status from feedback.requests where purchase_id = (select id from t_feedback_purchase)), 'confirmed', 'private feedback becomes confirmed');
select is((select benefit_status from feedback.requests where purchase_id = (select id from t_feedback_purchase)), 'granted_for_private_feedback', 'confirmation does not alter the independent benefit');
select is(api.log_feedback_customer_event(repeat('a',64), 'google_handoff_opened'), true, 'Google handoff is logged as a click only');
select ok((select google_handoff_opened_at is not null from feedback.requests where purchase_id = (select id from t_feedback_purchase)), 'handoff timestamp is distinct from a posted-review status');
select is(api.confirm_feedback_by_token(repeat('f',64), 'Unknown link draft'), false, 'unknown token fails closed');

select * from finish();
rollback;
