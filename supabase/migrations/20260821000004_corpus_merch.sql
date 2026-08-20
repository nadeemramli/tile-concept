-- Corpus migration 4/6 — durable merchandise hard schema.
--
-- Evolves the existing merch tables rather than creating parallel ones. Where
-- the Canonical Merchandise Schema v0.3 uses a different noun for the same
-- grain, the repo table keeps its name and gains the missing columns:
--
--   v0.3 product_family     == merch.products          (same grain, extended)
--   v0.3 product_variant    == merch.product_variants  (extended)
--   v0.3 catalog_item       == merch.catalog_entries   (extended)
--   v0.3 price_entry        == merch.variant_prices    (extended)
--   v0.3 attribute_value    == merch.product_attribute_values (extended)
--   v0.3 package_config     == merch.packaging_configurations (extended)
--   v0.3 product_media      == merch.product_media     (extended)
--
-- Genuinely new concepts: organizations and their dated roles, certificates and
-- their scopes, catalog editions, price-list versions, and product status
-- history. None of these existed in the repo or the PRD.

------------------------------------------------------------------------------
-- Organizations and dated roles.
--
-- A Drive folder called "White Horse" may name a brand, a manufacturer, a
-- supplier, or all three. Collapsing them into merch.suppliers loses that, so
-- the organization is the legal entity and organization_roles carries the dated
-- relationship. merch.suppliers is kept and linked, not replaced — every
-- existing supplier query keeps working.
------------------------------------------------------------------------------
create table if not exists merch.organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  canonical_name text not null,
  normalized_name text generated always as (core.normalize_text(canonical_name)) stored,
  registration_name text,
  country_code char(2),
  website text,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, normalized_name)
);

create table if not exists merch.organization_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  organization_id uuid not null references merch.organizations(id) on delete cascade,
  role text not null
    check (role in ('manufacturer','supplier','distributor','importer','owner','certificate_holder','certifying_body')),
  brand_id uuid references merch.brands(id) on delete cascade,
  product_category_id uuid references merch.product_categories(id) on delete set null,
  scope_note text,
  valid_from date not null default current_date,
  valid_to date,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_roles_dates check (valid_to is null or valid_to >= valid_from)
);
create index if not exists organization_roles_org_idx on merch.organization_roles (organization_id, role);
create index if not exists organization_roles_brand_idx on merch.organization_roles (brand_id);

alter table merch.suppliers
  add column if not exists organization_id uuid references merch.organizations(id) on delete set null;
alter table merch.brands
  add column if not exists owner_organization_id uuid references merch.organizations(id) on delete set null,
  add column if not exists slug text,
  add column if not exists country_code char(2);

------------------------------------------------------------------------------
-- merch.products is the v0.3 product_family grain. Add the missing family
-- fields and source provenance.
------------------------------------------------------------------------------
alter table merch.products
  add column if not exists series_name text,
  add column if not exists material_code text,
  add column if not exists published_version int not null default 1,
  add column if not exists source_version_id uuid references ingest.source_asset_versions(id) on delete set null;

------------------------------------------------------------------------------
-- Variants: scoped supplier and manufacturer codes.
--
-- A supplier code is unique only within a brand or supplier context, never
-- globally, so the uniqueness index is scoped through the parent product.
------------------------------------------------------------------------------
alter table merch.product_variants
  add column if not exists supplier_code text,
  add column if not exists supplier_code_key text generated always as (core.normalize_key(supplier_code)) stored,
  add column if not exists manufacturer_code text,
  add column if not exists manufacturer_code_key text generated always as (core.normalize_key(manufacturer_code)) stored,
  add column if not exists color_code text,
  add column if not exists finish_code text,
  add column if not exists grade_code text,
  add column if not exists source_version_id uuid references ingest.source_asset_versions(id) on delete set null;

create index if not exists product_variants_supplier_code_idx
  on merch.product_variants (workspace_id, supplier_code_key) where supplier_code_key is not null;
create index if not exists product_variants_manufacturer_code_idx
  on merch.product_variants (workspace_id, manufacturer_code_key) where manufacturer_code_key is not null;

------------------------------------------------------------------------------
-- Product status history.
--
-- A supplier workbook that says "Phased out" is one dated observation, not a
-- licence to overwrite a lifecycle. The published product_variants.status is
-- derived from reviewed history.
------------------------------------------------------------------------------
create table if not exists merch.product_status_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  variant_id uuid not null references merch.product_variants(id) on delete cascade,
  status_code text check (status_code in ('active','discontinued','archived','unknown')),
  status_raw text,
  effective_from date,
  effective_to date,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  source_locator jsonb not null default '{}'::jsonb,
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  supersedes_id uuid references merch.product_status_history(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_status_history_dates check (effective_to is null or effective_to >= effective_from)
);
create index if not exists product_status_history_variant_idx on merch.product_status_history (variant_id, effective_from desc);

------------------------------------------------------------------------------
-- Catalog editions. merch.catalog_entries becomes the v0.3 catalog_item by
-- pointing at an edition and a source version.
------------------------------------------------------------------------------
create table if not exists merch.catalog_editions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  brand_id uuid references merch.brands(id) on delete set null,
  name text not null,
  edition_label text,
  publication_date date,
  valid_from date,
  valid_to date,
  market text,
  language text,
  source_asset_id uuid references ingest.source_assets(id) on delete set null,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','active','superseded','archived')),
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_editions_dates check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index if not exists catalog_editions_brand_idx on merch.catalog_editions (workspace_id, brand_id, status);

alter table merch.catalog_entries
  add column if not exists catalog_edition_id uuid references merch.catalog_editions(id) on delete cascade,
  add column if not exists variant_id uuid references merch.product_variants(id) on delete cascade,
  add column if not exists source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  add column if not exists display_order int,
  add column if not exists raw_catalog_label text;
create index if not exists catalog_entries_edition_idx on merch.catalog_entries (catalog_edition_id);

------------------------------------------------------------------------------
-- Price-list versions and price-entry semantics.
--
-- A price list declares intent; a version pins the issued document. Version
-- defaults are NULLABLE on purpose: a missing source semantic is a publication
-- blocker, never something to fill from convention.
------------------------------------------------------------------------------
create table if not exists merch.price_list_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  price_list_id uuid not null references merch.price_lists(id) on delete cascade,
  version_label text,
  effective_from date,
  effective_to date,
  issued_at timestamptz,
  source_asset_id uuid references ingest.source_assets(id) on delete set null,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  default_currency_code char(3),
  default_price_unit_id uuid references merch.units_of_measure(id) on delete set null,
  default_tax_basis text check (default_tax_basis in ('inclusive','exclusive','not_applicable','unknown')),
  default_price_type text,
  default_market text,
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  supersedes_version_id uuid references merch.price_list_versions(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_list_versions_dates check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index if not exists price_list_versions_list_idx on merch.price_list_versions (price_list_id, effective_from desc);

alter table merch.variant_prices
  add column if not exists price_list_version_id uuid references merch.price_list_versions(id) on delete set null,
  add column if not exists quantity_unit_id uuid references merch.units_of_measure(id) on delete set null,
  add column if not exists tax_basis text
    check (tax_basis in ('inclusive','exclusive','not_applicable','unknown')),
  add column if not exists price_type text,
  add column if not exists market text,
  add column if not exists customer_tier text,
  add column if not exists source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  add column if not exists source_page_or_row text;

-- Remove the silent currency fill. Every writer in the app already passes a
-- currency explicitly, so an omitted one should now fail loudly rather than
-- become MYR (Canonical Schema rule 4; PRD 7.6).
alter table merch.variant_prices alter column currency drop default;
alter table merch.price_lists alter column currency drop default;

create index if not exists variant_prices_version_idx on merch.variant_prices (price_list_version_id);

------------------------------------------------------------------------------
-- Certificates and their scopes.
--
-- New concept: nothing certificate-shaped existed in the repo. The scope is the
-- dangerous part — a certificate found in a brand folder does not certify every
-- SKU of that brand, so scope_type defaults to 'unknown' and publication is
-- blocked while it stays unknown (enforced in migration 6).
------------------------------------------------------------------------------
create table if not exists merch.certificates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  certificate_type text,
  certificate_number text,
  title text not null,
  issuing_organization_id uuid references merch.organizations(id) on delete set null,
  holder_organization_id uuid references merch.organizations(id) on delete set null,
  standard_code text,
  issued_on date,
  expires_on date,
  -- 'not_dated' and 'unknown' are distinct: a certificate that states no expiry
  -- is not the same as one whose expiry we failed to read.
  validity_state text not null default 'unknown'
    check (validity_state in ('valid','expiring','expired','not_dated','revoked','unknown')),
  source_asset_id uuid references ingest.source_assets(id) on delete set null,
  source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificates_dates check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists certificates_ws_idx on merch.certificates (workspace_id, validity_state, review_state);
create unique index if not exists certificates_number_idx
  on merch.certificates (workspace_id, core.normalize_key(certificate_number))
  where certificate_number is not null;

create table if not exists merch.certificate_scopes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  certificate_id uuid not null references merch.certificates(id) on delete cascade,
  scope_type text not null default 'unknown'
    check (scope_type in ('organization','brand','manufacturing_facility','category',
                          'product_family','product_variant','unknown')),
  organization_id uuid references merch.organizations(id) on delete set null,
  brand_id uuid references merch.brands(id) on delete set null,
  product_category_id uuid references merch.product_categories(id) on delete set null,
  product_id uuid references merch.products(id) on delete cascade,
  variant_id uuid references merch.product_variants(id) on delete cascade,
  facility_text text,
  scope_text_raw text,
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A reviewed scope must actually name its target; 'unknown' may not be
  -- reviewed into existence.
  constraint certificate_scopes_reviewed_is_resolved check (
    review_state <> 'reviewed' or (
      scope_type <> 'unknown' and (
        (scope_type = 'organization' and organization_id is not null) or
        (scope_type = 'brand' and brand_id is not null) or
        (scope_type = 'category' and product_category_id is not null) or
        (scope_type = 'product_family' and product_id is not null) or
        (scope_type = 'product_variant' and variant_id is not null) or
        (scope_type = 'manufacturing_facility' and facility_text is not null)
      )
    )
  )
);
create index if not exists certificate_scopes_cert_idx on merch.certificate_scopes (certificate_id, scope_type);

------------------------------------------------------------------------------
-- Product media becomes the reviewed publication mapping over an evidence
-- media_asset, with rights tracked separately from correctness.
------------------------------------------------------------------------------
alter table merch.product_media
  add column if not exists media_asset_id uuid references ingest.media_assets(id) on delete set null,
  add column if not exists media_asset_variant_link_id uuid references ingest.media_asset_variant_links(id) on delete set null,
  add column if not exists usage_rights_state text not null default 'unreviewed'
    check (usage_rights_state in ('unreviewed','accepted','restricted','denied')),
  add column if not exists review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  add column if not exists alt_text text,
  add column if not exists sort_order int not null default 0,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

-- Publication requires cleared rights and a completed review, in the database
-- rather than only in the function that writes it.
alter table merch.product_media drop constraint if exists product_media_publication_gate;
alter table merch.product_media add constraint product_media_publication_gate check (
  review_state <> 'reviewed' or usage_rights_state = 'accepted'
);

------------------------------------------------------------------------------
-- Source provenance and validity on the remaining published fact tables.
------------------------------------------------------------------------------
alter table merch.product_attribute_values
  add column if not exists source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  add column if not exists unit_id uuid references merch.units_of_measure(id) on delete set null,
  add column if not exists review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  add column if not exists valid_from date,
  add column if not exists valid_to date;

alter table merch.packaging_configurations
  add column if not exists source_version_id uuid references ingest.source_asset_versions(id) on delete set null,
  add column if not exists gross_weight_kg numeric(14,4),
  add column if not exists review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  add column if not exists effective_from date,
  add column if not exists effective_to date;

alter table merch.attribute_definitions
  add column if not exists schema_version int not null default 1,
  add column if not exists comparable boolean not null default false,
  add column if not exists status text not null default 'active'
    check (status in ('active','deprecated','draft'));

------------------------------------------------------------------------------
-- RLS, grants, api views for the new tables.
------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('organizations',          'catalog.read', 'catalog.write'),
      ('organization_roles',     'catalog.read', 'catalog.write'),
      ('product_status_history', 'catalog.read', 'catalog.write'),
      ('catalog_editions',       'catalog.read', 'catalog.write'),
      ('certificates',           'catalog.read', 'catalog.write'),
      ('certificate_scopes',     'catalog.read', 'catalog.write'),
      ('price_list_versions',    'price.read',   'price.publish')
    ) as v(table_name, read_perm, write_perm)
  loop
    execute format('alter table merch.%I enable row level security', r.table_name);
    execute format($p$create policy member_read on merch.%I for select to authenticated
      using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission(%L)))$p$,
      r.table_name, r.read_perm);
    execute format($p$create policy member_write on merch.%I for all to authenticated
      using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission(%L)))
      with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission(%L)))$p$,
      r.table_name, r.write_perm, r.write_perm);
    execute format('grant select, insert, update, delete on merch.%I to authenticated', r.table_name);
    execute format('grant all on merch.%I to service_role', r.table_name);
    execute format('create view api.%I with (security_invoker = true) as select * from merch.%I', r.table_name, r.table_name);
    execute format('grant select, insert, update, delete on api.%I to authenticated', r.table_name);
    execute format('grant all on api.%I to service_role', r.table_name);
    execute format('create trigger set_updated_at before update on merch.%I for each row execute function core.set_updated_at()', r.table_name);
  end loop;
end $$;

------------------------------------------------------------------------------
-- Recreate the api views whose column list was frozen by `select *` in
-- 20260820000006_rls_api.sql. Every table below only gained columns.
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','brands','products','product_variants','variant_prices',
    'price_lists','catalog_entries','product_media','product_attribute_values',
    'packaging_configurations','attribute_definitions'
  ]
  loop
    execute format('create or replace view api.%I with (security_invoker = true) as select * from merch.%I', t, t);
    execute format('grant select, insert, update, delete on api.%I to authenticated', t);
    execute format('grant all on api.%I to service_role', t);
  end loop;
end $$;
