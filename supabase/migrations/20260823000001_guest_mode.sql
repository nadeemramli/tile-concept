-- Guest mode: let someone try the app without an account of their own.
--
-- The way into this system is a membership, and that stays true here. Guest mode
-- is not a bypass — it is one ordinary account, in a workspace that contains
-- nothing real, that the sign-in page can enter on a visitor's behalf. Every RLS
-- policy, every `api.*` view and every SECURITY DEFINER function then behaves as
-- it does for staff, with no special case anywhere, and a guest's writes persist
-- because they are ordinary writes.
--
-- Why not anonymous sign-in, which would give each visitor a private sandbox:
-- GoTrue routes `signInAnonymously` through /signup, so it is refused outright
-- while `enable_signup = false` ("Signups not allowed for this instance").
-- Allowing it would mean re-opening self-signup, which was deliberately closed on
-- 2026-08-21. One shared demo account keeps invite-only literally true and needs
-- no auth configuration change on the hosted project at all. The cost is that
-- guests share a workspace and can see each other's edits, which is why the demo
-- data is reset on a schedule.
--
-- The account itself is not created here. It has a password, and passwords do not
-- belong in migrations: `scripts/provision-demo-guest.mts` creates it and prints
-- the credentials to put in the environment. This migration creates the
-- workspace, the role, and the rule that keeps a guest inside it.

------------------------------------------------------------------------------
-- 1. The demo workspace.
--
-- Identified by slug, so no environment carries a hard-coded uuid and each can
-- generate its own.
------------------------------------------------------------------------------
insert into core.workspaces (slug, name, timezone, default_currency, settings)
values ('demo', 'Tile Concept (demo)', 'Asia/Kuala_Lumpur', 'MYR',
        jsonb_build_object('is_demo', true))
on conflict (slug) do nothing;

create or replace function core.demo_workspace_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select w.id from core.workspaces w where w.slug = 'demo'
$$;
revoke all on function core.demo_workspace_id() from public;
grant execute on function core.demo_workspace_id() to authenticated, service_role;

comment on function core.demo_workspace_id() is
  'The workspace guests are placed in. The only workspace a guest membership may name.';

------------------------------------------------------------------------------
-- 2. The guest role.
--
-- A guest gets everything the product can do, because the point is to show the
-- product and everything they are shown is synthetic. The single exception is
-- settings.manage, which carries user invitations — that would let a visitor
-- send email from this project.
------------------------------------------------------------------------------
insert into core.roles (key, label, description, rank)
values ('guest', 'Guest (demo)',
        'A visitor exploring the demo workspace. Every permission except settings.manage, and confined to the demo workspace by core.enforce_guest_workspace().',
        900)
on conflict (key) do nothing;

insert into core.role_permissions (role_key, permission)
select 'guest', p from unnest(array[
  'sales.read', 'sales.read_all', 'sales.write', 'sales.assign',
  'contact.reveal', 'identity.merge',
  'purchase.write', 'purchase.correct',
  'catalog.read', 'catalog.write',
  'price.read', 'price.publish',
  'stock.read', 'stock.write',
  'marketing.read', 'marketing.write', 'marketing.confirm',
  'source.import', 'review.approve',
  'report.read', 'audit.read', 'audit.read_all',
  'export.customer'
]) as p
on conflict (role_key, permission) do nothing;

------------------------------------------------------------------------------
-- 3. The rule that makes the rest of it safe.
--
-- Two directions, and both matter:
--
--   a guest membership names the demo workspace and no other — so the guest
--   role can never be the way into real data; and
--
--   a user who is a guest is a guest and nothing else — so the shared demo
--   account cannot also be given a membership in the real workspace, which is
--   the mistake that would quietly hand every visitor a staff session.
--
-- This lives in the database because the application is not the authority. A
-- Server Action, a script holding the service key, and a hand-written SQL
-- statement all pass through this trigger, and all are refused.
------------------------------------------------------------------------------
create or replace function core.enforce_guest_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_other int;
begin
  if new.role_key = 'guest' and new.workspace_id is distinct from core.demo_workspace_id() then
    raise exception 'the guest role exists only in the demo workspace'
      using errcode = '42501';
  end if;

  select count(*) into v_other
  from core.memberships m
  where m.user_id = new.user_id
    and m.id is distinct from new.id
    and (m.role_key = 'guest') is distinct from (new.role_key = 'guest');

  if v_other > 0 then
    raise exception 'a guest account cannot also hold a non-guest membership'
      using errcode = '42501';
  end if;

  return new;
end $$;
revoke all on function core.enforce_guest_workspace() from public;

create trigger memberships_guest_workspace_only
  before insert or update of workspace_id, user_id, role_key on core.memberships
  for each row execute function core.enforce_guest_workspace();
