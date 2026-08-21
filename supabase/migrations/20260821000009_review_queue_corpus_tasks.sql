-- Make corpus review tasks visible in the app.
--
-- api.review_queue was written for the interactive upload flow, where every
-- review item descends from an ingestion job:
--
--   join ingest.ingestion_jobs j on j.id = ri.job_id
--   join ingest.source_assets  a on a.id = j.source_asset_id
--
-- The 2,448 tasks imported from the discovery corpus have no ingestion job -
-- they came from a corpus-wide import run, not from someone uploading a
-- document - so both inner joins dropped every one of them. They were in the
-- database and invisible in the UI, which is the worst of both worlds.
--
-- This links a review item directly to its source asset and relaxes the joins,
-- so a task is visible whether it arrived through an upload or through an
-- import run.

alter table ingest.review_items
  add column if not exists source_asset_id uuid references ingest.source_assets(id) on delete cascade;

create index if not exists review_items_source_asset_idx
  on ingest.review_items (source_asset_id);

-- Backfill the existing upload-flow rows so the column is authoritative for
-- both paths rather than only the new one.
update ingest.review_items ri
set source_asset_id = j.source_asset_id
from ingest.ingestion_jobs j
where j.id = ri.job_id and ri.source_asset_id is null;

------------------------------------------------------------------------------
-- Recreate the read model.
--
-- `create or replace view` keeps the existing column list and order and appends
-- the four corpus columns at the end, so nothing that selects from it breaks.
------------------------------------------------------------------------------
create or replace view api.review_queue with (security_invoker = true) as
select ri.id, ri.workspace_id, ri.item_type, ri.proposed, ri.conflicts, ri.status, ri.confidence,
       ri.reviewed_by, ri.reviewed_at, ri.decision_note, ri.created_at, ri.published_object_id,
       j.id as job_id, j.job_type, j.parser_version,
       a.id as source_asset_id, a.name as source_name, a.kind as source_kind, a.storage_bucket, a.storage_path, a.page_count,
       s.name as supplier_name,
       r.row_no, r.page_no, r.raw,
       (select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'value', f.value, 'confidence', f.confidence, 'region', f.region, 'source_text', f.source_text) order by f.field_key), '[]'::jsonb)
          from ingest.extracted_fields f where f.record_id = r.id) as fields,
       ri.task_type, ri.priority, ri.review_target_type, ri.review_target_key
from ingest.review_items ri
left join ingest.ingestion_jobs j on j.id = ri.job_id
-- Either route to the document: a direct link, or through the job that made it.
left join ingest.source_assets a on a.id = coalesce(ri.source_asset_id, j.source_asset_id)
left join merch.suppliers s on s.id = a.supplier_id
left join ingest.ingestion_records r on r.id = ri.record_id;
grant select on api.review_queue to authenticated;

-- api.review_items froze its column list again when source_asset_id was added.
create or replace view api.review_items with (security_invoker = true) as select * from ingest.review_items;
grant select, insert, update, delete on api.review_items to authenticated;
grant all on api.review_items to service_role;
