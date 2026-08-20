-- Corpus migration 1/6 — source hierarchy, immutable versions, import runs.
--
-- The discovery corpus (Obsidian, cutoff 2026-08-21) knows sources as a Drive
-- tree: three collections -> folders -> files -> content versions. The repo so
-- far only had a flat ingest.source_assets for interactive uploads. This adds
-- the hierarchy above it and the version/provenance columns below it, without
-- disturbing the upload flow.
--
-- Canonical Merchandise Schema v0.3 mapping:
--   source_collection -> ingest.source_collections    (new)
--   source_location   -> ingest.source_locations      (new)
--   source_asset      -> ingest.source_assets         (extended)
--   source_version    -> ingest.source_asset_versions (extended)
--   ingestion_run     -> ingest.import_runs           (new; ingest.ingestion_jobs
--                        stays the per-asset interactive parse job)

------------------------------------------------------------------------------
-- Source collections — the three accepted Drive roots. "LOCAL"/"OEM" describe
-- a supply relationship, never a product category, so supply_model is separate
-- and nullable until the business validates it.
------------------------------------------------------------------------------
create table if not exists ingest.source_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  supply_model text check (supply_model in ('local','oem','imported','unknown')),
  provider text not null default 'google_drive',
  external_folder_id text,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

------------------------------------------------------------------------------
-- Source locations — folders and link manifests. Self-parenting.
--
-- display_path is a human breadcrumb only. Drive names may contain a literal
-- slash (observed: "Website - Username/PW"), so hierarchy is resolved through
-- parent_id / external_id and never by splitting display_path.
------------------------------------------------------------------------------
create table if not exists ingest.source_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_collection_id uuid not null references ingest.source_collections(id) on delete cascade,
  parent_id uuid references ingest.source_locations(id) on delete set null,
  provider text not null default 'google_drive',
  external_id text not null,
  name text not null,
  display_path text,
  location_type text not null default 'folder'
    check (location_type in ('folder','link_manifest','external_catalog','other')),
  brand_hint text,
  web_url text,
  access_state text not null default 'readable'
    check (access_state in ('readable','metadata_only','denied','not_scanned')),
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);
create index if not exists source_locations_collection_idx on ingest.source_locations (source_collection_id);
create index if not exists source_locations_parent_idx on ingest.source_locations (parent_id);

------------------------------------------------------------------------------
-- Extend ingest.source_assets with provider identity and document class.
-- "kind" (pdf|image|excel|csv|url|manual) keeps its existing CHECK and stays
-- the technical format; asset_class is the reviewed document role, and it is
-- itself reviewable because a folder name is only a hint.
------------------------------------------------------------------------------
alter table ingest.source_assets
  add column if not exists source_location_id uuid references ingest.source_locations(id) on delete set null,
  add column if not exists provider text,
  add column if not exists external_id text,
  add column if not exists asset_class text
    check (asset_class in ('catalog','price_list','certificate','technical_sheet','link_manifest','product_image','other')),
  add column if not exists asset_class_review_state text not null default 'pending_review'
    check (asset_class_review_state in ('pending_review','approved','needs_correction','rejected')),
  add column if not exists current_version_id uuid,
  add column if not exists source_web_url text;

-- One logical asset per provider file id. Interactive uploads leave both null
-- and are unaffected: NULLs are distinct in a unique index, so they never
-- collide with each other. The index is deliberately NOT partial — PostgREST
-- expresses an upsert conflict target as column names only, and Postgres
-- cannot infer a partial index from that.
create unique index if not exists source_assets_provider_external_idx
  on ingest.source_assets (workspace_id, provider, external_id);
create index if not exists source_assets_location_idx on ingest.source_assets (source_location_id);
create index if not exists source_assets_class_idx on ingest.source_assets (workspace_id, asset_class);

------------------------------------------------------------------------------
-- Extend ingest.source_asset_versions into the canonical immutable
-- source_version.
--
-- (source_asset_id, checksum) uniqueness is the idempotency invariant. Today it
-- is enforced only inside api.register_source_asset, so a direct insert could
-- duplicate a version. Make the database the authority instead.
------------------------------------------------------------------------------
alter table ingest.source_asset_versions
  add column if not exists workspace_id uuid references core.workspaces(id) on delete cascade,
  add column if not exists size_bytes bigint,
  add column if not exists mime_type text,
  add column if not exists modified_at_source timestamptz,
  add column if not exists discovered_at timestamptz not null default now(),
  add column if not exists provider_revision_id text,
  add column if not exists storage_bucket text,
  add column if not exists snapshot_state text not null default 'uploaded'
    check (snapshot_state in ('uploaded','connector_text_only','binary_not_staged','excluded_by_policy')),
  add column if not exists supersedes_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  add column if not exists parser_hint text,
  add column if not exists source_page_count int;

-- Backfill workspace_id for rows created before this migration so the policy
-- below can scope directly rather than through the parent.
update ingest.source_asset_versions v
set workspace_id = a.workspace_id
from ingest.source_assets a
where a.id = v.source_asset_id and v.workspace_id is null;

create unique index if not exists source_asset_versions_checksum_idx
  on ingest.source_asset_versions (source_asset_id, checksum);
create index if not exists source_asset_versions_ws_idx on ingest.source_asset_versions (workspace_id);
create index if not exists source_asset_versions_state_idx on ingest.source_asset_versions (workspace_id, snapshot_state);

alter table ingest.source_assets
  drop constraint if exists source_assets_current_version_fk;
alter table ingest.source_assets
  add constraint source_assets_current_version_fk
  foreign key (current_version_id) references ingest.source_asset_versions(id) on delete set null;

------------------------------------------------------------------------------
-- Import runs and items.
--
-- import_runs is the corpus-scale sibling of ingest.ingestion_jobs: one run
-- covers a whole corpus pass rather than one uploaded asset. import_items is
-- the resume ledger — (workspace_id, item_kind, external_key) is the
-- idempotency key that makes an unchanged re-import a no-op.
------------------------------------------------------------------------------
create table if not exists ingest.import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  run_key text not null,
  corpus_cutoff date,
  pipeline_version text not null,
  parser_name text,
  parser_version text,
  target_env text not null check (target_env in ('local','linked','plan')),
  status text not null default 'running'
    check (status in ('running','awaiting_review','completed','failed_retryable','failed_terminal','cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  warning_count int not null default 0,
  error_code text,
  -- Safe detail only: never a raw price row, document body, or credential.
  error_detail_safe text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, run_key)
);
create index if not exists import_runs_ws_idx on ingest.import_runs (workspace_id, status, started_at desc);

create table if not exists ingest.import_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  import_run_id uuid not null references ingest.import_runs(id) on delete cascade,
  item_kind text not null,
  external_key text not null,
  checksum text,
  expected_count bigint,
  actual_count bigint,
  status text not null default 'pending'
    check (status in ('pending','succeeded','skipped_unchanged','failed','excluded_by_policy','deferred')),
  attempts int not null default 0,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, item_kind, external_key)
);
create index if not exists import_items_run_idx on ingest.import_items (import_run_id, status);

------------------------------------------------------------------------------
-- RLS, grants, api views.
--
-- 20260820000006_rls_api.sql applies its policies through one-time catalog
-- loops, so every table added later writes its own — see the inline template at
-- 20260820000015_sales_scorecard.sql. The (select ...) wrappers are deliberate:
-- Postgres then evaluates the helper once per statement, not once per row.
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['source_collections','source_locations','import_runs','import_items']
  loop
    execute format('alter table ingest.%I enable row level security', t);
    execute format($p$create policy member_read on ingest.%I for select to authenticated
      using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('source.import')))$p$, t);
    execute format($p$create policy member_write on ingest.%I for all to authenticated
      using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('source.import')))
      with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('source.import')))$p$, t);
    execute format('grant select, insert, update, delete on ingest.%I to authenticated', t);
    execute format('grant all on ingest.%I to service_role', t);
    execute format('create view api.%I with (security_invoker = true) as select * from ingest.%I', t, t);
    execute format('grant select, insert, update, delete on api.%I to authenticated', t);
    execute format('grant all on api.%I to service_role', t);
    execute format('create trigger set_updated_at before update on ingest.%I for each row execute function core.set_updated_at()', t);
  end loop;
end $$;

-- source_asset_versions carried a via-parent policy from ...0008; now that it
-- has workspace_id, scope it directly.
drop policy if exists via_parent on ingest.source_asset_versions;
drop policy if exists member_read on ingest.source_asset_versions;
create policy member_read on ingest.source_asset_versions for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('source.import')));
drop policy if exists member_write on ingest.source_asset_versions;
create policy member_write on ingest.source_asset_versions for all to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('source.import')))
  with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('source.import')));

-- Recreate the api views whose column list was frozen by `select *` earlier.
-- Both tables only gained columns, so create or replace is safe.
create or replace view api.source_assets with (security_invoker = true) as select * from ingest.source_assets;
grant select, insert, update, delete on api.source_assets to authenticated;
grant all on api.source_assets to service_role;

create or replace view api.source_asset_versions with (security_invoker = true) as select * from ingest.source_asset_versions;
grant select, insert, update, delete on api.source_asset_versions to authenticated;
grant all on api.source_asset_versions to service_role;
