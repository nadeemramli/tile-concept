-- TILE-23 release review: close three ways around the imported-media review.
-- Found by execution against 20261009000001 on an isolated stack:
--   1. api.approve_media_link (corpus era) is still callable by any
--      review.approve holder, which includes sales_rep. It re-approved a link a
--      reviewer had rejected, and it can re-point a published link. It now goes
--      through api.confirm_media_association: catalog.write, the same state and
--      published checks, a review decision and an audit event.
--   2. Withdrawing rights archived only rows that referenced the asset by id. A
--      catalogue row pointing at the same object by path stayed published and
--      signable by sales. Withdrawal now also matches the object path.
--   3. The publication guard checked the asset, never the link, so a direct
--      insert could publish through a rejected, superseded or same-document
--      association. It now requires an approved, non-document link for the
--      same asset.
-- Also: the product-media storage read honoured catalog.write held in ANY
-- workspace (core.has_permission is not workspace-scoped). The policy now asks
-- for catalog.write in the workspace that owns the object.

------------------------------------------------------------------------------
-- Workspace-scoped permission check for storage policies.
------------------------------------------------------------------------------
create or replace function core.has_permission_in(p_workspace_id uuid, perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.memberships m
    join core.role_permissions rp on rp.role_key = m.role_key
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and m.workspace_id = p_workspace_id and rp.permission = perm)
$$;
revoke all on function core.has_permission_in(uuid, text) from public, anon;
grant execute on function core.has_permission_in(uuid, text) to authenticated, service_role;

drop policy if exists tc_read_product_media on storage.objects;
create policy tc_read_product_media on storage.objects for select to authenticated
using (bucket_id = 'product-media'
  and core.storage_workspace_of(name) in (select core.member_workspace_ids())
  and (core.has_permission_in(core.storage_workspace_of(name), 'catalog.write')
       or core.product_media_object_published(bucket_id, name)));

------------------------------------------------------------------------------
-- 1. Legacy link approval goes through the reviewed path.
------------------------------------------------------------------------------
create or replace function api.approve_media_link(p_link_id uuid, p_variant_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l ingest.media_asset_variant_links%rowtype;
begin
  perform core.require_permission('catalog.write');
  select * into l from ingest.media_asset_variant_links where id = p_link_id;
  if not found then raise exception 'media link not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(l.workspace_id);
  -- Kept from the corpus version: a same-document association is discovery
  -- context. Confirming one as a human match is done in the review screen.
  if l.link_basis = 'same_source_document' then
    raise exception 'a same-document link cannot be approved: re-link it to an exact page/region, supplier code, or manual match first'
      using errcode = '23514';
  end if;
  return api.confirm_media_association(p_link_id, p_variant_id, p_note);
end $$;
revoke all on function api.approve_media_link(uuid, uuid, text) from public, anon;
grant execute on function api.approve_media_link(uuid, uuid, text) to authenticated;

------------------------------------------------------------------------------
-- 2. Withdrawal follows the object, not only the reference.
------------------------------------------------------------------------------
create or replace function merch.withdraw_media_from_asset(p_media_asset_id uuid, p_rights text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int; a record;
begin
  select workspace_id, storage_bucket, object_path into a from ingest.media_assets where id = p_media_asset_id;
  update merch.product_media pm
  set archived_at = now(), is_primary = false, review_state = 'conflicted',
      usage_rights_state = coalesce(p_rights, pm.usage_rights_state)
  where pm.archived_at is null
    and (pm.media_asset_id = p_media_asset_id
         or (a.object_path is not null and pm.workspace_id = a.workspace_id
             and pm.storage_bucket = a.storage_bucket and pm.storage_path = a.object_path));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function merch.withdraw_media_from_asset(uuid, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3. The guard checks the association as well as the asset.
------------------------------------------------------------------------------
create or replace function merch.guard_imported_media_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; l record;
begin
  if new.review_state <> 'reviewed' and not new.is_primary then return new; end if;
  -- The imported asset this row shows, by explicit reference or by object path.
  select m.id, m.usage_rights_state, m.review_state into a
  from ingest.media_assets m
  where m.workspace_id = new.workspace_id
    and (m.id = new.media_asset_id or (m.storage_bucket = new.storage_bucket and m.object_path = new.storage_path))
  order by (m.id = new.media_asset_id) desc nulls last
  limit 1;
  if found and (a.usage_rights_state <> 'accepted' or a.review_state <> 'approved') then
    raise exception 'imported media must have reviewed evidence and accepted usage rights before it is published (asset review %, rights %)',
      a.review_state, a.usage_rights_state using errcode = '23514';
  end if;
  if new.media_asset_variant_link_id is not null then
    select x.workspace_id, x.media_asset_id, x.review_state, x.link_basis into l
    from ingest.media_asset_variant_links x where x.id = new.media_asset_variant_link_id;
    if not found or l.workspace_id <> new.workspace_id
       or l.review_state <> 'approved' or l.link_basis = 'same_source_document'
       or (new.media_asset_id is not null and l.media_asset_id <> new.media_asset_id) then
      raise exception 'imported media can only be published through an approved association for the same image'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function merch.guard_imported_media_publication() from public, anon, authenticated;
