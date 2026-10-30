-- TILE-24: source originals are readable and writable only by the people who
-- import them, in the workspace that owns them.
--
-- Found by execution on an isolated stack at d8671d0: the source-assets bucket
-- policies from 20260820000008 asked only for workspace membership, so a
-- sales rep, showroom, sales manager, marketing, management or stock user
-- could sign, download, list, copy, MOVE and OVERWRITE (upsert or update) a
-- supplier catalogue or price list by its known path, although
-- api.source_assets hid the row. The parser and the OCR worker read these
-- files, so an overwrite swaps what gets parsed.
--
-- The checks that did name a permission used core.has_permission, which is
-- not workspace-scoped: a member who is admin or catalog_pricing in ANOTHER
-- workspace could read this workspace's source rows and OCR page artifacts
-- and delete its originals.
--
-- Now, for an object or row of workspace W:
--   source-assets    read, insert, update  source.import or catalog.write in W
--                    insert                also stock.write in W, only under
--                                          <W>/supplier-evidence/ (the stock
--                                          quick-entry screenshot upload; it
--                                          never reads or overwrites)
--                    delete                settings.manage in W
--   ingest-artifacts read, insert, update  source.import in W
--                    delete                settings.manage in W
--   ingest.source_assets rows              source.import in W (delete:
--                                          settings.manage in W)
-- Unchanged: the service role (OCR worker, server-side parse) bypasses RLS;
-- review.approve (which sales_rep holds) never granted the original, and the
-- review screen signs it only for source.import holders.

------------------------------------------------------------------------------
-- Workspaces where the caller holds any of the given permissions. Set-
-- returning so a policy can use it as an uncorrelated subquery that Postgres
-- evaluates once per statement, not once per object row.
------------------------------------------------------------------------------
create or replace function core.permitted_workspace_ids(perms text[])
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct m.workspace_id from core.memberships m
  join core.role_permissions rp on rp.role_key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and rp.permission = any (perms)
$$;
revoke all on function core.permitted_workspace_ids(text[]) from public, anon;
grant execute on function core.permitted_workspace_ids(text[]) to authenticated, service_role;

------------------------------------------------------------------------------
-- source-assets
------------------------------------------------------------------------------
drop policy if exists tc_read_source_assets on storage.objects;
create policy tc_read_source_assets on storage.objects for select to authenticated
using (bucket_id = 'source-assets'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import', 'catalog.write'])));

drop policy if exists tc_insert_source_assets on storage.objects;
create policy tc_insert_source_assets on storage.objects for insert to authenticated
with check (bucket_id = 'source-assets'
  and owner_id = (select auth.uid()::text)
  and (core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import', 'catalog.write']))
       or (split_part(name, '/', 2) = 'supplier-evidence'
           and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['stock.write'])))));

drop policy if exists tc_update_source_assets on storage.objects;
create policy tc_update_source_assets on storage.objects for update to authenticated
using (bucket_id = 'source-assets'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import', 'catalog.write'])))
with check (bucket_id = 'source-assets'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import', 'catalog.write'])));

drop policy if exists tc_delete_source_assets on storage.objects;
create policy tc_delete_source_assets on storage.objects for delete to authenticated
using (bucket_id = 'source-assets'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['settings.manage'])));

------------------------------------------------------------------------------
-- ingest-artifacts (OCR page images and TSV: derived copies of originals)
------------------------------------------------------------------------------
drop policy if exists tc_read_ingest_artifacts on storage.objects;
create policy tc_read_ingest_artifacts on storage.objects for select to authenticated
using (bucket_id = 'ingest-artifacts'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import'])));

drop policy if exists tc_insert_ingest_artifacts on storage.objects;
create policy tc_insert_ingest_artifacts on storage.objects for insert to authenticated
with check (bucket_id = 'ingest-artifacts'
  and owner_id = (select auth.uid()::text)
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import'])));

drop policy if exists tc_update_ingest_artifacts on storage.objects;
create policy tc_update_ingest_artifacts on storage.objects for update to authenticated
using (bucket_id = 'ingest-artifacts'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import'])))
with check (bucket_id = 'ingest-artifacts'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['source.import'])));

drop policy if exists tc_delete_ingest_artifacts on storage.objects;
create policy tc_delete_ingest_artifacts on storage.objects for delete to authenticated
using (bucket_id = 'ingest-artifacts'
  and core.storage_workspace_of(name) in (select core.permitted_workspace_ids(array['settings.manage'])));

------------------------------------------------------------------------------
-- ingest.source_assets rows: same permission as before, now in the row's
-- own workspace. The api views over this table are security-invoker, so
-- api.source_assets, source_library, review_queue, media_review_queue,
-- ocr_jobs and corpus_reconciliation follow.
------------------------------------------------------------------------------
drop policy if exists member_read on ingest.source_assets;
create policy member_read on ingest.source_assets for select to authenticated
using (workspace_id in (select core.permitted_workspace_ids(array['source.import'])));

drop policy if exists member_insert on ingest.source_assets;
create policy member_insert on ingest.source_assets for insert to authenticated
with check (workspace_id in (select core.permitted_workspace_ids(array['source.import'])));

drop policy if exists member_update on ingest.source_assets;
create policy member_update on ingest.source_assets for update to authenticated
using (workspace_id in (select core.permitted_workspace_ids(array['source.import'])))
with check (workspace_id in (select core.permitted_workspace_ids(array['source.import'])));

drop policy if exists admin_delete on ingest.source_assets;
create policy admin_delete on ingest.source_assets for delete to authenticated
using (workspace_id in (select core.permitted_workspace_ids(array['settings.manage'])));
