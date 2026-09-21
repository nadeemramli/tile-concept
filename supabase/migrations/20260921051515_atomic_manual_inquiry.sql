-- One captured inquiry is one atomic command. Shared identifiers are evidence
-- for staff review, never a reason to pick the first contact in a search list.
-- Identity confirmation/merge may attach history to a customer/company while
-- the authored remark, source correction and original inquiry stay immutable.
create or replace function sales.guard_inquiry_annotation() returns trigger language plpgsql set search_path='' as $$
begin
  if old.metadata->>'event' in ('inquiry_remark','inquiry_source') and
    (tg_op='DELETE' or current_user in ('authenticated','anon')
      or (to_jsonb(new)-array['contact_id','account_id']) is distinct from (to_jsonb(old)-array['contact_id','account_id'])) then
    raise exception 'Inquiry remarks and source corrections are history. Add a new remark or correction.' using errcode='23514';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger inbox_changed_insert after insert on sales.intake_events referencing new table as inbox_changed_rows
  for each statement execute function sales.broadcast_inbox_changes();
create trigger inbox_changed_update after update on sales.intake_events referencing new table as inbox_changed_rows
  for each statement execute function sales.broadcast_inbox_changes();
create trigger inbox_changed_delete after delete on sales.intake_events referencing old table as inbox_changed_rows
  for each statement execute function sales.broadcast_inbox_changes();

create table sales.manual_inquiry_requests (
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,request_id)
);
alter table sales.manual_inquiry_requests enable row level security;
revoke all on sales.manual_inquiry_requests from public,anon,authenticated;

create function api.create_manual_inquiry(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ws uuid:=core.current_workspace_id(); saved sales.manual_inquiry_requests%rowtype;
  v_lead uuid; v_intake uuid; v_contact uuid; v_candidates uuid[]; v_state text:='unlinked';
  v_phone text; v_email text; v_owner uuid; v_location uuid; v_products text[]; v_result jsonb;
  v_key text; v_limit integer; v_unsafe boolean;
begin
  perform core.require_permission('sales.write');
  perform core.require_workspace(ws);
  if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception 'A request ID and inquiry object are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||':manual-inquiry:'||p_request_id::text,0));
  select * into saved from sales.manual_inquiry_requests where workspace_id=ws and request_id=p_request_id;
  if found then
    if saved.actor_id<>auth.uid() or saved.payload is distinct from p_input then
      raise exception 'Request ID already used for a different inquiry' using errcode='22023';
    end if;
    return saved.result;
  end if;
  if p_input->>'source_channel' is null or p_input->>'source_channel' not in ('tiktok','meta','facebook','instagram','google_ads','website','whatsapp','dm','call','email','referral','walk_in','other') then
    raise exception 'Choose a supported inquiry source' using errcode='23514';
  end if;
  for v_key,v_limit in select * from (values ('source_detail',200),('raw_name',200),('raw_phone',40),('raw_email',200),('raw_company',200),('interest',2000),('notes',4000),('raw_text',8000)) x(k,n) loop
    if (p_input ? v_key and jsonb_typeof(p_input->v_key) not in ('string','null')) or length(coalesce(p_input->>v_key,''))>v_limit then
      raise exception 'Invalid or too long inquiry field: %',v_key using errcode='23514';
    end if;
  end loop;
  if coalesce(nullif(btrim(p_input->>'raw_name'),''),nullif(btrim(p_input->>'raw_phone'),''),nullif(btrim(p_input->>'raw_email'),'')) is null then
    raise exception 'Provide at least a name, phone or email' using errcode='23514';
  end if;
  v_phone:=core.normalize_phone(p_input->>'raw_phone');
  v_email:=core.normalize_text(btrim(p_input->>'raw_email'));
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address' using errcode='23514';
  end if;
  v_owner:=nullif(p_input->>'owner_id','')::uuid;
  v_location:=nullif(p_input->>'location_id','')::uuid;
  if v_owner is not null then
    if v_owner<>auth.uid() then perform core.require_permission('sales.assign'); end if;
    if not exists(select 1 from core.memberships m join core.role_permissions rp on rp.role_key=m.role_key
      where m.workspace_id=ws and m.user_id=v_owner and m.status='active' and rp.permission='sales.write') then
      raise exception 'Choose an active salesperson in this workspace' using errcode='23514';
    end if;
  end if;
  if v_location is not null and not exists(select 1 from core.business_locations b where b.id=v_location and b.workspace_id=ws and b.is_active) then
    raise exception 'Choose an active location in this workspace' using errcode='23514';
  end if;
  if jsonb_typeof(coalesce(p_input->'product_interest','[]'::jsonb))<>'array' then
    raise exception 'Choose valid product interests' using errcode='23514';
  end if;
  select coalesce(array_agg(distinct value),'{}'::text[]) into v_products from jsonb_array_elements_text(coalesce(p_input->'product_interest','[]'::jsonb));
  if exists(select 1 from unnest(v_products) p where p is null or p not in ('wall_panel','tile','cut_tile','mosaic','finishing','accessory')) then
    raise exception 'Choose valid product interests' using errcode='23514';
  end if;

  select array_agg(distinct c.id) into v_candidates
  from identity.contact_points p join identity.contacts c on c.id=p.contact_id and c.workspace_id=ws
  where p.workspace_id=ws and c.archived_at is null and c.merged_into_contact_id is null
    and ((p.kind in ('phone','whatsapp') and p.normalized_value=v_phone) or (p.kind='email' and p.normalized_value=v_email));
  if cardinality(v_candidates)>0 then v_state:='needs_review'; end if;
  if cardinality(v_candidates)=1 then
    -- Lock the candidate while checking its current state. Any shared point or
    -- active duplicate identifier prevents automatic linking, including a
    -- provisional candidate even when search results label it an exact match.
    select c.is_provisional or c.archived_at is not null or c.merged_into_contact_id is not null
      into v_unsafe from identity.contacts c where c.id=v_candidates[1] for share;
    v_unsafe:=v_unsafe or exists(select 1 from identity.contact_points p
      where p.workspace_id=ws and p.contact_id=v_candidates[1] and p.kind in ('phone','whatsapp','email')
      and (p.is_shared or exists(select 1 from identity.contact_points q join identity.contacts other on other.id=q.contact_id and other.workspace_id=ws
        where q.workspace_id=ws and q.contact_id<>p.contact_id and other.archived_at is null and other.merged_into_contact_id is null
          and q.normalized_value=p.normalized_value
          and (q.kind=p.kind or (q.kind in ('phone','whatsapp') and p.kind in ('phone','whatsapp'))))));
    if not v_unsafe then v_contact:=v_candidates[1]; v_state:='matched'; end if;
  end if;

  insert into sales.intake_events(workspace_id,source_channel,provider,idempotency_key,occurred_at,payload,raw_text,status,created_by)
  values(ws,p_input->>'source_channel','manual','manual:'||p_request_id::text,now(),
    jsonb_build_object('name',nullif(btrim(p_input->>'raw_name'),''),'phone',nullif(btrim(p_input->>'raw_phone'),''),
      'email',v_email,'company',nullif(btrim(p_input->>'raw_company'),''),'interest',nullif(btrim(p_input->>'interest'),''),
      'source_detail',nullif(btrim(p_input->>'source_detail'),'')),nullif(p_input->>'raw_text',''),'processed',auth.uid())
  returning id into v_intake;
  insert into sales.leads(workspace_id,status,source_channel,source_detail,contact_id,raw_name,raw_phone,raw_email,raw_company,
    interest,product_interest,location_id,owner_id,assigned_at,first_response_due_at,notes,created_by)
  values(ws,'new',p_input->>'source_channel',nullif(btrim(p_input->>'source_detail'),''),v_contact,
    nullif(btrim(p_input->>'raw_name'),''),nullif(btrim(p_input->>'raw_phone'),''),v_email,nullif(btrim(p_input->>'raw_company'),''),
    nullif(btrim(p_input->>'interest'),''),v_products,v_location,v_owner,case when v_owner is null then null else now() end,
    now()+interval '4 hours',nullif(btrim(p_input->>'notes'),''),auth.uid()) returning id into v_lead;
  update sales.intake_events set lead_id=v_lead where id=v_intake;
  insert into sales.lead_intake_links(lead_id,intake_event_id) values(v_lead,v_intake);
  v_result:=jsonb_build_object('lead_id',v_lead,'intake_id',v_intake,'contact_id',v_contact,'identity_state',v_state);
  perform audit.emit(ws,'inquiry.created','sales','leads',v_lead,null,v_result,null,'{}'::jsonb);
  insert into sales.manual_inquiry_requests(workspace_id,request_id,actor_id,payload,result) values(ws,p_request_id,auth.uid(),p_input,v_result);
  return v_result;
end $$;
revoke all on function api.create_manual_inquiry(jsonb,uuid) from public,anon;
grant execute on function api.create_manual_inquiry(jsonb,uuid) to authenticated;
