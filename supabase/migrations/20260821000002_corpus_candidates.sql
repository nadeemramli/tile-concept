-- Corpus migration 2/6 — candidate staging.
--
-- Nothing in this file is a published fact. Every table here holds a proposal
-- that an authorised catalog/pricing operator must approve before it becomes
-- merchandise, price, or certificate data. Raw supplier labels and values are
-- retained beside every normalized proposal so a mapping change is reversible
-- (Canonical Merchandise Schema v0.3, modelling rules 6 and 8).
--
-- ingest.ingestion_records / ingest.extracted_fields are deliberately left
-- alone: they remain the interactive single-document upload path.

------------------------------------------------------------------------------
-- Document shape profiles and clusters — one profile per discovered source,
-- clustered so a reviewer can approve a parsing shape once per cluster instead
-- of once per document.
------------------------------------------------------------------------------
create table if not exists ingest.shape_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  external_source_id text not null,
  source_path text,
  brand_hint text,
  document_class text,
  likely_grain text,
  extraction jsonb not null default '{}'::jsonb,
  text_metrics jsonb not null default '{}'::jsonb,
  language_signals text[] not null default '{}',
  observed_fields jsonb not null default '{}'::jsonb,
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  safe_for_schema_learning boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_source_id)
);

create table if not exists ingest.shape_clusters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  cluster_key text not null,
  root_name text,
  document_class text,
  mime_type text,
  extraction_method text,
  layout_hint text,
  document_count int not null default 0,
  representative_source_id text,
  representative_source_path text,
  member_source_ids text[] not null default '{}',
  selection_score numeric,
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, cluster_key)
);

------------------------------------------------------------------------------
-- Generic candidate record + fact (canonical v0.3).
--
-- candidate_key is the corpus's own stable id (e.g. variant_65a1f653...). It is
-- the re-import idempotency key: the same corpus re-imported produces the same
-- keys and therefore zero new rows.
------------------------------------------------------------------------------
create table if not exists ingest.candidate_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  import_run_id uuid references ingest.import_runs(id) on delete set null,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  candidate_record_type text not null
    check (candidate_record_type in ('catalog_edition','product_family','product_variant','price_entry',
                                     'certificate','commercial_amount_observation','duplicate_code_group')),
  candidate_key text not null,
  source_locator jsonb not null default '{}'::jsonb,
  raw_group_reference text,
  group_confidence numeric(5,4),
  extraction_rule text,
  validation_state text not null default 'unvalidated'
    check (validation_state in ('unvalidated','valid','incomplete','conflicted','invalid')),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  published_object_type text,
  published_object_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, candidate_key)
);
create index if not exists candidate_records_type_idx on ingest.candidate_records (workspace_id, candidate_record_type, review_state);
create index if not exists candidate_records_asset_idx on ingest.candidate_records (source_asset_id);
create index if not exists candidate_records_run_idx on ingest.candidate_records (import_run_id);

create table if not exists ingest.candidate_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  candidate_record_id uuid not null references ingest.candidate_records(id) on delete cascade,
  field_path text not null,
  raw_label text,
  raw_value text,
  normalized_value jsonb,
  source_page int,
  source_region jsonb,
  confidence numeric(5,4),
  validation_state text not null default 'unvalidated'
    check (validation_state in ('unvalidated','valid','incomplete','conflicted','invalid')),
  mapping_rule_version text,
  created_at timestamptz not null default now(),
  unique (candidate_record_id, field_path)
);
create index if not exists candidate_facts_record_idx on ingest.candidate_facts (candidate_record_id);

------------------------------------------------------------------------------
-- Typed candidate tables. These mirror the discovery corpus JSONL shapes one
-- for one so reconciliation is a row count, not an interpretation.
------------------------------------------------------------------------------
create table if not exists ingest.catalog_edition_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  candidate_record_id uuid references ingest.candidate_records(id) on delete cascade,
  candidate_key text not null,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  external_source_id text not null,
  source_path text,
  root_name text,
  brand_hint text,
  name_candidate text,
  edition_label_candidate text,
  publication_date_candidate text,
  language_signals text[] not null default '{}',
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, candidate_key)
);

create table if not exists ingest.variant_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  candidate_record_id uuid references ingest.candidate_records(id) on delete cascade,
  candidate_key text not null,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  external_source_id text not null,
  source_path text,
  root_name text,
  brand_hint text,
  family_name_candidate text,
  supplier_code_raw text not null,
  supplier_code_normalized text generated always as (core.normalize_key(supplier_code_raw)) stored,
  dimensions_raw text[] not null default '{}',
  material_raw text,
  finish_raw text,
  status_raw text,
  package_raw text,
  extraction_rule text,
  source_locator jsonb not null default '{}'::jsonb,
  raw_excerpt text,
  confidence numeric(5,4),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  published_variant_id uuid references merch.product_variants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, candidate_key)
);
create index if not exists variant_candidates_code_idx on ingest.variant_candidates (workspace_id, brand_hint, supplier_code_normalized);
create index if not exists variant_candidates_state_idx on ingest.variant_candidates (workspace_id, review_state);

-- Price candidates: amount is numeric and is written from an exact decimal
-- string. currency_code, unit_basis, tax_basis and effective date stay NULL /
-- 'unknown' when the source does not establish them — they are publication
-- blockers, never values to infer (PRD 7.6; Canonical Schema rule 4).
create table if not exists ingest.price_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  candidate_record_id uuid references ingest.candidate_records(id) on delete cascade,
  candidate_key text not null,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  external_source_id text not null,
  source_path text,
  brand_hint text,
  variant_candidate_key text,
  product_code_candidate text,
  amount_raw text not null,
  amount_normalized numeric(18,6),
  currency_code char(3),
  price_type_raw text,
  unit_basis text,
  tax_basis text not null default 'unknown'
    check (tax_basis in ('inclusive','exclusive','not_applicable','unknown')),
  effective_date_raw text,
  source_locator jsonb not null default '{}'::jsonb,
  extraction_rule text,
  confidence numeric(5,4),
  validation_flags jsonb not null default '[]'::jsonb,
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  published_price_id uuid references merch.variant_prices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, candidate_key),
  constraint price_candidates_amount_positive check (amount_normalized is null or amount_normalized > 0)
);
create index if not exists price_candidates_variant_idx on ingest.price_candidates (workspace_id, variant_candidate_key);
create index if not exists price_candidates_state_idx on ingest.price_candidates (workspace_id, review_state);

-- Certificate candidates. scope_type defaults to 'unknown' and a folder
-- location never authorises a scope (Canonical Schema, certificate_scope).
create table if not exists ingest.certificate_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  candidate_record_id uuid references ingest.candidate_records(id) on delete cascade,
  candidate_key text not null,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  external_source_id text not null,
  source_path text,
  root_name text,
  brand_hint text,
  title_candidate text,
  certificate_number_candidates text[] not null default '{}',
  filename_identifier_candidates text[] not null default '{}',
  certificate_type_signal_candidates text[] not null default '{}',
  standard_candidates text[] not null default '{}',
  date_candidates text[] not null default '{}',
  -- Filename dates are hints, never accepted date roles.
  filename_date_candidates text[] not null default '{}',
  role_candidates jsonb not null default '{}'::jsonb,
  scope_type text not null default 'unknown'
    check (scope_type in ('organization','brand','manufacturing_facility','category','product_family','product_variant','unknown')),
  scope_text_raw text,
  extraction_rule text,
  source_locator jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  validation_flags jsonb not null default '[]'::jsonb,
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  published_certificate_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, candidate_key)
);

-- Currency amounts that are demonstrably not product prices (delivery charges,
-- investment figures, value thresholds). Retained as evidence, never publishable.
create table if not exists ingest.commercial_amount_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  candidate_record_id uuid references ingest.candidate_records(id) on delete cascade,
  observation_key text not null,
  observation_type text not null default 'commercial_amount_unresolved',
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  external_source_id text not null,
  source_path text,
  brand_hint text,
  amount_raw text,
  amount_normalized numeric(18,6),
  currency_code char(3),
  source_locator jsonb not null default '{}'::jsonb,
  raw_excerpt text,
  reason_not_price_candidate text,
  review_state text not null default 'retained_raw_observation'
    check (review_state in ('retained_raw_observation','pending_review','needs_correction','approved','rejected','superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, observation_key)
);

create table if not exists ingest.duplicate_code_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  group_key text not null,
  brand_hint text,
  supplier_code_normalized text not null,
  candidate_count int not null default 0,
  source_count int not null default 0,
  candidate_keys text[] not null default '{}',
  external_source_ids text[] not null default '{}',
  resolution_state text not null default 'unreviewed'
    check (resolution_state in ('unreviewed','merged','distinct','needs_correction','rejected')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, group_key)
);

create table if not exists ingest.corpus_validation_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  issue_key text not null,
  external_source_id text,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  issue_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  -- The corpus grades issues by consequence ("blocks_price_publication") rather
  -- than by level. Keep its own wording beside the level it maps to.
  severity_raw text,
  affected_candidate_count int,
  details jsonb not null default '{}'::jsonb,
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, issue_key)
);

------------------------------------------------------------------------------
-- Append-only review decisions. A decision is never updated or deleted; a later
-- decision supersedes an earlier one, which keeps the correction evidence and
-- the parser feedback trail intact (PRD 12.5 step 6).
------------------------------------------------------------------------------
create table if not exists ingest.review_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  review_target_type text not null,
  review_target_id uuid not null,
  review_target_key text,
  decision text not null check (decision in ('approved','corrected','rejected','deferred','superseded')),
  corrected_value jsonb,
  reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz not null default now(),
  supersedes_id uuid references ingest.review_decisions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists review_decisions_target_idx on ingest.review_decisions (workspace_id, review_target_type, review_target_id, reviewed_at desc);

-- Append-only in the strict sense: no update, no delete, for anyone.
create or replace function ingest.reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'ingest.% is append-only; record a superseding decision instead', tg_table_name
    using errcode = '0A000';
end $$;
revoke all on function ingest.reject_mutation() from public;

create trigger review_decisions_append_only
  before update or delete on ingest.review_decisions
  for each row execute function ingest.reject_mutation();

------------------------------------------------------------------------------
-- Extend ingest.review_items so a corpus review task is idempotent on
-- re-import and can point at a typed candidate rather than only an
-- ingestion_record. item_type has no CHECK constraint, so the corpus task
-- types need no DDL.
------------------------------------------------------------------------------
alter table ingest.review_items
  add column if not exists review_target_type text,
  add column if not exists review_target_id uuid,
  add column if not exists review_target_key text,
  add column if not exists task_type text,
  add column if not exists priority int,
  add column if not exists external_key text,
  add column if not exists import_run_id uuid references ingest.import_runs(id) on delete set null;

-- Not partial, for the same reason as source_assets_provider_external_idx:
-- an upsert conflict target must be inferable from column names alone.
create unique index if not exists review_items_external_key_idx
  on ingest.review_items (workspace_id, external_key);
create index if not exists review_items_task_idx on ingest.review_items (workspace_id, task_type, status, priority);

------------------------------------------------------------------------------
-- RLS, grants, api views.
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'shape_profiles','shape_clusters','candidate_records','candidate_facts',
    'catalog_edition_candidates','variant_candidates','price_candidates',
    'certificate_candidates','commercial_amount_observations',
    'duplicate_code_groups','corpus_validation_issues','review_decisions'
  ]
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
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'shape_profiles','shape_clusters','candidate_records',
    'catalog_edition_candidates','variant_candidates','price_candidates',
    'certificate_candidates','commercial_amount_observations',
    'duplicate_code_groups','corpus_validation_issues'
  ]
  loop
    execute format('create trigger set_updated_at before update on ingest.%I for each row execute function core.set_updated_at()', t);
  end loop;
end $$;

-- api.review_items froze its column list in ...0006; expose the new columns.
create or replace view api.review_items with (security_invoker = true) as select * from ingest.review_items;
grant select, insert, update, delete on api.review_items to authenticated;
grant all on api.review_items to service_role;
