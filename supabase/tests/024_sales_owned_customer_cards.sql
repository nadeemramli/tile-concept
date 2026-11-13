-- Sales-owned customer cards (20261029164000): one PIC per contact/account,
-- creation under the caller only, non-PIC read-only on every write path, and
-- PIC transfer only through the audited sales.assign command.
-- Synthetic fixtures; everything is rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
-- Run a statement and report the SQLSTATE and message it raised, or 'ok'.
create function pg_temp.outcome(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
grant execute on function pg_temp.outcome(text) to authenticated;

-- Users from supabase/seeds/local-users.sql:
--   ...01 admin, ...02 sales_manager, ...03 sales_rep (PIC), ...04 sales_rep (non-PIC),
--   ...05 showroom, ...07 marketing_coordinator.
insert into core.workspaces(id, slug, name) values
  ('99999999-2910-0024-0000-000000000001', 'owned-cards-isolation', 'Synthetic isolated workspace');
insert into identity.contacts(id, workspace_id, display_name, owner_id, created_by) values
  ('cccccccc-2910-0024-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Synthetic owned contact', 'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('cccccccc-2910-0024-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Synthetic legacy contact', null, null),
  ('cccccccc-2910-0024-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Synthetic teammate contact', 'aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('cccccccc-2910-0024-0000-000000000099', '99999999-2910-0024-0000-000000000001', 'Synthetic foreign contact', 'aaaaaaaa-0000-0000-0000-000000000003', null);
insert into identity.accounts(id, workspace_id, name, owner_id) values
  ('cccccccc-2910-0024-0001-000000000001', '11111111-1111-1111-1111-111111111111', 'Synthetic owned company', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('cccccccc-2910-0024-0001-000000000099', '99999999-2910-0024-0000-000000000001', 'Synthetic foreign company', null);
insert into identity.contact_points(id, workspace_id, contact_id, kind, raw_value, normalized_value, is_primary) values
  ('cccccccc-2910-0024-0002-000000000001', '11111111-1111-1111-1111-111111111111', 'cccccccc-2910-0024-0000-000000000001', 'phone', '0129100241', '+60129100241', true);
insert into identity.account_contact_relationships(id, workspace_id, account_id, contact_id, role) values
  ('cccccccc-2910-0024-0003-000000000001', '11111111-1111-1111-1111-111111111111', 'cccccccc-2910-0024-0001-000000000001', 'cccccccc-2910-0024-0000-000000000001', 'Director');
-- An open enquiry owned by the non-PIC rep, carrying a phone the card lacks.
insert into sales.leads(id, workspace_id, source_channel, raw_name, raw_phone, owner_id) values
  ('cccccccc-2910-0024-0004-000000000001', '11111111-1111-1111-1111-111111111111', 'tiktok', 'Synthetic teammate enquiry', '0129100249', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('cccccccc-2910-0024-0004-000000000002', '11111111-1111-1111-1111-111111111111', 'website', 'Synthetic linked enquiry', null, 'aaaaaaaa-0000-0000-0000-000000000004');
update sales.leads set contact_id = 'cccccccc-2910-0024-0000-000000000001' where id = 'cccccccc-2910-0024-0004-000000000002';

------------------------------------------------------------------------------
-- 1. One PIC, distinct from creator and assigner; legacy exceptions explicit
------------------------------------------------------------------------------
select has_column('identity', 'contacts', 'owner_id', 'contacts carry a PIC');
select has_column('identity', 'contacts', 'owner_assigned_by', 'contacts record who assigned the PIC');
select has_column('identity', 'accounts', 'owner_assigned_by', 'accounts record who assigned the PIC');
select has_column('api', 'contacts', 'owner_id', 'the api view exposes the contact PIC');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select is((select count(*) from api.customer_card_pic_exceptions where id = 'cccccccc-2910-0024-0000-000000000002' and exception = 'missing_pic'), 1::bigint,
  'a legacy contact without a PIC is listed as an exception');
select is((select count(*) from api.customer_card_pic_exceptions where id = 'cccccccc-2910-0024-0000-000000000001' and exception = 'lead_owner_differs'), 1::bigint,
  'an open enquiry owned by someone else than the card PIC is listed');
select ok((select lead_owner_ids = array['aaaaaaaa-0000-0000-0000-000000000004'::uuid] from api.customer_card_pic_exceptions where id = 'cccccccc-2910-0024-0000-000000000001'),
  'the exception names the enquiry owner');
select is((select count(*) from api.customer_card_pic_exceptions where id = 'cccccccc-2910-0024-0000-000000000099'), 0::bigint,
  'another workspace''s cards are not in the exception list');

------------------------------------------------------------------------------
-- 2. Creation is under the caller only; a forged PIC fails atomically
------------------------------------------------------------------------------
select is(pg_temp.outcome($$select api.create_contact('Synthetic forged contact', '0129100242', 'forged@example.test', p_owner_id => 'aaaaaaaa-0000-0000-0000-000000000004')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'create_contact refuses another PIC with the user-facing message');
select is((select count(*) from api.contacts where display_name = 'Synthetic forged contact'), 0::bigint, 'forged create leaves no contact');
select is((select count(*) from api.contact_points where normalized_value = '+60129100242'), 0::bigint, 'forged create leaves no contact points');
select is(pg_temp.outcome($$insert into api.contacts(workspace_id, display_name, owner_id) values ('11111111-1111-1111-1111-111111111111', 'Synthetic forged direct', 'aaaaaaaa-0000-0000-0000-000000000004')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'a direct contact insert naming another PIC is refused');
select is(pg_temp.outcome($$insert into api.accounts(workspace_id, name, owner_id) values ('11111111-1111-1111-1111-111111111111', 'Synthetic forged company', 'aaaaaaaa-0000-0000-0000-000000000004')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'a direct account insert naming another PIC is refused');
select is((select count(*) from api.accounts where name = 'Synthetic forged company'), 0::bigint, 'forged account create leaves no account');

create temp table made(card text, id uuid);
grant all on made to authenticated;
insert into made select 'contact', api.create_contact('Synthetic created contact', '0129100243', p_owner_id => 'aaaaaaaa-0000-0000-0000-000000000003');
select ok((select owner_id = 'aaaaaaaa-0000-0000-0000-000000000003' and created_by = 'aaaaaaaa-0000-0000-0000-000000000003' and owner_assigned_by = 'aaaaaaaa-0000-0000-0000-000000000003' and owner_assigned_at is not null
  from api.contacts c join made m on m.id = c.id and m.card = 'contact'), 'naming yourself creates the contact with you as PIC, creator and assigner');
insert into made select 'contact2', api.create_contact('Synthetic default contact');
select is((select owner_id from api.contacts c join made m on m.id = c.id and m.card = 'contact2'), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'omitting the PIC makes the caller the PIC');
with x as (
  insert into api.accounts(workspace_id, name, created_by) values ('11111111-1111-1111-1111-111111111111', 'Synthetic created company', 'aaaaaaaa-0000-0000-0000-000000000004') returning id)
insert into made select 'account', id from x;
select ok((select owner_id = 'aaaaaaaa-0000-0000-0000-000000000003' and created_by = 'aaaaaaaa-0000-0000-0000-000000000003'
  from api.accounts a join made m on m.id = a.id and m.card = 'account'), 'a direct account insert takes the caller as PIC and as creator, not a forged creator');

------------------------------------------------------------------------------
-- 3. Same-workspace sharing is read-only for anyone but the PIC
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000004');  -- non-PIC rep
select is((select count(*) from api.contacts where id = 'cccccccc-2910-0024-0000-000000000001'), 1::bigint, 'non-PIC rep sees the contact');
select is((select count(*) from api.accounts where id = 'cccccccc-2910-0024-0001-000000000001'), 1::bigint, 'non-PIC rep sees the account');
select is((select count(*) from api.contact_points where contact_id = 'cccccccc-2910-0024-0000-000000000001'), 1::bigint, 'non-PIC rep sees the contact points (masked in the UI)');

select is(pg_temp.outcome($$update api.contacts set display_name = 'Hijacked' where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot edit contact fields');
select is(pg_temp.outcome($$update api.contacts set owner_id = 'aaaaaaaa-0000-0000-0000-000000000004' where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot take the PIC by direct update');
select is(pg_temp.outcome($$update api.contacts set archived_at = now() where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot archive the contact');
select is_empty($$delete from api.contacts where id = 'cccccccc-2910-0024-0000-000000000001' returning id$$, 'non-PIC rep cannot delete the contact');
select is(pg_temp.outcome($$update api.accounts set name = 'Hijacked company' where id = 'cccccccc-2910-0024-0001-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot edit account fields');
select is(pg_temp.outcome($$update api.accounts set owner_id = 'aaaaaaaa-0000-0000-0000-000000000004' where id = 'cccccccc-2910-0024-0001-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot take the account PIC');
select is(pg_temp.outcome($$insert into api.contact_points(workspace_id, contact_id, kind, raw_value, normalized_value) values ('11111111-1111-1111-1111-111111111111', 'cccccccc-2910-0024-0000-000000000001', 'phone', '0129100244', '+60129100244')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot add a phone to the contact');
select is(pg_temp.outcome($$update api.contact_points set is_primary = false where id = 'cccccccc-2910-0024-0002-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot change a contact point');
select is(pg_temp.outcome($$update api.contact_points set contact_id = 'cccccccc-2910-0024-0000-000000000003' where id = 'cccccccc-2910-0024-0002-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot move a point onto their own card');
select is(pg_temp.outcome($$insert into api.account_aliases(workspace_id, account_id, alias) values ('11111111-1111-1111-1111-111111111111', 'cccccccc-2910-0024-0001-000000000001', 'Hijack alias')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot add an account alias');
select is(pg_temp.outcome($$update api.account_contact_relationships set ended_at = current_date where id = 'cccccccc-2910-0024-0003-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot end the contact''s company relationship');
select is(pg_temp.outcome($$insert into api.account_contact_relationships(workspace_id, account_id, contact_id) values ('11111111-1111-1111-1111-111111111111', (select id from made where card = 'account'), 'cccccccc-2910-0024-0000-000000000001')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'non-PIC cannot link the contact to a company');

-- Alternate RPC paths acting as sales.
select is(pg_temp.outcome($$select api.link_lead_contact('cccccccc-2910-0024-0004-000000000001', 'cccccccc-2910-0024-0000-000000000001')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'linking an enquiry cannot write its phone onto another PIC''s contact');
select is((select contact_id from api.leads where id = 'cccccccc-2910-0024-0004-000000000001'), null::uuid, 'the refused link leaves the enquiry unlinked');
select is(pg_temp.outcome($$select api.convert_lead('cccccccc-2910-0024-0004-000000000001', 'cccccccc-2910-0024-0000-000000000001')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'converting an enquiry cannot write onto another PIC''s contact');
select is((select count(*) from api.opportunities where lead_id = 'cccccccc-2910-0024-0004-000000000001'), 0::bigint, 'the refused conversion creates no opportunity');
select is((select status from api.leads where id = 'cccccccc-2910-0024-0004-000000000001'), 'new', 'the refused conversion leaves the enquiry open');
select alike(pg_temp.outcome($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', 'Taking it')$$),
  '42501: %sales.assign%', 'a sales rep cannot transfer a card');
-- A link that adds nothing to the card stays available to a shared editor.
select lives_ok($$select api.link_lead_contact('cccccccc-2910-0024-0004-000000000002', 'cccccccc-2910-0024-0000-000000000001')$$,
  'linking an enquiry that adds no identifiers to the card still works');

-- The non-PIC rep keeps full control of their own card.
select lives_ok($$update api.contacts set notes = 'Synthetic own note' where id = 'cccccccc-2910-0024-0000-000000000003'$$, 'a rep edits their own contact');

-- No role is exempt from the PIC rule on direct writes.
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');  -- sales_manager
select ok(core.has_permission('sales.read_all') and core.has_permission('sales.write'), 'the manager holds the old shared-edit combination');
select is(pg_temp.outcome($$update api.contacts set display_name = 'Manager edit' where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'sales.read_all does not override the PIC on edit');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');  -- admin
select is(pg_temp.outcome($$delete from api.contacts where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'admin delete of another PIC''s card is refused');
select is(pg_temp.outcome($$update api.contacts set display_name = 'Admin edit' where id = 'cccccccc-2910-0024-0000-000000000002'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'a legacy card without a PIC is read-only even for admin');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');  -- showroom
select is(pg_temp.outcome($$update api.contacts set display_name = 'Showroom edit' where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'showroom cannot edit another PIC''s card');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000007');  -- marketing coordinator
select is((select count(*) from api.contacts where id = 'cccccccc-2910-0024-0000-000000000001'), 1::bigint, 'marketing can read the card');
select is_empty($$update api.contacts set display_name = 'Marketing edit' where id = 'cccccccc-2910-0024-0000-000000000001' returning id$$, 'marketing cannot edit the card');
select alike(pg_temp.outcome($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', 'Marketing handoff')$$),
  '42501: %sales.assign%', 'marketing has no transfer authority today (unresolved policy, not granted)');

reset role;
select ok((select display_name = 'Synthetic owned contact' and owner_id = 'aaaaaaaa-0000-0000-0000-000000000003' and archived_at is null and updated_by is null
  from identity.contacts where id = 'cccccccc-2910-0024-0000-000000000001'), 'every refused write left the contact unchanged');
select is((select name from identity.accounts where id = 'cccccccc-2910-0024-0001-000000000001'), 'Synthetic owned company', 'the account is unchanged');
select is((select count(*) from identity.contact_points where contact_id = 'cccccccc-2910-0024-0000-000000000001'), 1::bigint, 'no contact point was added');
select is((select count(*) from identity.account_aliases where account_id = 'cccccccc-2910-0024-0001-000000000001'), 0::bigint, 'no alias was added');
select is((select ended_at from identity.account_contact_relationships where id = 'cccccccc-2910-0024-0003-000000000001'), null::date, 'the relationship is still active');
set local role authenticated;

-- The PIC edits their own card.
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select lives_ok($$update api.contacts set display_name = 'Synthetic owned contact edited' where id = 'cccccccc-2910-0024-0000-000000000001'$$, 'the PIC edits the contact');
select ok((select display_name = 'Synthetic owned contact edited' and updated_by = 'aaaaaaaa-0000-0000-0000-000000000003' from api.contacts where id = 'cccccccc-2910-0024-0000-000000000001'),
  'the PIC edit persists with the PIC as editor');
select lives_ok($$insert into api.contact_points(workspace_id, contact_id, kind, raw_value, normalized_value) values ('11111111-1111-1111-1111-111111111111', 'cccccccc-2910-0024-0000-000000000001', 'email', 'pic@example.test', 'pic@example.test')$$,
  'the PIC adds a contact point');
select lives_ok($$insert into api.account_aliases(workspace_id, account_id, alias) values ('11111111-1111-1111-1111-111111111111', 'cccccccc-2910-0024-0001-000000000001', 'Synthetic alias')$$,
  'the PIC adds an alias');
select lives_ok($$update api.accounts set notes = 'Synthetic PIC note' where id = 'cccccccc-2910-0024-0001-000000000001'$$, 'the PIC edits the account');
select is(pg_temp.outcome($$update api.contacts set owner_id = 'aaaaaaaa-0000-0000-0000-000000000004' where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'even the PIC cannot hand the card over by direct update');

------------------------------------------------------------------------------
-- 4. Explicit, audited transfer by a sales.assign holder
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');  -- sales_manager
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', '  ')$$,
  '23514', 'reason required: say why the PIC is changing', 'a transfer needs a reason');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000007', 'To marketing')$$,
  '23514', 'Choose an active salesperson in this workspace', 'the new PIC must hold sales.write');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000004', 'Foreign')$$,
  'P0002', 'Customer card not found', 'a foreign card cannot be transferred');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'Same')$$,
  '23514', 'This card is already assigned to that salesperson', 'a no-op transfer is refused');
select lives_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', 'Rep 1 handed over the territory')$$,
  'a sales manager transfers the contact');
select lives_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0024-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'Legacy card assigned at cutover')$$,
  'a sales manager assigns a legacy card');
select lives_ok($$select api.transfer_customer_card('account', 'cccccccc-2910-0024-0001-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', 'Company follows its director')$$,
  'a sales manager transfers the account');
select ok((select owner_id = 'aaaaaaaa-0000-0000-0000-000000000004' and owner_assigned_by = 'aaaaaaaa-0000-0000-0000-000000000002' and created_by = 'aaaaaaaa-0000-0000-0000-000000000003'
  from api.contacts where id = 'cccccccc-2910-0024-0000-000000000001'), 'PIC, assigner and creator stay three separate facts after transfer');
select is((select count(*) from api.customer_card_pic_exceptions where id = 'cccccccc-2910-0024-0000-000000000002'), 0::bigint, 'the assigned legacy card leaves the exception list');
select is((select count(*) from api.customer_card_pic_exceptions where id = 'cccccccc-2910-0024-0000-000000000001'), 0::bigint, 'the PIC now matches the enquiry owner');

reset role;
select ok((select actor_id = 'aaaaaaaa-0000-0000-0000-000000000002'
    and before_data->>'owner_id' = 'aaaaaaaa-0000-0000-0000-000000000003'
    and after_data->>'owner_id' = 'aaaaaaaa-0000-0000-0000-000000000004'
    and after_data->>'assigned_by' = 'aaaaaaaa-0000-0000-0000-000000000002'
    and reason = 'Rep 1 handed over the territory'
    and occurred_at is not null
  from audit.audit_events where action = 'customer_card.pic_transferred' and object_id = 'cccccccc-2910-0024-0000-000000000001'),
  'the transfer is audited with actor, old and new PIC, reason and time');
select is((select before_data->>'owner_id' from audit.audit_events where action = 'customer_card.pic_transferred' and object_id = 'cccccccc-2910-0024-0000-000000000002'), null::text,
  'the legacy assignment records that there was no previous PIC');
select is((select count(*) from audit.audit_events where action = 'customer_card.pic_transferred' and object_id in ('cccccccc-2910-0024-0000-000000000001', 'cccccccc-2910-0024-0000-000000000002', 'cccccccc-2910-0024-0001-000000000001')),
  3::bigint, 'one audit event per transfer, none for the refused ones');
set local role authenticated;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');  -- former PIC
select is(pg_temp.outcome($$update api.contacts set notes = 'Too late' where id = 'cccccccc-2910-0024-0000-000000000001'$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'the former PIC is now read-only');
select lives_ok($$update api.contacts set notes = 'Now mine' where id = 'cccccccc-2910-0024-0000-000000000002'$$, 'the newly assigned PIC edits the legacy card');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000004');  -- new PIC
select lives_ok($$update api.contacts set notes = 'Taken over' where id = 'cccccccc-2910-0024-0000-000000000001'$$, 'the new PIC edits the contact');
select lives_ok($$select api.link_lead_contact('cccccccc-2910-0024-0004-000000000001', 'cccccccc-2910-0024-0000-000000000001')$$,
  'the new PIC links their enquiry and its phone onto their card');
select is((select count(*) from api.contact_points where contact_id = 'cccccccc-2910-0024-0000-000000000001' and normalized_value = '+60129100249'), 1::bigint,
  'the enquiry phone is now on the card');

------------------------------------------------------------------------------
-- 5. Other workspaces stay invisible and untouchable
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select is((select count(*) from api.contacts where id = 'cccccccc-2910-0024-0000-000000000099'), 0::bigint, 'a foreign contact is hidden, even with a matching PIC id');
select is((select count(*) from api.accounts where id = 'cccccccc-2910-0024-0001-000000000099'), 0::bigint, 'a foreign account is hidden');
select is_empty($$update api.contacts set display_name = 'Foreign edit' where id = 'cccccccc-2910-0024-0000-000000000099' returning id$$, 'a foreign contact cannot be updated');
select is(pg_temp.outcome($$insert into api.contact_points(workspace_id, contact_id, kind, raw_value, normalized_value) values ('11111111-1111-1111-1111-111111111111', 'cccccccc-2910-0024-0000-000000000099', 'phone', '0129100245', '+60129100245')$$),
  '42501: You can only create or edit customer cards assigned to your own account.', 'a point cannot be attached to a foreign contact');
reset role;
select is((select display_name from identity.contacts where id = 'cccccccc-2910-0024-0000-000000000099'), 'Synthetic foreign contact', 'the foreign contact is unchanged');

select * from finish();
rollback;
