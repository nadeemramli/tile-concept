-- TILE-84: bind customer-card PIC transfers to the acting workspace.
--
-- api.transfer_customer_card (20261029164000) checked sales.assign with
-- core.require_permission, then looked the card up anywhere and only required
-- the caller to be SOME member of the card's workspace. Wherever
-- core.has_permission ORs every membership, that let a role held in one
-- workspace authorize a transfer in another, in both directions:
--   - admin acting in A, sales_rep (no sales.assign) in B: B cards moved;
--   - read-only acting in A, admin in B: A cards moved.
-- Even with the TILE-62 helpers (acting-only has_permission and
-- require_workspace) the command never called the workspace guard, so the
-- first case still went through.
--
-- The command now resolves the acting workspace first (core.current_workspace_id:
-- the caller's oldest active membership), requires sales.assign from THAT
-- membership (core.has_permission_in, which never ORs memberships), and only
-- finds and locks cards that belong to it. A card anywhere else reads as not
-- found, so nothing is locked, changed or audited. The same body behaves the
-- same whether or not the TILE-62 helpers are installed, because it relies on
-- neither core.has_permission nor core.require_workspace.
--
-- Everything else is unchanged: reason required, the new PIC must be an active
-- salesperson of the workspace, one audit event per transfer.

create or replace function api.transfer_customer_card(p_card text, p_id uuid, p_owner_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_old uuid;
  v_found boolean;
  v_at timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_ws is null or not core.has_permission_in(v_ws, 'sales.assign') then
    raise exception 'permission denied: sales.assign' using errcode = '42501';
  end if;
  if p_card not in ('contact', 'account') then
    raise exception 'Choose a contact or an account card' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'reason required: say why the PIC is changing' using errcode = '23514';
  end if;

  if p_card = 'contact' then
    select true, c.owner_id into v_found, v_old from identity.contacts c
    where c.id = p_id and c.workspace_id = v_ws and c.merged_into_contact_id is null and c.archived_at is null for update;
  else
    select true, a.owner_id into v_found, v_old from identity.accounts a
    where a.id = p_id and a.workspace_id = v_ws and a.merged_into_account_id is null and a.archived_at is null for update;
  end if;
  if v_found is null then
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
    update identity.contacts set owner_id = p_owner_id, owner_assigned_by = auth.uid(), owner_assigned_at = v_at, updated_by = auth.uid()
    where id = p_id and workspace_id = v_ws;
  else
    update identity.accounts set owner_id = p_owner_id, owner_assigned_by = auth.uid(), owner_assigned_at = v_at, updated_by = auth.uid()
    where id = p_id and workspace_id = v_ws;
  end if;

  perform audit.emit(v_ws, 'customer_card.pic_transferred', 'identity', p_card || 's', p_id,
    jsonb_build_object('owner_id', v_old),
    jsonb_build_object('owner_id', p_owner_id, 'assigned_by', auth.uid(), 'assigned_at', v_at),
    v_reason, jsonb_build_object('card', p_card));
  return jsonb_build_object('card', p_card, 'id', p_id, 'old_owner_id', v_old, 'owner_id', p_owner_id, 'assigned_by', auth.uid(), 'assigned_at', v_at);
end $$;
revoke all on function api.transfer_customer_card(text, uuid, uuid, text) from public, anon;
grant execute on function api.transfer_customer_card(text, uuid, uuid, text) to authenticated;
comment on function api.transfer_customer_card(text, uuid, uuid, text) is
  'Hand a contact or account card to another salesperson. Authorized by sales.assign in the caller''s acting workspace only; cards in any other workspace are not found. Reason required; audited.';
