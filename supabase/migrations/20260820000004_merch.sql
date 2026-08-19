-- Merchandise & pricing: suppliers, brands, categories, attribute definitions,
-- products, variants, aliases, units, packaging, effective-dated prices, media.

create table merch.suppliers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (core.normalize_text(name)) stored,
  contact jsonb not null default '{}'::jsonb,
  website text,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, normalized_name)
);

create table merch.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (core.normalize_text(name)) stored,
  supplier_id uuid references merch.suppliers(id) on delete set null,
  is_house_brand boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, normalized_name)
);

create table merch.product_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  key text not null,
  label text not null,
  parent_id uuid references merch.product_categories(id) on delete set null,
  position int not null default 0,
  is_active boolean not null default true,
  unique (workspace_id, key)
);

create table merch.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  code text not null,               -- pc, sheet, ctn, m, sqm, set, roll, kg
  label text not null,
  kind text not null default 'count' check (kind in ('count','length','area','volume','mass','pack')),
  unique (workspace_id, code)
);

create table merch.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  from_unit_id uuid not null references merch.units_of_measure(id),
  to_unit_id uuid not null references merch.units_of_measure(id),
  factor numeric(18,6) not null,
  context_variant_id uuid,          -- null = generic conversion; set = variant-specific (e.g. sqm per carton)
  version int not null default 1,
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);

create table merch.attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  key text not null,
  label text not null,
  data_type text not null check (data_type in ('text','number','boolean','enum','dimension')),
  unit text,
  options jsonb,                    -- enum options
  description text,
  unique (workspace_id, key)
);

create table merch.category_attribute_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  category_id uuid not null references merch.product_categories(id) on delete cascade,
  attribute_definition_id uuid not null references merch.attribute_definitions(id) on delete cascade,
  is_required boolean not null default false,
  position int not null default 0,
  version int not null default 1,
  unique (category_id, attribute_definition_id)
);

create table merch.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  brand_id uuid references merch.brands(id) on delete set null,
  supplier_id uuid references merch.suppliers(id) on delete set null,
  category_id uuid references merch.product_categories(id) on delete set null,
  name text not null,
  normalized_name text generated always as (core.normalize_text(name)) stored,
  code text,
  code_key text generated always as (core.normalize_key(code)) stored,
  family text,
  description text,
  color text,
  finish text,
  material text,
  style text,
  applicable_use text,
  search_keywords text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','active','discontinued','archived')),
  review_state text not null default 'unreviewed' check (review_state in ('unreviewed','reviewed','conflicted')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  source_ref text,                  -- document / page / URL evidence summary
  source_asset_id uuid,
  confidence numeric(4,3),
  version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_ws_status_idx on merch.products (workspace_id, status);
create index products_code_idx on merch.products (workspace_id, code_key);
create index products_name_trgm_idx on merch.products using gin (normalized_name extensions.gin_trgm_ops);
create index products_brand_idx on merch.products (brand_id);
create index products_category_idx on merch.products (category_id);

create table merch.product_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  product_id uuid not null references merch.products(id) on delete cascade,
  sku text,
  sku_key text generated always as (core.normalize_key(sku)) stored,
  name text,
  dimensions jsonb not null default '{}'::jsonb,   -- {width_mm, length_mm, thickness_mm, ...}
  selling_unit_id uuid references merch.units_of_measure(id),
  purchase_unit_id uuid references merch.units_of_measure(id),
  status text not null default 'active' check (status in ('active','discontinued','archived')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index variants_product_idx on merch.product_variants (product_id);
create index variants_sku_idx on merch.product_variants (workspace_id, sku_key);

alter table merch.unit_conversions add constraint unit_conversions_variant_fk foreign key (context_variant_id) references merch.product_variants(id) on delete cascade;

create table merch.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  product_id uuid not null references merch.products(id) on delete cascade,
  variant_id uuid references merch.product_variants(id) on delete cascade,
  attribute_definition_id uuid not null references merch.attribute_definitions(id) on delete cascade,
  value jsonb not null,
  source_ref text,
  confidence numeric(4,3),
  created_at timestamptz not null default now(),
  unique (product_id, variant_id, attribute_definition_id)
);
create index pav_product_idx on merch.product_attribute_values (product_id);

create table merch.product_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  product_id uuid not null references merch.products(id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (core.normalize_text(alias)) stored,
  alias_key text generated always as (core.normalize_key(alias)) stored,
  source text,
  created_at timestamptz not null default now()
);
create index product_aliases_idx on merch.product_aliases (workspace_id, alias_key);

create table merch.packaging_configurations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  variant_id uuid not null references merch.product_variants(id) on delete cascade,
  pack_unit_id uuid references merch.units_of_measure(id),
  pack_label text,                              -- carton, box, pallet
  quantity_per_pack numeric(14,3),
  inner_unit_id uuid references merch.units_of_measure(id),
  coverage_per_pack numeric(14,4),              -- e.g. sqm per carton
  coverage_unit_id uuid references merch.units_of_measure(id),
  moq numeric(14,3),
  order_increment numeric(14,3),
  created_at timestamptz not null default now()
);
create index packaging_variant_idx on merch.packaging_configurations (variant_id);

create table merch.price_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  owner_id uuid references auth.users(id),
  supplier_id uuid references merch.suppliers(id) on delete set null,
  brand_id uuid references merch.brands(id) on delete set null,
  category_id uuid references merch.product_categories(id) on delete set null,
  currency char(3) not null default 'MYR',
  market text default 'MY',
  price_type text not null default 'retail' check (price_type in ('retail','member','project','contract','cost','other')),
  tax_inclusive boolean not null default false,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  source_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index price_lists_ws_idx on merch.price_lists (workspace_id, status);

create table merch.variant_prices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  price_list_id uuid not null references merch.price_lists(id) on delete cascade,
  variant_id uuid not null references merch.product_variants(id) on delete cascade,
  amount numeric(14,2) not null,
  currency char(3) not null default 'MYR',
  unit_id uuid references merch.units_of_measure(id),   -- price basis: piece, sheet, carton, m, sqm
  min_quantity numeric(14,3) not null default 1,
  valid_from date not null default current_date,
  valid_to date,
  state text not null default 'draft' check (state in ('draft','scheduled','current','superseded','expired','conflicted')),
  review_state text not null default 'unreviewed' check (review_state in ('unreviewed','reviewed','rejected')),
  source_asset_id uuid,
  source_ref text,                       -- page/row/cell or URL
  imported_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index variant_prices_variant_idx on merch.variant_prices (variant_id, state, valid_from desc);
create index variant_prices_list_idx on merch.variant_prices (price_list_id);
-- One current price per exact scope (list + variant + unit + min qty).
create unique index variant_prices_one_current_idx on merch.variant_prices (price_list_id, variant_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), min_quantity) where state = 'current';

create table merch.price_approval_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  variant_price_id uuid not null references merch.variant_prices(id) on delete cascade,
  action text not null check (action in ('submitted','approved','rejected','superseded','expired','override')),
  actor_id uuid references auth.users(id),
  reason text,
  occurred_at timestamptz not null default now()
);
create index price_approval_events_price_idx on merch.price_approval_events (variant_price_id, occurred_at desc);

create table merch.catalog_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  product_id uuid not null references merch.products(id) on delete cascade,
  source_asset_id uuid,
  page_ref text,
  snippet text,
  region jsonb,                          -- page coordinates for reviewer comparison
  created_at timestamptz not null default now()
);
create index catalog_entries_product_idx on merch.catalog_entries (product_id);

create table merch.product_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  product_id uuid not null references merch.products(id) on delete cascade,
  variant_id uuid references merch.product_variants(id) on delete cascade,
  storage_bucket text not null default 'product-media',
  storage_path text not null,
  kind text not null default 'image' check (kind in ('image','pdf','other')),
  caption text,
  source_ref text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index product_media_product_idx on merch.product_media (product_id);

do $$
declare t text;
begin
  foreach t in array array['suppliers','brands','products','product_variants','price_lists','variant_prices']
  loop
    execute format('create trigger set_updated_at before update on merch.%I for each row execute function core.set_updated_at()', t);
    execute format('create trigger audit_row_change after insert or update or delete on merch.%I for each row execute function audit.log_row_change()', t);
  end loop;
end $$;
