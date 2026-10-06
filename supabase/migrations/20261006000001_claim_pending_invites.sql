-- Signed in, but no workspace: claim a waiting invite, or say why not.
--
-- core.handle_new_auth_user() turns a pending core.membership_invites row into
-- a membership, but only when the auth user is *created*. Two real paths miss
-- that moment and leave a signed-in account with no membership:
--
--   * the account was invited from the Supabase dashboard, so no invite row
--     existed when auth.users got its insert; and
--   * an admin then invites that existing account from Platform → Settings —
--     the invite row is written, but auth.users never sees another insert, so
--     it stays pending forever.
--
-- Before this, the app answered "no membership" by sending the user to /login,
-- and /login sends any signed-in user back to /, which looped without end.
--
-- api.claim_my_invites() is the second chance. It runs as the signed-in user,
-- accepts every pending invite addressed to their own *confirmed* email (the
-- same match the creation trigger makes), and reports what access they now
-- hold. It cannot grant anything an admin did not already record as an invite,
-- and it never reactivates a suspended membership: a fresh invite for a
-- suspended member stays pending for an admin to resolve.

create or replace function api.claim_my_invites()
returns table (access text, claimed int)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_claimed int := 0;
  v_status text;
  inv record;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  -- An unconfirmed address proves nothing about who holds the mailbox.
  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;

  -- lower() on both sides rather than citext: under search_path = '' the
  -- citext operators are out of scope and = silently becomes a text compare.
  if v_email is not null then
    for inv in
      select i.* from core.membership_invites i
      where lower(i.email::text) = v_email and i.status = 'pending'
      order by i.created_at
      for update
    loop
      begin
        insert into core.memberships (workspace_id, user_id, role_key, default_location_id)
        values (inv.workspace_id, v_uid, inv.role_key, inv.default_location_id)
        on conflict (workspace_id, user_id) do nothing;
      exception when insufficient_privilege then
        -- core.enforce_guest_workspace() refused it (a guest account cannot be
        -- staff, and the reverse). Leave the invite pending for an admin.
        continue;
      end;

      select m.status into v_status
      from core.memberships m
      where m.workspace_id = inv.workspace_id and m.user_id = v_uid;

      if v_status = 'active' then
        update core.membership_invites
        set status = 'accepted', accepted_at = now()
        where id = inv.id;
        perform audit.emit(inv.workspace_id, 'invite_claimed', 'core', 'membership_invites', inv.id,
          null, jsonb_build_object('role_key', inv.role_key),
          'Accepted at sign-in: the account already existed when the invite was recorded');
        v_claimed := v_claimed + 1;
      end if;
    end loop;
  end if;

  return query
  select case
           when exists (select 1 from core.memberships m where m.user_id = v_uid and m.status = 'active') then 'active'
           when exists (select 1 from core.memberships m where m.user_id = v_uid and m.status = 'suspended') then 'suspended'
           when v_email is null then 'unconfirmed'
           else 'none'
         end,
         v_claimed;
end $$;

revoke all on function api.claim_my_invites() from public;
grant execute on function api.claim_my_invites() to authenticated;

comment on function api.claim_my_invites() is
  'Accept pending invites addressed to the caller''s confirmed email, then report access: active | suspended | unconfirmed | none.';
