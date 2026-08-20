-- Enablement for Phases 2-6: policies for the child tables that had no
-- workspace_id (and were therefore deny-all), private storage buckets with
-- operation-specific policies, and the storage-object helper.

------------------------------------------------------------------------------
-- 1. Child-table policies (join to the parent's workspace scope)
------------------------------------------------------------------------------

-- marketing children
create policy via_parent on marketing.content_opportunity_status_events for all to authenticated
  using (content_opportunity_id in (select co.id from marketing.content_opportunities co))
  with check (content_opportunity_id in (select co.id from marketing.content_opportunities co));

create policy via_parent on marketing.shoot_booking_status_events for all to authenticated
  using (shoot_booking_id in (select b.id from marketing.shoot_bookings b))
  with check (shoot_booking_id in (select b.id from marketing.shoot_bookings b));

create policy via_parent_read on marketing.shoot_participants for select to authenticated
  using (shoot_booking_id in (select b.id from marketing.shoot_bookings b));
create policy via_parent_write on marketing.shoot_participants for all to authenticated
  using (shoot_booking_id in (select b.id from marketing.shoot_bookings b) and (select core.has_permission('marketing.write')))
  with check (shoot_booking_id in (select b.id from marketing.shoot_bookings b) and (select core.has_permission('marketing.write')));

create policy via_parent_read on marketing.shoot_locations for select to authenticated
  using (shoot_booking_id in (select b.id from marketing.shoot_bookings b));
create policy via_parent_write on marketing.shoot_locations for all to authenticated
  using (shoot_booking_id in (select b.id from marketing.shoot_bookings b) and (select core.has_permission('marketing.write')))
  with check (shoot_booking_id in (select b.id from marketing.shoot_bookings b) and (select core.has_permission('marketing.write')));

create policy via_parent_read on marketing.shoot_checklists for select to authenticated
  using (shoot_booking_id in (select b.id from marketing.shoot_bookings b));
create policy via_parent_write on marketing.shoot_checklists for all to authenticated
  using (shoot_booking_id in (select b.id from marketing.shoot_bookings b) and (select core.has_permission('marketing.write')))
  with check (shoot_booking_id in (select b.id from marketing.shoot_bookings b) and (select core.has_permission('marketing.write')));

create policy via_parent on marketing.content_asset_reviews for all to authenticated
  using (shoot_output_id in (select o.id from marketing.shoot_outputs o))
  with check (shoot_output_id in (select o.id from marketing.shoot_outputs o));

-- ingest children
create policy via_parent on ingest.source_asset_versions for all to authenticated
  using (source_asset_id in (select a.id from ingest.source_assets a))
  with check (source_asset_id in (select a.id from ingest.source_assets a));

create policy via_parent on ingest.ingestion_records for all to authenticated
  using (job_id in (select j.id from ingest.ingestion_jobs j))
  with check (job_id in (select j.id from ingest.ingestion_jobs j));

create policy via_parent on ingest.extracted_fields for all to authenticated
  using (record_id in (select r.id from ingest.ingestion_records r))
  with check (record_id in (select r.id from ingest.ingestion_records r));

create policy via_parent on ingest.connector_checkpoints for all to authenticated
  using (connection_id in (select c.id from ingest.integration_connections c))
  with check (connection_id in (select c.id from ingest.integration_connections c));

create policy via_parent on ingest.sync_runs for all to authenticated
  using (connection_id in (select c.id from ingest.integration_connections c))
  with check (connection_id in (select c.id from ingest.integration_connections c));

------------------------------------------------------------------------------
-- 2. Private storage buckets (PRD §10.4, §13.1): originals, media, evidence
--    and shoot outputs are separated so policies can differ per class.
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('source-assets', 'source-assets', false, 52428800,
   array['application/pdf','image/png','image/jpeg','image/webp','text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('product-media', 'product-media', false, 20971520, array['image/png','image/jpeg','image/webp','application/pdf']),
  ('shoot-outputs', 'shoot-outputs', false, 209715200, array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime','application/pdf']),
  ('permission-evidence', 'permission-evidence', false, 20971520, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

-- Objects are addressed as <workspace_id>/<...>; membership in the leading
-- folder is what grants access, and each operation is granted separately.
create or replace function core.storage_workspace_of(name text)
returns uuid language sql immutable as $$
  select nullif(split_part(name, '/', 1), '')::uuid
$$;
grant execute on function core.storage_workspace_of(text) to authenticated, service_role;

do $$
declare b record;
begin
  for b in select unnest(array['source-assets','product-media','shoot-outputs','permission-evidence']) as id loop
    execute format($p$
      create policy %I on storage.objects for select to authenticated
        using (bucket_id = %L and core.storage_workspace_of(name) in (select core.member_workspace_ids()))
    $p$, 'tc_read_' || replace(b.id, '-', '_'), b.id);
    execute format($p$
      create policy %I on storage.objects for insert to authenticated
        with check (bucket_id = %L and core.storage_workspace_of(name) in (select core.member_workspace_ids()) and owner_id = (select auth.uid()::text))
    $p$, 'tc_insert_' || replace(b.id, '-', '_'), b.id);
    execute format($p$
      create policy %I on storage.objects for update to authenticated
        using (bucket_id = %L and core.storage_workspace_of(name) in (select core.member_workspace_ids()))
        with check (bucket_id = %L and core.storage_workspace_of(name) in (select core.member_workspace_ids()))
    $p$, 'tc_update_' || replace(b.id, '-', '_'), b.id, b.id);
    -- Deletion of evidence and originals is an administrative act.
    execute format($p$
      create policy %I on storage.objects for delete to authenticated
        using (bucket_id = %L and core.storage_workspace_of(name) in (select core.member_workspace_ids()) and (select core.has_permission('settings.manage')))
    $p$, 'tc_delete_' || replace(b.id, '-', '_'), b.id);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 3. Columns the later phases need that the initial schema did not carry
------------------------------------------------------------------------------
alter table marketing.content_opportunities add column if not exists reference_media jsonb not null default '[]'::jsonb;
alter table marketing.content_opportunities add column if not exists site_notes text;
alter table marketing.content_opportunities add column if not exists interview_subjects text;
alter table marketing.shoot_bookings add column if not exists title text;
alter table marketing.shoot_outputs add column if not exists caption text;
alter table marketing.shoot_outputs add column if not exists mime_type text;
alter table marketing.shoot_outputs add column if not exists size_bytes bigint;
alter table stock.supplier_availability_snapshots add column if not exists supersedes_id uuid references stock.supplier_availability_snapshots(id);
alter table ingest.ingestion_jobs add column if not exists progress jsonb not null default '{}'::jsonb;
alter table ingest.review_items add column if not exists published_object_id uuid;
alter table ingest.review_items add column if not exists confidence numeric(4,3);

-- updated_at + audit on the later-phase operational tables
do $$
declare t text;
begin
  foreach t in array array['content_opportunities','media_permission_records','shoot_bookings'] loop
    execute format('create trigger set_updated_at before update on marketing.%I for each row execute function core.set_updated_at()', t);
    execute format('create trigger audit_row_change after insert or update or delete on marketing.%I for each row execute function audit.log_row_change()', t);
  end loop;
  foreach t in array array['supplier_availability_snapshots','stock_reconciliation_cases','inventory_item_mappings'] loop
    execute format('create trigger audit_row_change after insert or update or delete on stock.%I for each row execute function audit.log_row_change()', t);
  end loop;
  foreach t in array array['source_assets','review_items','integration_connections'] loop
    execute format('create trigger audit_row_change after insert or update or delete on ingest.%I for each row execute function audit.log_row_change()', t);
  end loop;
end $$;

-- Refresh the api views so the new columns are exposed.
do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('marketing','stock','ingest')
  loop
    execute format('drop view if exists api.%I cascade', r.table_name);
    execute format('create view api.%I with (security_invoker = true) as select * from %I.%I', r.table_name, r.schema_name, r.table_name);
    execute format('grant select, insert, update, delete on api.%I to authenticated', r.table_name);
    execute format('grant all on api.%I to service_role', r.table_name);
  end loop;
end $$;
