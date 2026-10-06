-- pgTAP: a signed-in account with no membership can claim an invite recorded
-- after the account existed, and nothing else.
--
-- core.handle_new_auth_user() only accepts invites when auth.users gets its
-- insert. An account invited from the Supabase dashboard, then invited again
-- from Settings, used to stay without a membership forever (and the app looped
-- between / and /login). api.claim_my_invites() is the second chance.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.make_user(uid uuid, addr text, confirmed boolean) returns void language sql as $$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user)
  values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', addr,
    '', case when confirmed then now() end, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', '', '', '', '', false)
  on conflict (id) do nothing;
$$;

-- Accounts first, invites second: exactly the order the creation trigger misses.
select pg_temp.make_user('eeeeeeee-0000-4000-8000-000000000001', 'Late.Invite@tileconcept.test', true);
select pg_temp.make_user('eeeeeeee-0000-4000-8000-000000000002', 'suspended.claim@tileconcept.test', true);
select pg_temp.make_user('eeeeeeee-0000-4000-8000-000000000003', 'unconfirmed.claim@tileconcept.test', false);
select pg_temp.make_user('eeeeeeee-0000-4000-8000-000000000004', 'nobody.claim@tileconcept.test', true);

insert into core.memberships (workspace_id, user_id, role_key, status)
values ('11111111-1111-1111-1111-111111111111', 'eeeeeeee-0000-4000-8000-000000000002', 'sales_rep', 'suspended');

insert into core.membership_invites (workspace_id, email, role_key) values
  ('11111111-1111-1111-1111-111111111111', 'late.invite@tileconcept.test', 'admin'),
  ('11111111-1111-1111-1111-111111111111', 'suspended.claim@tileconcept.test', 'admin'),
  ('11111111-1111-1111-1111-111111111111', 'unconfirmed.claim@tileconcept.test', 'admin'),
  ('11111111-1111-1111-1111-111111111111',
   (select email from auth.users where id = '00000000-9999-4000-8000-000000000001'), 'admin');

set local role authenticated;

-- 1-3. The late invite: claimed once, idempotent after, and the role is the invite's.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000001');
select is((select row(access, claimed)::text from api.claim_my_invites()), '(active,1)',
  'an existing account claims the invite recorded after it was created (email matched case-insensitively)');
select is((select row(access, claimed)::text from api.claim_my_invites()), '(active,0)',
  'claiming again is a no-op');
select is((select role_key from api.my_membership()), 'admin', 'the membership carries the invited role');

-- 4. Suspended stays suspended.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000002');
select is((select row(access, claimed)::text from api.claim_my_invites()), '(suspended,0)',
  'a fresh invite does not reactivate a suspended membership');

-- 5. Unconfirmed email proves nothing.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000003');
select is((select row(access, claimed)::text from api.claim_my_invites()), '(unconfirmed,0)',
  'an unconfirmed address cannot claim an invite');

-- 6. No invite, no access.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-000000000004');
select is((select row(access, claimed)::text from api.claim_my_invites()), '(none,0)',
  'an account with no invite gets nothing');

-- 7. The shared guest account cannot be promoted by an invite.
select pg_temp.act_as('00000000-9999-4000-8000-000000000001');
select is((select claimed from api.claim_my_invites()), 0,
  'the guest rule refuses a staff invite for the guest account');

-- 8. Anonymous callers are refused.
reset role;
set local role anon;
select throws_like($$select * from api.claim_my_invites()$$, '%permission denied%', 'anon cannot call claim_my_invites');
reset role;

-- 9-12. What the database holds afterwards.
select is((select status from core.membership_invites where email = 'late.invite@tileconcept.test'), 'accepted',
  'the claimed invite is marked accepted');
select is((select status from core.membership_invites where email = 'suspended.claim@tileconcept.test'), 'pending',
  'the suspended member''s invite stays pending for an admin');
select is((select status from core.memberships where user_id = 'eeeeeeee-0000-4000-8000-000000000002'), 'suspended',
  'the suspended membership is untouched');
select is((select count(*)::int from audit.audit_events where action = 'invite_claimed'), 1,
  'the claim is audited');

select * from finish();
rollback;
