-- Corpus migration 5/6 — private Storage for the corpus.
--
-- Object keys are workspace-first and content-addressed:
--
--   source-assets/    <workspace_id>/drive/<collection>/<source_id>/<sha256>/<file>
--   product-media/    <workspace_id>/sources/<source_id>/pages/page-0001.jpg
--   product-media/    <workspace_id>/sources/<source_id>/images/<sha256>.jpg
--   ingest-artifacts/ <workspace_id>/runs/<import_run_id>/<artifact_type>/<file>
--
-- The bucket name is chosen by the SDK and is never repeated inside the key.
-- core.storage_workspace_of() reads the leading folder, so every object must
-- begin with <workspace_id>/ or no policy will match it.

------------------------------------------------------------------------------
-- Raise the source-assets ceiling.
--
-- The staged corpus holds 154 original PDFs totalling 2,529,147,095 bytes, of
-- which 14 exceed the previous 50 MiB bucket limit; the largest is 366,392,675
-- bytes. This is inert until the project-wide Storage limit (a dashboard /
-- Management API setting, not SQL) is raised to at least the same value.
--
-- product-media keeps its 20 MiB limit: the largest page render is 897,040
-- bytes and the largest standalone image is 706,127 bytes.
------------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 536870912  -- 512 MiB
where id = 'source-assets';

------------------------------------------------------------------------------
-- ingest-artifacts — raw OCR payloads, shape profiles, contact sheets, and
-- reconciliation manifests.
--
-- Separate from source-assets because its retention and access rules differ:
-- these are derived working artifacts, not supplier originals.
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('ingest-artifacts', 'ingest-artifacts', false, 104857600,
   array['application/json','application/x-ndjson','text/plain','text/csv','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- The policy loop in 20260820000008_phase_enablement.sql was a one-time catalog
-- pass over the four original buckets, so a new bucket writes its own four.
create policy tc_read_ingest_artifacts on storage.objects for select to authenticated
  using (
    bucket_id = 'ingest-artifacts'
    and core.storage_workspace_of(name) in (select core.member_workspace_ids())
    and (select core.has_permission('source.import'))
  );

create policy tc_insert_ingest_artifacts on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ingest-artifacts'
    and core.storage_workspace_of(name) in (select core.member_workspace_ids())
    and (select core.has_permission('source.import'))
    and owner_id = (select auth.uid()::text)
  );

create policy tc_update_ingest_artifacts on storage.objects for update to authenticated
  using (
    bucket_id = 'ingest-artifacts'
    and core.storage_workspace_of(name) in (select core.member_workspace_ids())
    and (select core.has_permission('source.import'))
  )
  with check (
    bucket_id = 'ingest-artifacts'
    and core.storage_workspace_of(name) in (select core.member_workspace_ids())
    and (select core.has_permission('source.import'))
  );

-- Deleting a retained artifact is an administrative act, as with the originals.
create policy tc_delete_ingest_artifacts on storage.objects for delete to authenticated
  using (
    bucket_id = 'ingest-artifacts'
    and core.storage_workspace_of(name) in (select core.member_workspace_ids())
    and (select core.has_permission('settings.manage'))
  );
