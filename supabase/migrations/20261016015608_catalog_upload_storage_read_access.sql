-- Align private object previews with catalogue publication and workspace permissions.
create index if not exists product_media_object_idx on merch.product_media (storage_bucket, storage_path);

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

-- This private-schema predicate returns only publication eligibility. The
-- outer storage policy separately requires membership in the owning workspace.
create or replace function core.product_media_object_published(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from merch.product_media m
    where m.storage_bucket = p_bucket and m.storage_path = p_name
      and m.workspace_id = core.storage_workspace_of(p_name)
      and m.archived_at is null and m.review_state = 'reviewed' and m.usage_rights_state = 'accepted')
$$;
revoke all on function core.product_media_object_published(text, text) from public, anon;
grant execute on function core.product_media_object_published(text, text) to authenticated, service_role;

drop policy if exists tc_read_product_media on storage.objects;
create policy tc_read_product_media on storage.objects for select to authenticated
using (bucket_id = 'product-media'
  and core.storage_workspace_of(name) in (select core.member_workspace_ids())
  and (core.has_permission_in(core.storage_workspace_of(name), 'catalog.write')
       or core.product_media_object_published(bucket_id, name)));
