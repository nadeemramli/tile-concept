-- Corpus migration 3/6 — visual evidence.
--
-- Three layers, deliberately kept apart (Canonical Merchandise Schema v0.3,
-- modelling rules 9 and 10):
--
--   ingest.media_assets              immutable evidence and derivatives
--   ingest.visual_observations       append-only measurements and readings
--   ingest.media_asset_variant_links staging relationship to a variant
--   merch.product_media (migration 4) the reviewed publication mapping
--
-- A pixel palette is not a product colour. A photographed room or a page
-- background can dominate it, so a pixel_measurement observation never writes
-- to a merch colour/finish/pattern column — only a reviewed human decision
-- does. Physical size is never derived from image scale.
--
-- Note on naming: api.* view names are unqualified and share one namespace, and
-- api.product_media already belongs to merch.product_media. The evidence table
-- is therefore media_assets, never product_media.

------------------------------------------------------------------------------
-- Media assets. Source originals and derived images are separate rows joined by
-- parent_media_asset_id, so a crop always retains its page and its page always
-- retains its document.
--
-- page_number and region are evidence locators, not product attributes.
------------------------------------------------------------------------------
create table if not exists ingest.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  parent_media_asset_id uuid references ingest.media_assets(id) on delete cascade,
  external_key text not null,
  asset_kind text not null
    check (asset_kind in ('source_pdf','standalone_image','pdf_page_render','product_crop',
                          'room_scene','swatch','technical_drawing','certificate_page','other')),
  storage_bucket text,
  object_path text,
  content_checksum text not null,
  mime_type text,
  size_bytes bigint,
  width_px int,
  height_px int,
  orientation text,
  page_number int,
  region jsonb,
  document_class text,
  brand_hint text,
  source_path text,
  source_web_url text,
  -- Rights are a separate gate from correctness: an image may be correctly
  -- matched and still not be ours to display.
  usage_rights_state text not null default 'unreviewed'
    check (usage_rights_state in ('unreviewed','accepted','restricted','denied')),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  pipeline_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_key),
  constraint media_assets_page_requires_parent
    check (asset_kind <> 'pdf_page_render' or page_number is not null)
);
create index if not exists media_assets_source_idx on ingest.media_assets (source_asset_id, asset_kind, page_number);
create index if not exists media_assets_parent_idx on ingest.media_assets (parent_media_asset_id);
create index if not exists media_assets_checksum_idx on ingest.media_assets (workspace_id, content_checksum);
create index if not exists media_assets_kind_idx on ingest.media_assets (workspace_id, asset_kind, review_state);

-- Identity is the document, the role, and the page - not the bytes.
--
-- Byte-identical pages are common and legitimate: a brochure series shares its
-- boilerplate pages, so page 5 of one catalogue can hash the same as page 5 of
-- its sibling. Each is still separate evidence with its own provenance, and
-- collapsing them would silently lose one document's page. The checksum stays
-- indexed (above) for dedup *reporting*, not for identity.
create unique index if not exists media_assets_identity_idx
  on ingest.media_assets (workspace_id, source_asset_id, asset_kind, coalesce(page_number, -1));

------------------------------------------------------------------------------
-- Visual observations — append-only.
--
-- observation_basis is the whole point of this table: it records HOW something
-- was learned, so a reproducible pixel statistic can never be mistaken for a
-- supplier-stated specification or a reviewed decision.
------------------------------------------------------------------------------
create table if not exists ingest.visual_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  media_asset_id uuid not null references ingest.media_assets(id) on delete cascade,
  external_key text not null,
  observation_scope text not null
    check (observation_scope in ('whole_page','whole_image','whole_product_sheet','region','product_region')),
  observation_type text not null,
  observation_basis text not null
    check (observation_basis in ('pixel_measurement','ocr_or_supplier_text',
                                 'machine_visual_classification','human_visual_review')),
  -- The corpus names its own bases more verbosely (e.g.
  -- "pixel_measurement_not_semantic_classification"). Keep the raw string so
  -- the mapping into the canonical four stays reversible.
  observation_basis_raw text,
  value jsonb not null default '{}'::jsonb,
  source_text_raw text,
  model_or_rule_version text,
  confidence numeric(5,4),
  page_number int,
  region jsonb,
  -- Machine-readable form of "never infer physical size from pixels". A true
  -- value is a hard validation failure, not a warning.
  physical_size_inferred_from_pixels boolean not null default false,
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','machine_visual_review_complete_human_approval_pending',
                            'needs_correction','approved','rejected','superseded')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, external_key),
  constraint visual_observations_no_pixel_dimensions
    check (physical_size_inferred_from_pixels = false),
  -- Only a human review may carry the approved state.
  constraint visual_observations_approval_needs_human
    check (review_state <> 'approved' or observation_basis = 'human_visual_review')
);
create index if not exists visual_observations_asset_idx on ingest.visual_observations (media_asset_id);
create index if not exists visual_observations_basis_idx on ingest.visual_observations (workspace_id, observation_basis, review_state);

create trigger visual_observations_append_only
  before update or delete on ingest.visual_observations
  for each row execute function ingest.reject_mutation();

------------------------------------------------------------------------------
-- Media-to-variant links — the staging relationship.
--
-- A same_source_document link is discovery context only. It must never become a
-- published product image without a tighter page/region or a human decision,
-- which the constraint below enforces rather than merely documents.
------------------------------------------------------------------------------
create table if not exists ingest.media_asset_variant_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  media_asset_id uuid not null references ingest.media_assets(id) on delete cascade,
  external_key text not null,
  variant_candidate_key text,
  variant_candidate_id uuid references ingest.variant_candidates(id) on delete cascade,
  product_variant_id uuid references merch.product_variants(id) on delete set null,
  source_code_raw text,
  link_basis text not null
    check (link_basis in ('exact_supplier_code','exact_ocr_code','same_catalog_page',
                          'same_source_document','manual_match')),
  -- Corpus rule names ("exact_normalized_ocr_code", "candidate_page_locator")
  -- are retained beside the canonical basis they map to.
  link_basis_raw text,
  source_region jsonb,
  page_number int,
  confidence numeric(5,4),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review','needs_correction','approved','rejected','superseded')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_key),
  constraint media_links_same_document_never_approved
    check (review_state <> 'approved' or link_basis <> 'same_source_document'),
  constraint media_links_approved_needs_variant
    check (review_state <> 'approved' or product_variant_id is not null)
);
create index if not exists media_links_asset_idx on ingest.media_asset_variant_links (media_asset_id);
create index if not exists media_links_candidate_idx on ingest.media_asset_variant_links (workspace_id, variant_candidate_key);
create index if not exists media_links_state_idx on ingest.media_asset_variant_links (workspace_id, review_state, link_basis);

------------------------------------------------------------------------------
-- Contact sheets — the review aid used to inspect standalone supplier images in
-- batches. Kept as first-class rows so a semantic observation can cite the
-- exact sheet and cell a reviewer looked at.
------------------------------------------------------------------------------
create table if not exists ingest.contact_sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  sheet_key text not null,
  storage_bucket text,
  object_path text,
  content_checksum text,
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sheet_key)
);

create table if not exists ingest.contact_sheet_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  contact_sheet_id uuid not null references ingest.contact_sheets(id) on delete cascade,
  media_asset_id uuid not null references ingest.media_assets(id) on delete cascade,
  label text not null,
  source_path text,
  created_at timestamptz not null default now(),
  unique (contact_sheet_id, label)
);

------------------------------------------------------------------------------
-- RLS, grants, api views.
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'media_assets','visual_observations','media_asset_variant_links',
    'contact_sheets','contact_sheet_items'
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
  foreach t in array array['media_assets','media_asset_variant_links','contact_sheets']
  loop
    execute format('create trigger set_updated_at before update on ingest.%I for each row execute function core.set_updated_at()', t);
  end loop;
end $$;
