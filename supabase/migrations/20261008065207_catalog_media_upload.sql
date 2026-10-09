-- Direct catalogue attachments; preserve existing imported media and private originals.
alter table merch.product_media
  add column original_filename text,
  add column mime_type text,
  add column size_bytes bigint check (size_bytes > 0 and size_bytes <= 20971520),
  add column checksum text check (checksum ~ '^[0-9a-f]{64}$'),
  add column uploaded_by uuid references auth.users(id),
  add column archived_at timestamptz;

update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/webp','application/pdf','video/mp4','video/webm']
where id = 'product-media';

-- Permit removal of an unattached failed upload owned by the caller only.
create policy tc_cleanup_own_catalog_upload on storage.objects for delete to authenticated
using (bucket_id = 'product-media'
  and owner_id = (select auth.uid()::text)
  and core.storage_workspace_of(name) in (select core.member_workspace_ids())
  and (select core.has_permission('catalog.write'))
  and not exists (select 1 from merch.product_media m where m.storage_bucket = bucket_id and m.storage_path = name));

-- Writing catalogue media is a catalogue operator act, and an attached original
-- is immutable evidence (its checksum is recorded): only an unattached object
-- may be written. Server tooling uses the service role and is unaffected.
drop policy if exists tc_insert_product_media on storage.objects;
create policy tc_insert_product_media on storage.objects for insert to authenticated
with check (bucket_id = 'product-media'
  and core.storage_workspace_of(name) in (select core.member_workspace_ids())
  and owner_id = (select auth.uid()::text)
  and (select core.has_permission('catalog.write')));
drop policy if exists tc_update_product_media on storage.objects;
create policy tc_update_product_media on storage.objects for update to authenticated
using (bucket_id = 'product-media'
  and core.storage_workspace_of(name) in (select core.member_workspace_ids())
  and owner_id = (select auth.uid()::text)
  and (select core.has_permission('catalog.write'))
  and not exists (select 1 from merch.product_media m where m.storage_bucket = bucket_id and m.storage_path = name))
with check (bucket_id = 'product-media'
  and core.storage_workspace_of(name) in (select core.member_workspace_ids())
  and (select core.has_permission('catalog.write')));

-- Readers without catalog.write see only active, reviewed, rights-cleared media;
-- imported or archived attachments stay with catalogue operators.
create policy product_media_approved_for_readers on merch.product_media as restrictive for select to authenticated
using ((select core.has_permission('catalog.write'))
  or (archived_at is null and review_state = 'reviewed' and usage_rights_state = 'accepted'));

create or replace view api.product_media with (security_invoker = true) as select * from merch.product_media;

create trigger audit_row_change after insert or update or delete on merch.product_media
for each row execute function audit.log_row_change();

-- Serialize primary-image changes on the product, retain rights/review gates.
create function api.set_primary_catalog_media(p_media_id uuid, p_product_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_workspace uuid;
begin
  perform core.require_permission('catalog.write');
  select workspace_id into v_workspace from merch.products where id = p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  perform core.require_workspace(v_workspace);
  if not exists (select 1 from merch.product_media where id = p_media_id and product_id = p_product_id
    and workspace_id = v_workspace and kind = 'image' and archived_at is null
    and review_state = 'reviewed' and usage_rights_state = 'accepted') then
    raise exception 'primary image must be an active, reviewed, rights-cleared image for this product';
  end if;
  update merch.product_media set is_primary = (id = p_media_id) where product_id = p_product_id and workspace_id = v_workspace;
end $$;
revoke all on function api.set_primary_catalog_media(uuid, uuid) from public;
grant execute on function api.set_primary_catalog_media(uuid, uuid) to authenticated;

-- Replace one attachment with a newly uploaded one in a single transaction: the
-- new file inherits blank caption/alt/source and the primary role (when it is an
-- eligible image), and the old one is archived with its original retained.
create function api.replace_catalog_media(p_old_id uuid, p_new_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_old merch.product_media; v_new merch.product_media;
begin
  perform core.require_permission('catalog.write');
  select * into v_old from merch.product_media where id = p_old_id for update;
  if not found or v_old.archived_at is not null then raise exception 'media to replace is not active'; end if;
  perform core.require_workspace(v_old.workspace_id);
  perform 1 from merch.products where id = v_old.product_id for update;
  select * into v_new from merch.product_media where id = p_new_id for update;
  if not found or v_new.archived_at is not null or v_new.id = v_old.id
     or v_new.product_id <> v_old.product_id or v_new.workspace_id <> v_old.workspace_id then
    raise exception 'replacement must be another active attachment on the same product';
  end if;
  update merch.product_media set
    caption = coalesce(v_new.caption, v_old.caption),
    alt_text = coalesce(v_new.alt_text, v_old.alt_text),
    source_ref = coalesce(v_new.source_ref, v_old.source_ref),
    sort_order = v_old.sort_order
  where id = v_new.id;
  update merch.product_media set archived_at = now(), is_primary = false where id = v_old.id;
  if v_old.is_primary and v_new.kind = 'image' and v_new.review_state = 'reviewed' and v_new.usage_rights_state = 'accepted' then
    update merch.product_media set is_primary = (id = v_new.id) where product_id = v_old.product_id and workspace_id = v_old.workspace_id;
  end if;
end $$;
revoke all on function api.replace_catalog_media(uuid, uuid) from public;
grant execute on function api.replace_catalog_media(uuid, uuid) to authenticated;
