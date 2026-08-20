-- Phase 3 — Lead connectors and response operations (PRD §11.1, §11.2, §17).
-- The webhook route handlers verify signatures and hand the raw payload here.
-- Acceptance is durable and idempotent; mapping and routing happen after, so a
-- provider retry can never create a second lead.

------------------------------------------------------------------------------
-- Versioned field mapping per connector: provider question -> canonical field.
-- Unknown questions stay visible for review rather than being dropped.
------------------------------------------------------------------------------
create table if not exists ingest.field_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  connection_id uuid references ingest.integration_connections(id) on delete cascade,
  provider text not null,
  form_ref text,
  source_field text not null,
  target_field text not null check (target_field in ('name','phone','email','company','interest','product_interest','area','notes','ignore')),
  version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists field_mappings_unique_idx
  on ingest.field_mappings (workspace_id, provider, coalesce(form_ref, ''), source_field, version);
alter table ingest.field_mappings enable row level security;
create policy member_read on ingest.field_mappings for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('audit.read')));
create policy admin_write on ingest.field_mappings for all to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('settings.manage')))
  with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('settings.manage')));
grant select, insert, update, delete on ingest.field_mappings to authenticated;
grant all on ingest.field_mappings to service_role;
create view api.field_mappings with (security_invoker = true) as select * from ingest.field_mappings;
grant select, insert, update, delete on api.field_mappings to authenticated;
grant all on api.field_mappings to service_role;

-- Routing rules decide the owner. Evaluated in order; first match wins.
create table if not exists ingest.routing_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  position int not null default 100,
  match_source_channel text,
  match_location_id uuid references core.business_locations(id),
  match_product_interest text,
  assign_to uuid references auth.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table ingest.routing_rules enable row level security;
create policy member_read on ingest.routing_rules for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.read')));
create policy manager_write on ingest.routing_rules for all to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.assign')))
  with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.assign')));
grant select, insert, update, delete on ingest.routing_rules to authenticated;
grant all on ingest.routing_rules to service_role;
create view api.routing_rules with (security_invoker = true) as select * from ingest.routing_rules;
grant select, insert, update, delete on api.routing_rules to authenticated;
grant all on api.routing_rules to service_role;

------------------------------------------------------------------------------
-- Accept one inbound submission. SECURITY DEFINER and callable by the service
-- role from a webhook route: the actor is the connector, not a member.
--
-- Idempotency is the contract. A provider retry with the same key returns the
-- original lead and records nothing new.
------------------------------------------------------------------------------
create or replace function api.accept_intake(
  p_workspace_id uuid,
  p_source_channel text,
  p_provider text,
  p_external_id text,
  p_idempotency_key text,
  p_payload jsonb,
  p_fields jsonb default '{}'::jsonb,   -- already mapped: {name, phone, email, company, interest, area, notes, product_interest[]}
  p_occurred_at timestamptz default null,
  p_form_ref text default null,
  p_raw_text text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ev sales.intake_events%rowtype;
  v_event_id uuid;
  v_lead_id uuid;
  v_phone text := core.normalize_phone(p_fields->>'phone');
  v_email text := core.normalize_text(p_fields->>'email');
  v_owner uuid;
  v_location uuid;
  v_contact uuid;
  v_dupe uuid;
begin
  if p_workspace_id is null then raise exception 'workspace required'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'an idempotency key is required' using errcode = '23514';
  end if;

  -- Retry of a submission already accepted.
  select * into ev from sales.intake_events where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    update sales.intake_events set status = 'duplicate' where id = ev.id and status = 'received';
    return jsonb_build_object('intake_event_id', ev.id, 'lead_id', ev.lead_id, 'duplicate', true);
  end if;

  insert into sales.intake_events (workspace_id, source_channel, provider, external_id, idempotency_key, occurred_at, payload, raw_text, status)
  values (p_workspace_id, p_source_channel, p_provider, p_external_id, p_idempotency_key, p_occurred_at, coalesce(p_payload, '{}'::jsonb), p_raw_text, 'received')
  returning id into v_event_id;

  -- A second submission from the same phone within a day is the same enquiry.
  if v_phone is not null then
    select l.id into v_dupe from sales.leads l
    where l.workspace_id = p_workspace_id and l.raw_phone_normalized = v_phone
      and l.created_at > now() - interval '1 day' and l.status not in ('converted','disqualified')
    order by l.created_at desc limit 1;
  end if;

  if v_dupe is not null then
    update sales.intake_events set status = 'duplicate', lead_id = v_dupe where id = v_event_id;
    insert into sales.lead_intake_links (lead_id, intake_event_id) values (v_dupe, v_event_id) on conflict do nothing;
    perform audit.emit(p_workspace_id, 'intake.deduplicated', 'sales', 'intake_events', v_event_id, null,
      jsonb_build_object('lead_id', v_dupe), 'Same phone within 24h', '{}'::jsonb);
    return jsonb_build_object('intake_event_id', v_event_id, 'lead_id', v_dupe, 'duplicate', true);
  end if;

  -- Routing: first active rule that matches, else unassigned for the inbox.
  select r.assign_to, r.match_location_id into v_owner, v_location
  from ingest.routing_rules r
  where r.workspace_id = p_workspace_id and r.is_active
    and (r.match_source_channel is null or r.match_source_channel = p_source_channel)
    and (r.match_product_interest is null or r.match_product_interest = any(
          coalesce(array(select jsonb_array_elements_text(p_fields->'product_interest')), '{}')))
  order by r.position limit 1;

  -- Link to an existing contact only on an exact normalized phone or email.
  if v_phone is not null then
    select cp.contact_id into v_contact from identity.contact_points cp
    where cp.workspace_id = p_workspace_id and cp.kind in ('phone','whatsapp') and cp.normalized_value = v_phone and not cp.is_shared
    limit 1;
  end if;
  if v_contact is null and v_email is not null then
    select cp.contact_id into v_contact from identity.contact_points cp
    where cp.workspace_id = p_workspace_id and cp.kind = 'email' and cp.normalized_value = v_email
    limit 1;
  end if;

  insert into sales.leads (workspace_id, status, source_channel, source_detail, contact_id, raw_name, raw_phone, raw_phone_normalized,
                           raw_email, raw_company, interest, product_interest, location_id, owner_id, assigned_at, first_response_due_at)
  values (p_workspace_id, 'new', p_source_channel, coalesce(p_form_ref, p_fields->>'source_detail'), v_contact,
          nullif(p_fields->>'name',''), nullif(p_fields->>'phone',''), v_phone, nullif(p_fields->>'email',''), nullif(p_fields->>'company',''),
          nullif(p_fields->>'interest',''), coalesce(array(select jsonb_array_elements_text(p_fields->'product_interest')), '{}'),
          v_location, v_owner, case when v_owner is not null then now() end, now() + interval '4 hours')
  returning id into v_lead_id;

  update sales.intake_events set status = 'processed', lead_id = v_lead_id where id = v_event_id;
  insert into sales.lead_intake_links (lead_id, intake_event_id) values (v_lead_id, v_event_id) on conflict do nothing;

  perform audit.emit(p_workspace_id, 'intake.received', 'sales', 'intake_events', v_event_id, null,
    jsonb_build_object('lead_id', v_lead_id, 'provider', p_provider, 'channel', p_source_channel), null,
    jsonb_build_object('matched_contact', v_contact is not null, 'routed', v_owner is not null));
  return jsonb_build_object('intake_event_id', v_event_id, 'lead_id', v_lead_id, 'duplicate', false, 'matched_contact_id', v_contact);
end $$;
revoke all on function api.accept_intake(uuid,text,text,text,text,jsonb,jsonb,timestamptz,text,text) from public;
grant execute on function api.accept_intake(uuid,text,text,text,text,jsonb,jsonb,timestamptz,text,text) to authenticated, service_role;

------------------------------------------------------------------------------
-- Connector run bookkeeping: checkpoints, sync runs, and the reconciliation
-- that proves nothing was silently lost.
------------------------------------------------------------------------------
create or replace function api.start_sync_run(p_connection_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c ingest.integration_connections%rowtype; v_id uuid;
begin
  select * into c from ingest.integration_connections where id = p_connection_id;
  if not found then raise exception 'connection not found'; end if;
  insert into ingest.sync_runs (connection_id, status) values (p_connection_id, 'running') returning id into v_id;
  update ingest.integration_connections set last_attempt_at = now() where id = p_connection_id;
  return v_id;
end $$;
grant execute on function api.start_sync_run(uuid) to authenticated, service_role;

create or replace function api.finish_sync_run(
  p_run_id uuid, p_status text, p_read int default 0, p_created int default 0,
  p_updated int default 0, p_rejected int default 0, p_error text default null, p_checkpoint text default null, p_stream text default 'default'
) returns void language plpgsql security definer set search_path = '' as $$
declare r ingest.sync_runs%rowtype; c ingest.integration_connections%rowtype;
begin
  select * into r from ingest.sync_runs where id = p_run_id for update;
  if not found then raise exception 'sync run not found'; end if;
  select * into c from ingest.integration_connections where id = r.connection_id;

  update ingest.sync_runs set status = p_status, finished_at = now(), records_read = p_read,
         records_created = p_created, records_updated = p_updated, records_rejected = p_rejected, error = p_error
  where id = p_run_id;

  update ingest.integration_connections
  set status = case when p_status = 'succeeded' then 'healthy' when p_status = 'partial' then 'degraded' else 'failed' end,
      last_success_at = case when p_status in ('succeeded','partial') then now() else last_success_at end,
      last_error = case when p_status = 'failed' then p_error else null end
  where id = r.connection_id;

  if p_checkpoint is not null then
    insert into ingest.connector_checkpoints (connection_id, stream, cursor, updated_at)
    values (r.connection_id, p_stream, p_checkpoint, now())
    on conflict (connection_id, stream) do update set cursor = excluded.cursor, updated_at = now();
  end if;

  if p_status = 'failed' then
    insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
    values (c.workspace_id, 'failed_webhook', 'high', 'integration_connection', c.id,
            format('%s sync failed', c.name), jsonb_build_object('error', p_error, 'run_id', p_run_id));
  end if;

  perform audit.emit(c.workspace_id, 'sync_run.finished', 'ingest', 'sync_runs', p_run_id, null,
    jsonb_build_object('status', p_status, 'read', p_read, 'created', p_created, 'rejected', p_rejected), p_error, '{}'::jsonb);
end $$;
grant execute on function api.finish_sync_run(uuid,text,int,int,int,int,text,text,text) to authenticated, service_role;

-- Replay a webhook that failed downstream: the raw evidence is kept, so the
-- lead can be created without asking the provider to send again.
create or replace function api.replay_intake_event(p_intake_event_id uuid, p_fields jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ev sales.intake_events%rowtype; res jsonb;
begin
  perform core.require_permission('sales.assign');
  select * into ev from sales.intake_events where id = p_intake_event_id;
  if not found then raise exception 'intake event not found'; end if;
  perform core.require_workspace(ev.workspace_id);
  if ev.lead_id is not null then raise exception 'this submission already produced a lead'; end if;
  res := api.accept_intake(ev.workspace_id, ev.source_channel, ev.provider, ev.external_id,
                           ev.idempotency_key || ':replay', ev.payload, coalesce(p_fields, ev.payload), ev.occurred_at, null, ev.raw_text);
  update sales.intake_events set status = 'processed', lead_id = (res->>'lead_id')::uuid where id = p_intake_event_id;
  perform audit.emit(ev.workspace_id, 'intake.replayed', 'sales', 'intake_events', p_intake_event_id, null, res, null, '{}'::jsonb);
  return res;
end $$;
grant execute on function api.replay_intake_event(uuid,jsonb) to authenticated;

-- Reconciliation view: what the provider sent versus what became a lead.
create or replace view api.intake_reconciliation with (security_invoker = true) as
select e.workspace_id, e.provider, e.source_channel,
       date_trunc('day', e.received_at)::date as day,
       count(*) as received,
       count(*) filter (where e.status = 'processed') as processed,
       count(*) filter (where e.status = 'duplicate') as deduplicated,
       count(*) filter (where e.status = 'failed') as failed,
       count(*) filter (where e.lead_id is null and e.status <> 'duplicate') as unlinked
from sales.intake_events e
group by e.workspace_id, e.provider, e.source_channel, date_trunc('day', e.received_at);
grant select on api.intake_reconciliation to authenticated;
