-- pgTAP: answering an unowned lead claims it, and the inbox has a home for
-- every post-response state (20260911000001).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

create or replace function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;

insert into sales.leads (id, workspace_id, status, source_channel, raw_name, raw_phone, owner_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'new', 'tiktok', 'Unowned Enquirer', '017-8880001', null),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'new', 'meta', 'Owned Enquirer', '017-8880002', 'aaaaaaaa-0000-0000-0000-000000000003');

select is((select count(*)::int from core.saved_views where surface = 'inbox' and user_id is null and name in ('Waiting for reply', 'Contacted')),
  2, 'the inbox has Waiting for reply and Contacted views');
select is((select position from core.saved_views where surface = 'inbox' and user_id is null and name = 'Waiting for reply' limit 1),
  2, 'Waiting for reply sits right after New');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');  -- rep 1

select lives_ok(
  $$select api.log_lead_response('cccccccc-0000-0000-0000-000000000001', 'message', 'whatsapp', 'WhatsApp message sent', false)$$,
  'a rep can answer an unowned lead');
select is((select owner_id::text from sales.leads where id = 'cccccccc-0000-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000003', 'answering an unowned lead claims it for the responder');
select is((select status from sales.leads where id = 'cccccccc-0000-0000-0000-000000000001'),
  'contact_attempted', 'an attempt without a reply is Contact attempted');

select lives_ok(
  $$select api.log_lead_response('cccccccc-0000-0000-0000-000000000002', 'call', 'phone', null, true)$$,
  'the owner can log a response on their own lead');

select * from finish();
rollback;
