-- Configurable routing. Staff labels are pending slots until a real member is selected.
create function sales.member_can(p_workspace uuid,p_actor uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from core.memberships m join core.role_permissions r on r.role_key=m.role_key
    where m.workspace_id=p_workspace and m.user_id=p_actor and m.status='active' and r.permission=p_permission)
$$;
revoke all on function sales.member_can(uuid,uuid,text) from public,anon,authenticated;

create table ingest.lead_assignment_settings (
  workspace_id uuid primary key references core.workspaces(id) on delete cascade,
  config jsonb not null, version integer not null default 1,
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table sales.lead_pool_cursors (
  workspace_id uuid references core.workspaces(id) on delete cascade,
  pool_key text not null, last_position integer not null default 0,
  primary key(workspace_id,pool_key)
);
create table sales.lead_routing_assignments (
  lead_id uuid primary key references sales.leads(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  customer_type text, pool_key text, slot_name text, owner_id uuid references auth.users(id),
  reason text not null, config_version integer, created_at timestamptz not null default now()
);
create function sales.default_lead_routing() returns jsonb language sql immutable set search_path='' as $$
select '{"enabled":true,"pools":[{"key":"homeowners","name":"Homeowners / end users","mode":"fixed","active":true,"members":[{"name":"Naufal","user_id":null,"active":true}]},{"key":"trade","name":"Designers / contractors","mode":"round_robin","active":true,"members":[{"name":"Beyla","user_id":null,"active":true},{"name":"Alia","user_id":null,"active":true},{"name":"Jerry","user_id":null,"active":true}]}],"rules":[{"customer_type":"homeowner","pool_key":"homeowners","aliases":["homeowner","home owner","end user","end_user","pemilik rumah"]},{"customer_type":"designer","pool_key":"trade","aliases":["designer","interior designer","interior_designer","pereka dalaman"]},{"customer_type":"contractor","pool_key":"trade","aliases":["contractor","kontraktor"]},{"customer_type":"business_owner","pool_key":null,"aliases":["business owner","business_owner","pemilik perniagaan"]}]}'::jsonb
$$;
revoke all on function sales.default_lead_routing() from public,anon,authenticated;

alter table ingest.lead_assignment_settings enable row level security;
alter table sales.lead_pool_cursors enable row level security;
alter table sales.lead_routing_assignments enable row level security;
create policy settings_read on ingest.lead_assignment_settings for select to authenticated
using(workspace_id=core.current_workspace_id() and core.has_permission('settings.manage'));
create policy assignment_read on sales.lead_routing_assignments for select to authenticated
using(workspace_id=core.current_workspace_id() and exists(select 1 from sales.leads l where l.id=lead_id));
grant select on ingest.lead_assignment_settings,sales.lead_routing_assignments to authenticated;
grant all on ingest.lead_assignment_settings,sales.lead_pool_cursors,sales.lead_routing_assignments to service_role;
create view api.lead_assignment_settings with(security_invoker=true) as select * from ingest.lead_assignment_settings;
create view api.lead_routing_assignments with(security_invoker=true) as select * from sales.lead_routing_assignments;
grant select on api.lead_assignment_settings,api.lead_routing_assignments to authenticated,service_role;

create function api.get_lead_routing() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); result jsonb;
begin
  perform core.require_permission('settings.manage'); perform core.require_workspace(ws);
  select jsonb_build_object('config',config,'version',version) into result from ingest.lead_assignment_settings where workspace_id=ws;
  return coalesce(result,jsonb_build_object('config',sales.default_lead_routing(),'version',0));
end $$;
revoke all on function api.get_lead_routing() from public,anon;
grant execute on function api.get_lead_routing() to authenticated;

create function api.save_lead_routing(p_config jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); prior ingest.lead_assignment_settings%rowtype; p jsonb; m jsonb; r jsonb; alias text; aliases text[]:='{}'; keys text[]:='{}'; seen_users text[];
begin
  perform core.require_permission('settings.manage'); perform core.require_workspace(ws);
  perform 1 from core.workspaces where id=ws for update;
  select * into prior from ingest.lead_assignment_settings where workspace_id=ws;
  if coalesce(prior.version,0) is distinct from p_expected_version then raise exception 'Routing changed. Reload before saving.' using errcode='40001'; end if;
  if jsonb_typeof(p_config->'enabled') is distinct from 'boolean' or jsonb_typeof(p_config->'pools') is distinct from 'array'
    or jsonb_typeof(p_config->'rules') is distinct from 'array' or jsonb_array_length(p_config->'pools') not between 1 and 20
    or jsonb_array_length(p_config->'rules') not between 1 and 30 or octet_length(p_config::text)>40000 then
    raise exception 'Invalid routing configuration' using errcode='22023'; end if;
  for p in select value from jsonb_array_elements(p_config->'pools') loop
    if coalesce(p->>'key','') !~ '^[a-z][a-z0-9_]{0,39}$' or p->>'key'=any(keys)
      or length(btrim(coalesce(p->>'name',''))) not between 1 and 100 or coalesce(p->>'mode','') not in ('fixed','round_robin')
      or jsonb_typeof(p->'active') is distinct from 'boolean' or jsonb_typeof(p->'members') is distinct from 'array'
      or jsonb_array_length(p->'members') not between 1 and 30 then raise exception 'Invalid or duplicate pool' using errcode='22023'; end if;
    keys:=array_append(keys,p->>'key'); seen_users:='{}';
    for m in select value from jsonb_array_elements(p->'members') loop
      if length(btrim(coalesce(m->>'name',''))) not between 1 and 100 or jsonb_typeof(m->'active') is distinct from 'boolean' then
        raise exception 'Each slot needs a name and active state' using errcode='22023'; end if;
      if nullif(m->>'user_id','') is not null then
        if not sales.member_can(ws,(m->>'user_id')::uuid,'sales.write') or m->>'user_id'=any(seen_users) then
          raise exception 'Choose distinct active sales members in this workspace' using errcode='23514'; end if;
        seen_users:=array_append(seen_users,m->>'user_id');
      end if;
    end loop;
    if p->>'mode'='fixed' and jsonb_array_length(p->'members')<>1 then raise exception 'Fixed pools need exactly one slot' using errcode='23514'; end if;
  end loop;
  for r in select value from jsonb_array_elements(p_config->'rules') loop
    if coalesce(r->>'customer_type','') !~ '^[a-z][a-z0-9_]{0,39}$' or (r->>'pool_key' is not null and not r->>'pool_key'=any(keys))
      or jsonb_typeof(r->'aliases') is distinct from 'array' or jsonb_array_length(r->'aliases') not between 1 and 30 then
      raise exception 'Invalid routing rule' using errcode='22023'; end if;
    for alias in select lower(btrim(value)) from jsonb_array_elements_text(r->'aliases') loop
      if length(alias) not between 1 and 100 or alias=any(aliases) then raise exception 'Aliases must be nonempty and unique across rules' using errcode='23514'; end if;
      aliases:=array_append(aliases,alias);
    end loop;
  end loop;
  insert into ingest.lead_assignment_settings(workspace_id,config,version,updated_by) values(ws,p_config,1,auth.uid())
    on conflict(workspace_id) do update set config=excluded.config,version=ingest.lead_assignment_settings.version+1,updated_by=auth.uid(),updated_at=now();
  perform audit.emit(ws,'lead.routing_configured','ingest','lead_assignment_settings',ws,prior.config,p_config);
  return api.get_lead_routing();
end $$;
revoke all on function api.save_lead_routing(jsonb,integer) from public,anon;
grant execute on function api.save_lead_routing(jsonb,integer) to authenticated;

create function sales.route_intake_lead() returns trigger language plpgsql security definer set search_path='' as $$
declare ev sales.intake_events%rowtype; l sales.leads%rowtype; cfg jsonb; cfg_version integer; rule jsonb; pool jsonb; slot jsonb; last_pos integer; chosen integer; uid uuid; category text; why text:='Unknown customer type: review routing';
begin
  select * into ev from sales.intake_events where id=new.intake_event_id;
  if ev.status<>'processed' then return new; end if;
  -- Lock configuration before the lead and pool cursor. One lock order for all new intakes.
  select config,version into cfg,cfg_version from ingest.lead_assignment_settings where workspace_id=ev.workspace_id for update;
  cfg:=coalesce(cfg,sales.default_lead_routing());
  select * into l from sales.leads where id=new.lead_id for update;
  if exists(select 1 from sales.lead_routing_assignments where lead_id=l.id) then return new; end if;
  category:=lower(btrim(coalesce(ev.payload->>'customer_type',substring(ev.payload->>'message' from 'conditional_question_1: ([^\n\r]+)'))));
  select value into rule from jsonb_array_elements(cfg->'rules')
    where exists(select 1 from jsonb_array_elements_text(value->'aliases') a where lower(btrim(a))=category) limit 1;
  if l.owner_id is not null then why:='Existing owner preserved'; uid:=l.owner_id;
  elsif not coalesce((cfg->>'enabled')::boolean,false) then why:='Automatic assignment paused';
  elsif rule is not null and rule->>'pool_key' is null then why:='Customer type needs a pool: review routing';
  elsif rule is not null then
    select value into pool from jsonb_array_elements(cfg->'pools') where value->>'key'=rule->>'pool_key';
    if not coalesce((pool->>'active')::boolean,false) then why:='Pool paused: review routing';
    else
      insert into sales.lead_pool_cursors(workspace_id,pool_key) values(l.workspace_id,pool->>'key') on conflict do nothing;
      select last_position into last_pos from sales.lead_pool_cursors where workspace_id=l.workspace_id and pool_key=pool->>'key' for update;
      select m.value,m.ordinality into slot,chosen from jsonb_array_elements(pool->'members') with ordinality m
        where (m.value->>'active')::boolean and nullif(m.value->>'user_id','') is not null
          and sales.member_can(l.workspace_id,(m.value->>'user_id')::uuid,'sales.write')
        order by case when pool->>'mode'='round_robin' and m.ordinality<=last_pos then 1 else 0 end,m.ordinality limit 1;
      if slot is null then why:='No linked active salesperson: configure pool members';
      else
        uid:=(slot->>'user_id')::uuid; why:='Automatically assigned';
        update sales.lead_pool_cursors set last_position=chosen where workspace_id=l.workspace_id and pool_key=pool->>'key';
        update sales.leads set owner_id=uid,assigned_at=now() where id=l.id;
      end if;
    end if;
  end if;
  insert into sales.lead_routing_assignments(lead_id,workspace_id,customer_type,pool_key,slot_name,owner_id,reason,config_version)
    values(l.id,l.workspace_id,coalesce(rule->>'customer_type',category),pool->>'key',slot->>'name',uid,why,cfg_version);
  perform audit.emit(l.workspace_id,'lead.auto_routed','sales','leads',l.id,null,jsonb_build_object('owner_id',uid,'pool',pool->>'key','reason',why),null,jsonb_build_object('source','intake'));
  return new;
end $$;
revoke all on function sales.route_intake_lead() from public,anon,authenticated;
create trigger route_intake_lead after insert on sales.lead_intake_links for each row execute function sales.route_intake_lead();

-- One business command for both authenticated app actions and the trusted bot adapter.
-- Actor is explicit; no JWT impersonation or request claim mutation.
create function sales.emit_inquiry_actor(p_ws uuid,p_actor uuid,p_source text,p_action text,p_id uuid,p_result jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into audit.audit_events(workspace_id,actor_id,action,object_schema,object_table,object_id,after_data,reason,metadata)
 values(p_ws,p_actor,'inquiry.'||p_action,'sales','leads',p_id,p_result,p_reason,jsonb_build_object('source',p_source));
 insert into audit.outbox_events(workspace_id,event_type,actor_id,object_type,object_id,payload)
 values(p_ws,'inquiry.'||p_action,p_actor,'leads',p_id,jsonb_build_object('source',p_source));
end $$;
revoke all on function sales.emit_inquiry_actor(uuid,uuid,text,text,uuid,jsonb,text) from public,anon,authenticated;

create function sales.work_inquiry_as(p_actor uuid,p_workspace uuid,p_source text,p_lead_id uuid, p_action text, p_request_id uuid,
  p_due_at timestamptz default null, p_task_id uuid default null, p_body text default null,
  p_channel text default 'whatsapp', p_occurred_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l sales.leads%rowtype; t sales.tasks%rowtype; a sales.activities%rowtype;
  v_time timestamptz := coalesce(p_occurred_at, now()); v_task uuid; v_result jsonb;
  v_payload jsonb := jsonb_build_object('action',p_action,'due',p_due_at,'task',p_task_id,'body',p_body,'channel',p_channel,'occurred',p_occurred_at);
begin
  if not sales.member_can(p_workspace,p_actor,'sales.write') then raise exception 'permission denied: sales.write' using errcode='42501'; end if;
  select * into l from sales.leads where id = p_lead_id for update;
  if not found then raise exception 'Inquiry not found' using errcode = 'P0002'; end if;
  if l.workspace_id is distinct from p_workspace then raise exception 'workspace access denied' using errcode='42501'; end if;
  if l.owner_id is not null and l.owner_id<>p_actor and not sales.member_can(p_workspace,p_actor,'sales.read_all') then raise exception 'permission denied: not the owner' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'Request ID is required' using errcode = '22023'; end if;
  select * into a from sales.activities where workspace_id = l.workspace_id and lead_id = l.id and request_id = p_request_id;
  if found then
    if a.metadata->'command' is distinct from v_payload then raise exception 'Request ID already used for a different action' using errcode = '22023'; end if;
    return a.metadata->'result';
  end if;
  if p_action is null or p_action not in ('whatsapp_sent','contact_attempt','customer_replied','no_response','schedule','reschedule','complete','no_next_action','lost','reopen') then
    raise exception 'Unknown inquiry action' using errcode = '22023';
  end if;
  if p_channel is null or p_channel not in ('whatsapp','phone','email','dm','meeting') or not isfinite(v_time) or v_time > now() + interval '5 minutes' or v_time < l.created_at then
    raise exception 'Invalid channel or event time' using errcode = '22023';
  end if;
  if length(coalesce(p_body,'')) > 4000 then raise exception 'Note is too long' using errcode = '22023'; end if;
  if l.status in ('disqualified','duplicate') and p_action <> 'reopen' then
    raise exception 'Reopen the inquiry before recording more work' using errcode = '23514';
  end if;
  if p_action = 'reopen' and l.status <> 'disqualified' then
    raise exception 'Only lost inquiries can be reopened here' using errcode = '23514';
  end if;
  if p_action in ('lost','reopen','no_next_action','complete') and length(btrim(coalesce(p_body,''))) < 3 then
    raise exception 'Record an outcome or reason (at least 3 characters)' using errcode = '23514';
  end if;
  if p_action in ('schedule','reschedule','reopen') and (p_due_at is null or not isfinite(p_due_at)) then
    raise exception 'Choose a follow-up date and time' using errcode = '23514';
  end if;
  if l.owner_id is null then
    update sales.leads set owner_id = p_actor, assigned_at = now() where id = l.id;
    l.owner_id := p_actor;
  end if;
  if p_action in ('whatsapp_sent','contact_attempt','no_response') then
    update sales.leads set
      first_response_at = least(first_response_at,v_time),
      first_whatsapp_sent_at = case when p_action = 'whatsapp_sent' then least(first_whatsapp_sent_at,v_time) else first_whatsapp_sent_at end,
      last_contact_attempt_at = greatest(last_contact_attempt_at,v_time), contact_attempts = contact_attempts + 1,
      last_no_response_at = case when p_action = 'no_response' then greatest(last_no_response_at,v_time) else last_no_response_at end,
      status = case when status = 'new' then 'contact_attempted' else status end,
      no_next_action_reason = null where id = l.id;
  elsif p_action = 'customer_replied' then
    update sales.leads set first_customer_reply_at = least(first_customer_reply_at,v_time),
      last_customer_reply_at = greatest(last_customer_reply_at,v_time),
      first_whatsapp_reply_at = case when p_channel = 'whatsapp' then least(first_whatsapp_reply_at,v_time) else first_whatsapp_reply_at end,
      status = case when status in ('new','contact_attempted') then 'contacted' else status end,
      no_next_action_reason = null where id = l.id;
  elsif p_action = 'lost' then
    update sales.leads set status = 'disqualified', disqualified_reason = btrim(p_body), no_next_action_reason = null where id = l.id;
    update sales.tasks set status = 'cancelled', completed_at = v_time, outcome = 'Inquiry lost: ' || btrim(p_body)
      where lead_id = l.id and workspace_id = l.workspace_id and status = 'open';
  elsif p_action = 'reopen' then
    update sales.leads set status = case when first_customer_reply_at is not null then 'contacted'
      when first_response_at is not null then 'contact_attempted' else 'new' end,
      disqualified_reason = null, no_next_action_reason = null where id = l.id;
  elsif p_action = 'no_next_action' then
    if exists(select 1 from sales.tasks where lead_id = l.id and workspace_id = l.workspace_id and status = 'open') then
      raise exception 'Complete outstanding follow-ups first' using errcode = '23514';
    end if;
    update sales.leads set no_next_action_reason = btrim(p_body) where id = l.id;
  end if;

  if p_action in ('schedule','reschedule','complete','reopen') then
    if p_task_id is not null then
      select * into t from sales.tasks where id = p_task_id and lead_id = l.id and workspace_id = l.workspace_id for update;
      if not found or t.status <> 'open' then raise exception 'This follow-up is no longer open. Refresh the inquiry.' using errcode = '23514'; end if;
    else
      select * into t from sales.tasks where lead_id = l.id and workspace_id = l.workspace_id and status = 'open'
        order by due_at asc nulls last,id limit 1 for update;
    end if;
    if p_action = 'complete' then
      if t.id is null then raise exception 'No open follow-up to complete' using errcode = '23514'; end if;
      update sales.tasks set status = 'done', completed_at = v_time, outcome = btrim(p_body) where id = t.id;
      v_task := t.id;
      update sales.leads set no_next_action_reason = null where id = l.id;
    elsif t.id is not null then
      update sales.tasks set due_at = p_due_at, assignee_id = l.owner_id where id = t.id;
      v_task := t.id;
      update sales.leads set no_next_action_reason = null where id = l.id;
    else
      insert into sales.tasks(workspace_id,title,due_at,assignee_id,lead_id,contact_id,created_by)
      values(l.workspace_id,'Follow up with ' || coalesce(nullif(l.raw_name,''),nullif(l.raw_company,''),'customer'),
        p_due_at,l.owner_id,l.id,l.contact_id,p_actor) returning id into v_task;
      update sales.leads set no_next_action_reason = null where id = l.id;
    end if;
  end if;
  v_result := jsonb_build_object('lead_id',l.id,'task_id',v_task,'action',p_action);
  insert into sales.activities(workspace_id,kind,channel,subject,body,occurred_at,actor_id,lead_id,contact_id,request_id,metadata)
  values(l.workspace_id,case when p_action in ('whatsapp_sent','customer_replied','contact_attempt','no_response') then case when p_channel = 'phone' then 'call' when p_channel = 'email' then 'email' when p_channel = 'meeting' then 'meeting' else 'message' end when p_action = 'complete' then 'task_outcome' else 'note' end,
    p_channel,case p_action when 'whatsapp_sent' then 'WhatsApp sent' when 'contact_attempt' then 'Staff contact logged' when 'customer_replied' then 'Customer replied'
      when 'no_response' then 'No response' when 'schedule' then 'Follow-up scheduled' when 'reschedule' then 'Follow-up rescheduled'
      when 'complete' then 'Follow-up completed' when 'lost' then 'Inquiry lost' when 'reopen' then 'Inquiry reopened' else 'No next action needed' end,
    p_body,v_time,p_actor,l.id,l.contact_id,p_request_id,
    jsonb_build_object('source',p_source,'event',p_action,'command',v_payload,'result',v_result,'task_id',v_task));
  perform sales.emit_inquiry_actor(l.workspace_id,p_actor,p_source,p_action,l.id,v_result,p_body);
  return v_result;
end $$;
revoke all on function sales.work_inquiry_as(uuid,uuid,text,uuid,text,uuid,timestamptz,uuid,text,text,timestamptz) from public,anon,authenticated;

create or replace function api.work_inquiry(p_lead_id uuid, p_action text, p_request_id uuid,
  p_due_at timestamptz default null, p_task_id uuid default null, p_body text default null,
  p_channel text default 'whatsapp', p_occurred_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform core.require_permission('sales.write');
 return sales.work_inquiry_as(auth.uid(),core.current_workspace_id(),'app',p_lead_id,p_action,p_request_id,p_due_at,p_task_id,p_body,p_channel,p_occurred_at);
end $$;
-- Bot credentials stay in n8n. These tables store bindings and delivery state only.
create table ingest.telegram_sales_channels(workspace_id uuid primary key references core.workspaces(id),chat_id bigint not null);
create table sales.telegram_members(workspace_id uuid references core.workspaces(id),user_id uuid references auth.users(id),telegram_user_id bigint not null,linked_at timestamptz not null default now(),primary key(workspace_id,user_id),unique(workspace_id,telegram_user_id));
create table sales.telegram_link_codes(token_hash text primary key check(length(token_hash)=64),workspace_id uuid not null references core.workspaces(id),user_id uuid not null references auth.users(id),expires_at timestamptz not null,used_at timestamptz);
create table sales.telegram_lead_cards(
  lead_id uuid primary key references sales.leads(id) on delete cascade,workspace_id uuid not null references core.workspaces(id),
  token uuid not null default gen_random_uuid() unique,chat_id bigint not null,message_id bigint,
  owner_id uuid,assigned_at timestamptz,needs_sync boolean not null default true,lease_until timestamptz,
  expires_at timestamptz not null default now()+interval '30 days',created_at timestamptz not null default now(),
  delivered_follow_up_at timestamptz,leased_follow_up_at timestamptz
);
create table sales.telegram_updates(workspace_id uuid references core.workspaces(id),update_id bigint not null,result jsonb not null,processed_at timestamptz not null default now(),primary key(workspace_id,update_id));
do $$declare t text; begin
  foreach t in array array['telegram_members','telegram_link_codes','telegram_lead_cards','telegram_updates'] loop
    execute format('alter table sales.%I enable row level security',t);
    execute format('grant all on sales.%I to service_role',t);
    execute format('create view api.%I with(security_invoker=true) as select * from sales.%I',t,t);
    execute format('grant all on api.%I to service_role',t);
  end loop;
end $$;
alter table ingest.telegram_sales_channels enable row level security;
grant all on ingest.telegram_sales_channels to service_role;
create view api.telegram_sales_channels with(security_invoker=true) as select * from ingest.telegram_sales_channels;
grant all on api.telegram_sales_channels to service_role;
create policy self_read on sales.telegram_members for select to authenticated using(workspace_id=core.current_workspace_id() and user_id=auth.uid());
grant select on sales.telegram_members,api.telegram_members to authenticated;

create function api.begin_telegram_link(p_token_hash text) returns void language plpgsql security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); begin
  perform core.require_permission('sales.write'); perform core.require_workspace(ws);
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid link code' using errcode='22023'; end if;
  delete from sales.telegram_link_codes where workspace_id=ws and user_id=auth.uid();
  insert into sales.telegram_link_codes values(p_token_hash,ws,auth.uid(),now()+interval '10 minutes',null);
end $$;
revoke all on function api.begin_telegram_link(text) from public,anon;
grant execute on function api.begin_telegram_link(text) to authenticated;
create function api.unlink_my_telegram() returns void language plpgsql security definer set search_path='' as $$
begin
  delete from sales.telegram_members where workspace_id=core.current_workspace_id() and user_id=auth.uid();
  delete from sales.telegram_link_codes where workspace_id=core.current_workspace_id() and user_id=auth.uid();
  perform audit.emit(core.current_workspace_id(),'telegram.unlinked','core','profiles',auth.uid());
end $$;
revoke all on function api.unlink_my_telegram() from public,anon;
grant execute on function api.unlink_my_telegram() to authenticated;

create function sales.queue_telegram_card() returns trigger language plpgsql security definer set search_path='' as $$
declare l sales.leads%rowtype; group_id bigint;
begin
  if tg_table_name='lead_intake_links' then
    select * into l from sales.leads where id=new.lead_id;
    if not exists(select 1 from sales.intake_events where id=new.intake_event_id and status='processed') then return new; end if;
    select chat_id into group_id from ingest.telegram_sales_channels where workspace_id=l.workspace_id;
    if group_id is not null then
      insert into sales.telegram_lead_cards(lead_id,workspace_id,chat_id,owner_id,assigned_at)
        values(l.id,l.workspace_id,group_id,l.owner_id,l.assigned_at) on conflict do nothing;
    end if;
  else
    update sales.telegram_lead_cards set token=gen_random_uuid(),owner_id=new.owner_id,assigned_at=new.assigned_at,
      needs_sync=true,lease_until=null,expires_at=now()+interval '30 days' where lead_id=new.id;
  end if;
  return new;
end $$;
revoke all on function sales.queue_telegram_card() from public,anon,authenticated;
-- Alphabetical trigger order: routing must commit ownership before the first card is queued.
create trigger zz_queue_telegram_card after insert on sales.lead_intake_links for each row execute function sales.queue_telegram_card();
create trigger queue_telegram_progress after update of owner_id,status,assigned_at,first_whatsapp_sent_at,first_customer_reply_at,last_no_response_at,no_next_action_reason on sales.leads
for each row execute function sales.queue_telegram_card();

create function sales.telegram_card_data(p_lead uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lead_id',l.id,'token',c.token,'chat_id',c.chat_id::text,'message_id',c.message_id,
   'phone',l.raw_phone,'name',coalesce(nullif(l.raw_name,''),'New prospect'),'assignee',coalesce(p.full_name,'Unassigned'),
   'status',l.status,'routing_reason',a.reason,'customer_type',a.customer_type,
   'whatsapp_sent_at',l.first_whatsapp_sent_at,'customer_reply_at',l.first_customer_reply_at,'no_response_at',l.last_no_response_at,'last_customer_reply_at',l.last_customer_reply_at,'last_contact_attempt_at',l.last_contact_attempt_at,
   'follow_up_at',c.leased_follow_up_at)
 from sales.telegram_lead_cards c join sales.leads l on l.id=c.lead_id
 left join core.profiles p on p.user_id=l.owner_id left join sales.lead_routing_assignments a on a.lead_id=l.id
 where l.id=p_lead
$$;
revoke all on function sales.telegram_card_data(uuid) from public,anon,authenticated;

create function api.pending_telegram_cards(p_workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; result jsonb;
begin
  update sales.telegram_lead_cards set token=gen_random_uuid(),needs_sync=true,lease_until=null,expires_at=now()+interval '30 days' where workspace_id=p_workspace_id and expires_at<=now();
  -- Reconcile app-side task edits/deletions without taking task locks or changing lead ownership.
  -- The acknowledged snapshot is the content actually leased to the sender, not whatever changed during delivery.
  with followups as (
    select c.lead_id,min(t.due_at) due_at from sales.telegram_lead_cards c
    left join sales.tasks t on t.lead_id=c.lead_id and t.workspace_id=c.workspace_id and t.status='open'
    where c.workspace_id=p_workspace_id group by c.lead_id
  ) update sales.telegram_lead_cards c set token=gen_random_uuid(),needs_sync=true,lease_until=null,expires_at=now()+interval '30 days'
    from followups f where c.lead_id=f.lead_id and not c.needs_sync and c.delivered_follow_up_at is distinct from f.due_at;
  select array_agg(lead_id) into ids from (
    select lead_id from sales.telegram_lead_cards where workspace_id=p_workspace_id and needs_sync
      and (lease_until is null or lease_until<now()) order by created_at,lead_id limit 20 for update skip locked
  ) q;
  update sales.telegram_lead_cards c set token=gen_random_uuid(),lease_until=now()+interval '2 minutes',expires_at=now()+interval '30 days',
    leased_follow_up_at=(select min(t.due_at) from sales.tasks t where t.lead_id=c.lead_id and t.workspace_id=c.workspace_id and t.status='open')
    where c.lead_id=any(ids);
  select coalesce(jsonb_agg(sales.telegram_card_data(lead_id)),'[]'::jsonb) into result from sales.telegram_lead_cards where lead_id=any(ids);
  return result;
end $$;
revoke all on function api.pending_telegram_cards(uuid) from public,anon,authenticated;
grant execute on function api.pending_telegram_cards(uuid) to service_role;
create function api.confirm_telegram_card(p_workspace_id uuid,p_lead_id uuid,p_token uuid,p_message_id bigint) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_message_id<=0 then raise exception 'Invalid message ID' using errcode='22023'; end if;
  -- Do not clear a newer pending update when an older network request finishes late.
  update sales.telegram_lead_cards set message_id=p_message_id,delivered_follow_up_at=case when token=p_token then leased_follow_up_at else delivered_follow_up_at end,needs_sync=case when token=p_token then false else true end,lease_until=null
    where workspace_id=p_workspace_id and lead_id=p_lead_id and (message_id is null or message_id=p_message_id);
end $$;
revoke all on function api.confirm_telegram_card(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function api.confirm_telegram_card(uuid,uuid,uuid,bigint) to service_role;

create function api.process_telegram_update(p_workspace_id uuid,p_update jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare upd bigint:=(p_update->>'update_id')::bigint; prior jsonb; result jsonb; cb jsonb:=p_update->'callback_query'; msg jsonb:=p_update->'message';
  code sales.telegram_link_codes%rowtype; c sales.telegram_lead_cards%rowtype; l sales.leads%rowtype;
  who bigint; actor uuid; data text; action text; v_token uuid; due timestamptz; problem text;
begin
  if upd is null or upd<0 then raise exception 'Invalid update' using errcode='22023'; end if;
  -- Serialize retries for one provider update without retaining raw Telegram payloads.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||upd::text,0));
  select r.result into prior from sales.telegram_updates r where workspace_id=p_workspace_id and update_id=upd;
  if found then return prior; end if;
  result:='{"kind":"ignored"}'::jsonb;
  if msg is not null and msg->'chat'->>'type'='private' and msg->>'text' like '/start tc_%'
    and msg->'from'->>'id'=msg->'chat'->>'id' then
    who:=(msg->'from'->>'id')::bigint;
    select * into code from sales.telegram_link_codes where token_hash=core.hash_key(substring(msg->>'text' from 11))
      and workspace_id=p_workspace_id and used_at is null and expires_at>now() for update;
    if not found or not sales.member_can(p_workspace_id,code.user_id,'sales.write') then problem:='This link expired. Create a fresh link in the app.';
    elsif exists(select 1 from sales.telegram_members where workspace_id=p_workspace_id and telegram_user_id=who and user_id<>code.user_id) then
      problem:='This Telegram account is already linked. Unlink it in the original app account first.';
    else
      insert into sales.telegram_members(workspace_id,user_id,telegram_user_id) values(p_workspace_id,code.user_id,who)
        on conflict(workspace_id,user_id) do update set telegram_user_id=excluded.telegram_user_id,linked_at=now();
      update sales.telegram_link_codes set used_at=now() where token_hash=code.token_hash;
      insert into audit.audit_events(workspace_id,actor_id,action,object_schema,object_table,object_id,metadata)
        values(p_workspace_id,code.user_id,'telegram.linked','core','profiles',code.user_id,jsonb_build_object('source','telegram'));
    end if;
    result:=jsonb_build_object('kind','message','chat_id',who::text,'text',coalesce(problem,'Telegram linked. You can now update your assigned leads from the sales group.'));
  elsif cb is not null then
    who:=(cb->'from'->>'id')::bigint; data:=coalesce(cb->>'data','');
    problem:='This button is out of date. Use the latest lead card.';
    if data ~ '^tc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(sent|reply|none|tomorrow)$' then
      v_token:=split_part(data,':',2)::uuid; action:=split_part(data,':',3);
      select lead_id into c.lead_id from sales.telegram_lead_cards where workspace_id=p_workspace_id and telegram_lead_cards.token=v_token;
      -- Lead before card lock matches the progress/update-trigger lock order.
      select * into l from sales.leads where id=c.lead_id for update;
      select * into c from sales.telegram_lead_cards where lead_id=l.id and telegram_lead_cards.token=v_token for update;
      if found and c.expires_at>now() and c.message_id=(cb->'message'->>'message_id')::bigint
        and c.chat_id::text=cb->'message'->'chat'->>'id' and c.chat_id=(select chat_id from ingest.telegram_sales_channels where workspace_id=p_workspace_id)
        and c.owner_id is not distinct from l.owner_id and c.assigned_at is not distinct from l.assigned_at then
        select user_id into actor from sales.telegram_members where workspace_id=p_workspace_id and telegram_user_id=who;
        if actor is null then problem:='Link your Telegram account from the app first.';
        elsif not sales.member_can(p_workspace_id,actor,'sales.write') then problem:='Your app account cannot update sales inquiries.';
        elsif l.owner_id is distinct from actor and not sales.member_can(p_workspace_id,actor,'sales.assign') then problem:='Only the assigned salesperson or sales manager can update this lead.';
        else
          begin
            if action='tomorrow' then due:=((now() at time zone 'Asia/Kuala_Lumpur')::date+1+time '09:00') at time zone 'Asia/Kuala_Lumpur'; end if;
            perform sales.work_inquiry_as(actor,p_workspace_id,'telegram',l.id,
              case action when 'sent' then 'whatsapp_sent' when 'reply' then 'customer_replied' when 'none' then 'no_response' else 'schedule' end,
              gen_random_uuid(),due,null,null,'whatsapp',null);
            -- Scheduling alone may not touch a watched lead column.
            update sales.telegram_lead_cards set token=gen_random_uuid(),needs_sync=true,lease_until=null where lead_id=l.id;
            problem:=null;
          exception when check_violation or insufficient_privilege or invalid_parameter_value then
            problem:='This action is unavailable for the current lead state. Open Inquiry for details.';
          end;
        end if;
      end if;
    end if;
    result:=jsonb_build_object('kind','callback','callback_query_id',cb->>'id','text',coalesce(problem,'Saved in Inquiry Box.'),'show_alert',problem is not null);
  end if;
  insert into sales.telegram_updates(workspace_id,update_id,result) values(p_workspace_id,upd,result);
  return result;
end $$;
revoke all on function api.process_telegram_update(uuid,jsonb) from public,anon,authenticated;
grant execute on function api.process_telegram_update(uuid,jsonb) to service_role;

-- Supersede legacy first-match assignees only for newly accepted leads.
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
  if auth.role()='authenticated' then
    perform core.require_permission('source.import');
    perform core.require_workspace(p_workspace_id);
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'an idempotency key is required' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_idempotency_key,0));
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

  -- Preserve legacy location selection; configurable pools now own new-lead assignment.
  select null::uuid, r.match_location_id into v_owner, v_location
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
