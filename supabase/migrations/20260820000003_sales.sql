-- Sales lifecycle: intake, leads, opportunities, stage events, activities,
-- tasks, visits, quotes, purchases, payments, external document links.

create table sales.intake_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  source_channel text not null check (source_channel in ('tiktok','meta','website','whatsapp','dm','call','email','referral','walk_in','other')),
  provider text,
  external_id text,
  idempotency_key text not null,
  received_at timestamptz not null default now(),
  occurred_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  raw_text text,
  status text not null default 'received' check (status in ('received','processed','duplicate','failed')),
  lead_id uuid,
  created_by uuid references auth.users(id),
  unique (workspace_id, idempotency_key)
);
create index intake_events_ws_time_idx on sales.intake_events (workspace_id, received_at desc);

create table sales.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  status text not null default 'new' check (status in ('new','contact_attempted','contacted','qualified','disqualified','converted','duplicate')),
  source_channel text not null check (source_channel in ('tiktok','meta','website','whatsapp','dm','call','email','referral','walk_in','other')),
  source_detail text,                      -- campaign/form/page/referrer name
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  raw_name text,
  raw_phone text,
  raw_phone_normalized text,
  raw_email text,
  raw_company text,
  interest text,
  product_interest text[] not null default '{}',
  location_id uuid references core.business_locations(id),
  owner_id uuid references auth.users(id),
  assigned_at timestamptz,
  first_response_due_at timestamptz,
  first_response_at timestamptz,
  contact_attempts int not null default 0,
  qualified_at timestamptz,
  disqualified_reason text,
  converted_opportunity_id uuid,
  duplicate_of_lead_id uuid references sales.leads(id),
  notes text,
  version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_ws_status_idx on sales.leads (workspace_id, status, created_at desc);
create index leads_owner_idx on sales.leads (owner_id) where status not in ('converted','disqualified','duplicate');
create index leads_phone_idx on sales.leads (workspace_id, raw_phone_normalized);
create index leads_contact_idx on sales.leads (contact_id);

alter table sales.intake_events add constraint intake_events_lead_fk foreign key (lead_id) references sales.leads(id) on delete set null;

create table sales.lead_intake_links (
  lead_id uuid not null references sales.leads(id) on delete cascade,
  intake_event_id uuid not null references sales.intake_events(id) on delete cascade,
  primary key (lead_id, intake_event_id)
);

create table sales.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  name text not null,
  account_id uuid references identity.accounts(id) on delete set null,
  contact_id uuid references identity.contacts(id) on delete set null,
  project_id uuid references identity.projects(id) on delete set null,
  lead_id uuid references sales.leads(id) on delete set null,
  stage_key text not null,
  status text not null default 'open' check (status in ('open','won','lost','deferred')),
  owner_id uuid references auth.users(id),
  source_channel text,
  estimated_value numeric(14,2),
  currency char(3) not null default 'MYR',
  probability_band text check (probability_band in ('low','medium','high')),
  expected_close_date date,
  next_action text,
  next_action_due_at timestamptz,
  product_interest text[] not null default '{}',
  won_at timestamptz,
  lost_at timestamptz,
  deferred_until date,
  outcome_reason text,
  competitor text,
  notes text,
  version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunities_ws_stage_idx on sales.opportunities (workspace_id, status, stage_key);
create index opportunities_owner_idx on sales.opportunities (owner_id, next_action_due_at) where status = 'open';
create index opportunities_account_idx on sales.opportunities (account_id);
create index opportunities_contact_idx on sales.opportunities (contact_id);
create index opportunities_project_idx on sales.opportunities (project_id);

alter table sales.leads add constraint leads_converted_opportunity_fk foreign key (converted_opportunity_id) references sales.opportunities(id) on delete set null;

create table sales.opportunity_stage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  opportunity_id uuid not null references sales.opportunities(id) on delete cascade,
  from_stage_key text,
  to_stage_key text not null,
  is_backward boolean not null default false,
  reason text,
  actor_id uuid references auth.users(id),
  occurred_at timestamptz not null default now()
);
create index stage_events_opp_idx on sales.opportunity_stage_events (opportunity_id, occurred_at desc);

create table sales.visits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  location_id uuid references core.business_locations(id),
  staff_user_id uuid references auth.users(id),
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  lead_id uuid references sales.leads(id) on delete set null,
  opportunity_id uuid references sales.opportunities(id) on delete set null,
  customer_type text,
  origin_area text,
  inquiry_source text,                   -- where the customer heard of us
  purpose text check (purpose in ('browse','consultation','sample','purchase','collection','follow_up','other')),
  is_new_customer boolean,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_ws_time_idx on sales.visits (workspace_id, occurred_at desc);
create index visits_contact_idx on sales.visits (contact_id);

create table sales.activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  kind text not null check (kind in ('call','message','email','meeting','walk_in','note','sample','site_visit','task_outcome','stage_change','system')),
  channel text,
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id),
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  project_id uuid references identity.projects(id) on delete set null,
  opportunity_id uuid references sales.opportunities(id) on delete set null,
  lead_id uuid references sales.leads(id) on delete set null,
  visit_id uuid references sales.visits(id) on delete set null,
  purchase_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activities_contact_idx on sales.activities (contact_id, occurred_at desc);
create index activities_account_idx on sales.activities (account_id, occurred_at desc);
create index activities_opp_idx on sales.activities (opportunity_id, occurred_at desc);
create index activities_lead_idx on sales.activities (lead_id, occurred_at desc);
create index activities_ws_time_idx on sales.activities (workspace_id, occurred_at desc);

create table sales.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at timestamptz,
  assignee_id uuid references auth.users(id),
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  project_id uuid references identity.projects(id) on delete set null,
  opportunity_id uuid references sales.opportunities(id) on delete set null,
  lead_id uuid references sales.leads(id) on delete set null,
  completed_at timestamptz,
  outcome text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_assignee_idx on sales.tasks (assignee_id, due_at) where status = 'open';
create index tasks_ws_idx on sales.tasks (workspace_id, status, due_at);

create table sales.quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  opportunity_id uuid not null references sales.opportunities(id) on delete cascade,
  quote_number text,
  status text not null default 'draft' check (status in ('draft','issued','revised','accepted','rejected','expired')),
  current_version_no int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_opp_idx on sales.quotes (opportunity_id);

create table sales.quote_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  quote_id uuid not null references sales.quotes(id) on delete cascade,
  version_no int not null,
  issued_at timestamptz,
  valid_until date,
  total_amount numeric(14,2),
  currency char(3) not null default 'MYR',
  external_ref text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (quote_id, version_no)
);

create table sales.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_version_id uuid not null references sales.quote_versions(id) on delete cascade,
  product_variant_id uuid,
  description text not null,
  quantity numeric(14,3) not null default 1,
  unit text,
  unit_price numeric(14,2),
  currency char(3) not null default 'MYR',
  line_total numeric(14,2),
  price_snapshot jsonb,                 -- frozen price evidence at issue time
  position int not null default 0
);
create index quote_items_version_idx on sales.quote_items (quote_version_id);

create table sales.purchases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  contact_id uuid references identity.contacts(id) on delete set null,
  account_id uuid references identity.accounts(id) on delete set null,
  opportunity_id uuid references sales.opportunities(id) on delete set null,
  project_id uuid references identity.projects(id) on delete set null,
  visit_id uuid references sales.visits(id) on delete set null,
  purchased_at timestamptz not null default now(),
  external_ref text,                    -- ORC / SQL document number
  amount numeric(14,2) not null,
  currency char(3) not null default 'MYR',
  purchase_source text,                 -- walk_in | online | phone | project | other
  location_id uuid references core.business_locations(id),
  salesperson_id uuid references auth.users(id),
  is_repeat boolean not null default false,
  status text not null default 'recorded' check (status in ('recorded','corrected','voided')),
  notes text,
  recorded_by uuid references auth.users(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index purchases_contact_idx on sales.purchases (contact_id, purchased_at desc);
create index purchases_account_idx on sales.purchases (account_id, purchased_at desc);
create index purchases_ws_time_idx on sales.purchases (workspace_id, purchased_at desc);
create index purchases_ref_idx on sales.purchases (workspace_id, external_ref);

alter table sales.activities add constraint activities_purchase_fk foreign key (purchase_id) references sales.purchases(id) on delete set null;

create table sales.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references sales.purchases(id) on delete cascade,
  product_variant_id uuid,
  description text not null,
  quantity numeric(14,3) not null default 1,
  unit text,
  unit_price numeric(14,2),
  line_total numeric(14,2),
  price_snapshot jsonb,
  position int not null default 0
);
create index purchase_items_purchase_idx on sales.purchase_items (purchase_id);

create table sales.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references sales.purchases(id) on delete cascade,
  method text not null check (method in ('cash','card','bank_transfer','ewallet','cheque','credit_terms','other')),
  amount numeric(14,2) not null,
  currency char(3) not null default 'MYR',
  reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index purchase_payments_purchase_idx on sales.purchase_payments (purchase_id);

create table sales.external_document_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  object_type text not null,            -- opportunity | quote | purchase | contact | account
  object_id uuid not null,
  system text not null default 'sql_account',
  document_type text not null,          -- quotation | sales_order | invoice | delivery_order | orc | other
  document_number text not null,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index external_docs_object_idx on sales.external_document_links (object_type, object_id);

do $$
declare t text;
begin
  foreach t in array array['leads','opportunities','visits','tasks','quotes','purchases']
  loop
    execute format('create trigger set_updated_at before update on sales.%I for each row execute function core.set_updated_at()', t);
  end loop;
  foreach t in array array['leads','opportunities','opportunity_stage_events','visits','tasks','quotes','quote_versions','purchases','purchase_payments','external_document_links']
  loop
    execute format('create trigger audit_row_change after insert or update or delete on sales.%I for each row execute function audit.log_row_change()', t);
  end loop;
end $$;
