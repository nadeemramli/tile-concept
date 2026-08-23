-- LOCAL DEVELOPMENT ONLY. Creates the shared guest account so "Enter as guest"
-- works against the local stack.
--
-- On a hosted project this file is never applied; `scripts/provision-demo-guest.mts`
-- creates the same account with a generated password instead. The password here
-- is the same well-known local one the other demo staff use, and like them this
-- account only ever exists on a stack whose keys are published defaults.
--
-- The membership names core.demo_workspace_id() rather than a literal, and
-- core.enforce_guest_workspace() refuses it if that resolves to anything but the
-- demo workspace.
do $$
declare
  v_user  uuid := '00000000-9999-4000-8000-000000000001';
  v_email text := 'demo.guest@tileconcept.test';
  v_demo  uuid := core.demo_workspace_id();
begin
  if v_demo is null then
    raise notice 'no demo workspace; skipping guest account';
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user)
  values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
    extensions.crypt('TileDemo!2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Guest'),
    now(), now(), '', '', '', '', '', '', '', '', false)
  on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_user, v_email, 'email',
          jsonb_build_object('sub', v_user, 'email', v_email, 'email_verified', true),
          now(), now(), now())
  on conflict do nothing;

  insert into core.memberships (workspace_id, user_id, role_key)
  values (v_demo, v_user, 'guest')
  on conflict (workspace_id, user_id) do nothing;

  update core.profiles set full_name = 'Guest' where user_id = v_user;
end $$;
