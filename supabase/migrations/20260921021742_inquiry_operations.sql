-- Inquiry operations: explicit customer replies, shared reminder summaries,
-- uncapped server-side filtering, and transactional/idempotent staff actions.
-- Historic first_response_at is a STAFF response. Never backfill customer replies.
alter table sales.leads
  add column first_whatsapp_sent_at timestamptz,
  add column first_customer_reply_at timestamptz,
  add column first_whatsapp_reply_at timestamptz,
  add column last_customer_reply_at timestamptz,
  add column last_no_response_at timestamptz,
  add column last_contact_attempt_at timestamptz,
  add column no_next_action_reason text;
alter table sales.activities add column request_id uuid;
create unique index activities_lead_request_idx on sales.activities(workspace_id, lead_id, request_id);
create index tasks_lead_status_due_idx on sales.tasks(lead_id, status, due_at, id);

-- A narrow shared summary, not shared access to private task descriptions.
create function api.lead_followup_summary(p_lead_id uuid)
returns table(next_follow_up_task_id uuid, next_follow_up_at timestamptz,
  follow_up_owner_id uuid, open_follow_ups bigint, completed_follow_ups bigint)
language plpgsql stable security definer set search_path = '' as $$
declare l sales.leads%rowtype;
begin
  perform core.require_permission('sales.read');
  select * into l from sales.leads where id = p_lead_id;
  if not found then return; end if;
  perform core.require_workspace(l.workspace_id);
  if not (core.has_permission('sales.read_all') or core.has_permission('sales.leads.read_all')
    or l.owner_id is null or l.owner_id = auth.uid()) then return; end if;
  return query
    select t.id, t.due_at, t.assignee_id,
      (select count(*) from sales.tasks x where x.lead_id = l.id and x.workspace_id = l.workspace_id and x.status = 'open'),
      (select count(*) from sales.tasks x where x.lead_id = l.id and x.workspace_id = l.workspace_id and x.status = 'done')
    from (values (1)) dummy(n)
    left join lateral (select x.id, x.due_at, x.assignee_id from sales.tasks x
      where x.lead_id = l.id and x.workspace_id = l.workspace_id and x.status = 'open'
      order by x.due_at asc nulls last, x.id limit 1) t on true;
end $$;
revoke all on function api.lead_followup_summary(uuid) from public, anon;
grant execute on function api.lead_followup_summary(uuid) to authenticated;

create view api.inbox_leads with (security_invoker = true) as
select l.*, f.next_follow_up_task_id, f.next_follow_up_at, f.follow_up_owner_id,
       f.open_follow_ups, f.completed_follow_ups,
       (l.status not in ('disqualified','duplicate') and
         (l.first_response_at is null or
          (f.open_follow_ups = 0 and l.no_next_action_reason is null) or
          (f.open_follow_ups > 0 and f.next_follow_up_at is null) or
          coalesce(f.next_follow_up_at < (date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur',false))) as needs_action
from sales.leads l left join lateral api.lead_followup_summary(l.id) f on true;
grant select on api.inbox_leads to authenticated;

-- One snapshot for rows and counts; filters/search cover all authorized records.
create function api.inquiry_page(p_view text default 'needs-action', p_search text default '',
  p_owner text default 'all', p_source text default '', p_page integer default 1, p_size integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb; v_end timestamptz := (date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur';
begin
  perform core.require_permission('sales.read');
  if p_view is null or p_view not in ('needs-action','new','waiting','contacted','replied','unassigned','mine','no-response','follow-up','follow-ups-due','upcoming','follow-ups-completed','duplicates','qualified','disqualified','all','aging') then
    raise exception 'Unknown inbox view' using errcode = '22023';
  end if;
  if p_size is null or p_page is null or p_search is null or p_owner is null or p_source is null
    or p_size < 1 or p_size > 100 or p_page < 1 or p_page > 1000000 or length(p_search) > 200 then
    raise exception 'Invalid page or search' using errcode = '22023';
  end if;
  with base as materialized (
    select l.*, array_remove(array[
      'all',
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

create function api.work_inquiry(p_lead_id uuid, p_action text, p_request_id uuid,
  p_due_at timestamptz default null, p_task_id uuid default null, p_body text default null,
  p_channel text default 'whatsapp', p_occurred_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l sales.leads%rowtype; t sales.tasks%rowtype; a sales.activities%rowtype;
  v_time timestamptz := coalesce(p_occurred_at, now()); v_task uuid; v_result jsonb;
  v_payload jsonb := jsonb_build_object('action',p_action,'due',p_due_at,'task',p_task_id,'body',p_body,'channel',p_channel,'occurred',p_occurred_at);
begin
  perform core.require_permission('sales.write');
  select * into l from sales.leads where id = p_lead_id for update;
  if not found then raise exception 'Inquiry not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(l.workspace_id);
  perform sales.require_lead_owner(l);
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
    update sales.leads set owner_id = auth.uid(), assigned_at = now() where id = l.id;
    l.owner_id := auth.uid();
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
        p_due_at,l.owner_id,l.id,l.contact_id,auth.uid()) returning id into v_task;
      update sales.leads set no_next_action_reason = null where id = l.id;
    end if;
  end if;
  v_result := jsonb_build_object('lead_id',l.id,'task_id',v_task,'action',p_action);
  insert into sales.activities(workspace_id,kind,channel,subject,body,occurred_at,actor_id,lead_id,contact_id,request_id,metadata)
  values(l.workspace_id,case when p_action in ('whatsapp_sent','customer_replied','contact_attempt','no_response') then case when p_channel = 'phone' then 'call' when p_channel = 'email' then 'email' when p_channel = 'meeting' then 'meeting' else 'message' end when p_action = 'complete' then 'task_outcome' else 'note' end,
    p_channel,case p_action when 'whatsapp_sent' then 'WhatsApp sent' when 'contact_attempt' then 'Staff contact logged' when 'customer_replied' then 'Customer replied'
      when 'no_response' then 'No response' when 'schedule' then 'Follow-up scheduled' when 'reschedule' then 'Follow-up rescheduled'
      when 'complete' then 'Follow-up completed' when 'lost' then 'Inquiry lost' when 'reopen' then 'Inquiry reopened' else 'No next action needed' end,
    p_body,v_time,auth.uid(),l.id,l.contact_id,p_request_id,
    jsonb_build_object('event',p_action,'command',v_payload,'result',v_result,'task_id',v_task));
  perform audit.emit(l.workspace_id,'inquiry.' || p_action,'sales','leads',l.id,null,v_result,p_body,'{}'::jsonb);
  return v_result;
end $$;
revoke all on function api.work_inquiry(uuid,text,uuid,timestamptz,uuid,text,text,timestamptz) from public, anon;
grant execute on function api.work_inquiry(uuid,text,uuid,timestamptz,uuid,text,text,timestamptz) to authenticated;

-- Lead reassignment also transfers its outstanding reminders.
create or replace function api.assign_lead(p_lead_id uuid,p_owner_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l sales.leads%rowtype;
begin
  perform core.require_permission('sales.assign');
  select * into l from sales.leads where id = p_lead_id for update;
  if not found then raise exception 'Inquiry not found'; end if;
  perform core.require_workspace(l.workspace_id);
  if not exists(select 1 from core.memberships m join core.role_permissions rp on rp.role_key = m.role_key
    where m.workspace_id = l.workspace_id and m.user_id = p_owner_id and m.status = 'active' and rp.permission = 'sales.write') then
    raise exception 'Choose an active salesperson in this workspace' using errcode = '23514';
  end if;
  update sales.leads set owner_id = p_owner_id, assigned_at = now(),
    first_response_due_at = coalesce(first_response_due_at,now() + interval '4 hours') where id = l.id;
  update sales.tasks set assignee_id = p_owner_id where lead_id = l.id and workspace_id = l.workspace_id and status = 'open';
  perform audit.emit(l.workspace_id,'lead.assigned','sales','leads',l.id,
    jsonb_build_object('owner_id',l.owner_id),jsonb_build_object('owner_id',p_owner_id),p_reason,'{}'::jsonb);
end $$;
revoke all on function api.assign_lead(uuid,uuid,text) from public, anon;
grant execute on function api.assign_lead(uuid,uuid,text) to authenticated;

comment on column sales.leads.first_customer_reply_at is 'Explicitly recorded inbound customer response. Historic staff responses are not customer replies.';
comment on view api.inbox_leads is 'RLS-protected inquiry records with the minimal shared follow-up summary; private task bodies stay scoped.';

-- The Tasks screen must obey the same lead ownership and closed-state rules.
create function sales.guard_inquiry_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l sales.leads%rowtype;
begin
  if tg_op = 'UPDATE' and auth.role() = 'authenticated' and old.lead_id is not null and old.lead_id is distinct from new.lead_id then
    raise exception 'An inquiry task cannot be moved to another inquiry' using errcode = '23514';
  end if;
  if new.lead_id is null then return new; end if;
  select * into l from sales.leads where id = new.lead_id;
  if not found or l.workspace_id <> new.workspace_id then
    raise exception 'Task and inquiry must belong to the same workspace' using errcode = '23514';
  end if;
  if auth.role() = 'authenticated' then
    perform core.require_workspace(l.workspace_id);
    perform core.require_permission('sales.write');
    perform sales.require_lead_owner(l);
    if new.status = 'open' and l.status in ('disqualified','duplicate') then
      raise exception 'Reopen the inquiry before reopening its follow-up' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function sales.guard_inquiry_task() from public, anon, authenticated;
create trigger guard_inquiry_task before insert or update on sales.tasks
for each row execute function sales.guard_inquiry_task();

-- Completion and its history either both succeed or both roll back, including
-- when staff complete a follow-up from Tasks instead of the Inquiry Inbox.
create function api.complete_sales_task(p_task_id uuid, p_outcome text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare t sales.tasks%rowtype;
begin
  perform core.require_permission('sales.write');
  select * into t from sales.tasks where id = p_task_id;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if t.lead_id is not null then
    -- The lead lock precedes the task lock, matching work_inquiry's lock order.
    perform 1 from sales.leads where id = t.lead_id for update;
  end if;
  select * into t from sales.tasks where id = p_task_id for update;
  if t.status = 'done' then return; end if;
  if t.status <> 'open' then raise exception 'Only open tasks can be completed' using errcode = '23514'; end if;
  if t.lead_id is not null then
    perform api.work_inquiry(t.lead_id,'complete',gen_random_uuid(),p_task_id => t.id,p_body => p_outcome);
  else
    update sales.tasks set status = 'done', completed_at = now(), outcome = p_outcome where id = t.id;
    insert into sales.activities(workspace_id,kind,subject,body,actor_id,contact_id,account_id,opportunity_id,project_id,metadata)
    values(t.workspace_id,'task_outcome','Task done: ' || t.title,p_outcome,auth.uid(),t.contact_id,t.account_id,t.opportunity_id,t.project_id,jsonb_build_object('task_id',t.id));
  end if;
end $$;
revoke all on function api.complete_sales_task(uuid,text) from public, anon;
grant execute on function api.complete_sales_task(uuid,text) to authenticated;
