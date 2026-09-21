-- Visits are interactions with a buying inquiry, not new acquisition events.
-- Existing links stay labelled legacy: no inferred historical attribution.
-- Counter staff need the same shared inquiry visibility as sales reps to confirm
-- showroom matches. Existing lead/opportunity owner write boundaries stay intact.
insert into core.role_permissions(role_key,permission) values('showroom','sales.leads.read_all') on conflict do nothing;
alter table sales.visits
  add column inquiry_link_state text not null default 'legacy'
    check (inquiry_link_state in ('legacy','linked','direct','needs_linking')),
  add column inquiry_link_reason text,
  add column inquiry_link_version integer not null default 0;
create index visits_lead_occurred_idx on sales.visits(workspace_id, lead_id, occurred_at, id);
create index visits_needs_linking_idx on sales.visits(workspace_id, occurred_at desc) where inquiry_link_state = 'needs_linking';
create or replace view api.visits with (security_invoker = true) as select * from sales.visits;

create table sales.walk_in_requests (
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id, request_id)
);
alter table sales.walk_in_requests enable row level security;
revoke all on sales.walk_in_requests from public, anon, authenticated;

-- Only the transactional commands may change attribution/identity on a visit.
create function sales.guard_visit_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') and
    (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id
      or new.contact_id is distinct from old.contact_id or new.account_id is distinct from old.account_id
      or new.opportunity_id is distinct from old.opportunity_id or new.occurred_at is distinct from old.occurred_at
      or new.workspace_id is distinct from old.workspace_id
      or new.inquiry_link_state is distinct from old.inquiry_link_state
      or new.inquiry_link_reason is distinct from old.inquiry_link_reason
      or new.inquiry_link_version is distinct from old.inquiry_link_version) then
    raise exception 'Use the showroom visit commands to change identity or inquiry links' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_visit_link before insert or update on sales.visits for each row execute function sales.guard_visit_link();

-- Identity is confirmed by the counter operator first. Exact identifiers only;
-- names are never enough for acquisition attribution. Return conflicts so staff
-- can see why automatic matching was withheld, without reassigning a customer.
create function api.walk_in_inquiries(p_contact_id uuid, p_occurred_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c identity.contacts%rowtype; v_rows jsonb; v_safe boolean; v_auto uuid;
begin
  perform core.require_permission('sales.write');
  select * into c from identity.contacts where id = p_contact_id and workspace_id = core.current_workspace_id()
    and archived_at is null and merged_into_contact_id is null;
  if not found then raise exception 'Active customer not found' using errcode = '23514'; end if;
  if p_occurred_at is null or not isfinite(p_occurred_at) then raise exception 'Valid visit time required'; end if;
  v_safe := not c.is_provisional and not exists (
    select 1 from identity.contact_points p where p.contact_id = c.id and p.workspace_id = c.workspace_id
      and p.kind in ('phone','whatsapp','email') and (p.is_shared or exists (
        select 1 from identity.contact_points q join identity.contacts other on other.id = q.contact_id
        where q.workspace_id = c.workspace_id and q.contact_id <> c.id
          and other.archived_at is null and other.merged_into_contact_id is null
          and q.normalized_value = p.normalized_value
          and (q.kind = p.kind or (q.kind in ('phone','whatsapp') and p.kind in ('phone','whatsapp'))))));
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id), '[]') into v_rows from (
    select l.id, coalesce(nullif(l.raw_name,''),c.display_name) as name, l.source_channel, l.status,
      l.created_at, l.interest, l.converted_opportunity_id as opportunity_id, o.name as opportunity_name,
      case when conflict.has_conflict or (l.contact_id is not null and l.contact_id <> c.id) then 'Conflicting customer identity: review the contact records first'
        when l.status in ('disqualified','duplicate') or l.duplicate_of_lead_id is not null or o.status in ('won','lost') then 'Closed inquiry: confirm continuation or start a new inquiry'
        when not v_safe then 'Shared identifier or provisional customer: staff confirmation required'
        when l.contact_id = c.id then 'Confirmed customer'
        else 'Exact phone or email match' end as match_reason,
      not conflict.has_conflict and (l.contact_id is null or l.contact_id = c.id) and l.status <> 'duplicate' and l.duplicate_of_lead_id is null as can_link,
      l.status in ('disqualified','duplicate') or coalesce(o.status,'open') in ('won','lost') as closed,
      v_safe and not conflict.has_conflict and (l.contact_id is null or l.contact_id = c.id) and l.status not in ('disqualified','duplicate')
        and l.duplicate_of_lead_id is null and coalesce(o.status,'open') = 'open' as auto_eligible
    from sales.leads l left join sales.opportunities o on o.id = l.converted_opportunity_id and o.workspace_id = l.workspace_id
    cross join lateral (select exists (
      select 1 from identity.contact_points q join identity.contacts other on other.id = q.contact_id
      where q.workspace_id = c.workspace_id and q.contact_id <> c.id
        and other.archived_at is null and other.merged_into_contact_id is null
        and ((q.kind in ('phone','whatsapp') and q.normalized_value = l.raw_phone_normalized)
          or (q.kind = 'email' and q.normalized_value = l.raw_email_normalized))
        and not exists(select 1 from identity.contact_points own where own.contact_id = c.id and own.workspace_id = c.workspace_id
          and own.normalized_value = q.normalized_value
          and (own.kind = q.kind or (own.kind in ('phone','whatsapp') and q.kind in ('phone','whatsapp'))))
    ) as has_conflict) conflict
    where l.workspace_id = c.workspace_id and l.created_at <= p_occurred_at
      and (core.has_permission('sales.read_all') or core.has_permission('sales.leads.read_all') or l.owner_id is null or l.owner_id = auth.uid())
      and (l.contact_id = c.id or exists (select 1 from identity.contact_points p
        where p.contact_id = c.id and p.workspace_id = c.workspace_id and
          ((p.kind in ('phone','whatsapp') and p.normalized_value = l.raw_phone_normalized)
            or (p.kind = 'email' and p.normalized_value = l.raw_email_normalized))))
  ) x;
  if jsonb_array_length(v_rows) = 1 and (v_rows->0->>'auto_eligible')::boolean then
    v_auto := (v_rows->0->>'id')::uuid;
  end if;
  -- Hidden inquiries cannot be selected, but must still block automatic guesses.
  if exists (select 1 from sales.leads l where l.workspace_id = c.workspace_id and l.created_at <= p_occurred_at
    and not (core.has_permission('sales.read_all') or core.has_permission('sales.leads.read_all') or l.owner_id is null or l.owner_id = auth.uid())
    and (l.contact_id = c.id or exists(select 1 from identity.contact_points p where p.contact_id = c.id and p.workspace_id = c.workspace_id
      and ((p.kind in ('phone','whatsapp') and p.normalized_value = l.raw_phone_normalized) or (p.kind = 'email' and p.normalized_value = l.raw_email_normalized))))) then
    v_safe := false; v_auto := null;
  end if;
  return jsonb_build_object('candidates',v_rows,'automatic_lead_id',v_auto,
    'can_start_direct',v_safe and jsonb_array_length(v_rows) = 0,
    'needs_review',not v_safe or (jsonb_array_length(v_rows) > 0 and v_auto is null));
end $$;
revoke all on function api.walk_in_inquiries(uuid,timestamptz) from public, anon;
grant execute on function api.walk_in_inquiries(uuid,timestamptz) to authenticated;

-- Shared resolver for save and later correction. A closed inquiry can receive
-- an explicitly confirmed repeat visit; its sales outcome is never reopened here.
create function sales.resolve_walk_in_lead(p_contact_id uuid, p_at timestamptz, p_mode text, p_lead_id uuid, p_reason text, p_details jsonb, p_require_owner boolean default false)
returns uuid language plpgsql set search_path = '' as $$
declare v_matches jsonb; v_candidate jsonb; v_lead uuid;
begin
  if p_mode is null or p_mode not in ('automatic','choose','new','unlinked') then raise exception 'Choose how to link the inquiry'; end if;
  if p_mode in ('choose','new') and length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'Explain the inquiry decision (at least 5 characters)'; end if;
  v_matches := api.walk_in_inquiries(p_contact_id,p_at);
  if p_mode = 'unlinked' then return null; end if;
  if p_mode = 'choose' then
    select x into v_candidate from jsonb_array_elements(v_matches->'candidates') x where x->>'id' = p_lead_id::text;
    if v_candidate is null or not (v_candidate->>'can_link')::boolean then
      raise exception 'This inquiry does not match the confirmed customer and visit date' using errcode = '23514';
    end if;
    v_lead := p_lead_id;
  elsif p_mode = 'automatic' then
    v_lead := (v_matches->>'automatic_lead_id')::uuid;
    if v_lead is null and not (v_matches->>'can_start_direct')::boolean then return null; end if;
  end if;
  if v_lead is null then
    insert into sales.leads(workspace_id,status,source_channel,source_detail,contact_id,account_id,raw_name,owner_id,created_by,created_at,interest,product_interest,location_id)
      select workspace_id,'contacted','walk_in',nullif(p_details->>'inquiry_source',''),id,nullif(p_details->>'account_id','')::uuid,display_name,
        coalesce(nullif(p_details->>'staff_user_id','')::uuid,auth.uid()),auth.uid(),p_at,
        nullif(p_details->>'notes',''),array(select jsonb_array_elements_text(coalesce(p_details->'product_interest','[]'))),nullif(p_details->>'location_id','')::uuid
      from identity.contacts where id = p_contact_id
      returning id into v_lead;
  else
    perform 1 from sales.leads where id = v_lead for update;
    -- Recheck the full decision after locking; identity or outcome may have changed.
    v_matches := api.walk_in_inquiries(p_contact_id,p_at);
    select x into v_candidate from jsonb_array_elements(v_matches->'candidates') x where x->>'id' = v_lead::text;
    if v_candidate is null or not (v_candidate->>'can_link')::boolean
      or (p_mode = 'automatic' and (v_matches->>'automatic_lead_id')::uuid is distinct from v_lead) then
      raise exception 'Inquiry changed. Refresh and review the match.' using errcode = '40001';
    end if;
    if p_require_owner and not (v_candidate->>'closed')::boolean then
      perform sales.require_lead_owner(l) from sales.leads l where l.id = v_lead;
    end if;
    update sales.leads set contact_id = p_contact_id where id = v_lead and contact_id is null;
  end if;
  return v_lead;
end $$;
revoke all on function sales.resolve_walk_in_lead(uuid,timestamptz,text,uuid,text,jsonb,boolean) from public, anon, authenticated;

create function api.record_showroom_visit(p_input jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id(); v_contact uuid := (p_input->>'contact_id')::uuid;
  v_account uuid := nullif(p_input->>'account_id','')::uuid; v_location uuid := nullif(p_input->>'location_id','')::uuid;
  v_staff uuid := coalesce(nullif(p_input->>'staff_user_id','')::uuid,auth.uid());
  v_at timestamptz := coalesce((p_input->>'occurred_at')::timestamptz,now());
  v_mode text := coalesce(p_input->>'inquiry_mode','automatic'); v_reason text := nullif(btrim(p_input->>'inquiry_reason'),'');
  v_visit uuid; v_lead uuid; v_project uuid; v_opp uuid := nullif(p_input->>'opportunity_id','')::uuid; v_purchase uuid;
  v_source text; v_opp_lead uuid; v_state text; v_prior integer; v_stage text; v_result jsonb; v_saved sales.walk_in_requests%rowtype;
  v_products text[] := array(select jsonb_array_elements_text(coalesce(p_input->'product_interest','[]')));
  v_p jsonb := nullif(p_input->'purchase','null'::jsonb);
begin
  perform core.require_permission('sales.write');
  if p_request_id is null or p_input is null or jsonb_typeof(p_input) <> 'object' then raise exception 'Visit details and request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_ws::text || p_request_id::text,0));
  select * into v_saved from sales.walk_in_requests where workspace_id = v_ws and request_id = p_request_id;
  if found then
    if v_saved.actor_id <> auth.uid() or v_saved.payload <> p_input then raise exception 'Request ID already used for different visit details' using errcode = '23514'; end if;
    return v_saved.result;
  end if;
  if not isfinite(v_at) or v_at > now() + interval '5 minutes' then raise exception 'Visit time must not be in the future'; end if;
  perform 1 from identity.contacts where id = v_contact and workspace_id = v_ws and archived_at is null and merged_into_contact_id is null for update;
  if not found then raise exception 'Active customer not found' using errcode = '23514'; end if;
  if v_account is not null and not exists(select 1 from identity.accounts where id = v_account and workspace_id = v_ws and archived_at is null and merged_into_account_id is null) then raise exception 'Account not in this workspace'; end if;
  if v_location is not null and not exists(select 1 from core.business_locations where id = v_location and workspace_id = v_ws) then raise exception 'Location not in this workspace'; end if;
  if not exists(select 1 from core.memberships where user_id = v_staff and workspace_id = v_ws and status = 'active') then raise exception 'Active staff member required'; end if;
  if v_opp is not null and coalesce((p_input->>'create_opportunity')::boolean,false) then raise exception 'Choose an existing opportunity or create a new one, not both'; end if;
  if v_opp is not null then
    select project_id,lead_id into v_project,v_opp_lead from sales.opportunities where id = v_opp and workspace_id = v_ws
      and contact_id = v_contact and status = 'open' and (v_account is null or account_id is null or account_id = v_account);
    if not found then raise exception 'Choose an open opportunity for this customer'; end if;
  end if;
  v_lead := sales.resolve_walk_in_lead(v_contact,v_at,v_mode,nullif(p_input->>'inquiry_lead_id','')::uuid,v_reason,p_input,coalesce((p_input->>'create_opportunity')::boolean,false));
  if v_lead is not null then
    select source_channel into v_source from sales.leads where id = v_lead;
    if exists(select 1 from sales.leads where id = v_lead and account_id is not null and v_account is not null and account_id <> v_account) then raise exception 'Inquiry belongs to a different account'; end if;
    if v_opp is not null and v_opp_lead is distinct from v_lead then raise exception 'Opportunity and inquiry must belong to the same buying inquiry'; end if;
    if coalesce((p_input->>'create_opportunity')::boolean,false) and exists(select 1 from sales.leads where id = v_lead and converted_opportunity_id is not null) then raise exception 'Inquiry already has an opportunity. Choose it or record the visit without a new opportunity.'; end if;
    if coalesce((p_input->>'create_opportunity')::boolean,false) and exists(select 1 from sales.leads where id = v_lead and status = 'disqualified') then raise exception 'Ask the inquiry owner to reopen it before creating an opportunity'; end if;
    v_state := case when v_source = 'walk_in' then 'direct' else 'linked' end;
  else
    v_state := 'needs_linking';
    if v_opp is not null or coalesce((p_input->>'create_opportunity')::boolean,false) then raise exception 'Resolve the inquiry before linking or creating an opportunity'; end if;
  end if;
  select count(*) into v_prior from sales.visits where workspace_id = v_ws and contact_id = v_contact;
  insert into sales.visits(workspace_id,occurred_at,location_id,staff_user_id,contact_id,account_id,lead_id,
    customer_type,origin_area,inquiry_source,purpose,is_new_customer,notes,created_by,renovation_area,quotation_ref,quotation_amount,
    inquiry_link_state,inquiry_link_reason,inquiry_link_version)
  values(v_ws,v_at,v_location,v_staff,v_contact,v_account,v_lead,nullif(p_input->>'customer_type',''),nullif(p_input->>'origin_area',''),
    nullif(p_input->>'inquiry_source',''),coalesce(p_input->>'purpose','browse'),v_prior=0,nullif(p_input->>'notes',''),auth.uid(),
    nullif(p_input->>'renovation_area',''),nullif(p_input->>'quotation_ref',''),(p_input->>'quotation_amount')::numeric,v_state,v_reason,1)
  returning id into v_visit;
  -- Contact attribution is filled only when unknown; the original inquiry's
  -- source/owner and all WhatsApp milestones are untouched.
  update identity.contacts set original_acquisition_source = coalesce(original_acquisition_source,v_source),
    original_acquisition_at = coalesce(original_acquisition_at,(select created_at from sales.leads where id = v_lead)),
    customer_type = coalesce(customer_type,nullif(p_input->>'customer_type','')) where id = v_contact;
  if coalesce((p_input->>'create_opportunity')::boolean,false) then
    insert into identity.projects(workspace_id,name,account_id,primary_contact_id,project_type,status,area,owner_id,created_by)
      values(v_ws,coalesce(nullif(p_input->>'project_name',''),'Walk-in project'),v_account,v_contact,'other','planning',p_input->>'origin_area',v_staff,auth.uid()) returning id into v_project;
    select key into v_stage from core.opportunity_stages where workspace_id = v_ws and is_active and reporting_group = 'open' order by position limit 1;
    insert into sales.opportunities(workspace_id,name,account_id,contact_id,project_id,lead_id,stage_key,status,owner_id,source_channel,product_interest,next_action,next_action_due_at,created_by)
      values(v_ws,coalesce(nullif(p_input->>'opportunity_name',''),nullif(p_input->>'project_name',''),'Walk-in opportunity'),v_account,v_contact,v_project,v_lead,coalesce(v_stage,'new_inquiry'),'open',v_staff,v_source,v_products,'Follow up after showroom visit',v_at+interval '2 days',auth.uid()) returning id into v_opp;
    insert into sales.opportunity_stage_events(workspace_id,opportunity_id,to_stage_key,actor_id) values(v_ws,v_opp,coalesce(v_stage,'new_inquiry'),auth.uid());
    update sales.leads set status = 'converted', converted_opportunity_id = v_opp where id = v_lead;
  end if;
  update sales.visits set opportunity_id = v_opp where id = v_visit;
  insert into sales.activities(workspace_id,kind,channel,subject,body,occurred_at,actor_id,contact_id,account_id,project_id,opportunity_id,lead_id,visit_id,metadata)
    values(v_ws,'walk_in','walk_in','Showroom visit',p_input->>'notes',v_at,auth.uid(),v_contact,v_account,v_project,v_opp,v_lead,v_visit,
      jsonb_build_object('purpose',p_input->>'purpose','inquiry_link_state',v_state,'inquiry_mode',v_mode,'reason',v_reason));
  if v_p is not null then
    v_purchase := api.record_purchase(v_contact,v_account,(v_p->>'amount')::numeric,v_p->>'external_ref',
      coalesce(v_p->'payments','[]'),coalesce(v_p->'items','[]'),v_opp,v_project,v_visit,v_location,v_staff,
      coalesce(v_p->>'purchase_source','walk_in'),v_at,v_p->>'notes');
  end if;
  perform audit.emit(v_ws,'visit.recorded','sales','visits',v_visit,null,jsonb_build_object('lead_id',v_lead,'inquiry_link_state',v_state),v_reason);
  v_result := jsonb_build_object('visit_id',v_visit,'lead_id',v_lead,'opportunity_id',v_opp,'project_id',v_project,'purchase_id',v_purchase,'new_customer',v_prior=0,'inquiry_link_state',v_state);
  insert into sales.walk_in_requests(workspace_id,request_id,actor_id,payload,result) values(v_ws,p_request_id,auth.uid(),p_input,v_result);
  return v_result;
end $$;
revoke all on function api.record_showroom_visit(jsonb,uuid) from public, anon;
grant execute on function api.record_showroom_visit(jsonb,uuid) to authenticated;

create function api.resolve_visit_inquiry(p_visit_id uuid, p_mode text, p_lead_id uuid default null, p_reason text default null, p_expected_version integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v sales.visits%rowtype; v_lead uuid; v_state text;
begin
  perform core.require_permission('sales.write');
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'Explain the correction (at least 5 characters)'; end if;
  if p_mode is null or p_mode not in ('choose','new','unlinked') then raise exception 'Choose a correction'; end if;
  -- Same lock order as visit creation: contact, then visit, then inquiry.
  perform 1 from identity.contacts where id = (select contact_id from sales.visits where id = p_visit_id and workspace_id = core.current_workspace_id()) for update;
  select * into v from sales.visits where id = p_visit_id and workspace_id = core.current_workspace_id() for update;
  if not found or v.contact_id is null then raise exception 'Visit with a confirmed customer required'; end if;
  if p_expected_version is distinct from v.inquiry_link_version then raise exception 'Visit link changed. Refresh before correcting it.' using errcode = '40001'; end if;
  v_lead := sales.resolve_walk_in_lead(v.contact_id,v.occurred_at,p_mode,p_lead_id,p_reason,jsonb_build_object('notes',v.notes,'inquiry_source',v.inquiry_source));
  if v.account_id is not null and exists(select 1 from sales.leads where id=v_lead and account_id is not null and account_id<>v.account_id) then
    raise exception 'Inquiry belongs to a different account';
  end if;
  if v.opportunity_id is not null and not exists(select 1 from sales.opportunities where id = v.opportunity_id and lead_id = v_lead) then
    raise exception 'This visit has an opportunity. Its inquiry must stay consistent; review the opportunity first.';
  end if;
  v_state := case when v_lead is null then 'needs_linking' when (select source_channel from sales.leads where id = v_lead) = 'walk_in' then 'direct' else 'linked' end;
  update sales.visits set lead_id=v_lead,inquiry_link_state=v_state,inquiry_link_reason=p_reason,inquiry_link_version=inquiry_link_version+1 where id=v.id;
  update identity.contacts c set original_acquisition_source = coalesce(c.original_acquisition_source,l.source_channel),
    original_acquisition_at = coalesce(c.original_acquisition_at,l.created_at)
    from sales.leads l where c.id=v.contact_id and l.id=v_lead and c.workspace_id=v.workspace_id and l.workspace_id=v.workspace_id;
  update sales.activities set lead_id=v_lead where visit_id=v.id and kind='walk_in';
  if v.lead_id is not null and v.lead_id is distinct from v_lead then
    insert into sales.activities(workspace_id,kind,channel,subject,body,actor_id,contact_id,lead_id,metadata)
      values(v.workspace_id,'note','walk_in','Showroom visit relinked',p_reason,auth.uid(),v.contact_id,v.lead_id,
        jsonb_build_object('visit_id',v.id,'old_lead_id',v.lead_id,'new_lead_id',v_lead));
  end if;
  insert into sales.activities(workspace_id,kind,channel,subject,body,actor_id,contact_id,lead_id,visit_id,metadata)
    values(v.workspace_id,'note','walk_in','Visit inquiry link corrected',p_reason,auth.uid(),v.contact_id,v_lead,v.id,
      jsonb_build_object('old_lead_id',v.lead_id,'new_lead_id',v_lead));
  perform audit.emit(v.workspace_id,'visit.inquiry_link_corrected','sales','visits',v.id,jsonb_build_object('lead_id',v.lead_id),jsonb_build_object('lead_id',v_lead),p_reason);
end $$;
revoke all on function api.resolve_visit_inquiry(uuid,text,uuid,text,integer) from public, anon;
grant execute on function api.resolve_visit_inquiry(uuid,text,uuid,text,integer) to authenticated;

-- Compatibility entry point also uses the new matching rules.
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
begin
  return api.record_showroom_visit(jsonb_build_object(
    'contact_id',p_contact_id,'account_id',p_account_id,'location_id',p_location_id,'staff_user_id',p_staff_user_id,
    'occurred_at',p_occurred_at,'customer_type',p_customer_type,'origin_area',p_origin_area,'inquiry_source',p_inquiry_source,
    'purpose',p_purpose,'notes',p_notes,'create_opportunity',p_create_opportunity,'opportunity_id',p_opportunity_id,
    'project_name',p_project_name,'opportunity_name',p_opportunity_name,'product_interest',p_product_interest,'purchase',p_purchase),gen_random_uuid());
end $$;
revoke all on function api.record_walk_in(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,uuid,text,text,text[],jsonb) from public, anon;
grant execute on function api.record_walk_in(uuid,uuid,uuid,uuid,timestamptz,text,text,text,text,text,boolean,uuid,text,text,text[],jsonb) to authenticated;

create or replace view api.inbox_leads with (security_invoker = true) as
select l.*, f.next_follow_up_task_id, f.next_follow_up_at, f.follow_up_owner_id,
       f.open_follow_ups, f.completed_follow_ups,
       (l.status not in ('disqualified','duplicate') and
         ((l.first_response_at is null and s.first_showroom_at is null) or
          (f.open_follow_ups = 0 and l.no_next_action_reason is null) or
          (f.open_follow_ups > 0 and f.next_follow_up_at is null) or
          coalesce(f.next_follow_up_at < (date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur',false))) as needs_action, s.first_showroom_at, s.showroom_visits
from sales.leads l left join lateral api.lead_followup_summary(l.id) f on true
left join lateral (select min(v.occurred_at) as first_showroom_at, count(*) as showroom_visits
  from sales.visits v where v.workspace_id = l.workspace_id and v.lead_id = l.id) s on true;
grant select on api.inbox_leads to authenticated;


create or replace function api.inquiry_page(p_view text default 'needs-action', p_search text default '',
  p_owner text default 'all', p_source text default '', p_page integer default 1, p_size integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb; v_end timestamptz := (date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur';
begin
  perform core.require_permission('sales.read');
  if p_view is null or p_view not in ('needs-action','new','waiting','contacted','replied','unassigned','mine','no-response','follow-up','follow-ups-due','upcoming','follow-ups-completed','duplicates','qualified','disqualified','all','aging','showroom') then
    raise exception 'Unknown inbox view' using errcode = '22023';
  end if;
  if p_size is null or p_page is null or p_search is null or p_owner is null or p_source is null
    or p_size < 1 or p_size > 100 or p_page < 1 or p_page > 1000000 or length(p_search) > 200 then
    raise exception 'Invalid page or search' using errcode = '22023';
  end if;
  with base as materialized (
    select l.*, array_remove(array[
      'all',
      case when l.first_showroom_at is not null then 'showroom' end,
      case when l.needs_action then 'needs-action' end,
      case when l.status = 'new' then 'new' end,
      case when l.status = 'contact_attempted' and l.source_channel <> 'walk_in' and l.first_customer_reply_at is null then 'waiting' end,
      case when l.status = 'contacted' and l.source_channel <> 'walk_in' then 'contacted' end,
      case when l.first_customer_reply_at is not null and l.status not in ('disqualified','duplicate') then 'replied' end,
      case when l.owner_id is null and l.status in ('new','contact_attempted','contacted','qualified','converted') then 'unassigned' end,
      case when l.owner_id = auth.uid() and l.status in ('new','contact_attempted','contacted','qualified','converted') then 'mine' end,
      case when l.status not in ('disqualified','duplicate') and l.last_no_response_at is not null
        and l.last_no_response_at >= l.last_contact_attempt_at
        and (l.last_customer_reply_at is null or l.last_no_response_at > l.last_customer_reply_at) then 'no-response' end,
      case when l.status in ('new','contact_attempted','contacted') and l.first_response_at is null and l.first_response_due_at < now() then 'follow-up' end,
      case when l.next_follow_up_at < v_end and l.status not in ('disqualified','duplicate') then 'follow-ups-due' end,
      case when l.next_follow_up_at >= v_end and l.status not in ('disqualified','duplicate') then 'upcoming' end,
      case when l.completed_follow_ups > 0 then 'follow-ups-completed' end,
      case when l.status = 'duplicate' or l.duplicate_of_lead_id is not null then 'duplicates' end,
      case when l.status in ('qualified','converted') then 'qualified' end,
      case when l.status = 'disqualified' then 'disqualified' end,
      case when l.status in ('new','contact_attempted') and l.created_at < now() - interval '2 days' then 'aging' end
    ], null) as inbox_views
    from api.inbox_leads l
    where (p_source = '' or l.source_channel = p_source)
      and (p_owner = 'all' or (p_owner = 'mine' and l.owner_id = auth.uid()) or (p_owner = 'unassigned' and l.owner_id is null)
        or l.owner_id::text = p_owner)
      and (btrim(p_search) = '' or
        strpos(lower(concat_ws(' ',l.raw_name,l.raw_company,l.raw_email,l.source_detail,l.id::text)), lower(btrim(p_search))) > 0
        or (length(regexp_replace(p_search,'[^0-9]','','g')) >= 4 and
          strpos(regexp_replace(coalesce(l.raw_phone_normalized,l.raw_phone,''),'[^0-9]','','g'),
            regexp_replace(p_search,'[^0-9]','','g')) > 0))
  ), filtered as materialized (select * from base where p_view = any(inbox_views)),
  totals as (select count(*) as total from filtered),
  paging as (select total, least(p_page, greatest(1, ceil(total::numeric / p_size)::integer)) as page from totals),
  page_rows as (
    select * from filtered order by
      case when p_view in ('needs-action','follow-ups-due','upcoming') then next_follow_up_at end asc nulls last,
      created_at desc, id
    offset (select (page - 1) * p_size from paging) limit p_size
  ), counts as (
    select v, count(*) as n from base cross join lateral unnest(inbox_views) v group by v
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
    'total', (select total from paging), 'page', (select page from paging), 'page_size', p_size,
    'counts', coalesce((select jsonb_object_agg(v,n) from counts),'{}'::jsonb)) into result;
  return result;
end $$;
revoke all on function api.inquiry_page(text,text,text,text,integer,integer) from public, anon;
grant execute on function api.inquiry_page(text,text,text,text,integer,integer) to authenticated;
