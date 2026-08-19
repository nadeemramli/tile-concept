-- Later-phase entity groups (PRD §10.2). Schema is created now so Phase 2–5
-- modules have a home; UI for these is placeholder-only in the first slice.

------------------------------------------------------------------------------
-- Marketing coordination and shoot scheduling
------------------------------------------------------------------------------

create table marketing.content_opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id uuid not null references identity.projects(id) on delete cascade,
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  opportunity_id uuid references sales.opportunities(id) on delete set null,
  purchase_id uuid references sales.purchases(id) on delete set null,
  nominated_by uuid references auth.users(id),
  customer_owner_id uuid references auth.users(id),
  marketing_owner_id uuid references auth.users(id),
  status text not null default 'nominated' check (status in ('nominated','under_review','needs_info','accepted','deferred','declined','scheduled','completed','cancelled')),
  story_angle text,
  nomination_reason text,
  content_types text[] not null default '{}',   -- before_after | walkthrough | testimonial | process | short_form | showcase
  readiness_state text not null default 'in_progress' check (readiness_state in ('in_progress','substantially_complete','ready','delayed','inaccessible','completed')),
  target_window_start date,
  target_window_end date,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  products_used text[] not null default '{}',
  special_requirements text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_opps_ws_status_idx on marketing.content_opportunities (workspace_id, status);

create table marketing.content_opportunity_status_events (
  id uuid primary key default gen_random_uuid(),
  content_opportunity_id uuid not null references marketing.content_opportunities(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  actor_id uuid references auth.users(id),
  occurred_at timestamptz not null default now()
);

create table marketing.media_permission_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  content_opportunity_id uuid references marketing.content_opportunities(id) on delete cascade,
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  status text not null default 'not_requested' check (status in ('not_requested','requested','verbal_pending_written','approved','approved_with_restrictions','declined','revoked','expired')),
  granted_by_name text,
  granted_at timestamptz,
  permitted_capture text[] not null default '{}',
  permitted_uses text[] not null default '{}',
  restrictions text,
  expires_at date,
  evidence_storage_path text,
  revoked_at timestamptz,
  revocation_reason text,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing.shoot_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  content_opportunity_id uuid not null references marketing.content_opportunities(id) on delete cascade,
  proposed_windows jsonb not null default '[]'::jsonb,   -- [{start, end, note}]
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table marketing.shoot_bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  content_opportunity_id uuid not null references marketing.content_opportunities(id) on delete cascade,
  status text not null default 'tentative' check (status in ('proposed','tentative','standby','customer_confirmation_pending','confirmed','completed','partially_completed','postponed','cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  all_day boolean not null default false,
  coordinator_id uuid references auth.users(id),
  outcome text,
  outcome_reason text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index shoot_bookings_time_idx on marketing.shoot_bookings (workspace_id, starts_at);

create table marketing.shoot_booking_status_events (
  id uuid primary key default gen_random_uuid(),
  shoot_booking_id uuid not null references marketing.shoot_bookings(id) on delete cascade,
  from_status text,
  to_status text not null,
  previous_starts_at timestamptz,
  previous_ends_at timestamptz,
  reason text,
  actor_id uuid references auth.users(id),
  occurred_at timestamptz not null default now()
);

create table marketing.shoot_participants (
  id uuid primary key default gen_random_uuid(),
  shoot_booking_id uuid not null references marketing.shoot_bookings(id) on delete cascade,
  user_id uuid references auth.users(id),
  external_name text,
  role text not null default 'crew' check (role in ('coordinator','crew','standby','interviewer','salesperson','customer')),
  status text not null default 'assigned' check (status in ('assigned','accepted','declined','standby')),
  created_at timestamptz not null default now()
);

create table marketing.shoot_locations (
  id uuid primary key default gen_random_uuid(),
  shoot_booking_id uuid not null references marketing.shoot_bookings(id) on delete cascade,
  project_site_id uuid references identity.project_sites(id) on delete set null,
  sequence int not null default 1,
  travel_buffer_minutes int not null default 0,
  address jsonb not null default '{}'::jsonb,
  notes text
);

create table marketing.shoot_checklists (
  id uuid primary key default gen_random_uuid(),
  shoot_booking_id uuid not null references marketing.shoot_bookings(id) on delete cascade,
  item text not null,
  is_done boolean not null default false,
  done_by uuid references auth.users(id),
  done_at timestamptz
);

create table marketing.shoot_outputs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  shoot_booking_id uuid references marketing.shoot_bookings(id) on delete set null,
  content_opportunity_id uuid references marketing.content_opportunities(id) on delete cascade,
  kind text not null check (kind in ('photo','video','interview_notes','other')),
  storage_path text,
  state text not null default 'uploaded' check (state in ('uploaded','reviewing','usable','restricted','rejected','archived','permission_review_required')),
  captured_at timestamptz,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table marketing.content_asset_reviews (
  id uuid primary key default gen_random_uuid(),
  shoot_output_id uuid not null references marketing.shoot_outputs(id) on delete cascade,
  reviewer_id uuid references auth.users(id),
  decision text not null check (decision in ('usable','restricted','rejected')),
  reason text,
  reviewed_at timestamptz not null default now()
);

create table marketing.external_calendar_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  shoot_booking_id uuid not null references marketing.shoot_bookings(id) on delete cascade,
  provider text not null,
  calendar_id text,
  event_id text,
  sync_direction text not null default 'push',
  last_synced_at timestamptz,
  conflict_state text,
  created_at timestamptz not null default now()
);

------------------------------------------------------------------------------
-- Stock and availability
------------------------------------------------------------------------------

create table stock.inventory_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  key text not null,
  name text not null,
  kind text not null check (kind in ('sql_account','supplier','manual','other')),
  is_authoritative boolean not null default false,
  freshness_sla_minutes int,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);

create table stock.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_id uuid not null references stock.inventory_sources(id) on delete cascade,
  external_code text,
  name text not null,
  business_location_id uuid references core.business_locations(id),
  created_at timestamptz not null default now()
);

create table stock.inventory_item_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_id uuid not null references stock.inventory_sources(id) on delete cascade,
  external_item_code text not null,
  variant_id uuid references merch.product_variants(id) on delete set null,
  unit_id uuid references merch.units_of_measure(id),
  status text not null default 'unmapped' check (status in ('unmapped','mapped','ignored')),
  created_at timestamptz not null default now(),
  unique (source_id, external_item_code)
);

create table stock.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_id uuid not null references stock.inventory_sources(id) on delete cascade,
  location_id uuid references stock.inventory_locations(id) on delete set null,
  variant_id uuid references merch.product_variants(id) on delete set null,
  external_item_code text,
  on_hand numeric(14,3),
  allocated numeric(14,3),
  available numeric(14,3),
  unit_id uuid references merch.units_of_measure(id),
  source_timestamp timestamptz,
  checkpoint text,
  captured_at timestamptz not null default now()
);
create index inventory_snapshots_variant_idx on stock.inventory_snapshots (variant_id, captured_at desc);

create table stock.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_id uuid not null references stock.inventory_sources(id) on delete cascade,
  variant_id uuid references merch.product_variants(id) on delete set null,
  location_id uuid references stock.inventory_locations(id),
  quantity numeric(14,3) not null,
  unit_id uuid references merch.units_of_measure(id),
  movement_type text not null,
  reference text,
  occurred_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id)
);

create table stock.supplier_availability_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  supplier_id uuid not null references merch.suppliers(id) on delete cascade,
  variant_id uuid references merch.product_variants(id) on delete set null,
  product_id uuid references merch.products(id) on delete set null,
  availability text not null check (availability in ('available','low','out','made_to_order','ask_supplier','unknown')),
  quantity numeric(14,3),
  unit_id uuid references merch.units_of_measure(id),
  expected_replenishment date,
  source_channel text,              -- call | whatsapp | email | portal | visit
  evidence_storage_path text,
  submitted_by uuid references auth.users(id),
  captured_at timestamptz not null default now(),
  notes text
);
create index supplier_avail_variant_idx on stock.supplier_availability_snapshots (variant_id, captured_at desc);

create table stock.stock_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  variant_id uuid references merch.product_variants(id) on delete set null,
  source_id uuid references stock.inventory_sources(id),
  expected numeric(14,3),
  observed numeric(14,3),
  status text not null default 'open' check (status in ('open','investigating','resolved','accepted')),
  notes text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table stock.stock_freshness_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  supplier_id uuid references merch.suppliers(id) on delete cascade,
  source_id uuid references stock.inventory_sources(id) on delete cascade,
  fresh_hours int not null default 72,
  aging_hours int not null default 168,
  created_at timestamptz not null default now()
);

------------------------------------------------------------------------------
-- Ingestion and governance
------------------------------------------------------------------------------

create table ingest.source_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('pdf','image','excel','csv','url','manual')),
  supplier_id uuid references merch.suppliers(id) on delete set null,
  brand_id uuid references merch.brands(id) on delete set null,
  storage_bucket text,
  storage_path text,
  url text,
  checksum text,
  mime_type text,
  size_bytes bigint,
  page_count int,
  received_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id),
  status text not null default 'uploaded' check (status in ('uploaded','processing','processed','failed','archived')),
  created_at timestamptz not null default now()
);
create index source_assets_checksum_idx on ingest.source_assets (workspace_id, checksum);

create table ingest.source_asset_versions (
  id uuid primary key default gen_random_uuid(),
  source_asset_id uuid not null references ingest.source_assets(id) on delete cascade,
  version_no int not null,
  checksum text not null,
  storage_path text,
  created_at timestamptz not null default now(),
  unique (source_asset_id, version_no)
);

create table ingest.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_asset_id uuid references ingest.source_assets(id) on delete cascade,
  job_type text not null,           -- parse_pdf | ocr | parse_sheet | web_capture | walkin_import
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','dead_letter')),
  parser_version text,
  attempts int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table ingest.ingestion_records (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ingest.ingestion_jobs(id) on delete cascade,
  row_no int,
  page_no int,
  raw jsonb not null default '{}'::jsonb,
  normalized jsonb,
  confidence numeric(4,3),
  status text not null default 'pending' check (status in ('pending','valid','duplicate','rejected','published')),
  issues jsonb not null default '[]'::jsonb
);
create index ingestion_records_job_idx on ingest.ingestion_records (job_id);

create table ingest.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references ingest.ingestion_records(id) on delete cascade,
  field_key text not null,
  value text,
  confidence numeric(4,3),
  region jsonb,
  source_text text
);

create table ingest.review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  job_id uuid references ingest.ingestion_jobs(id) on delete cascade,
  record_id uuid references ingest.ingestion_records(id) on delete cascade,
  item_type text not null,          -- product | price | stock | walkin_row | identity
  proposed jsonb not null default '{}'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','corrected','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index review_items_pending_idx on ingest.review_items (workspace_id, status) where status = 'pending';

create table ingest.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  provider text not null,           -- meta | tiktok | website | sql_account | google_drive | supplier_web | calendar
  name text not null,
  environment text not null default 'demo' check (environment in ('demo','shadow','live')),
  direction text not null default 'pull' check (direction in ('pull','push','webhook','bidirectional')),
  status text not null default 'not_configured' check (status in ('not_configured','paused','healthy','degraded','failed')),
  owner_id uuid references auth.users(id),
  credential_ref text,              -- reference to secret manager entry, never the secret
  scopes text[] not null default '{}',
  business_purpose text,
  config jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ingest.connector_checkpoints (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references ingest.integration_connections(id) on delete cascade,
  stream text not null,
  cursor text,
  updated_at timestamptz not null default now(),
  unique (connection_id, stream)
);

create table ingest.sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references ingest.integration_connections(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','failed','partial')),
  records_read int not null default 0,
  records_created int not null default 0,
  records_updated int not null default 0,
  records_rejected int not null default 0,
  error text
);

create table ingest.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  issue_type text not null,         -- duplicate_contact | unmapped_field | unknown_unit | overlapping_price | stale_snapshot | sql_mismatch | failed_webhook | ocr_low_confidence
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  object_type text,
  object_id uuid,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
  assigned_to uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index dq_issues_open_idx on ingest.data_quality_issues (workspace_id, status, severity);

-- FK back-references from merch to ingest now that source_assets exists.
alter table merch.products add constraint products_source_asset_fk foreign key (source_asset_id) references ingest.source_assets(id) on delete set null;
alter table merch.variant_prices add constraint variant_prices_source_asset_fk foreign key (source_asset_id) references ingest.source_assets(id) on delete set null;
alter table merch.catalog_entries add constraint catalog_entries_source_asset_fk foreign key (source_asset_id) references ingest.source_assets(id) on delete set null;
