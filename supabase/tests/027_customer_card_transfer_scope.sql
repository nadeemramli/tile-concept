-- TILE-84: api.transfer_customer_card is authorized by the ACTING membership
-- (core.current_workspace_id) and only touches cards in that workspace. A role
-- held in another workspace is never borrowed, in either direction.
-- Seeded users from supabase/seeds/local-users.sql; their seeded membership in
-- 1111... stays the acting one because every membership added here is newer.
-- Synthetic fixtures; everything is rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
-- PIC, assignment and the number of audit and outbox rows: everything a transfer changes.
create function pg_temp.card_state(p_id uuid) returns text language sql security definer as $$
  select coalesce(owner_id::text, '-') || '|' || coalesce(owner_assigned_by::text, '-') || '|' || coalesce(owner_assigned_at::text, '-')
    || '|' || (select count(*) from audit.audit_events where object_id = p_id)
    || '|' || (select count(*) from audit.outbox_events where object_id = p_id)
  from (select owner_id, owner_assigned_by, owner_assigned_at from identity.contacts where id = p_id
        union all select owner_id, owner_assigned_by, owner_assigned_at from identity.accounts where id = p_id) c
$$;
grant execute on function pg_temp.card_state(uuid) to authenticated;

-- A = the seeded workspace 1111..., B = a second synthetic workspace.
insert into core.workspaces(id, slug, name) values
  ('99999999-2910-0027-0000-00000000000b', 'transfer-scope-b', 'Synthetic workspace B');
insert into core.memberships(workspace_id, user_id, role_key, created_at) values
  -- admin acting in A, sales_rep without sales.assign in B
  ('99999999-2910-0027-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001', 'sales_rep', now() + interval '1 day'),
  -- catalog_pricing (no sales.assign) acting in A, admin in B
  ('99999999-2910-0027-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000006', 'admin', now() + interval '1 day'),
  -- the two B salespeople
  ('99999999-2910-0027-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000003', 'sales_rep', now() + interval '1 day'),
  ('99999999-2910-0027-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000004', 'sales_rep', now() + interval '1 day');
insert into identity.contacts(id, workspace_id, display_name, owner_id) values
  ('cccccccc-2910-0027-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Synthetic A contact', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('cccccccc-2910-0027-0000-00000000000b', '99999999-2910-0027-0000-00000000000b', 'Synthetic B contact', 'aaaaaaaa-0000-0000-0000-000000000003');
insert into identity.accounts(id, workspace_id, name, owner_id) values
  ('cccccccc-2910-0027-0001-00000000000a', '11111111-1111-1111-1111-111111111111', 'Synthetic A company', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('cccccccc-2910-0027-0001-00000000000b', '99999999-2910-0027-0000-00000000000b', 'Synthetic B company', 'aaaaaaaa-0000-0000-0000-000000000003');

create temp table before_state as
  select id, pg_temp.card_state(id) as state from (values
    ('cccccccc-2910-0027-0000-00000000000a'::uuid), ('cccccccc-2910-0027-0000-00000000000b'::uuid),
    ('cccccccc-2910-0027-0001-00000000000a'::uuid), ('cccccccc-2910-0027-0001-00000000000b'::uuid)) v(id);
grant select on before_state to authenticated;

set local role authenticated;

------------------------------------------------------------------------------
-- 1. Admin acting in A, sales_rep (no sales.assign) in B
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is(core.current_workspace_id(), '11111111-1111-1111-1111-111111111111'::uuid, 'the admin acts in A, its oldest membership');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0027-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000004', 'Borrowed admin')$$,
  'P0002', 'Customer card not found', 'an admin acting in A cannot transfer a B contact');
select throws_ok($$select api.transfer_customer_card('account', 'cccccccc-2910-0027-0001-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000004', 'Borrowed admin')$$,
  'P0002', 'Customer card not found', 'an admin acting in A cannot transfer a B account');

------------------------------------------------------------------------------
-- 2. No sales.assign acting in A, admin in B
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select is(core.current_workspace_id(), '11111111-1111-1111-1111-111111111111'::uuid, 'the catalogue user acts in A, its oldest membership');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0027-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'Borrowed from B')$$,
  '42501', 'permission denied: sales.assign', 'B''s admin role does not authorize transferring an A contact');
select throws_ok($$select api.transfer_customer_card('account', 'cccccccc-2910-0027-0001-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'Borrowed from B')$$,
  '42501', 'permission denied: sales.assign', 'B''s admin role does not authorize transferring an A account');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0027-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000004', 'Not the acting workspace')$$,
  '42501', 'permission denied: sales.assign', 'an admin of B acting in A cannot transfer a B card either');

------------------------------------------------------------------------------
-- 3. Suspended and outside callers
------------------------------------------------------------------------------
reset role;
update core.memberships set status = 'suspended' where user_id = 'aaaaaaaa-0000-0000-0000-000000000002';  -- the seeded sales_manager
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0027-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'Suspended')$$,
  '42501', null, 'a suspended manager cannot transfer');
select pg_temp.act_as('dddddddd-2910-0027-0000-000000000000');
select throws_ok($$select api.transfer_customer_card('account', 'cccccccc-2910-0027-0001-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'Outsider')$$,
  '42501', null, 'a caller with no membership cannot transfer');

select is((select count(*) from before_state b where pg_temp.card_state(b.id) is distinct from b.state), 0::bigint,
  'every refused transfer left PIC, assignment, audit and outbox unchanged');

------------------------------------------------------------------------------
-- 4. The acting workspace's own authority still works
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0027-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000099', 'Unknown PIC')$$,
  '23514', 'Choose an active salesperson in this workspace', 'the new PIC must be an active salesperson of the acting workspace');
select lives_ok($$select api.transfer_customer_card('contact', 'cccccccc-2910-0027-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'Local handover')$$,
  'the admin transfers an A contact in its acting workspace');
select lives_ok($$select api.transfer_customer_card('account', 'cccccccc-2910-0027-0001-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000004', 'Local handover')$$,
  'the admin transfers an A account in its acting workspace');
reset role;
select is((select count(*) from audit.audit_events where action = 'customer_card.pic_transferred'
            and object_id in ('cccccccc-2910-0027-0000-00000000000a', 'cccccccc-2910-0027-0001-00000000000a')
            and actor_id = 'aaaaaaaa-0000-0000-0000-000000000001' and workspace_id = '11111111-1111-1111-1111-111111111111'
            and before_data->>'owner_id' = 'aaaaaaaa-0000-0000-0000-000000000003' and after_data->>'owner_id' = 'aaaaaaaa-0000-0000-0000-000000000004'),
  2::bigint, 'each allowed transfer writes exactly one attributable audit event in A');
select is((select string_agg(owner_id::text, ',' order by id) from (
            select id, owner_id from identity.contacts where id = 'cccccccc-2910-0027-0000-00000000000b'
            union all select id, owner_id from identity.accounts where id = 'cccccccc-2910-0027-0001-00000000000b') x),
  'aaaaaaaa-0000-0000-0000-000000000003,aaaaaaaa-0000-0000-0000-000000000003', 'B''s cards still have their B PIC');

select * from finish();
rollback;
