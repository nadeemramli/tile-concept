-- Company switchboard numbers are distinct from personal PIC contact points.
alter table identity.accounts add column telephone text check(telephone is null or length(telephone)<=50);
alter table identity.accounts add column telephone_normalized text generated always as (core.normalize_phone(telephone)) stored;
create index accounts_telephone_idx on identity.accounts(workspace_id,telephone_normalized) where telephone_normalized is not null;
alter table identity.projects add column follow_up_contact_id uuid references identity.contacts(id);
alter table identity.projects add column product_specification text check(product_specification is null or length(product_specification)<=4000);
create index projects_follow_up_contact_idx on identity.projects(follow_up_contact_id) where follow_up_contact_id is not null;
create or replace view api.accounts with(security_invoker=true) as select * from identity.accounts;
create or replace view api.projects with(security_invoker=true) as select * from identity.projects;

-- A relationship row cannot connect records from different workspaces, including
-- inserts made by an existing SECURITY DEFINER contact-creation command.
create function identity.guard_company_relationship() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from identity.contacts where id=new.contact_id and workspace_id=new.workspace_id)
    or not exists(select 1 from identity.accounts where id=new.account_id and workspace_id=new.workspace_id) then
    raise exception 'Company and contact must belong to the same workspace' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function identity.guard_company_relationship() from public,anon,authenticated;
create trigger company_relationship_scope before insert or update of workspace_id,account_id,contact_id
on identity.account_contact_relationships for each row execute function identity.guard_company_relationship();

create function identity.guard_project_registration() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.follow_up_contact_id is not null then
    if not exists(select 1 from identity.contacts where id=new.follow_up_contact_id and workspace_id=new.workspace_id
      and archived_at is null and merged_into_contact_id is null) then
      raise exception 'Choose an active customer PIC in this workspace' using errcode='23514';
    end if;
    if new.account_id is not null and not exists(select 1 from identity.account_contact_relationships
      where workspace_id=new.workspace_id and account_id=new.account_id and contact_id=new.follow_up_contact_id and ended_at is null) then
      raise exception 'Link the follow-up PIC to this company first' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function identity.guard_project_registration() from public,anon,authenticated;
create trigger project_registration_scope before insert or update of workspace_id,account_id,follow_up_contact_id
on identity.projects for each row execute function identity.guard_project_registration();

-- Search is discovery only: the user still chooses the company and person.
create function api.showroom_customer_search(p_query text default '',p_account_id uuid default null,p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); q text:=core.normalize_text(p_query);
  digits text:=nullif(regexp_replace(coalesce(p_query,''),'[^0-9]','','g'),'');
  result jsonb;
begin
  perform core.require_permission('sales.read'); perform core.require_workspace(ws);
  if p_account_id is null and length(coalesce(btrim(q),''))<2 then return '[]'::jsonb; end if;
  if length(coalesce(p_query,''))>200 then raise exception 'Search is too long' using errcode='23514'; end if;
  if p_account_id is not null and not exists(select 1 from identity.accounts where id=p_account_id and workspace_id=ws
    and archived_at is null and merged_into_account_id is null) then raise exception 'Company not found' using errcode='42501'; end if;
  with matching_accounts as (
    select a.* from identity.accounts a where a.workspace_id=ws and a.archived_at is null and a.merged_into_account_id is null
      and ((p_account_id is not null and a.id=p_account_id) or (p_account_id is null and (
        position(q in a.normalized_name)>0
        or (length(digits)>=4 and position(digits in a.telephone_normalized)>0)
        or exists(select 1 from identity.account_aliases al where al.account_id=a.id and al.workspace_id=ws and position(q in al.normalized_alias)>0))))
  ), matching_contacts as (
    select c.*, exists(select 1 from identity.contact_points cp where cp.contact_id=c.id and cp.workspace_id=ws
      and ((length(digits)>=4 and cp.kind in ('phone','whatsapp') and position(digits in cp.normalized_value)>0)
        or (cp.kind='email' and position(q in cp.normalized_value)>0))) as number_match
    from identity.contacts c where c.workspace_id=ws and c.archived_at is null and c.merged_into_contact_id is null
      and ((p_account_id is not null and exists(select 1 from identity.account_contact_relationships r
        where r.contact_id=c.id and r.account_id=p_account_id and r.workspace_id=ws and r.ended_at is null))
      or (p_account_id is null and (
        position(q in c.normalized_name)>0
        or exists(select 1 from identity.contact_points cp where cp.contact_id=c.id and cp.workspace_id=ws
          and ((length(digits)>=4 and cp.kind in ('phone','whatsapp') and position(digits in cp.normalized_value)>0)
            or (cp.kind='email' and position(q in cp.normalized_value)>0)))
        or exists(select 1 from identity.account_contact_relationships r join matching_accounts a on a.id=r.account_id
          where r.contact_id=c.id and r.workspace_id=ws and r.ended_at is null))))
  ), hits as (
    select to_jsonb(b) as item from api.find_identity_candidates(
      p_phone=>case when length(digits)>=4 then p_query end,
      p_email=>case when position('@' in p_query)>0 then p_query end,
      p_name=>p_query,p_company=>p_query,p_limit=>50) b where p_account_id is null
    union all
    select jsonb_build_object('entity_type','account','entity_id',a.id,'display_name',a.name,
      'confidence','medium','score',40,'reasons',jsonb_build_array(jsonb_build_object('code','company_match','field','company','weight',40)),
      'masked_phone',core.mask_value(a.telephone_normalized,'phone'),'masked_email',null,'lifecycle_state',a.lifecycle_state,'last_activity_at',null)
    from matching_accounts a where p_account_id is null
    union all
    select jsonb_build_object('entity_type','contact','entity_id',c.id,'display_name',c.display_name,
      'confidence','medium','score',case when c.number_match then 45 else 30 end,
      'reasons',jsonb_build_array(jsonb_build_object('code',case when c.number_match then 'number_match' else 'contact_match' end,'field','contact','weight',30)),
      'masked_phone',(select core.mask_value(cp.normalized_value,'phone') from identity.contact_points cp where cp.contact_id=c.id and cp.workspace_id=ws and cp.kind in ('phone','whatsapp') order by cp.is_primary desc,cp.created_at limit 1),
      'masked_email',null,'lifecycle_state',c.lifecycle_state,'last_activity_at',null)
    from matching_contacts c where p_account_id is null or q is null or q='' or c.number_match or position(q in c.normalized_name)>0
  ), unique_hits as (
    select distinct on (item->>'entity_type',item->>'entity_id') item
    from hits order by item->>'entity_type',item->>'entity_id',(item->>'score')::numeric desc
  ), enriched as (
    select item || jsonb_build_object('companies',coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'role',r.role) order by a.name)
      from identity.account_contact_relationships r join identity.accounts a on a.id=r.account_id and a.workspace_id=ws
      where item->>'entity_type'='contact' and r.contact_id=(item->>'entity_id')::uuid and r.workspace_id=ws and r.ended_at is null
        and a.archived_at is null and a.merged_into_account_id is null),'[]'::jsonb)) as item from unique_hits
    order by (item->>'score')::numeric desc,item->>'display_name'
    limit greatest(1,least(coalesce(p_limit,30),50))
  ) select coalesce(jsonb_agg(item),'[]'::jsonb) into result from enriched;
  return result;
end $$;
revoke all on function api.showroom_customer_search(text,uuid,int) from public,anon;
grant execute on function api.showroom_customer_search(text,uuid,int) to authenticated;

create or replace function api.opportunity_command(p_action text,p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid:=core.current_workspace_id(); uid uuid:=auth.uid(); o sales.opportunities%rowtype;
  prior sales.opportunity_requests%rowtype; result jsonb; payload jsonb:=jsonb_build_object('action',p_action,'input',p_input);
  cid uuid:=nullif(p_input->>'contact_id','')::uuid; aid uuid:=nullif(p_input->>'account_id','')::uuid;
  pid uuid:=nullif(p_input->>'project_id','')::uuid; oid uuid:=nullif(p_input->>'owner_id','')::uuid;
  first_stage text; opp_id uuid; reason text:=nullif(btrim(p_input->>'reason'),'');
  make_project boolean:=coalesce((p_input->>'create_project')::boolean,false);
  make_opp boolean:=coalesce((p_input->>'create_opportunity')::boolean,true);
begin
  perform core.require_permission('sales.write'); perform core.require_workspace(ws);
  if p_request_id is null then raise exception 'A request id is required' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||p_request_id::text,0));
  select * into prior from sales.opportunity_requests where workspace_id=ws and request_id=p_request_id;
  if found then
    if prior.actor_id<>uid or prior.payload<>payload then raise exception 'Retry differs from original command' using errcode='23514'; end if;
    return prior.result;
  end if;
  if p_action not in ('create','edit','archive','restore','reassign') then raise exception 'Unknown opportunity action' using errcode='23514'; end if;
  if p_action<>'create' then
    select * into o from sales.opportunities where id=(p_input->>'id')::uuid and workspace_id=ws for update;
    if not found then raise exception 'Opportunity not found' using errcode='42501'; end if;
    if not core.has_permission('sales.read_all') and o.owner_id is not null and o.owner_id<>uid then raise exception 'Only the owner or a sales manager can change this opportunity' using errcode='42501'; end if;
    if (p_input->>'version')::integer is distinct from o.version then raise exception 'Opportunity changed. Refresh and try again.' using errcode='40001'; end if;
    if o.archived_at is not null and p_action<>'restore' then raise exception 'Restore the opportunity before changing it' using errcode='23514'; end if;
    opp_id:=o.id; pid:=o.project_id;
  end if;
  if p_action in ('create','edit') then
    if p_action='edit' then make_opp:=true; end if;
    if p_action='edit' then cid:=o.contact_id; aid:=o.account_id; oid:=coalesce(oid,o.owner_id); end if;
    if p_action='create' and cid is null and aid is null then raise exception 'Choose a contact or company' using errcode='23514'; end if;
    if cid is not null and not exists(select 1 from identity.contacts where id=cid and workspace_id=ws and archived_at is null and merged_into_contact_id is null) then raise exception 'Choose an active contact in this workspace' using errcode='23514'; end if;
    if aid is not null and not exists(select 1 from identity.accounts where id=aid and workspace_id=ws and archived_at is null) then raise exception 'Choose an active company in this workspace' using errcode='23514'; end if;
    if pid is not null and not exists(select 1 from identity.projects where id=pid and workspace_id=ws and (account_id is null or account_id=aid) and (primary_contact_id is null or primary_contact_id=cid)) then raise exception 'Project must belong to this contact or company' using errcode='23514'; end if;
    if oid is null and p_action='create' then oid:=uid; end if;
    if oid is distinct from (case when p_action='create' then uid else o.owner_id end) and not core.has_permission('sales.assign') then raise exception 'permission denied: sales.assign' using errcode='42501'; end if;
    if oid is not null and not exists(select 1 from core.memberships where workspace_id=ws and user_id=oid and status='active') then raise exception 'Choose an active workspace owner' using errcode='23514'; end if;
    if make_opp and (length(btrim(coalesce(p_input->>'name','')))<2 or coalesce(p_input->>'currency','MYR')!~'^[A-Z]{3}$') then raise exception 'Enter an opportunity name and currency' using errcode='23514'; end if;
    if p_input->>'estimated_value' is not null and ((p_input->>'estimated_value')::numeric<0 or (p_input->>'estimated_value')::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Estimated value must be a finite positive amount or zero' using errcode='23514'; end if;
    if make_opp and (p_action='create' or o.status='open') and (nullif(btrim(p_input->>'next_action'),'') is null or (nullif(p_input->>'next_action_due_at','') is null and not (p_action='create' and make_project))) then raise exception 'Enter a next action and due date' using errcode='23514'; end if;
    if p_action='create' then
      if make_project then
        if pid is not null or length(btrim(coalesce(p_input->>'project_name','')))<2 then raise exception 'Enter a new project name' using errcode='23514'; end if;
        insert into identity.projects(workspace_id,name,project_type,area,account_id,primary_contact_id,owner_id,expected_start,expected_completion,created_by,follow_up_contact_id,product_specification)
        values(ws,btrim(p_input->>'project_name'),coalesce(p_input->>'project_type','other'),nullif(p_input->>'area',''),aid,cid,oid,nullif(p_input->>'expected_start','')::date,nullif(p_input->>'expected_completion','')::date,uid,nullif(p_input->>'follow_up_contact_id','')::uuid,nullif(btrim(p_input->>'product_specification'),'')) returning id into pid;
        if nullif(btrim(p_input->>'site_address'),'') is not null then
          if length(p_input->>'site_address')>1000 then raise exception 'Site address is too long' using errcode='23514'; end if;
          insert into identity.project_sites(workspace_id,project_id,label,address) values(ws,pid,'Main site',jsonb_build_object('line1',btrim(p_input->>'site_address'),'country','MY'));
        end if;
      elsif not make_opp then raise exception 'Choose an opportunity or project to create' using errcode='23514'; end if;
      if make_opp then
        select key into first_stage from core.opportunity_stages where workspace_id=ws and is_active and reporting_group='open' order by position limit 1;
        if first_stage is null then raise exception 'No active open stage configured' using errcode='23514'; end if;
        insert into sales.opportunities(workspace_id,name,contact_id,account_id,project_id,owner_id,stage_key,estimated_value,currency,next_action,next_action_due_at,source_channel,product_interest,notes,created_by)
        values(ws,btrim(p_input->>'name'),cid,aid,pid,oid,first_stage,nullif(p_input->>'estimated_value','')::numeric,coalesce(p_input->>'currency','MYR'),btrim(p_input->>'next_action'),nullif(p_input->>'next_action_due_at','')::timestamptz,nullif(p_input->>'source_channel',''),array(select jsonb_array_elements_text(coalesce(p_input->'product_interest','[]'))),nullif(p_input->>'notes',''),uid) returning id into opp_id;
        insert into sales.opportunity_stage_events(workspace_id,opportunity_id,to_stage_key,actor_id) values(ws,opp_id,first_stage,uid);
      end if;
    else
      update sales.opportunities set name=btrim(p_input->>'name'),segment=nullif(p_input->>'segment',''),estimated_value=nullif(p_input->>'estimated_value','')::numeric,
        currency=coalesce(p_input->>'currency','MYR'),probability_band=nullif(p_input->>'probability_band',''),expected_close_date=nullif(p_input->>'expected_close_date','')::date,
        next_action=nullif(btrim(p_input->>'next_action'),''),next_action_due_at=nullif(p_input->>'next_action_due_at','')::timestamptz,
        product_interest=array(select jsonb_array_elements_text(coalesce(p_input->'product_interest','[]'))),competitor=nullif(p_input->>'competitor',''),notes=nullif(p_input->>'notes',''),
        source_channel=nullif(p_input->>'source_channel',''),owner_id=oid where id=o.id;
    end if;
  elsif p_action in ('archive','restore') then
    if reason is null then raise exception 'A reason is required' using errcode='23514'; end if;
    if p_action='restore' and o.archived_at is null then raise exception 'Opportunity is already active' using errcode='23514'; end if;
    update sales.opportunities set archived_at=case when p_action='archive' then now() end,archive_reason=case when p_action='archive' then reason end where id=o.id;
  elsif p_action='reassign' then
    perform core.require_permission('sales.assign');
    if oid is null or not exists(select 1 from core.memberships where workspace_id=ws and user_id=oid and status='active') then raise exception 'Choose an active workspace owner' using errcode='23514'; end if;
    update sales.opportunities set owner_id=oid where id=o.id;
  end if;
  insert into sales.activities(workspace_id,kind,subject,body,actor_id,contact_id,account_id,project_id,opportunity_id)
  values(ws,'system','Opportunity: '||p_action,coalesce(reason,nullif(p_input->>'notes','')),uid,coalesce(cid,o.contact_id),coalesce(aid,o.account_id),pid,opp_id);
  perform audit.emit(ws,'opportunity.'||p_action,'sales','opportunities',opp_id,to_jsonb(o),(select to_jsonb(x) from sales.opportunities x where id=opp_id),reason);
  result:=jsonb_build_object('opportunity_id',opp_id,'project_id',pid);
  insert into sales.opportunity_requests values(ws,p_request_id,uid,payload,result);
  return result;
end $$;
revoke all on function api.opportunity_command(text,jsonb,uuid) from public,anon;
grant execute on function api.opportunity_command(text,jsonb,uuid) to authenticated;


-- Preserve project follow-up assignments during an approved identity merge.
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
  -- Keep an active company association when the survivor already had an ended link.
  update identity.account_contact_relationships s set ended_at = null
  from identity.account_contact_relationships m
  where s.contact_id = p_survivor_id and m.contact_id = p_merged_id and s.account_id = m.account_id
    and s.ended_at is not null and m.ended_at is null;
  delete from identity.account_contact_relationships where contact_id = p_merged_id;
  update identity.external_identities set contact_id = p_survivor_id where contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('external_identities', n);
  update identity.consent_records set contact_id = p_survivor_id where contact_id = p_merged_id;
  update identity.projects set primary_contact_id = p_survivor_id where primary_contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('projects', n);
  update identity.projects set follow_up_contact_id = p_survivor_id where follow_up_contact_id = p_merged_id; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('project_follow_up_pics', n);
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

revoke all on function api.merge_contacts(uuid,uuid,text,uuid) from public,anon;
