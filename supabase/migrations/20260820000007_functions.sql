-- Business functions exposed through the api schema. Each validates the actor's
-- permission, enforces multi-record invariants in one transaction, and emits
-- audit/outbox events. All run as SECURITY DEFINER with explicit checks
-- because they cross tables; they never trust client-supplied actor ids.

------------------------------------------------------------------------------
-- Guards
------------------------------------------------------------------------------
create or replace function core.require_permission(perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not core.has_permission(perm) then
    raise exception 'permission denied: %', perm using errcode = '42501';
  end if;
end $$;

create or replace function core.require_workspace(ws uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if ws is null or not exists (select 1 from core.member_workspace_ids() w where w = ws) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
end $$;


-- Malaysia-aware phone normalization to E.164-ish form (no libphonenumber in SQL).
create or replace function core.normalize_phone(input text)
returns text language sql immutable set search_path = '' as $$
  select case
    when input is null then null
    when d = '' then null
    when input ~ '^\s*\+' then '+' || d
    when d like '60%' and length(d) >= 10 then '+' || d
    when d like '0%' then '+6' || d
    when length(d) between 9 and 10 then '+60' || d
    else '+' || d end
  from (select regexp_replace(input, '[^0-9]', '', 'g') as d) x
$$;

------------------------------------------------------------------------------
-- Identity candidates (PRD §6): exact phone/email/reg-no are high confidence;
-- fuzzy name/company are low. Never merges; only proposes.
------------------------------------------------------------------------------
create or replace function api.find_identity_candidates(
  p_phone text default null,
  p_email text default null,
  p_name text default null,
  p_company text default null,
  p_registration_number text default null,
  p_limit int default 10
)
returns table (
  entity_type text,
  entity_id uuid,
  display_name text,
  confidence text,
  score numeric,
  reasons jsonb,
  masked_phone text,
  masked_email text,
  lifecycle_state text,
  last_activity_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_phone text := core.normalize_phone(p_phone);
  v_email text := core.normalize_text(p_email);
  v_name text := core.normalize_text(p_name);
  v_company text := core.normalize_text(p_company);
  v_reg text := core.normalize_key(p_registration_number);
begin
  perform core.require_permission('sales.read');

  return query
  with contact_hits as (
    select c.id, c.display_name, c.lifecycle_state,
      jsonb_agg(distinct jsonb_build_object('code', h.code, 'field', h.field, 'weight', h.weight)) as reasons,
      sum(h.weight) as score
    from identity.contacts c
    join lateral (
      select 'exact_phone' as code, 'phone' as field, 60 as weight
        from identity.contact_points cp where cp.contact_id = c.id and cp.kind in ('phone','whatsapp') and v_phone is not null and cp.normalized_value = v_phone
      union all
      select 'exact_email', 'email', 55
        from identity.contact_points cp where cp.contact_id = c.id and cp.kind = 'email' and v_email is not null and cp.normalized_value = v_email
      union all
      select 'similar_name', 'name', (extensions.similarity(c.normalized_name, v_name) * 30)::int
        where v_name is not null and c.normalized_name is not null and extensions.similarity(c.normalized_name, v_name) >= 0.45
    ) h on true
    where c.workspace_id = v_ws and c.merged_into_contact_id is null and c.archived_at is null
    group by c.id
  ),
  account_hits as (
    select a.id, a.name, a.lifecycle_state,
      jsonb_agg(distinct jsonb_build_object('code', h.code, 'field', h.field, 'weight', h.weight)) as reasons,
      sum(h.weight) as score
    from identity.accounts a
    join lateral (
      select 'exact_registration' as code, 'registration_number' as field, 70 as weight
        where v_reg is not null and a.registration_number_key = v_reg
      union all
      select 'similar_company', 'company', (extensions.similarity(a.normalized_name, v_company) * 35)::int
        where v_company is not null and a.normalized_name is not null and extensions.similarity(a.normalized_name, v_company) >= 0.45
      union all
      select 'alias_company', 'company', 30
        from identity.account_aliases al where al.account_id = a.id and v_company is not null and al.normalized_alias = v_company
    ) h on true
    where a.workspace_id = v_ws and a.merged_into_account_id is null and a.archived_at is null
    group by a.id
  )
  select * from (
    select 'contact'::text, ch.id, ch.display_name,
      case when ch.score >= 55 then 'high' when ch.score >= 25 then 'medium' else 'low' end,
      ch.score::numeric, ch.reasons,
      (select core.mask_value(cp.normalized_value, 'phone') from identity.contact_points cp where cp.contact_id = ch.id and cp.kind in ('phone','whatsapp') order by cp.is_primary desc, cp.created_at limit 1),
      (select core.mask_value(cp.normalized_value, 'email') from identity.contact_points cp where cp.contact_id = ch.id and cp.kind = 'email' order by cp.is_primary desc, cp.created_at limit 1),
      ch.lifecycle_state,
      (select max(a.occurred_at) from sales.activities a where a.contact_id = ch.id)
    from contact_hits ch
    union all
    select 'account', ah.id, ah.name,
      case when ah.score >= 55 then 'high' when ah.score >= 25 then 'medium' else 'low' end,
      ah.score::numeric, ah.reasons, null, null, ah.lifecycle_state,
      (select max(a.occurred_at) from sales.activities a where a.account_id = ah.id)
    from account_hits ah
  ) x
  order by x.score desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end $$;

create or replace function core.mask_value(v text, kind text)
returns text language sql immutable as $$
  select case
    when v is null then null
    when kind = 'phone' then regexp_replace(v, '(\+?\d{2,3})\d+(\d{3})$', '\1•••\2')
    when kind = 'email' then regexp_replace(v, '^(.).*(@.*)$', '\1•••\2')
    else '•••' end
$$;
grant execute on function api.find_identity_candidates(text,text,text,text,text,int) to authenticated;

------------------------------------------------------------------------------
-- Contact reveal (audited)
------------------------------------------------------------------------------
create or replace function api.reveal_contact_points(p_contact_id uuid)
returns table (id uuid, kind text, raw_value text, normalized_value text, is_primary boolean, label text)
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  perform core.require_permission('contact.reveal');
  select c.workspace_id into v_ws from identity.contacts c where c.id = p_contact_id;
  perform core.require_workspace(v_ws);
  perform audit.emit(v_ws, 'contact.reveal', 'identity', 'contacts', p_contact_id, null, null, null, '{}'::jsonb);
  return query select cp.id, cp.kind, cp.raw_value, cp.normalized_value, cp.is_primary, cp.label
    from identity.contact_points cp where cp.contact_id = p_contact_id order by cp.is_primary desc, cp.created_at;
end $$;
grant execute on function api.reveal_contact_points(uuid) to authenticated;

------------------------------------------------------------------------------
-- Create contact with contact points in one call (used by inbox + walk-in)
------------------------------------------------------------------------------
create or replace function api.create_contact(
  p_display_name text,
  p_phone text default null,
  p_email text default null,
  p_customer_type text default null,
  p_source text default null,
  p_account_id uuid default null,
  p_is_provisional boolean default false,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_id uuid;
  v_phone text := core.normalize_phone(p_phone);
  v_email text := core.normalize_text(p_email);
begin
  perform core.require_permission('sales.write');
  insert into identity.contacts (workspace_id, display_name, customer_type, original_acquisition_source, original_acquisition_at, is_provisional, notes, created_by, updated_by)
  values (v_ws, p_display_name, p_customer_type, p_source, case when p_source is null then null else now() end, coalesce(p_is_provisional, false), p_notes, auth.uid(), auth.uid())
  returning id into v_id;
  if v_phone is not null then
    insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
    values (v_ws, v_id, 'phone', p_phone, v_phone, true, p_source);
  end if;
  if v_email is not null then
    insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
    values (v_ws, v_id, 'email', p_email, v_email, v_phone is null, p_source);
  end if;
  if p_account_id is not null then
    insert into identity.account_contact_relationships (workspace_id, account_id, contact_id, is_primary)
    values (v_ws, p_account_id, v_id, true) on conflict do nothing;
  end if;
  perform audit.emit(v_ws, 'contact.created', 'identity', 'contacts', v_id, null, jsonb_build_object('display_name', p_display_name), null, '{}'::jsonb);
  return v_id;
end $$;
grant execute on function api.create_contact(text,text,text,text,text,uuid,boolean,text) to authenticated;

------------------------------------------------------------------------------
-- Opportunity stage change (PRD §5.3): reason required for won/lost/deferred
-- and for backward moves; records an append-only stage event + activity.
------------------------------------------------------------------------------
create or replace function api.change_opportunity_stage(
  p_opportunity_id uuid,
  p_to_stage_key text,
  p_reason text default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_outcome_date date default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_opp sales.opportunities%rowtype;
  v_from core.opportunity_stages%rowtype;
  v_to core.opportunity_stages%rowtype;
  v_backward boolean;
begin
  perform core.require_permission('sales.write');
  select * into v_opp from sales.opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'opportunity not found'; end if;
  perform core.require_workspace(v_opp.workspace_id);
  if not core.has_permission('sales.read_all') and v_opp.owner_id is not null and v_opp.owner_id <> auth.uid() then
    raise exception 'permission denied: not the owner' using errcode = '42501';
  end if;

  select * into v_to from core.opportunity_stages where workspace_id = v_opp.workspace_id and key = p_to_stage_key and is_active;
  if not found then raise exception 'unknown stage %', p_to_stage_key; end if;
  select * into v_from from core.opportunity_stages where workspace_id = v_opp.workspace_id and key = v_opp.stage_key;
  v_backward := v_from.position is not null and v_to.position < v_from.position;

  if (v_to.requires_reason or v_backward) and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required for this stage change' using errcode = '23514';
  end if;
  if v_to.reporting_group = 'open' and v_to.requires_next_action
     and coalesce(p_next_action, v_opp.next_action) is null then
    raise exception 'next action required for active opportunities' using errcode = '23514';
  end if;

  update sales.opportunities set
    stage_key = v_to.key,
    status = v_to.reporting_group,
    next_action = coalesce(p_next_action, next_action),
    next_action_due_at = coalesce(p_next_action_due_at, next_action_due_at),
    won_at = case when v_to.reporting_group = 'won' then coalesce(p_outcome_date::timestamptz, now()) else won_at end,
    lost_at = case when v_to.reporting_group = 'lost' then coalesce(p_outcome_date::timestamptz, now()) else lost_at end,
    deferred_until = case when v_to.reporting_group = 'deferred' then p_outcome_date else deferred_until end,
    outcome_reason = case when v_to.reporting_group in ('won','lost','deferred') then p_reason else outcome_reason end
  where id = p_opportunity_id;

  insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, is_backward, reason, actor_id)
  values (v_opp.workspace_id, p_opportunity_id, v_opp.stage_key, v_to.key, v_backward, p_reason, auth.uid());

  insert into sales.activities (workspace_id, kind, subject, body, actor_id, contact_id, account_id, project_id, opportunity_id, metadata)
  values (v_opp.workspace_id, 'stage_change', format('Stage: %s → %s', coalesce(v_from.label, v_opp.stage_key), v_to.label), p_reason, auth.uid(),
          v_opp.contact_id, v_opp.account_id, v_opp.project_id, p_opportunity_id,
          jsonb_build_object('from', v_opp.stage_key, 'to', v_to.key, 'backward', v_backward));

  perform audit.emit(v_opp.workspace_id, 'opportunity.stage_changed', 'sales', 'opportunities', p_opportunity_id,
    jsonb_build_object('stage_key', v_opp.stage_key), jsonb_build_object('stage_key', v_to.key), p_reason,
    jsonb_build_object('backward', v_backward, 'group', v_to.reporting_group));

  -- lifecycle: won → contact/account become active
  if v_to.reporting_group = 'won' then
    update identity.contacts set lifecycle_state = case when lifecycle_state = 'new' then 'active' else lifecycle_state end where id = v_opp.contact_id;
    update identity.accounts set lifecycle_state = case when lifecycle_state = 'new' then 'active' else lifecycle_state end where id = v_opp.account_id;
  end if;
end $$;
grant execute on function api.change_opportunity_stage(uuid,text,text,text,timestamptz,date) to authenticated;

------------------------------------------------------------------------------
-- Record a purchase: derives repeat state from prior accepted purchases of the
-- resolved identity, never overwrites original acquisition source.
------------------------------------------------------------------------------
create or replace function api.record_purchase(
  p_contact_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_external_ref text default null,
  p_payments jsonb default '[]'::jsonb,      -- [{method, amount, reference}]
  p_items jsonb default '[]'::jsonb,         -- [{description, quantity, unit, unit_price, product_variant_id}]
  p_opportunity_id uuid default null,
  p_project_id uuid default null,
  p_visit_id uuid default null,
  p_location_id uuid default null,
  p_salesperson_id uuid default null,
  p_purchase_source text default 'walk_in',
  p_purchased_at timestamptz default now(),
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_id uuid;
  v_prior int;
  v_pay jsonb;
  v_item jsonb;
  v_pos int := 0;
begin
  perform core.require_permission('purchase.write');
  if p_contact_id is null and p_account_id is null then
    raise exception 'purchase needs a contact or account' using errcode = '23514';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be >= 0' using errcode = '23514';
  end if;

  select count(*) into v_prior from sales.purchases p
  where p.workspace_id = v_ws and p.status <> 'voided'
    and ((p_contact_id is not null and p.contact_id = p_contact_id) or (p_account_id is not null and p.account_id = p_account_id));

  insert into sales.purchases (workspace_id, contact_id, account_id, opportunity_id, project_id, visit_id, purchased_at, external_ref, amount,
    purchase_source, location_id, salesperson_id, is_repeat, notes, recorded_by)
  values (v_ws, p_contact_id, p_account_id, p_opportunity_id, p_project_id, p_visit_id, coalesce(p_purchased_at, now()), p_external_ref, p_amount,
    p_purchase_source, p_location_id, coalesce(p_salesperson_id, auth.uid()), v_prior > 0, p_notes, auth.uid())
  returning id into v_id;

  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    insert into sales.purchase_payments (purchase_id, method, amount, reference, paid_at)
    values (v_id, coalesce(v_pay->>'method', 'other'), (v_pay->>'amount')::numeric, v_pay->>'reference', coalesce(p_purchased_at, now()));
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into sales.purchase_items (purchase_id, product_variant_id, description, quantity, unit, unit_price, line_total, position)
    values (v_id, nullif(v_item->>'product_variant_id', '')::uuid, coalesce(v_item->>'description', 'Item'),
      coalesce((v_item->>'quantity')::numeric, 1), v_item->>'unit', (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'line_total')::numeric, coalesce((v_item->>'quantity')::numeric, 1) * coalesce((v_item->>'unit_price')::numeric, 0)), v_pos);
  end loop;

  insert into sales.activities (workspace_id, kind, channel, subject, body, actor_id, contact_id, account_id, project_id, opportunity_id, visit_id, purchase_id, metadata)
  values (v_ws, 'note', p_purchase_source, format('Purchase recorded%s', case when p_external_ref is null then '' else ' · ' || p_external_ref end),
    p_notes, auth.uid(), p_contact_id, p_account_id, p_project_id, p_opportunity_id, p_visit_id, v_id,
    jsonb_build_object('amount', p_amount, 'repeat', v_prior > 0));

  -- lifecycle derivation (does not touch original_acquisition_source)
  if p_contact_id is not null then
    update identity.contacts set lifecycle_state = case when v_prior > 0 then 'repeat' else 'active' end where id = p_contact_id;
  end if;
  if p_account_id is not null then
    update identity.accounts set lifecycle_state = case when v_prior > 0 then 'repeat' else 'active' end where id = p_account_id;
  end if;

  perform audit.emit(v_ws, case when v_prior > 0 then 'purchase.recorded.repeat' else 'purchase.recorded' end, 'sales', 'purchases', v_id, null,
    jsonb_build_object('amount', p_amount, 'external_ref', p_external_ref), null, jsonb_build_object('repeat', v_prior > 0));
  return v_id;
end $$;
grant execute on function api.record_purchase(uuid,uuid,numeric,text,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text) to authenticated;

------------------------------------------------------------------------------
-- Walk-in fast path (PRD §5.4): one transaction for visit + optional purchase
-- + optional project/opportunity creation/link.
------------------------------------------------------------------------------
create or replace function api.record_walk_in(
  p_contact_id uuid,
  p_account_id uuid default null,
  p_location_id uuid default null,
  p_staff_user_id uuid default null,
  p_occurred_at timestamptz default now(),
  p_customer_type text default null,
  p_origin_area text default null,
  p_inquiry_source text default null,
  p_purpose text default 'browse',
  p_notes text default null,
  p_create_opportunity boolean default false,
  p_opportunity_id uuid default null,
  p_project_name text default null,
  p_opportunity_name text default null,
  p_product_interest text[] default '{}',
  p_purchase jsonb default null               -- {amount, external_ref, payments:[], items:[], purchase_source}
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_visit_id uuid;
  v_project_id uuid;
  v_opp_id uuid := p_opportunity_id;
  v_purchase_id uuid;
  v_prior_visits int;
  v_first_stage text;
  v_lead_id uuid;
begin
  perform core.require_permission('sales.write');
  if p_contact_id is null and p_account_id is null then
    raise exception 'walk-in needs a resolved contact or account' using errcode = '23514';
  end if;

  select count(*) into v_prior_visits from sales.visits v
  where v.workspace_id = v_ws and ((p_contact_id is not null and v.contact_id = p_contact_id) or (p_account_id is not null and v.account_id = p_account_id));

  insert into sales.visits (workspace_id, occurred_at, location_id, staff_user_id, contact_id, account_id, customer_type, origin_area, inquiry_source, purpose, is_new_customer, notes, created_by)
  values (v_ws, coalesce(p_occurred_at, now()), p_location_id, coalesce(p_staff_user_id, auth.uid()), p_contact_id, p_account_id, p_customer_type, p_origin_area, p_inquiry_source, coalesce(p_purpose, 'browse'), v_prior_visits = 0, p_notes, auth.uid())
  returning id into v_visit_id;

  -- stamp original acquisition source if unknown
  update identity.contacts set original_acquisition_source = coalesce(original_acquisition_source, coalesce(p_inquiry_source, 'walk_in')),
                               original_acquisition_at = coalesce(original_acquisition_at, coalesce(p_occurred_at, now())),
                               customer_type = coalesce(customer_type, p_customer_type)
  where id = p_contact_id;

  -- walk-in lead record keeps the inquiry in the inbox lifecycle
  insert into sales.leads (workspace_id, status, source_channel, source_detail, contact_id, account_id, interest, product_interest, location_id, owner_id, first_response_at, created_by)
  values (v_ws, 'contacted', 'walk_in', p_inquiry_source, p_contact_id, p_account_id, p_notes, coalesce(p_product_interest, '{}'), p_location_id, coalesce(p_staff_user_id, auth.uid()), coalesce(p_occurred_at, now()), auth.uid())
  returning id into v_lead_id;
  update sales.visits set lead_id = v_lead_id where id = v_visit_id;

  if p_create_opportunity and v_opp_id is null then
    insert into identity.projects (workspace_id, name, account_id, primary_contact_id, project_type, status, area, owner_id, created_by)
    values (v_ws, coalesce(p_project_name, p_opportunity_name, 'Walk-in project'), p_account_id, p_contact_id, 'other', 'planning', p_origin_area, coalesce(p_staff_user_id, auth.uid()), auth.uid())
    returning id into v_project_id;

    select key into v_first_stage from core.opportunity_stages where workspace_id = v_ws and is_active and reporting_group = 'open' order by position limit 1;
    insert into sales.opportunities (workspace_id, name, account_id, contact_id, project_id, lead_id, stage_key, status, owner_id, source_channel, product_interest, next_action, next_action_due_at, created_by)
    values (v_ws, coalesce(p_opportunity_name, p_project_name, 'Walk-in opportunity'), p_account_id, p_contact_id, v_project_id, v_lead_id, coalesce(v_first_stage, 'new_inquiry'), 'open',
            coalesce(p_staff_user_id, auth.uid()), 'walk_in', coalesce(p_product_interest, '{}'), 'Follow up after showroom visit', coalesce(p_occurred_at, now()) + interval '2 days', auth.uid())
    returning id into v_opp_id;
    insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, actor_id) values (v_ws, v_opp_id, null, coalesce(v_first_stage, 'new_inquiry'), auth.uid());
    update sales.leads set status = 'converted', converted_opportunity_id = v_opp_id where id = v_lead_id;
  end if;
  if v_opp_id is not null then
    update sales.visits set opportunity_id = v_opp_id where id = v_visit_id;
    select project_id into v_project_id from sales.opportunities where id = v_opp_id;
  end if;

  insert into sales.activities (workspace_id, kind, channel, subject, body, occurred_at, actor_id, contact_id, account_id, project_id, opportunity_id, lead_id, visit_id, metadata)
  values (v_ws, 'walk_in', 'walk_in', 'Showroom walk-in', p_notes, coalesce(p_occurred_at, now()), auth.uid(), p_contact_id, p_account_id, v_project_id, v_opp_id, v_lead_id, v_visit_id,
          jsonb_build_object('purpose', p_purpose, 'new_customer', v_prior_visits = 0));

  if p_purchase is not null and (p_purchase->>'amount') is not null then
    v_purchase_id := api.record_purchase(
      p_contact_id, p_account_id, (p_purchase->>'amount')::numeric, p_purchase->>'external_ref',
      coalesce(p_purchase->'payments', '[]'::jsonb), coalesce(p_purchase->'items', '[]'::jsonb),
      v_opp_id, v_project_id, v_visit_id, p_location_id, coalesce(p_staff_user_id, auth.uid()),
      coalesce(p_purchase->>'purchase_source', 'walk_in'), coalesce(p_occurred_at, now()), p_purchase->>'notes');
  end if;

  perform audit.emit(v_ws, 'visit.recorded', 'sales', 'visits', v_visit_id, null, jsonb_build_object('purpose', p_purpose), null,
    jsonb_build_object('opportunity_id', v_opp_id, 'purchase_id', v_purchase_id));

  return jsonb_build_object('visit_id', v_visit_id, 'lead_id', v_lead_id, 'opportunity_id', v_opp_id, 'project_id', v_project_id, 'purchase_id', v_purchase_id, 'new_customer', v_prior_visits = 0);
end $$;
grant execute on function api.record_walk_in(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,uuid,text,text,text[],jsonb) to authenticated;

------------------------------------------------------------------------------
-- Identity merge / unmerge (PRD §6.2): reversible, audited, never auto.
------------------------------------------------------------------------------
create or replace function api.merge_contacts(p_survivor_id uuid, p_merged_id uuid, p_reason text, p_candidate_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_before jsonb;
  v_event_id uuid;
  v_counts jsonb := '{}'::jsonb;
  n int;
begin
  perform core.require_permission('identity.merge');
  if p_survivor_id = p_merged_id then raise exception 'cannot merge a contact into itself'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'merge reason required' using errcode = '23514'; end if;
  select workspace_id into v_ws from identity.contacts where id = p_survivor_id;
  perform core.require_workspace(v_ws);
  if not exists (select 1 from identity.contacts where id = p_merged_id and workspace_id = v_ws and merged_into_contact_id is null) then
    raise exception 'merged contact not found or already merged';
  end if;

  select jsonb_build_object(
    'contact', to_jsonb(c),
    'contact_points', (select coalesce(jsonb_agg(to_jsonb(cp)), '[]'::jsonb) from identity.contact_points cp where cp.contact_id = p_merged_id),
    'relationships', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from identity.account_contact_relationships r where r.contact_id = p_merged_id)
  ) into v_before from identity.contacts c where c.id = p_merged_id;

  -- drop exact duplicates of points the survivor already has, move the rest
  delete from identity.contact_points m using identity.contact_points s
    where m.contact_id = p_merged_id and s.contact_id = p_survivor_id and s.kind = m.kind and s.normalized_value = m.normalized_value;
  update identity.contact_points set contact_id = p_survivor_id, is_primary = false where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('contact_points', n);
  update identity.account_contact_relationships r set contact_id = p_survivor_id where contact_id = p_merged_id
    and not exists (select 1 from identity.account_contact_relationships x where x.account_id = r.account_id and x.contact_id = p_survivor_id); get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('relationships', n);
  delete from identity.account_contact_relationships where contact_id = p_merged_id;
  update identity.external_identities set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('external_identities', n);
  update identity.consent_records set contact_id = p_survivor_id where contact_id = p_merged_id;
  update identity.projects set primary_contact_id = p_survivor_id where primary_contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('projects', n);
  update sales.leads set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('leads', n);
  update sales.opportunities set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('opportunities', n);
  update sales.visits set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('visits', n);
  update sales.activities set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('activities', n);
  update sales.tasks set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tasks', n);
  update sales.purchases set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('purchases', n);

  -- preserve earliest acquisition source
  update identity.contacts s set
    original_acquisition_source = case when m.original_acquisition_at is not null and (s.original_acquisition_at is null or m.original_acquisition_at < s.original_acquisition_at) then m.original_acquisition_source else s.original_acquisition_source end,
    original_acquisition_at = least(s.original_acquisition_at, m.original_acquisition_at),
    lifecycle_state = case when exists (select 1 from sales.purchases p where p.contact_id = p_survivor_id and p.status <> 'voided' having count(*) > 1) then 'repeat' else s.lifecycle_state end,
    updated_by = auth.uid()
  from identity.contacts m where s.id = p_survivor_id and m.id = p_merged_id;

  update identity.contacts set merged_into_contact_id = p_survivor_id, archived_at = now(), updated_by = auth.uid() where id = p_merged_id;

  insert into identity.identity_merge_events (workspace_id, entity_type, survivor_id, merged_id, actor_id, reason, before_snapshot, relinked)
  values (v_ws, 'contact', p_survivor_id, p_merged_id, auth.uid(), p_reason, v_before, v_counts) returning id into v_event_id;

  if p_candidate_id is not null then
    update identity.identity_match_candidates set status = 'confirmed', decided_by = auth.uid(), decided_at = now(), decision_note = p_reason where id = p_candidate_id;
  end if;
  update identity.identity_match_candidates set status = 'superseded' where subject_type = 'contact' and status = 'suggested' and (subject_id = p_merged_id or candidate_id = p_merged_id);

  perform audit.emit(v_ws, 'identity.merged', 'identity', 'contacts', p_survivor_id, v_before, jsonb_build_object('merged_id', p_merged_id), p_reason, v_counts);
  return v_event_id;
end $$;
grant execute on function api.merge_contacts(uuid,uuid,text,uuid) to authenticated;

create or replace function api.unmerge_contacts(p_merge_event_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  ev identity.identity_merge_events%rowtype;
  cp jsonb;
  rel jsonb;
begin
  perform core.require_permission('identity.merge');
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'unmerge reason required' using errcode = '23514'; end if;
  select * into ev from identity.identity_merge_events where id = p_merge_event_id for update;
  if not found or ev.entity_type <> 'contact' then raise exception 'merge event not found'; end if;
  if ev.reversed_at is not null then raise exception 'merge already reversed'; end if;
  perform core.require_workspace(ev.workspace_id);

  update identity.contacts set merged_into_contact_id = null, archived_at = null, updated_by = auth.uid() where id = ev.merged_id;
  -- restore contact points and relationships that belonged to the merged record
  for cp in select * from jsonb_array_elements(ev.before_snapshot->'contact_points') loop
    update identity.contact_points set contact_id = ev.merged_id, is_primary = coalesce((cp->>'is_primary')::boolean, false) where id = (cp->>'id')::uuid;
  end loop;
  for rel in select * from jsonb_array_elements(ev.before_snapshot->'relationships') loop
    insert into identity.account_contact_relationships (id, workspace_id, account_id, contact_id, role, is_primary)
    values ((rel->>'id')::uuid, ev.workspace_id, (rel->>'account_id')::uuid, ev.merged_id, rel->>'role', coalesce((rel->>'is_primary')::boolean, false))
    on conflict (account_id, contact_id) do nothing;
  end loop;
  -- Business rows linked after the merge remain with the survivor (documented limitation); audit rows show which moved.
  update identity.identity_merge_events set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason where id = p_merge_event_id;
  perform audit.emit(ev.workspace_id, 'identity.unmerged', 'identity', 'contacts', ev.merged_id, null, jsonb_build_object('survivor_id', ev.survivor_id), p_reason, '{}'::jsonb);
end $$;
grant execute on function api.unmerge_contacts(uuid,text) to authenticated;

create or replace function api.reject_identity_candidate(p_candidate_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  perform core.require_permission('sales.write');
  select workspace_id into v_ws from identity.identity_match_candidates where id = p_candidate_id;
  perform core.require_workspace(v_ws);
  update identity.identity_match_candidates set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_candidate_id;
  perform audit.emit(v_ws, 'identity.candidate_rejected', 'identity', 'identity_match_candidates', p_candidate_id, null, null, p_note, '{}'::jsonb);
end $$;
grant execute on function api.reject_identity_candidate(uuid,text) to authenticated;

-- Generate/refresh duplicate candidates for a contact (called after create/import).
create or replace function api.suggest_contact_duplicates(p_contact_id uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid; v_name text; n int := 0; r record;
begin
  perform core.require_permission('sales.read');
  select workspace_id, normalized_name into v_ws, v_name from identity.contacts where id = p_contact_id;
  perform core.require_workspace(v_ws);
  for r in
    select other.id as candidate_id, sum(w) as score, jsonb_agg(jsonb_build_object('code', code, 'field', field)) as reasons
    from (
      select cp2.contact_id as other_id, 'exact_phone' as code, 'phone' as field, 60 as w
      from identity.contact_points cp1 join identity.contact_points cp2 on cp2.workspace_id = cp1.workspace_id and cp2.kind = cp1.kind and cp2.normalized_value = cp1.normalized_value and cp2.contact_id <> cp1.contact_id
      where cp1.contact_id = p_contact_id and cp1.kind in ('phone','whatsapp') and not cp1.is_shared
      union all
      select cp2.contact_id, 'exact_email', 'email', 55
      from identity.contact_points cp1 join identity.contact_points cp2 on cp2.workspace_id = cp1.workspace_id and cp2.kind = 'email' and cp2.normalized_value = cp1.normalized_value and cp2.contact_id <> cp1.contact_id
      where cp1.contact_id = p_contact_id and cp1.kind = 'email'
      union all
      select c2.id, 'similar_name', 'name', (extensions.similarity(c2.normalized_name, v_name) * 30)::int
      from identity.contacts c2 where c2.workspace_id = v_ws and c2.id <> p_contact_id and c2.merged_into_contact_id is null and v_name is not null
        and extensions.similarity(c2.normalized_name, v_name) >= 0.6
    ) s
    join identity.contacts other on other.id = s.other_id and other.merged_into_contact_id is null and other.archived_at is null
    group by other.id
    having sum(w) >= 25
  loop
    insert into identity.identity_match_candidates (workspace_id, subject_type, subject_id, candidate_id, score, confidence, reasons)
    values (v_ws, 'contact', p_contact_id, r.candidate_id, r.score, case when r.score >= 55 then 'high' when r.score >= 25 then 'medium' else 'low' end, r.reasons)
    on conflict (workspace_id, subject_type, subject_id, candidate_id) do update
      set score = excluded.score, confidence = excluded.confidence, reasons = excluded.reasons
      where identity.identity_match_candidates.status = 'suggested';
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function api.suggest_contact_duplicates(uuid) to authenticated;

------------------------------------------------------------------------------
-- Price publish (PRD §7.6): prevents overlapping current prices for the same
-- exact scope unless an authorized override records a reason.
------------------------------------------------------------------------------
create or replace function api.publish_price(p_variant_price_id uuid, p_override boolean default false, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  vp merch.variant_prices%rowtype;
  conflict_id uuid;
begin
  perform core.require_permission('price.publish');
  select * into vp from merch.variant_prices where id = p_variant_price_id for update;
  if not found then raise exception 'price not found'; end if;
  perform core.require_workspace(vp.workspace_id);

  select id into conflict_id from merch.variant_prices x
  where x.price_list_id = vp.price_list_id and x.variant_id = vp.variant_id and x.id <> vp.id
    and coalesce(x.unit_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(vp.unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and x.min_quantity = vp.min_quantity and x.state in ('current','scheduled')
    and daterange(x.valid_from, x.valid_to, '[]') && daterange(vp.valid_from, vp.valid_to, '[]')
  limit 1;

  if conflict_id is not null then
    if not p_override then
      update merch.variant_prices set state = 'conflicted' where id = vp.id;
      insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
      values (vp.workspace_id, 'overlapping_price', 'high', 'variant_price', vp.id, 'Overlapping active price for the same scope', jsonb_build_object('conflicts_with', conflict_id));
      raise exception 'overlapping current price exists (%). Override with a reason to supersede.', conflict_id using errcode = '23505';
    end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'override reason required' using errcode = '23514'; end if;
    update merch.variant_prices set state = 'superseded', valid_to = least(coalesce(valid_to, vp.valid_from - 1), vp.valid_from - 1) where id = conflict_id;
    insert into merch.price_approval_events (workspace_id, variant_price_id, action, actor_id, reason) values (vp.workspace_id, conflict_id, 'superseded', auth.uid(), p_reason);
    insert into merch.price_approval_events (workspace_id, variant_price_id, action, actor_id, reason) values (vp.workspace_id, vp.id, 'override', auth.uid(), p_reason);
  end if;

  update merch.variant_prices set
    state = case when vp.valid_from > current_date then 'scheduled' else 'current' end,
    review_state = 'reviewed', approved_by = auth.uid(), approved_at = now()
  where id = vp.id;
  insert into merch.price_approval_events (workspace_id, variant_price_id, action, actor_id, reason) values (vp.workspace_id, vp.id, 'approved', auth.uid(), p_reason);
  perform audit.emit(vp.workspace_id, 'price.published', 'merch', 'variant_prices', vp.id, to_jsonb(vp), null, p_reason, jsonb_build_object('override', p_override));
end $$;
grant execute on function api.publish_price(uuid,boolean,text) to authenticated;

------------------------------------------------------------------------------
-- Global search (PRD §7.3)
------------------------------------------------------------------------------
create or replace function api.global_search(p_query text, p_limit int default 20)
returns table (entity_type text, entity_id uuid, title text, subtitle text, href text, score real)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  q text := core.normalize_text(p_query);
  qkey text := core.normalize_key(p_query);
  qdigits text := nullif(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '');
begin
  if q is null then return; end if;
  return query
  select * from (
    select 'contact'::text as entity_type, c.id as entity_id, c.display_name as title, coalesce(c.customer_type, 'contact') as subtitle, '/sales/contacts/' || c.id as href, greatest(extensions.similarity(c.normalized_name, q), 0)::real as score
    from identity.contacts c where c.workspace_id = v_ws and c.merged_into_contact_id is null and core.has_permission('sales.read')
      and (c.normalized_name operator(extensions.%) q or c.normalized_name like '%' || q || '%')
    union all
    select 'contact', c.id, c.display_name, core.mask_value(cp.normalized_value, cp.kind), '/sales/contacts/' || c.id, 1.0::real
    from identity.contact_points cp join identity.contacts c on c.id = cp.contact_id
    where cp.workspace_id = v_ws and c.merged_into_contact_id is null and core.has_permission('sales.read')
      and ((qdigits is not null and length(qdigits) >= 4 and cp.kind in ('phone','whatsapp') and cp.normalized_value like '%' || qdigits || '%')
        or (cp.kind = 'email' and cp.normalized_value like '%' || q || '%'))
    union all
    select 'account', a.id, a.name, coalesce(a.account_type, 'account'), '/sales/accounts/' || a.id, greatest(extensions.similarity(a.normalized_name, q), 0)::real
    from identity.accounts a where a.workspace_id = v_ws and a.merged_into_account_id is null and core.has_permission('sales.read')
      and (a.normalized_name operator(extensions.%) q or a.normalized_name like '%' || q || '%' or (qkey is not null and a.registration_number_key = qkey))
    union all
    select 'project', p.id, p.name, coalesce(p.area, p.status), '/sales/projects/' || p.id, greatest(extensions.similarity(core.normalize_text(p.name), q), 0)::real
    from identity.projects p where p.workspace_id = v_ws and core.has_permission('sales.read') and core.normalize_text(p.name) like '%' || q || '%'
    union all
    select 'opportunity', o.id, o.name, o.stage_key, '/sales/pipeline?opportunity=' || o.id, greatest(extensions.similarity(core.normalize_text(o.name), q), 0)::real
    from sales.opportunities o where o.workspace_id = v_ws and core.has_permission('sales.read') and core.normalize_text(o.name) like '%' || q || '%'
    union all
    select 'purchase', pu.id, coalesce(pu.external_ref, 'Purchase'), to_char(pu.purchased_at, 'YYYY-MM-DD') || ' · ' || pu.amount::text, '/sales/walk-ins?purchase=' || pu.id, 1.0::real
    from sales.purchases pu where pu.workspace_id = v_ws and core.has_permission('sales.read') and pu.external_ref is not null and core.normalize_key(pu.external_ref) like '%' || qkey || '%'
    union all
    select 'product', pr.id, coalesce(pr.code || ' · ', '') || pr.name, coalesce(b.name, ''), '/merchandise/catalog/' || pr.id, greatest(extensions.similarity(pr.normalized_name, q), 0)::real
    from merch.products pr left join merch.brands b on b.id = pr.brand_id
    where pr.workspace_id = v_ws and core.has_permission('catalog.read') and pr.status <> 'archived'
      and (pr.normalized_name operator(extensions.%) q or pr.normalized_name like '%' || q || '%' or (qkey is not null and pr.code_key like '%' || qkey || '%')
           or exists (select 1 from merch.product_aliases al where al.product_id = pr.id and al.alias_key like '%' || qkey || '%'))
  ) x
  order by x.score desc, x.title
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end $$;
grant execute on function api.global_search(text,int) to authenticated;

------------------------------------------------------------------------------
-- Command centre summary (PRD §7.1) — counts with definitions live in the app.
------------------------------------------------------------------------------
create or replace function api.command_centre_summary()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_me uuid := auth.uid();
  v_all boolean := core.has_permission('sales.read_all');
  result jsonb;
begin
  perform core.require_permission('sales.read');
  select jsonb_build_object(
    'aging_leads', (select count(*) from sales.leads l where l.workspace_id = v_ws and l.status in ('new','contact_attempted') and l.created_at < now() - interval '2 days' and (v_all or l.owner_id = v_me or l.owner_id is null)),
    'unassigned_leads', (select count(*) from sales.leads l where l.workspace_id = v_ws and l.status in ('new','contact_attempted','contacted') and l.owner_id is null),
    'no_response_leads', (select count(*) from sales.leads l where l.workspace_id = v_ws and l.status = 'new' and l.first_response_at is null and (v_all or l.owner_id = v_me or l.owner_id is null)),
    'overdue_followups', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and o.next_action_due_at < now() and (v_all or o.owner_id = v_me)),
    'missing_next_action', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and (o.next_action is null or o.next_action_due_at is null) and (v_all or o.owner_id = v_me)),
    'open_opportunities', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and (v_all or o.owner_id = v_me)),
    'open_value', (select coalesce(sum(o.estimated_value), 0) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and (v_all or o.owner_id = v_me)),
    'won_30d', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'won' and o.won_at > now() - interval '30 days' and (v_all or o.owner_id = v_me)),
    'lost_30d', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'lost' and o.lost_at > now() - interval '30 days' and (v_all or o.owner_id = v_me)),
    'quotes_expiring', (select count(*) from sales.quote_versions qv join sales.quotes qt on qt.id = qv.quote_id where qv.workspace_id = v_ws and qt.status in ('issued','revised') and qv.version_no = qt.current_version_no and qv.valid_until between current_date and current_date + 7),
    'my_open_tasks', (select count(*) from sales.tasks t where t.workspace_id = v_ws and t.status = 'open' and t.assignee_id = v_me),
    'my_overdue_tasks', (select count(*) from sales.tasks t where t.workspace_id = v_ws and t.status = 'open' and t.assignee_id = v_me and t.due_at < now()),
    'duplicate_candidates', (select count(*) from identity.identity_match_candidates m where m.workspace_id = v_ws and m.status = 'suggested'),
    'visits_today', (select count(*) from sales.visits v where v.workspace_id = v_ws and v.occurred_at >= date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'),
    'purchases_7d', (select count(*) from sales.purchases p where p.workspace_id = v_ws and p.purchased_at > now() - interval '7 days' and p.status <> 'voided'),
    'purchase_amount_7d', (select coalesce(sum(p.amount), 0) from sales.purchases p where p.workspace_id = v_ws and p.purchased_at > now() - interval '7 days' and p.status <> 'voided'),
    'products_without_price', (select count(*) from merch.products pr where pr.workspace_id = v_ws and pr.status = 'active' and not exists (select 1 from merch.product_variants v join merch.variant_prices vp on vp.variant_id = v.id and vp.state = 'current' where v.product_id = pr.id)),
    'price_conflicts', (select count(*) from merch.variant_prices vp where vp.workspace_id = v_ws and vp.state = 'conflicted'),
    'unreviewed_products', (select count(*) from merch.products pr where pr.workspace_id = v_ws and pr.review_state = 'unreviewed' and pr.status <> 'archived'),
    'open_data_issues', (select count(*) from ingest.data_quality_issues d where d.workspace_id = v_ws and d.status = 'open'),
    'pending_reviews', (select count(*) from ingest.review_items r where r.workspace_id = v_ws and r.status = 'pending'),
    'connectors_failed', (select count(*) from ingest.integration_connections ic where ic.workspace_id = v_ws and ic.status in ('failed','degraded')),
    'content_opps_pending', (select count(*) from marketing.content_opportunities co where co.workspace_id = v_ws and co.status in ('nominated','under_review','needs_info')),
    'shoots_next_7d', (select count(*) from marketing.shoot_bookings sb where sb.workspace_id = v_ws and sb.status in ('tentative','confirmed','customer_confirmation_pending') and sb.starts_at between now() and now() + interval '7 days'),
    'generated_at', now()
  ) into result;
  return result;
end $$;
grant execute on function api.command_centre_summary() to authenticated;

------------------------------------------------------------------------------
-- Lead assignment + first response (PRD §7.2)
------------------------------------------------------------------------------
create or replace function api.assign_lead(p_lead_id uuid, p_owner_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_old uuid;
begin
  perform core.require_permission('sales.assign');
  select workspace_id, owner_id into v_ws, v_old from sales.leads where id = p_lead_id;
  perform core.require_workspace(v_ws);
  update sales.leads set owner_id = p_owner_id, assigned_at = now(),
    first_response_due_at = coalesce(first_response_due_at, now() + interval '4 hours') where id = p_lead_id;
  perform audit.emit(v_ws, 'lead.assigned', 'sales', 'leads', p_lead_id, jsonb_build_object('owner_id', v_old), jsonb_build_object('owner_id', p_owner_id), p_reason, '{}'::jsonb);
end $$;
grant execute on function api.assign_lead(uuid,uuid,text) to authenticated;

create or replace function api.log_lead_response(p_lead_id uuid, p_kind text, p_channel text, p_body text default null, p_reached boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_contact uuid; v_id uuid; v_status text;
begin
  perform core.require_permission('sales.write');
  select workspace_id, contact_id, status into v_ws, v_contact, v_status from sales.leads where id = p_lead_id;
  perform core.require_workspace(v_ws);
  insert into sales.activities (workspace_id, kind, channel, subject, body, actor_id, lead_id, contact_id, metadata)
  values (v_ws, coalesce(p_kind, 'call'), p_channel, case when p_reached then 'Contacted' else 'Contact attempted' end, p_body, auth.uid(), p_lead_id, v_contact, jsonb_build_object('reached', p_reached))
  returning id into v_id;
  update sales.leads set
    first_response_at = coalesce(first_response_at, now()),
    contact_attempts = contact_attempts + 1,
    status = case when status in ('new','contact_attempted') then (case when p_reached then 'contacted' else 'contact_attempted' end) else status end
  where id = p_lead_id;
  return v_id;
end $$;
grant execute on function api.log_lead_response(uuid,text,text,text,boolean) to authenticated;

-- Convert a lead into project + opportunity (and link/create contact).
create or replace function api.convert_lead(
  p_lead_id uuid, p_contact_id uuid, p_account_id uuid default null,
  p_project_name text default null, p_opportunity_name text default null,
  p_estimated_value numeric default null, p_next_action text default 'Follow up', p_next_action_due_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l sales.leads%rowtype; v_project uuid; v_opp uuid; v_stage text;
begin
  perform core.require_permission('sales.write');
  select * into l from sales.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found'; end if;
  perform core.require_workspace(l.workspace_id);
  if l.status = 'converted' then raise exception 'lead already converted'; end if;

  insert into identity.projects (workspace_id, name, account_id, primary_contact_id, project_type, status, owner_id, created_by)
  values (l.workspace_id, coalesce(p_project_name, p_opportunity_name, coalesce(l.raw_name, 'Lead') || ' project'), p_account_id, p_contact_id, 'other', 'planning', coalesce(l.owner_id, auth.uid()), auth.uid())
  returning id into v_project;

  select key into v_stage from core.opportunity_stages where workspace_id = l.workspace_id and is_active and reporting_group = 'open' order by position offset 3 limit 1; -- 'qualified'
  insert into sales.opportunities (workspace_id, name, account_id, contact_id, project_id, lead_id, stage_key, status, owner_id, source_channel, estimated_value, product_interest, next_action, next_action_due_at, created_by)
  values (l.workspace_id, coalesce(p_opportunity_name, p_project_name, coalesce(l.raw_name, 'Lead') || ' opportunity'), p_account_id, p_contact_id, v_project, l.id,
          coalesce(v_stage, 'qualified'), 'open', coalesce(l.owner_id, auth.uid()), l.source_channel, p_estimated_value, l.product_interest, p_next_action, coalesce(p_next_action_due_at, now() + interval '2 days'), auth.uid())
  returning id into v_opp;
  insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, actor_id) values (l.workspace_id, v_opp, null, coalesce(v_stage, 'qualified'), auth.uid());

  update sales.leads set status = 'converted', contact_id = coalesce(contact_id, p_contact_id), account_id = coalesce(account_id, p_account_id), converted_opportunity_id = v_opp, qualified_at = coalesce(qualified_at, now()) where id = l.id;
  update identity.contacts set original_acquisition_source = coalesce(original_acquisition_source, l.source_channel), original_acquisition_at = coalesce(original_acquisition_at, l.created_at) where id = p_contact_id;

  insert into sales.activities (workspace_id, kind, subject, actor_id, lead_id, contact_id, account_id, project_id, opportunity_id)
  values (l.workspace_id, 'system', 'Lead converted to opportunity', auth.uid(), l.id, p_contact_id, p_account_id, v_project, v_opp);
  perform audit.emit(l.workspace_id, 'lead.converted', 'sales', 'leads', l.id, null, jsonb_build_object('opportunity_id', v_opp, 'project_id', v_project), null, '{}'::jsonb);
  return jsonb_build_object('project_id', v_project, 'opportunity_id', v_opp);
end $$;
grant execute on function api.convert_lead(uuid,uuid,uuid,text,text,numeric,text,timestamptz) to authenticated;

------------------------------------------------------------------------------
-- Contact / account 360 timeline (append-oriented)
------------------------------------------------------------------------------
create or replace function api.entity_timeline(p_entity_type text, p_entity_id uuid, p_limit int default 100)
returns table (id uuid, kind text, channel text, subject text, body text, occurred_at timestamptz, actor_id uuid, actor_name text, opportunity_id uuid, lead_id uuid, purchase_id uuid, visit_id uuid, metadata jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.kind, a.channel, a.subject, a.body, a.occurred_at, a.actor_id, p.full_name, a.opportunity_id, a.lead_id, a.purchase_id, a.visit_id, a.metadata
  from sales.activities a
  left join core.profiles p on p.user_id = a.actor_id
  where a.workspace_id in (select core.member_workspace_ids()) and core.has_permission('sales.read')
    and case p_entity_type
      when 'contact' then a.contact_id = p_entity_id
      when 'account' then a.account_id = p_entity_id
      when 'project' then a.project_id = p_entity_id
      when 'opportunity' then a.opportunity_id = p_entity_id
      when 'lead' then a.lead_id = p_entity_id
      else false end
  order by a.occurred_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
grant execute on function api.entity_timeline(text,uuid,int) to authenticated;

------------------------------------------------------------------------------
-- Current approved price lookup for catalog screens
------------------------------------------------------------------------------
create or replace view api.current_variant_prices with (security_invoker = true) as
select vp.id, vp.workspace_id, vp.variant_id, v.product_id, vp.price_list_id, pl.name as price_list_name, pl.price_type,
       vp.amount, vp.currency, u.code as unit_code, u.label as unit_label, vp.min_quantity, vp.valid_from, vp.valid_to,
       vp.state, vp.review_state, vp.source_ref, vp.approved_at, vp.approved_by
from merch.variant_prices vp
join merch.product_variants v on v.id = vp.variant_id
join merch.price_lists pl on pl.id = vp.price_list_id
left join merch.units_of_measure u on u.id = vp.unit_id
where vp.state in ('current','scheduled','conflicted');
grant select on api.current_variant_prices to authenticated;
