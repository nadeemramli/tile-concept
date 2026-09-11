-- Lead identity sharing (PRD §6, §7.2, §7.4).
--
-- An enquiry's phone and email lived only on sales.leads, where nothing in the
-- identity layer could see them: the walk-in lookup told staff "safe to create
-- a new one" for a customer who enquired last week, global search had no lead
-- branch, and linking a lead to a contact discarded the lead's identifiers and
-- orphaned its history. This migration:
--
--   1. normalises lead identifiers in one trigger (phone, email, and the
--      contact's phone for walk-in leads that never carried one);
--   2. adds api.link_lead_contact, the single way a lead is attached to a
--      contact/account: carries the lead's phone/email onto the contact,
--      moves activities and tasks logged before the link, and audits it;
--   3. makes api.convert_lead use the same attachment;
--   4. teaches api.find_identity_candidates and api.global_search to return
--      unlinked enquiries, and to say "enquired before" on matched contacts;
--   5. closes the inbox owner gap: api.log_lead_response and api.convert_lead
--      are SECURITY DEFINER and skipped the owner scope the update policy
--      enforces (20260904074501). Both now refuse a non-owner without
--      sales.read_all, exactly like api.change_opportunity_stage;
--   6. hardens the sales.opportunities update policy so ownership is stated
--      on the policy itself rather than inherited from the select policy.

------------------------------------------------------------------------------
-- 1. Normalised identifiers on leads
------------------------------------------------------------------------------
alter table sales.leads add column if not exists raw_email_normalized text;
create index if not exists leads_email_idx on sales.leads (workspace_id, raw_email_normalized);

create or replace function sales.normalize_lead_identifiers()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.raw_phone_normalized := core.normalize_phone(new.raw_phone);
  new.raw_email_normalized := core.normalize_text(trim(new.raw_email));
  -- A lead created from an already-resolved contact (a walk-in) carries that
  -- contact's primary phone so every lead answers the same lookup.
  if new.raw_phone is null and new.contact_id is not null then
    select cp.raw_value, cp.normalized_value into new.raw_phone, new.raw_phone_normalized
    from identity.contact_points cp
    where cp.contact_id = new.contact_id and cp.kind in ('phone','whatsapp')
    order by cp.is_primary desc, cp.created_at
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists leads_normalize on sales.leads;
create trigger leads_normalize
  before insert or update of raw_phone, raw_email, contact_id on sales.leads
  for each row execute function sales.normalize_lead_identifiers();

-- Backfill: emails, and phones for walk-in leads created without one.
update sales.leads set raw_email = raw_email where raw_email is not null;
update sales.leads set contact_id = contact_id where raw_phone is null and contact_id is not null;

------------------------------------------------------------------------------
-- 2. Owner scope for lead RPCs, and the one attachment routine
------------------------------------------------------------------------------
create or replace function sales.require_lead_owner(l sales.leads)
returns void language plpgsql stable set search_path = '' as $$
begin
  if not core.has_permission('sales.read_all') and l.owner_id is not null and l.owner_id <> auth.uid() then
    raise exception 'permission denied: not the owner' using errcode = '42501';
  end if;
end $$;

-- Internal: attach a lead to a contact and/or account. Not exposed; called by
-- api.link_lead_contact and api.convert_lead after their own checks.
create or replace function sales.attach_lead_identity(p_lead_id uuid, p_contact_id uuid, p_account_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  l sales.leads%rowtype;
  v_has_points boolean;
begin
  select * into l from sales.leads where id = p_lead_id for update;
  if not found then raise exception 'lead not found'; end if;

  update sales.leads
    set contact_id = coalesce(p_contact_id, contact_id),
        account_id = coalesce(p_account_id, account_id)
  where id = l.id;

  if p_contact_id is not null then
    -- The enquiry's identifiers become contact points, so the next lookup by
    -- this number or email finds the customer directly.
    select exists (select 1 from identity.contact_points cp where cp.contact_id = p_contact_id) into v_has_points;
    if l.raw_phone_normalized is not null and not exists (
      select 1 from identity.contact_points cp
      where cp.contact_id = p_contact_id and cp.kind in ('phone','whatsapp') and cp.normalized_value = l.raw_phone_normalized
    ) then
      insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
      values (l.workspace_id, p_contact_id, 'phone', coalesce(l.raw_phone, l.raw_phone_normalized), l.raw_phone_normalized, not v_has_points, l.source_channel);
      v_has_points := true;
    end if;
    if l.raw_email_normalized is not null and not exists (
      select 1 from identity.contact_points cp
      where cp.contact_id = p_contact_id and cp.kind = 'email' and cp.normalized_value = l.raw_email_normalized
    ) then
      insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
      values (l.workspace_id, p_contact_id, 'email', coalesce(l.raw_email, l.raw_email_normalized), l.raw_email_normalized, not v_has_points, l.source_channel);
    end if;

    -- History logged before the link had no contact to land on.
    update sales.activities set contact_id = p_contact_id where lead_id = l.id and contact_id is null;
    update sales.tasks set contact_id = p_contact_id where lead_id = l.id and contact_id is null;

    update identity.contacts
      set original_acquisition_source = coalesce(original_acquisition_source, l.source_channel),
          original_acquisition_at = coalesce(original_acquisition_at, l.created_at)
    where id = p_contact_id;
  end if;

  if p_account_id is not null then
    update sales.activities set account_id = p_account_id where lead_id = l.id and account_id is null;
  end if;
end $$;

create or replace function api.link_lead_contact(p_lead_id uuid, p_contact_id uuid default null, p_account_id uuid default null, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l sales.leads%rowtype;
begin
  perform core.require_permission('sales.write');
  select * into l from sales.leads where id = p_lead_id;
  if not found then raise exception 'lead not found'; end if;
  perform core.require_workspace(l.workspace_id);
  perform sales.require_lead_owner(l);
  if p_contact_id is null and p_account_id is null then
    raise exception 'choose a contact or an account to link' using errcode = '23514';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from identity.contacts c where c.id = p_contact_id and c.workspace_id = l.workspace_id and c.merged_into_contact_id is null and c.archived_at is null
  ) then
    raise exception 'contact not found';
  end if;
  if p_account_id is not null and not exists (
    select 1 from identity.accounts a where a.id = p_account_id and a.workspace_id = l.workspace_id and a.merged_into_account_id is null and a.archived_at is null
  ) then
    raise exception 'account not found';
  end if;

  perform sales.attach_lead_identity(l.id, p_contact_id, p_account_id);
  perform audit.emit(l.workspace_id, 'lead.linked', 'sales', 'leads', l.id,
    jsonb_build_object('contact_id', l.contact_id, 'account_id', l.account_id),
    jsonb_build_object('contact_id', coalesce(p_contact_id, l.contact_id), 'account_id', coalesce(p_account_id, l.account_id)),
    p_reason, '{}'::jsonb);
end $$;
grant execute on function api.link_lead_contact(uuid,uuid,uuid,text) to authenticated;

create or replace function api.log_lead_response(p_lead_id uuid, p_kind text, p_channel text, p_body text default null, p_reached boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l sales.leads%rowtype;
  v_id uuid;
begin
  perform core.require_permission('sales.write');
  select * into l from sales.leads where id = p_lead_id;
  if not found then raise exception 'lead not found'; end if;
  perform core.require_workspace(l.workspace_id);
  perform sales.require_lead_owner(l);
  insert into sales.activities (workspace_id, kind, channel, subject, body, actor_id, lead_id, contact_id, metadata)
  values (l.workspace_id, coalesce(p_kind, 'call'), p_channel, case when p_reached then 'Contacted' else 'Contact attempted' end, p_body, auth.uid(), p_lead_id, l.contact_id, jsonb_build_object('reached', p_reached))
  returning id into v_id;
  update sales.leads set
    first_response_at = coalesce(first_response_at, now()),
    contact_attempts = contact_attempts + 1,
    status = case when status in ('new','contact_attempted') then (case when p_reached then 'contacted' else 'contact_attempted' end) else status end
  where id = p_lead_id;
  return v_id;
end $$;

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
  perform sales.require_lead_owner(l);
  if l.status = 'converted' then raise exception 'lead already converted'; end if;
  if p_contact_id is null then raise exception 'link a customer record before converting' using errcode = '23514'; end if;

  insert into identity.projects (workspace_id, name, account_id, primary_contact_id, project_type, status, owner_id, created_by)
  values (l.workspace_id, coalesce(p_project_name, p_opportunity_name, coalesce(l.raw_name, 'Lead') || ' project'), p_account_id, p_contact_id, 'other', 'planning', coalesce(l.owner_id, auth.uid()), auth.uid())
  returning id into v_project;

  select key into v_stage from core.opportunity_stages where workspace_id = l.workspace_id and is_active and reporting_group = 'open' order by position offset 3 limit 1; -- 'qualified'
  insert into sales.opportunities (workspace_id, name, account_id, contact_id, project_id, lead_id, stage_key, status, owner_id, source_channel, estimated_value, product_interest, next_action, next_action_due_at, created_by)
  values (l.workspace_id, coalesce(p_opportunity_name, p_project_name, coalesce(l.raw_name, 'Lead') || ' opportunity'), p_account_id, p_contact_id, v_project, l.id,
          coalesce(v_stage, 'qualified'), 'open', coalesce(l.owner_id, auth.uid()), l.source_channel, p_estimated_value, l.product_interest, p_next_action, coalesce(p_next_action_due_at, now() + interval '2 days'), auth.uid())
  returning id into v_opp;
  insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, actor_id) values (l.workspace_id, v_opp, null, coalesce(v_stage, 'qualified'), auth.uid());

  -- Same attachment as api.link_lead_contact: identifiers and history travel with the lead.
  perform sales.attach_lead_identity(l.id, p_contact_id, p_account_id);
  update sales.leads set status = 'converted', converted_opportunity_id = v_opp, qualified_at = coalesce(qualified_at, now()) where id = l.id;

  insert into sales.activities (workspace_id, kind, subject, actor_id, lead_id, contact_id, account_id, project_id, opportunity_id)
  values (l.workspace_id, 'system', 'Lead converted to opportunity', auth.uid(), l.id, p_contact_id, p_account_id, v_project, v_opp);
  perform audit.emit(l.workspace_id, 'lead.converted', 'sales', 'leads', l.id, null, jsonb_build_object('opportunity_id', v_opp, 'project_id', v_project), null, '{}'::jsonb);
  return jsonb_build_object('project_id', v_project, 'opportunity_id', v_opp);
end $$;

------------------------------------------------------------------------------
-- 3. Lookups see enquiries
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
  v_email text := core.normalize_text(trim(p_email));
  v_name text := core.normalize_text(p_name);
  v_company text := core.normalize_text(p_company);
  v_reg text := core.normalize_key(p_registration_number);
  -- Mirrors the sales.leads select policy so a candidate never reveals a lead
  -- the caller could not open.
  v_leads_all boolean := core.has_permission('sales.read_all') or core.has_permission('sales.leads.read_all');
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
  -- Enquiries not yet attached to a contact. Exact identifiers only: a name
  -- alone is never enough to say two enquiries are the same person.
  lead_hits as (
    select l.id, coalesce(l.raw_name, l.raw_company) as display_name, l.status, l.source_channel, l.created_at,
      l.raw_phone_normalized, l.raw_email_normalized,
      jsonb_agg(distinct jsonb_build_object('code', h.code, 'field', h.field, 'weight', h.weight)) as reasons,
      sum(h.weight) as score
    from sales.leads l
    join lateral (
      select 'exact_phone' as code, 'phone' as field, 60 as weight
        where v_phone is not null and l.raw_phone_normalized = v_phone
      union all
      select 'exact_email', 'email', 55
        where v_email is not null and l.raw_email_normalized = v_email
    ) h on true
    where l.workspace_id = v_ws and l.contact_id is null and l.status <> 'duplicate'
      and (v_leads_all or l.owner_id is null or l.owner_id = auth.uid())
    group by l.id
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
      ch.score::numeric,
      -- "Enquired before": a zero-weight reason carrying the enquiry facts, so
      -- the walk-in counter can say so without changing the score.
      ch.reasons || coalesce((
        select jsonb_build_array(jsonb_build_object(
          'code', 'prior_enquiry', 'field', 'lead', 'weight', 0,
          'count', count(*),
          'channel', (array_agg(l.source_channel order by l.created_at desc))[1],
          'status', (array_agg(l.status order by l.created_at desc))[1],
          'at', max(l.created_at)))
        from sales.leads l where l.contact_id = ch.id and l.status <> 'duplicate'
        having count(*) > 0), '[]'::jsonb),
      (select core.mask_value(cp.normalized_value, 'phone') from identity.contact_points cp where cp.contact_id = ch.id and cp.kind in ('phone','whatsapp') order by cp.is_primary desc, cp.created_at limit 1),
      (select core.mask_value(cp.normalized_value, 'email') from identity.contact_points cp where cp.contact_id = ch.id and cp.kind = 'email' order by cp.is_primary desc, cp.created_at limit 1),
      ch.lifecycle_state,
      (select max(a.occurred_at) from sales.activities a where a.contact_id = ch.id)
    from contact_hits ch
    union all
    select 'lead', lh.id, coalesce(lh.display_name, 'Enquiry'),
      case when lh.score >= 55 then 'high' when lh.score >= 25 then 'medium' else 'low' end,
      lh.score::numeric,
      lh.reasons || jsonb_build_array(jsonb_build_object(
        'code', 'prior_enquiry', 'field', 'lead', 'weight', 0,
        'count', 1, 'channel', lh.source_channel, 'status', lh.status, 'at', lh.created_at)),
      core.mask_value(lh.raw_phone_normalized, 'phone'),
      core.mask_value(lh.raw_email_normalized, 'email'),
      null,
      coalesce((select max(a.occurred_at) from sales.activities a where a.lead_id = lh.id), lh.created_at)
    from lead_hits lh
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

create or replace function api.global_search(p_query text, p_limit int default 20)
returns table (entity_type text, entity_id uuid, title text, subtitle text, href text, score real)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  q text := core.normalize_text(p_query);
  qkey text := core.normalize_key(p_query);
  qdigits text := nullif(regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g'), '');
  v_leads_all boolean := core.has_permission('sales.read_all') or core.has_permission('sales.leads.read_all');
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
    -- Enquiries, by name, phone or email, under the same visibility as the inbox.
    select 'lead', l.id, coalesce(l.raw_name, l.raw_company, 'Enquiry'),
      l.source_channel || ' · ' || replace(l.status, '_', ' ') || case when l.contact_id is null then '' else ' · linked' end,
      '/sales/inbox?lead=' || l.id,
      case
        when qdigits is not null and length(qdigits) >= 4 and l.raw_phone_normalized like '%' || qdigits || '%' then 1.0
        when l.raw_email_normalized like '%' || q || '%' then 1.0
        else greatest(extensions.similarity(core.normalize_text(coalesce(l.raw_name, l.raw_company)), q), 0)
      end::real
    from sales.leads l
    where l.workspace_id = v_ws and core.has_permission('sales.read') and l.status <> 'duplicate'
      and (v_leads_all or l.owner_id is null or l.owner_id = auth.uid())
      and ((qdigits is not null and length(qdigits) >= 4 and l.raw_phone_normalized like '%' || qdigits || '%')
        or l.raw_email_normalized like '%' || q || '%'
        or core.normalize_text(coalesce(l.raw_name, l.raw_company)) like '%' || q || '%')
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

------------------------------------------------------------------------------
-- 4. Ownership stated on the opportunities update policy itself
------------------------------------------------------------------------------
drop policy if exists member_update on sales.opportunities;
create policy member_update on sales.opportunities
  for update to authenticated
  using (
    workspace_id in (select core.member_workspace_ids())
    and (select core.has_permission('sales.write'))
    and ((select core.has_permission('sales.read_all')) or owner_id is null or owner_id = (select auth.uid()))
  )
  with check (
    workspace_id in (select core.member_workspace_ids())
    and (select core.has_permission('sales.write'))
    and ((select core.has_permission('sales.read_all')) or owner_id is null or owner_id = (select auth.uid()))
  );
