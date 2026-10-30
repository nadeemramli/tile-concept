-- Sales-owned customer cards (TILE-11).
--
-- A customer card is a contact (person) or an account (company). Each card has
-- one PIC: the salesperson who owns it, stored in owner_id. The PIC is a
-- different fact from the actors around it:
--
--   owner_id           the card's PIC (who the card belongs to)
--   created_by         who first saved the card
--   updated_by         who last changed it
--   owner_assigned_by  who made the current PIC assignment (creator, or the
--                      sales.assign holder who transferred it)
--   owner_assigned_at  when that assignment was made
--
-- "Customer/company PIC" elsewhere in the product (identity.projects
-- .follow_up_contact_id) is the customer's own contact person and is unrelated.
--
-- Rules enforced here:
--   1. Creating a card makes the caller its PIC. Naming anybody else fails the
--      whole request with: You can only create or edit customer cards assigned
--      to your own account.
--   2. Only the PIC may change a card's fields, archive it, delete it, or
--      change its phone/email points, aliases or company relationships. Every
--      signed-in role is held to this on direct writes; there is no
--      sales.read_all, manager or admin override.
--   3. A card's PIC changes only through api.transfer_customer_card, which
--      needs sales.assign, a reason, and an active salesperson as the new PIC,
--      and writes an audit event with actor, old and new PIC and time.
--   4. Reading is unchanged: everyone with sales.read in the workspace still
--      sees every card; other workspaces stay invisible.
--
-- Cards saved before this migration have no PIC (owner_id is null on every
-- contact, and on accounts nobody chose an owner for). They are legacy
-- exceptions: readable, but nobody can edit them until a sales.assign holder
-- transfers them to a salesperson. api.customer_card_pic_exceptions lists them,
-- with the lead owners and creator that may inform the assignment. No backfill
-- runs here, because choosing a PIC for an existing customer is a business
-- decision.
--
-- SECURITY DEFINER commands are not checked by the triggers below (they run as
-- the function owner); each one that writes a card states its own rule:
--   api.create_contact            caller becomes PIC, forged PIC refused
--   sales.attach_lead_identity    copying a lead's phone/email onto a contact
--                                 needs that contact's PIC (link + convert)
--   api.transfer_customer_card    rule 3
-- Merges (identity.merge) and lifecycle/acquisition facts derived from visits,
-- purchases and enquiries are unchanged; see docs/sales-owned-customer-cards.md.

------------------------------------------------------------------------------
-- 1. PIC columns
------------------------------------------------------------------------------
alter table identity.contacts
  add column owner_id uuid references auth.users(id),
  add column owner_assigned_by uuid references auth.users(id),
  add column owner_assigned_at timestamptz;
alter table identity.accounts
  add column owner_assigned_by uuid references auth.users(id),
  add column owner_assigned_at timestamptz;

create index contacts_owner_idx on identity.contacts (workspace_id, owner_id);
create index accounts_owner_idx on identity.accounts (workspace_id, owner_id);

comment on column identity.contacts.owner_id is 'Customer card PIC: the salesperson who owns this card. Null = legacy card awaiting assignment.';
comment on column identity.accounts.owner_id is 'Customer card PIC: the salesperson who owns this card. Null = legacy card awaiting assignment.';
comment on column identity.contacts.owner_assigned_by is 'Who made the current PIC assignment (the creator, or the sales.assign holder who transferred it).';
comment on column identity.accounts.owner_assigned_by is 'Who made the current PIC assignment (the creator, or the sales.assign holder who transferred it).';

-- The api views were created with select *; re-expand them to the new columns.
create or replace view api.contacts with (security_invoker = true) as select * from identity.contacts;
create or replace view api.accounts with (security_invoker = true) as select * from identity.accounts;

------------------------------------------------------------------------------
-- 2. Helpers
------------------------------------------------------------------------------
create function identity.deny_customer_card_edit()
returns void language plpgsql set search_path = '' as $$
begin
  raise exception 'You can only create or edit customer cards assigned to your own account.'
    using errcode = '42501',
          hint = 'A sales manager can transfer the card to you with Transfer PIC.';
end $$;
revoke all on function identity.deny_customer_card_edit() from public;
grant execute on function identity.deny_customer_card_edit() to authenticated, service_role;

-- PIC of a card in one of the caller's workspaces. Used by the invoker-rights
-- trigger below, which cannot assume the caller can see the parent row.
create function identity.customer_card_owner(p_card text, p_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case p_card
    when 'contacts' then (select c.owner_id from identity.contacts c
                          where c.id = p_id and c.workspace_id in (select core.member_workspace_ids()))
    when 'accounts' then (select a.owner_id from identity.accounts a
                          where a.id = p_id and a.workspace_id in (select core.member_workspace_ids()))
  end
$$;
revoke all on function identity.customer_card_owner(text, uuid) from public;
grant execute on function identity.customer_card_owner(text, uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. Direct writes: the card itself
------------------------------------------------------------------------------
-- Invoker rights on purpose: current_user is 'authenticated' only when the
-- signed-in user wrote the row through an api view (PostgREST or the app).
create function identity.enforce_customer_card_pic()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if v_uid is null then
    perform identity.deny_customer_card_edit();
  end if;

  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, v_uid);
    if new.owner_id <> v_uid then
      perform identity.deny_customer_card_edit();
    end if;
    new.created_by := v_uid;
    new.updated_by := v_uid;
    new.owner_assigned_by := v_uid;
    new.owner_assigned_at := now();
    return new;
  end if;

  if old.owner_id is distinct from v_uid then
    perform identity.deny_customer_card_edit();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.owner_assigned_by is distinct from old.owner_assigned_by
     or new.owner_assigned_at is distinct from old.owner_assigned_at
     or new.created_by is distinct from old.created_by then
    perform identity.deny_customer_card_edit();
  end if;
  new.updated_by := v_uid;
  return new;
end $$;

create trigger enforce_customer_card_pic before insert or update or delete on identity.contacts
  for each row execute function identity.enforce_customer_card_pic();
create trigger enforce_customer_card_pic before insert or update or delete on identity.accounts
  for each row execute function identity.enforce_customer_card_pic();

------------------------------------------------------------------------------
-- 4. Direct writes: rows that belong to a card
------------------------------------------------------------------------------
-- TG_ARGV: parent card table, parent id column. A company relationship belongs
-- to the person's card: the contact's PIC links or ends it.
create function identity.enforce_customer_card_child_pic()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_card text := tg_argv[0];
  v_col text := tg_argv[1];
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if v_uid is null then
    perform identity.deny_customer_card_edit();
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and identity.customer_card_owner(v_card, (to_jsonb(old) ->> v_col)::uuid) is distinct from v_uid then
    perform identity.deny_customer_card_edit();
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and identity.customer_card_owner(v_card, (to_jsonb(new) ->> v_col)::uuid) is distinct from v_uid then
    perform identity.deny_customer_card_edit();
  end if;
  return coalesce(new, old);
end $$;

create trigger enforce_customer_card_pic before insert or update or delete on identity.contact_points
  for each row execute function identity.enforce_customer_card_child_pic('contacts', 'contact_id');
create trigger enforce_customer_card_pic before insert or update or delete on identity.account_aliases
  for each row execute function identity.enforce_customer_card_child_pic('accounts', 'account_id');
create trigger enforce_customer_card_pic before insert or update or delete on identity.account_contact_relationships
  for each row execute function identity.enforce_customer_card_child_pic('contacts', 'contact_id');

------------------------------------------------------------------------------
-- 5. api.create_contact: the caller is the PIC
------------------------------------------------------------------------------
drop function api.create_contact(text, text, text, text, text, uuid, boolean, text);
create function api.create_contact(
  p_display_name text,
  p_phone text default null,
  p_email text default null,
  p_customer_type text default null,
  p_source text default null,
  p_account_id uuid default null,
  p_is_provisional boolean default false,
  p_notes text default null,
  p_owner_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_id uuid;
  v_phone text := core.normalize_phone(p_phone);
  v_email text := core.normalize_text(p_email);
begin
  perform core.require_permission('sales.write');
  if p_owner_id is not null and p_owner_id is distinct from auth.uid() then
    perform identity.deny_customer_card_edit();
  end if;
  insert into identity.contacts (workspace_id, display_name, customer_type, original_acquisition_source, original_acquisition_at, is_provisional, notes,
                                 owner_id, owner_assigned_by, owner_assigned_at, created_by, updated_by)
  values (v_ws, p_display_name, p_customer_type, p_source, case when p_source is null then null else now() end, coalesce(p_is_provisional, false), p_notes,
          auth.uid(), auth.uid(), now(), auth.uid(), auth.uid())
  returning id into v_id;
  if v_phone is not null then
    insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
    values (v_ws, v_id, 'phone', p_phone, v_phone, true, p_source);
  end if;
  if v_email is not null then
    insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
    values (v_ws, v_id, 'email', p_email, v_email, v_phone is null, p_source);
  end if;
  if p_account_id is not null then
    insert into identity.account_contact_relationships (workspace_id, account_id, contact_id, is_primary)
    values (v_ws, p_account_id, v_id, true) on conflict do nothing;
  end if;
  perform audit.emit(v_ws, 'contact.created', 'identity', 'contacts', v_id, null,
    jsonb_build_object('display_name', p_display_name, 'owner_id', auth.uid()), null, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function api.create_contact(text, text, text, text, text, uuid, boolean, text, uuid) from public, anon;
grant execute on function api.create_contact(text, text, text, text, text, uuid, boolean, text, uuid) to authenticated;

------------------------------------------------------------------------------
-- 6. Lead linking may not write onto somebody else's card
------------------------------------------------------------------------------
-- Unchanged from 20260910000001 except for the PIC check: link_lead_contact and
-- convert_lead keep their lead-owner rules; carrying the enquiry's phone or
-- email onto the contact is a card edit and needs the contact's PIC. A link
-- that adds nothing to the card still goes through.
create or replace function sales.attach_lead_identity(p_lead_id uuid, p_contact_id uuid, p_account_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  l sales.leads%rowtype;
  v_has_points boolean;
  v_new_phone boolean;
  v_new_email boolean;
begin
  select * into l from sales.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found'; end if;

  if p_contact_id is not null then
    v_new_phone := l.raw_phone_normalized is not null and not exists (
      select 1 from identity.contact_points cp
      where cp.contact_id = p_contact_id and cp.kind in ('phone','whatsapp') and cp.normalized_value = l.raw_phone_normalized);
    v_new_email := l.raw_email_normalized is not null and not exists (
      select 1 from identity.contact_points cp
      where cp.contact_id = p_contact_id and cp.kind = 'email' and cp.normalized_value = l.raw_email_normalized);
    if (v_new_phone or v_new_email)
       and (select c.owner_id from identity.contacts c where c.id = p_contact_id) is distinct from auth.uid() then
      perform identity.deny_customer_card_edit();
    end if;
  end if;

  update sales.leads
    set contact_id = coalesce(p_contact_id, contact_id),
        account_id = coalesce(p_account_id, account_id)
  where id = l.id;

  if p_contact_id is not null then
    -- The enquiry's identifiers become contact points, so the next lookup by
    -- this number or email finds the customer directly.
    select exists (select 1 from identity.contact_points cp where cp.contact_id = p_contact_id) into v_has_points;
    if v_new_phone then
      insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
      values (l.workspace_id, p_contact_id, 'phone', coalesce(l.raw_phone, l.raw_phone_normalized), l.raw_phone_normalized, not v_has_points, l.source_channel);
      v_has_points := true;
    end if;
    if v_new_email then
      insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
      values (l.workspace_id, p_contact_id, 'email', coalesce(l.raw_email, l.raw_email_normalized), l.raw_email_normalized, not v_has_points, l.source_channel);
    end if;

    -- History logged before the link had no contact to land on.
    update sales.activities set contact_id = p_contact_id where lead_id = l.id and contact_id is null;
    update sales.tasks set contact_id = p_contact_id where lead_id = l.id and contact_id is null;

    update identity.contacts
      set original_acquisition_source = coalesce(original_acquisition_source, l.source_channel),
          original_acquisition_at = coalesce(original_acquisition_at, l.created_at)
    where id = p_contact_id;
  end if;

  if p_account_id is not null then
    update sales.activities set account_id = p_account_id where lead_id = l.id and account_id is null;
  end if;
end $$;

------------------------------------------------------------------------------
-- 7. Explicit, audited PIC transfer
------------------------------------------------------------------------------
create function api.transfer_customer_card(p_card text, p_id uuid, p_owner_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_old uuid;
  v_at timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform core.require_permission('sales.assign');
  if p_card not in ('contact', 'account') then
    raise exception 'Choose a contact or an account card' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'reason required: say why the PIC is changing' using errcode = '23514';
  end if;

  if p_card = 'contact' then
    select c.workspace_id, c.owner_id into v_ws, v_old from identity.contacts c
    where c.id = p_id and c.merged_into_contact_id is null and c.archived_at is null for update;
  else
    select a.workspace_id, a.owner_id into v_ws, v_old from identity.accounts a
    where a.id = p_id and a.merged_into_account_id is null and a.archived_at is null for update;
  end if;
  if v_ws is null or not exists (select 1 from core.member_workspace_ids() w where w = v_ws) then
    raise exception 'Customer card not found' using errcode = 'P0002';
  end if;
  if p_owner_id is null or not exists (
    select 1 from core.memberships m join core.role_permissions rp on rp.role_key = m.role_key
    where m.workspace_id = v_ws and m.user_id = p_owner_id and m.status = 'active' and rp.permission = 'sales.write') then
    raise exception 'Choose an active salesperson in this workspace' using errcode = '23514';
  end if;
  if v_old is not distinct from p_owner_id then
    raise exception 'This card is already assigned to that salesperson' using errcode = '23514';
  end if;

  if p_card = 'contact' then
    update identity.contacts set owner_id = p_owner_id, owner_assigned_by = auth.uid(), owner_assigned_at = v_at, updated_by = auth.uid() where id = p_id;
  else
    update identity.accounts set owner_id = p_owner_id, owner_assigned_by = auth.uid(), owner_assigned_at = v_at, updated_by = auth.uid() where id = p_id;
  end if;

  perform audit.emit(v_ws, 'customer_card.pic_transferred', 'identity', p_card || 's', p_id,
    jsonb_build_object('owner_id', v_old),
    jsonb_build_object('owner_id', p_owner_id, 'assigned_by', auth.uid(), 'assigned_at', v_at),
    v_reason, jsonb_build_object('card', p_card));
  return jsonb_build_object('card', p_card, 'id', p_id, 'old_owner_id', v_old, 'owner_id', p_owner_id, 'assigned_by', auth.uid(), 'assigned_at', v_at);
end $$;
revoke all on function api.transfer_customer_card(text, uuid, uuid, text) from public, anon;
grant execute on function api.transfer_customer_card(text, uuid, uuid, text) to authenticated;

------------------------------------------------------------------------------
-- 8. Legacy exceptions to resolve before cutover
------------------------------------------------------------------------------
-- missing_pic: the card has no PIC, so nobody can edit it.
-- lead_owner_differs: an open enquiry linked to the card is owned by someone
--   other than the card's PIC. Lead ownership is assigned separately
--   (api.assign_lead); this only makes the mismatch visible.
create view api.customer_card_pic_exceptions with (security_invoker = true) as
with lead_owners as (
  select l.contact_id, l.account_id, l.owner_id,
         l.status not in ('converted', 'disqualified', 'duplicate') as is_open
  from sales.leads l
  where l.owner_id is not null and l.status <> 'duplicate'
), cards as (
  select 'contact'::text as card, c.id, c.workspace_id, c.display_name as name, c.owner_id, c.created_by, c.created_at,
         array(select distinct lo.owner_id from lead_owners lo where lo.contact_id = c.id) as lead_owner_ids,
         exists (select 1 from lead_owners lo where lo.contact_id = c.id and lo.is_open and lo.owner_id is distinct from c.owner_id) as open_lead_mismatch
  from identity.contacts c
  where c.merged_into_contact_id is null and c.archived_at is null
  union all
  select 'account', a.id, a.workspace_id, a.name, a.owner_id, a.created_by, a.created_at,
         array(select distinct lo.owner_id from lead_owners lo where lo.account_id = a.id),
         exists (select 1 from lead_owners lo where lo.account_id = a.id and lo.is_open and lo.owner_id is distinct from a.owner_id)
  from identity.accounts a
  where a.merged_into_account_id is null and a.archived_at is null
)
select card, id, workspace_id, name,
       case when owner_id is null then 'missing_pic' else 'lead_owner_differs' end as exception,
       owner_id, created_by, created_at, lead_owner_ids
from cards
where owner_id is null or open_lead_mismatch;
grant select on api.customer_card_pic_exceptions to authenticated;
grant all on api.customer_card_pic_exceptions to service_role;
comment on view api.customer_card_pic_exceptions is
  'Customer cards to resolve before cutover: no PIC yet, or an open linked enquiry owned by someone else. Read-only; assign with api.transfer_customer_card.';
