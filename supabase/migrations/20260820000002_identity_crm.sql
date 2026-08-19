-- Identity & CRM: contacts, contact points, accounts, relationships,
-- external identities, match candidates, merge events, consent, projects.

create table identity.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  display_name text not null,
  normalized_name text generated always as (core.normalize_text(display_name)) stored,
  given_name text,
  family_name text,
  salutation text,
  customer_type text check (customer_type in ('homeowner','contractor','designer','developer','retailer','architect','other')),
  preferred_language text,
  lifecycle_state text not null default 'new' check (lifecycle_state in ('new','active','repeat','lapsed','reactivated')),
  original_acquisition_source text,
  original_acquisition_at timestamptz,
  notes text,
  is_provisional boolean not null default false,
  merged_into_contact_id uuid references identity.contacts(id),
  archived_at timestamptz,
  version int not null default 1,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_ws_name_idx on identity.contacts (workspace_id, normalized_name);
create index contacts_name_trgm_idx on identity.contacts using gin (normalized_name extensions.gin_trgm_ops);
create index contacts_active_idx on identity.contacts (workspace_id) where merged_into_contact_id is null and archived_at is null;

create table identity.contact_points (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  contact_id uuid not null references identity.contacts(id) on delete cascade,
  kind text not null check (kind in ('phone','whatsapp','email','other')),
  raw_value text not null,
  normalized_value text not null,
  hash_key text generated always as (core.hash_key(normalized_value)) stored,
  label text,
  is_primary boolean not null default false,
  is_shared boolean not null default false, -- company/shared number: weaker identity signal
  verified_at timestamptz,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_points_lookup_idx on identity.contact_points (workspace_id, kind, normalized_value);
create index contact_points_hash_idx on identity.contact_points (workspace_id, hash_key);
create index contact_points_contact_idx on identity.contact_points (contact_id);

create table identity.accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (core.normalize_text(name)) stored,
  account_type text check (account_type in ('contractor','developer','designer','retailer','corporate','government','other')),
  registration_number text,
  registration_number_key text generated always as (core.normalize_key(registration_number)) stored,
  website text,
  domain text,
  address jsonb not null default '{}'::jsonb,
  owner_id uuid references auth.users(id),
  lifecycle_state text not null default 'new' check (lifecycle_state in ('new','active','repeat','lapsed','reactivated')),
  original_acquisition_source text,
  original_acquisition_at timestamptz,
  notes text,
  merged_into_account_id uuid references identity.accounts(id),
  archived_at timestamptz,
  version int not null default 1,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_ws_name_idx on identity.accounts (workspace_id, normalized_name);
create index accounts_name_trgm_idx on identity.accounts using gin (normalized_name extensions.gin_trgm_ops);
create index accounts_reg_idx on identity.accounts (workspace_id, registration_number_key) where registration_number_key is not null;

create table identity.account_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  account_id uuid not null references identity.accounts(id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (core.normalize_text(alias)) stored,
  source text,
  created_at timestamptz not null default now()
);
create index account_aliases_idx on identity.account_aliases (workspace_id, normalized_alias);

create table identity.account_contact_relationships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  account_id uuid not null references identity.accounts(id) on delete cascade,
  contact_id uuid not null references identity.contacts(id) on delete cascade,
  role text,
  is_primary boolean not null default false,
  started_at date,
  ended_at date,
  created_at timestamptz not null default now(),
  unique (account_id, contact_id)
);
create index acr_contact_idx on identity.account_contact_relationships (contact_id);

create table identity.external_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  provider text not null,          -- meta | tiktok | website | sql_account | whatsapp | other
  external_id text not null,
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);

create table identity.identity_match_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  subject_type text not null check (subject_type in ('contact','account')),
  subject_id uuid not null,
  candidate_id uuid not null,
  score numeric(5,2) not null default 0,
  confidence text not null default 'low' check (confidence in ('high','medium','low')),
  reasons jsonb not null default '[]'::jsonb,      -- [{code, field, subject_value, candidate_value}]
  status text not null default 'suggested' check (status in ('suggested','confirmed','rejected','superseded')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (workspace_id, subject_type, subject_id, candidate_id)
);
create index match_candidates_open_idx on identity.identity_match_candidates (workspace_id, status) where status = 'suggested';

create table identity.identity_merge_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('contact','account')),
  survivor_id uuid not null,
  merged_id uuid not null,
  actor_id uuid references auth.users(id),
  reason text not null,
  before_snapshot jsonb not null,
  relinked jsonb not null default '{}'::jsonb,     -- counts of moved child rows per table
  occurred_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text
);
create index merge_events_merged_idx on identity.identity_merge_events (entity_type, merged_id);

create table identity.consent_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  contact_id uuid not null references identity.contacts(id) on delete cascade,
  channel text not null,            -- whatsapp | email | sms | phone | marketing
  purpose text not null,
  status text not null check (status in ('granted','declined','withdrawn','unknown')),
  evidence text,
  notice_version text,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index consent_contact_idx on identity.consent_records (contact_id);

create table identity.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  account_id uuid references identity.accounts(id) on delete set null,
  primary_contact_id uuid references identity.contacts(id) on delete set null,
  project_type text check (project_type in ('residential','commercial','renovation','new_build','hospitality','other')),
  status text not null default 'planning' check (status in ('planning','active','completed','on_hold','cancelled')),
  area text,                        -- origin / project area (e.g. Cheras, Puchong)
  owner_id uuid references auth.users(id),
  expected_start date,
  expected_completion date,
  notes text,
  version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_ws_idx on identity.projects (workspace_id, status);
create index projects_account_idx on identity.projects (account_id);
create index projects_contact_idx on identity.projects (primary_contact_id);

create table identity.project_sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  project_id uuid not null references identity.projects(id) on delete cascade,
  label text not null default 'Main site',
  address jsonb not null default '{}'::jsonb,
  access_notes text,
  created_at timestamptz not null default now()
);
create index project_sites_project_idx on identity.project_sites (project_id);

do $$
declare t text;
begin
  foreach t in array array['contacts','contact_points','accounts','projects']
  loop
    execute format('create trigger set_updated_at before update on identity.%I for each row execute function core.set_updated_at()', t);
    execute format('create trigger audit_row_change after insert or update or delete on identity.%I for each row execute function audit.log_row_change()', t);
  end loop;
  foreach t in array array['identity_match_candidates','identity_merge_events','consent_records','account_contact_relationships']
  loop
    execute format('create trigger audit_row_change after insert or update or delete on identity.%I for each row execute function audit.log_row_change()', t);
  end loop;
end $$;
