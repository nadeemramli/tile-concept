-- pgTAP: guest mode gives a visitor a real session in a workspace that contains
-- nothing real, and cannot become anything more than that.
--
-- The interesting assertions are the refusals. Guest mode is only safe because
-- the database will not let a guest membership name a real workspace, and will
-- not let the shared guest account also be staff — so those are tested against
-- the highest privilege available, a direct statement as the migration owner,
-- rather than through the application.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create or replace function pg_temp.real_ws() returns uuid language sql as $$
  select '11111111-1111-1111-1111-111111111111'::uuid
$$;
create or replace function pg_temp.seeded_guest() returns uuid language sql as $$
  select '00000000-9999-4000-8000-000000000001'::uuid
$$;
create or replace function pg_temp.staff_user() returns uuid language sql as $$
  select 'aaaaaaaa-0000-0000-0000-000000000006'::uuid  -- catalog operator
$$;

-- Two candidate accounts of our own, so the assertions do not depend on which
-- memberships the seed happens to have handed out.
create or replace function pg_temp.make_user(uid uuid, addr text) returns void language sql as $$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user)
  values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', addr,
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', '', '', '', '', false)
  on conflict (id) do nothing;
$$;

select pg_temp.make_user('dddddddd-0000-0000-0000-000000000001', 'guest.candidate.1@tileconcept.test');
select pg_temp.make_user('dddddddd-0000-0000-0000-000000000002', 'guest.candidate.2@tileconcept.test');

------------------------------------------------------------------------------
-- 1-3. The workspace, the role, and what the role may do.
------------------------------------------------------------------------------
select isnt(core.demo_workspace_id(), null,
  'a demo workspace exists and demo_workspace_id() names it');

select isnt(core.demo_workspace_id(), pg_temp.real_ws(),
  'the demo workspace is not the workspace real data lives in');

-- Every permission the product has except settings.manage, which carries user
-- invitations and would let a visitor send email from this project.
select is(
  (select count(*)::int from core.role_permissions where role_key = 'guest' and permission = 'settings.manage'),
  0, 'a guest cannot manage settings, so cannot invite anyone');

------------------------------------------------------------------------------
-- 4-6. A guest membership belongs to the demo workspace and nowhere else.
------------------------------------------------------------------------------
select lives_ok(
  $$insert into core.memberships (workspace_id, user_id, role_key)
    values (core.demo_workspace_id(), 'dddddddd-0000-0000-0000-000000000001', 'guest')$$,
  'a guest membership in the demo workspace is allowed');

select throws_like(
  $$insert into core.memberships (workspace_id, user_id, role_key)
    values ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000002', 'guest')$$,
  '%guest role exists only in the demo workspace%',
  'a guest membership cannot name the workspace real data lives in');

-- Moving an existing guest membership across is the same mistake by another
-- route, and is refused the same way.
select throws_like(
  $$update core.memberships set workspace_id = '11111111-1111-1111-1111-111111111111'
    where user_id = 'dddddddd-0000-0000-0000-000000000001' and role_key = 'guest'$$,
  '%guest role exists only in the demo workspace%',
  'an existing guest membership cannot be moved into a real workspace');

------------------------------------------------------------------------------
-- 7-9. The shared guest account is a guest and nothing else.
--
-- This is the mistake that would quietly hand every visitor a staff session:
-- one extra membership on the account the login page signs in as.
------------------------------------------------------------------------------
select throws_like(
  $$insert into core.memberships (workspace_id, user_id, role_key)
    values ('11111111-1111-1111-1111-111111111111', '00000000-9999-4000-8000-000000000001', 'admin')$$,
  '%cannot also hold a non-guest membership%',
  'the guest account cannot be given a staff membership');

select throws_like(
  $$insert into core.memberships (workspace_id, user_id, role_key)
    values (core.demo_workspace_id(), 'aaaaaaaa-0000-0000-0000-000000000006', 'guest')$$,
  '%cannot also hold a non-guest membership%',
  'a staff account cannot pick up a guest membership on the side');

select is(
  (select role_key from core.memberships
   where user_id = pg_temp.seeded_guest() and workspace_id = core.demo_workspace_id()),
  'guest', 'the seeded guest account holds exactly the guest role');

select * from finish();
rollback;
