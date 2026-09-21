-- Opportunity lifecycle remains separate from recorded sales and collections.
alter table sales.opportunities add column archived_at timestamptz,
  add column archive_reason text;
create index opportunities_active_workspace_idx on sales.opportunities(workspace_id,status,next_action_due_at) where archived_at is null;
create or replace view api.opportunities with(security_invoker=true) as select * from sales.opportunities;
revoke insert,update,delete on sales.opportunities,api.opportunities from authenticated;

create table sales.opportunity_requests (
  workspace_id uuid not null references core.workspaces(id), request_id uuid not null, actor_id uuid not null,
  payload jsonb not null, result jsonb not null, primary key(workspace_id,request_id)
);
alter table sales.opportunity_requests enable row level security;
revoke all on sales.opportunity_requests from public,anon,authenticated;

create function api.opportunity_command(p_action text,p_input jsonb,p_request_id uuid) returns jsonb
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
    if make_opp and (p_action='create' or o.status='open') and (nullif(btrim(p_input->>'next_action'),'') is null or nullif(p_input->>'next_action_due_at','') is null) then raise exception 'Enter a next action and due date' using errcode='23514'; end if;
    if p_action='create' then
      if make_project then
        if pid is not null or length(btrim(coalesce(p_input->>'project_name','')))<2 then raise exception 'Enter a new project name' using errcode='23514'; end if;
        insert into identity.projects(workspace_id,name,project_type,area,account_id,primary_contact_id,owner_id,expected_start,expected_completion,created_by)
        values(ws,btrim(p_input->>'project_name'),coalesce(p_input->>'project_type','other'),nullif(p_input->>'area',''),aid,cid,oid,nullif(p_input->>'expected_start','')::date,nullif(p_input->>'expected_completion','')::date,uid) returning id into pid;
      elsif not make_opp then raise exception 'Choose an opportunity or project to create' using errcode='23514'; end if;
      if make_opp then
        select key into first_stage from core.opportunity_stages where workspace_id=ws and is_active and reporting_group='open' order by position limit 1;
        if first_stage is null then raise exception 'No active open stage configured' using errcode='23514'; end if;
        insert into sales.opportunities(workspace_id,name,contact_id,account_id,project_id,owner_id,stage_key,estimated_value,currency,next_action,next_action_due_at,source_channel,product_interest,notes,created_by)
        values(ws,btrim(p_input->>'name'),cid,aid,pid,oid,first_stage,nullif(p_input->>'estimated_value','')::numeric,coalesce(p_input->>'currency','MYR'),btrim(p_input->>'next_action'),(p_input->>'next_action_due_at')::timestamptz,nullif(p_input->>'source_channel',''),array(select jsonb_array_elements_text(coalesce(p_input->'product_interest','[]'))),nullif(p_input->>'notes',''),uid) returning id into opp_id;
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

-- Existing conversion/stage RPCs still use the canonical table. Archived records are inert.
create function sales.guard_archived_opportunity() returns trigger language plpgsql set search_path='' as $$
begin
  if old.archived_at is not null and new.archived_at is not null and row(new.stage_key,new.status,new.owner_id) is distinct from row(old.stage_key,old.status,old.owner_id) then
    raise exception 'Restore the opportunity before changing it' using errcode='23514';
  end if;
  return new;
end $$;
create trigger opportunity_archive_guard before update on sales.opportunities for each row execute function sales.guard_archived_opportunity();

create table sales.opportunity_photos (
  id uuid primary key, workspace_id uuid not null references core.workspaces(id),
  opportunity_id uuid not null references sales.opportunities(id), object_path text not null unique,
  file_name text not null, content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
  file_size integer not null check(file_size between 1 and 5242880), remark text not null check(length(btrim(remark)) between 1 and 2000),
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(), uploaded_at timestamptz, removed_at timestamptz
);
create index opportunity_photos_opp_idx on sales.opportunity_photos(opportunity_id,created_at desc);
alter table sales.opportunity_photos enable row level security;
create policy opportunity_photo_read on sales.opportunity_photos for select to authenticated using(
  workspace_id=(select core.current_workspace_id()) and exists(select 1 from sales.opportunities o where o.id=opportunity_id));
grant select on sales.opportunity_photos to authenticated;
create view api.opportunity_photos with(security_invoker=true) as select * from sales.opportunity_photos;
grant select on api.opportunity_photos to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('opportunity-photos','opportunity-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy opportunity_photo_upload on storage.objects for insert to authenticated with check(
  bucket_id='opportunity-photos' and (select core.has_permission('sales.write')) and exists(select 1 from sales.opportunity_photos p join sales.opportunities o on o.id=p.opportunity_id
    where p.object_path=storage.objects.name and p.created_by=(select auth.uid()) and p.uploaded_at is null and p.removed_at is null and o.archived_at is null and ((select core.has_permission('sales.read_all')) or o.owner_id is null or o.owner_id=(select auth.uid()))));
create policy opportunity_photo_download on storage.objects for select to authenticated using(
  bucket_id='opportunity-photos' and exists(select 1 from sales.opportunity_photos p where p.object_path=storage.objects.name and p.removed_at is null));

create function api.opportunity_photo_command(p_action text,p_opportunity_id uuid,p_photo_id uuid,p_input jsonb default '{}') returns text
language plpgsql security definer set search_path='' as $$
declare o sales.opportunities%rowtype; p sales.opportunity_photos%rowtype; path text; ext text;
begin
  perform core.require_permission('sales.write');
  select * into o from sales.opportunities where id=p_opportunity_id and workspace_id=core.current_workspace_id() for update;
  if not found or (not core.has_permission('sales.read_all') and o.owner_id is not null and o.owner_id<>auth.uid()) then raise exception 'Opportunity not found or owned by another salesperson' using errcode='42501'; end if;
  if o.archived_at is not null then raise exception 'Restore the opportunity before changing it' using errcode='23514'; end if;
  select * into p from sales.opportunity_photos where id=p_photo_id;
  if found and (p.opportunity_id<>o.id or p.workspace_id<>o.workspace_id) then raise exception 'Photo belongs to another opportunity' using errcode='42501'; end if;
  if p_action='prepare' then
    if p.id is not null then
      if p.created_by<>auth.uid() or p.file_name<>p_input->>'file_name' or p.content_type<>p_input->>'content_type' or p.file_size<>(p_input->>'file_size')::int or p.remark<>p_input->>'remark' then raise exception 'Retry differs from original photo' using errcode='23514'; end if;
      return p.object_path;
    end if;
    if coalesce(p_input->>'content_type','') not in ('image/jpeg','image/png','image/webp') or coalesce((p_input->>'file_size')::int,0) not between 1 and 5242880 or length(btrim(coalesce(p_input->>'remark',''))) not between 1 and 2000 or nullif(btrim(p_input->>'file_name'),'') is null then raise exception 'Choose a JPG, PNG or WebP up to 5 MB and enter a remark' using errcode='23514'; end if;
    ext:=case p_input->>'content_type' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
    path:=o.workspace_id::text||'/'||o.id::text||'/'||p_photo_id::text||ext;
    insert into sales.opportunity_photos(id,workspace_id,opportunity_id,object_path,file_name,content_type,file_size,remark,created_by)
      values(p_photo_id,o.workspace_id,o.id,path,p_input->>'file_name',p_input->>'content_type',(p_input->>'file_size')::int,btrim(p_input->>'remark'),auth.uid());
    return path;
  end if;
  if p.id is null or p.removed_at is not null then raise exception 'Photo not found' using errcode='23514'; end if;
  if p_action='finish' then
    if p.uploaded_at is not null then return p.object_path; end if;
    if p.created_by<>auth.uid() then raise exception 'Only the uploader can finish this upload' using errcode='42501'; end if;
    if not exists(select 1 from storage.objects where bucket_id='opportunity-photos' and name=p.object_path and (metadata->>'size')::bigint=p.file_size and metadata->>'mimetype'=p.content_type) then raise exception 'Upload the photo before saving' using errcode='23514'; end if;
    update sales.opportunity_photos set uploaded_at=now() where id=p.id;
  elsif p_action='remove' then
    if nullif(btrim(p_input->>'reason'),'') is null then raise exception 'A reason is required' using errcode='23514'; end if;
    update sales.opportunity_photos set removed_at=now() where id=p.id;
  else raise exception 'Unknown photo action' using errcode='23514'; end if;
  insert into sales.activities(workspace_id,kind,subject,body,actor_id,opportunity_id,contact_id,account_id,project_id)
    values(o.workspace_id,'note',case p_action when 'finish' then 'Opportunity photo added' else 'Opportunity photo removed' end,coalesce(p_input->>'reason',p.remark),auth.uid(),o.id,o.contact_id,o.account_id,o.project_id);
  perform audit.emit(o.workspace_id,'opportunity.photo_'||p_action,'sales','opportunity_photos',p.id,to_jsonb(p),null,p_input->>'reason');
  return p.object_path;
end $$;
revoke all on function api.opportunity_photo_command(text,uuid,uuid,jsonb) from public,anon;
grant execute on function api.opportunity_photo_command(text,uuid,uuid,jsonb) to authenticated;
