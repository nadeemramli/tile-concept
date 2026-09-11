-- pgTAP: an enquiry's identity is shared across lookups, and lead writes stay
-- owner-scoped even through the SECURITY DEFINER RPCs (20260910000001).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create or replace function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;

-- Fixtures, written as the owner role: one enquiry owned by rep 2, one unassigned.
insert into sales.leads (id, workspace_id, status, source_channel, raw_name, raw_phone, raw_email, owner_id)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'new', 'website', 'Test Enquirer', '017-9990001', 'Test.Enquirer@Example.test ', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'new', 'tiktok', 'Unassigned Enquirer', '017-9990002', null, null);

select is((select raw_email_normalized from sales.leads where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'test.enquirer@example.test', 'the trigger normalises the enquiry email');
select is((select raw_phone_normalized from sales.leads where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  '+60179990002', 'the trigger normalises the enquiry phone');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');  -- rep 1

-- The walk-in counter sees an enquiry nobody has linked yet.
select is((select entity_type from api.find_identity_candidates('0179990002') limit 1),
  'lead', 'the walk-in lookup returns an unlinked enquiry by phone');
select ok((select reasons @> '[{"code":"prior_enquiry"}]' from api.find_identity_candidates('0179990002') limit 1),
  'the enquiry hit carries the prior-enquiry reason');
select is((select entity_type from api.global_search('0179990002') limit 1),
  'lead', 'global search finds an enquiry by phone');

-- Owner scope holds through the RPCs, not only the update policy.
select throws_like(
  $$select api.log_lead_response('bbbbbbbb-0000-0000-0000-000000000001', 'call', 'phone')$$,
  '%not the owner%', 'a rep cannot log a response on another rep''s lead');
select throws_like(
  $$select api.convert_lead('bbbbbbbb-0000-0000-0000-000000000001', (select id from identity.contacts where merged_into_contact_id is null and archived_at is null order by created_at limit 1))$$,
  '%not the owner%', 'a rep cannot convert another rep''s lead');

-- Linking an unassigned enquiry carries its phone onto the contact.
select lives_ok(
  $$select api.link_lead_contact('bbbbbbbb-0000-0000-0000-000000000002', (select id from identity.contacts where merged_into_contact_id is null and archived_at is null order by created_at limit 1))$$,
  'a rep may link an unassigned enquiry to a contact');
select is(
  (select count(*)::int from identity.contact_points cp
     join sales.leads l on l.contact_id = cp.contact_id
   where l.id = 'bbbbbbbb-0000-0000-0000-000000000002' and cp.normalized_value = '+60179990002'),
  1, 'linking carries the enquiry phone onto the contact');
select is((select entity_type from api.find_identity_candidates('0179990002') order by score desc limit 1),
  'contact', 'after linking, the lookup returns the contact');
select ok((select reasons @> '[{"code":"prior_enquiry"}]' from api.find_identity_candidates('0179990002') order by score desc limit 1),
  'and says the contact enquired before');

-- A sales manager holds sales.read_all and may act on any lead.
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select lives_ok(
  $$select api.log_lead_response('bbbbbbbb-0000-0000-0000-000000000001', 'call', 'phone')$$,
  'a sales manager can log a response on any lead');

select * from finish();
rollback;
