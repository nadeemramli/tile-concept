-- A shared project register is available to every workspace role. Follow-up
-- remains a sales responsibility without granting broader sales.assign rights.
insert into core.role_permissions(role_key,permission)
select r.key,p from core.roles r cross join unnest(array['projects.read','projects.write']) p on conflict do nothing;
insert into core.role_permissions(role_key,permission)
select role_key,'projects.follow_up' from core.role_permissions where permission='sales.write' on conflict do nothing;

alter table identity.projects add column next_action text check(length(next_action)<=1000);
alter table identity.projects add column next_action_due_at timestamptz;
alter table identity.projects add column last_follow_up_at timestamptz;
alter table identity.projects add column last_follow_up_by uuid references auth.users(id);
create index projects_handler_idx on identity.projects(workspace_id,owner_id);
create or replace view api.projects with(security_invoker=true) as select * from identity.projects;
create policy project_register_read on identity.projects for select to authenticated
using(workspace_id in(select core.member_workspace_ids()) and (select core.has_permission('projects.read')));
create policy project_register_read on identity.project_sites for select to authenticated
using(workspace_id in(select core.member_workspace_ids()) and (select core.has_permission('projects.read')));
-- All project mutations go through the versioned command, including assignment.
revoke insert,update,delete on identity.projects,api.projects from authenticated;

create table identity.project_requests(
 workspace_id uuid not null references core.workspaces(id),request_id uuid not null,actor_id uuid not null references auth.users(id),
 payload jsonb not null,result jsonb not null,primary key(workspace_id,request_id)
);
alter table identity.project_requests enable row level security;
revoke all on identity.project_requests from anon,authenticated;
create table identity.project_events(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references core.workspaces(id),
 project_id uuid not null references identity.projects(id),actor_id uuid not null references auth.users(id),
 kind text not null check(kind in('registered','enriched','assigned','follow_up')),note text check(length(note)<=4000),
 previous_owner_id uuid references auth.users(id),owner_id uuid references auth.users(id),
 next_action text,next_action_due_at timestamptz,created_at timestamptz not null default now()
);
create index project_events_project_idx on identity.project_events(workspace_id,project_id,created_at desc);
alter table identity.project_events enable row level security;
create policy project_event_read on identity.project_events for select to authenticated
using(workspace_id in(select core.member_workspace_ids()) and (select core.has_permission('projects.read')));
create view api.project_events with(security_invoker=true) as select * from identity.project_events;
revoke all on identity.project_events,api.project_events from anon,authenticated;
grant select on identity.project_events,api.project_events to authenticated;

-- Returns only project data and the display names of its linked identities.
-- Staff are not granted general access to customer records or financial data.
create function api.project_directory(p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); result jsonb;
begin
 perform core.require_permission('projects.read'); perform core.require_workspace(ws);
 select coalesce(jsonb_agg(row order by created_at desc),'[]'::jsonb) into result from (
   select p.created_at,to_jsonb(p)||jsonb_build_object('account_name',a.name,'contact_name',c.display_name,'follow_up_contact_name',pic.display_name) as row
   from identity.projects p
   left join identity.accounts a on a.id=p.account_id and a.workspace_id=ws
   left join identity.contacts c on c.id=p.primary_contact_id and c.workspace_id=ws
   left join identity.contacts pic on pic.id=p.follow_up_contact_id and pic.workspace_id=ws
   where p.workspace_id=ws and (p_id is null or p.id=p_id) order by p.created_at desc limit 1000
 ) rows;
 return result;
end $$;
revoke all on function api.project_directory(uuid) from public,anon;
grant execute on function api.project_directory(uuid) to authenticated;

create function api.project_identity_search(p_kind text,p_query text default '',p_account_id uuid default null)
returns table(id uuid,name text) language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); q text:=coalesce(core.normalize_text(btrim(p_query)),''); digits text:=regexp_replace(coalesce(p_query,''),'[^0-9]','','g');
begin
 perform core.require_permission('projects.write'); perform core.require_workspace(ws);
 if length(q)>200 or p_kind not in ('account','contact') then raise exception 'Invalid search' using errcode='23514'; end if;
 if length(q)<2 and p_account_id is null then return; end if;
 if p_account_id is not null and not exists(select 1 from identity.accounts a where a.id=p_account_id and a.workspace_id=ws and a.archived_at is null and a.merged_into_account_id is null) then raise exception 'Company not found' using errcode='42501'; end if;
 if p_kind='account' then
   return query select a.id,a.name from identity.accounts a where a.workspace_id=ws and a.archived_at is null and a.merged_into_account_id is null
     and (position(q in a.normalized_name)>0 or (length(digits)>=4 and position(digits in a.telephone_normalized)>0)) order by a.name limit 20;
 else
   return query select c.id,c.display_name from identity.contacts c where c.workspace_id=ws and c.archived_at is null and c.merged_into_contact_id is null
     and (p_account_id is null or exists(select 1 from identity.account_contact_relationships r where r.workspace_id=ws and r.contact_id=c.id and r.account_id=p_account_id and r.ended_at is null))
     and (q='' or position(q in c.normalized_name)>0 or (length(digits)>=4 and exists(select 1 from identity.contact_points cp where cp.workspace_id=ws and cp.contact_id=c.id and cp.kind in ('phone','whatsapp') and position(digits in cp.normalized_value)>0)))
     order by c.display_name limit 20;
 end if;
end $$;
revoke all on function api.project_identity_search(text,text,uuid) from public,anon;
grant execute on function api.project_identity_search(text,text,uuid) to authenticated;

create function api.project_command(p_action text,p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 ws uuid:=core.current_workspace_id(); uid uuid:=auth.uid(); p identity.projects%rowtype;
 prior identity.project_requests%rowtype; payload jsonb:=jsonb_build_object('action',p_action,'input',p_input); result jsonb;
 pid uuid:=nullif(p_input->>'id','')::uuid; aid uuid:=nullif(p_input->>'account_id','')::uuid;
 cid uuid:=nullif(p_input->>'contact_id','')::uuid; pic uuid:=nullif(p_input->>'follow_up_contact_id','')::uuid;
 handler uuid:=nullif(p_input->>'owner_id','')::uuid; site uuid;
 note text:=nullif(btrim(p_input->>'note'),''); title text:=btrim(p_input->>'name'); event_kind text;
begin
 perform core.require_permission('projects.write'); perform core.require_workspace(ws);
 if p_action not in('create','edit','assign','follow_up') or p_request_id is null then raise exception 'Invalid project command' using errcode='23514'; end if;
 if p_action in('assign','follow_up') then perform core.require_permission('projects.follow_up'); end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||p_request_id::text,0));
 select * into prior from identity.project_requests where workspace_id=ws and request_id=p_request_id;
 if found then
   if prior.actor_id<>uid or prior.payload<>payload then raise exception 'Retry differs from original project command' using errcode='23514'; end if;
   return prior.result;
 end if;
 if p_action<>'create' then
   select * into p from identity.projects where id=pid and workspace_id=ws for update;
   if not found then raise exception 'Project not found' using errcode='42501'; end if;
   if (p_input->>'version')::int is distinct from p.version then raise exception 'Project changed. Refresh before saving or assigning it.' using errcode='40001'; end if;
 end if;
 if p_action in('create','assign') and handler is not null and not exists(
   select 1 from core.memberships m join core.role_permissions rp on rp.role_key=m.role_key and rp.permission='projects.follow_up'
   where m.workspace_id=ws and m.user_id=handler and m.status='active'
 ) then raise exception 'Choose an active salesperson in this company' using errcode='23514'; end if;
 if p_action in('create','edit') then
   if length(coalesce(title,''))<2 or length(title)>200 then raise exception 'Enter a project title (2 to 200 characters)' using errcode='23514'; end if;
   if aid is not null and not exists(select 1 from identity.accounts where id=aid and workspace_id=ws and archived_at is null and merged_into_account_id is null) then raise exception 'Choose an active company in this workspace' using errcode='23514'; end if;
   if cid is not null and not exists(select 1 from identity.contacts where id=cid and workspace_id=ws and archived_at is null and merged_into_contact_id is null) then raise exception 'Choose an active customer in this workspace' using errcode='23514'; end if;
   if length(coalesce(p_input->>'site_address',''))>1000 or length(coalesce(p_input->>'notes',''))>4000 then raise exception 'Project details are too long' using errcode='23514'; end if;
   if p_action='create' then
     insert into identity.projects(workspace_id,name,account_id,primary_contact_id,follow_up_contact_id,owner_id,project_type,area,product_specification,expected_start,expected_completion,notes,created_by)
     values(ws,title,aid,cid,pic,handler,coalesce(nullif(p_input->>'project_type',''),'other'),nullif(p_input->>'area',''),nullif(btrim(p_input->>'product_specification'),''),nullif(p_input->>'expected_start','')::date,nullif(p_input->>'expected_completion','')::date,nullif(p_input->>'notes',''),uid) returning id into pid;
     event_kind:='registered';
   else
     if (aid is distinct from p.account_id or cid is distinct from p.primary_contact_id) and exists(select 1 from sales.opportunities o where o.project_id=pid and o.workspace_id=ws and ((o.account_id is not null and o.account_id is distinct from aid) or (o.contact_id is not null and o.contact_id is distinct from cid))) then
       raise exception 'This change conflicts with an existing opportunity customer. Keep the linked customer or register a separate project.' using errcode='23514';
     end if;
     update identity.projects set name=title,account_id=aid,primary_contact_id=cid,follow_up_contact_id=pic,project_type=coalesce(nullif(p_input->>'project_type',''),'other'),status=coalesce(nullif(p_input->>'status',''),p.status),area=nullif(p_input->>'area',''),product_specification=nullif(btrim(p_input->>'product_specification'),''),expected_start=nullif(p_input->>'expected_start','')::date,expected_completion=nullif(p_input->>'expected_completion','')::date,notes=nullif(p_input->>'notes','') where id=pid;
     event_kind:='enriched';
   end if;
   if p_input ? 'site_address' then
     select id into site from identity.project_sites where workspace_id=ws and project_id=pid order by created_at,id limit 1;
     if site is not null then
       update identity.project_sites set address=jsonb_set(address,'{line1}',to_jsonb(coalesce(p_input->>'site_address',''))) where id=site;
     elsif nullif(btrim(p_input->>'site_address'),'') is not null then
       insert into identity.project_sites(workspace_id,project_id,label,address) values(ws,pid,'Main site',jsonb_build_object('line1',btrim(p_input->>'site_address'),'country','MY'));
     end if;
   end if;
 elsif p_action='assign' then
   if p.owner_id is not null and handler is distinct from p.owner_id and note is null then raise exception 'Add a handover reason when changing the handler' using errcode='23514'; end if;
   update identity.projects set owner_id=handler where id=pid;
   event_kind:='assigned';
 else
   if note is null or length(note)>4000 then raise exception 'Describe the follow-up (up to 4000 characters)' using errcode='23514'; end if;
   if nullif(p_input->>'next_action_due_at','') is not null and nullif(btrim(p_input->>'next_action'),'') is null then raise exception 'Describe the next action for its due date' using errcode='23514'; end if;
   update identity.projects set last_follow_up_at=now(),last_follow_up_by=uid,next_action=nullif(btrim(p_input->>'next_action'),''),next_action_due_at=nullif(p_input->>'next_action_due_at','')::timestamptz where id=pid;
   event_kind:='follow_up';
 end if;
 insert into identity.project_events(workspace_id,project_id,actor_id,kind,note,previous_owner_id,owner_id,next_action,next_action_due_at)
 select ws,pid,uid,event_kind,note,p.owner_id,x.owner_id,x.next_action,x.next_action_due_at from identity.projects x where x.id=pid;
 select jsonb_build_object('project_id',id,'version',version) into result from identity.projects where id=pid;
 insert into identity.project_requests values(ws,p_request_id,uid,payload,result);
 return result;
end $$;
revoke all on function api.project_command(text,jsonb,uuid) from public,anon;
grant execute on function api.project_command(text,jsonb,uuid) to authenticated;
