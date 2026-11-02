-- received_at is business event time; created_at remains system entry time.
alter table sales.leads add column received_at timestamptz;
-- Preserve updated_at during the one-time compatibility backfill.
alter table sales.leads disable trigger set_updated_at;
update sales.leads set received_at = created_at;
alter table sales.leads enable trigger set_updated_at;
alter table sales.leads alter column received_at set not null;
comment on column sales.leads.received_at is 'Actual enquiry receipt time. Existing rows initially retain their prior lead date; corrections require evidence.';
comment on column sales.leads.created_at is 'System entry time; immutable for new writes. Historical imports may already have overwritten this before received_at existed.';
create index leads_workspace_received_idx on sales.leads(workspace_id, received_at desc, id);

create function sales.guard_enquiry_dates() returns trigger language plpgsql set search_path='' as $$
declare earliest timestamptz;
begin
  if tg_op='INSERT' then
    new.received_at := coalesce(new.received_at,new.created_at,now());
  elsif new.created_at is distinct from old.created_at then
    raise exception 'System entry time cannot be changed. Correct the enquiry received date instead.' using errcode='23514';
  end if;
  if tg_op='INSERT' or new.received_at is distinct from old.received_at then
    if new.received_at is null or not isfinite(new.received_at) or new.received_at>now()+interval '5 minutes' then
      raise exception 'Choose a valid enquiry received date that is not in the future.' using errcode='22023';
    end if;
    if tg_op='UPDATE' then
      if current_user not in ('postgres','supabase_admin','service_role') then
        raise exception 'Use the enquiry date correction action and provide a reason.' using errcode='42501';
      end if;
      select min(t) into earliest from (
        select unnest(array[new.first_response_at,new.first_whatsapp_sent_at,new.first_customer_reply_at,new.first_whatsapp_reply_at,new.last_customer_reply_at,new.last_contact_attempt_at,new.last_no_response_at]) t
        union all select a.occurred_at from sales.activities a where a.workspace_id=new.workspace_id and a.lead_id=new.id
          and a.metadata->>'event' in ('whatsapp_sent','contact_attempt','customer_replied','no_response','schedule','reschedule','complete','lost','reopen','no_next_action')
        union all select v.occurred_at from sales.visits v where v.workspace_id=new.workspace_id and v.lead_id=new.id
        union all select p.purchased_at from sales.purchases p where p.workspace_id=new.workspace_id and p.lead_id=new.id and p.status<>'voided'
      ) events;
      if earliest<new.received_at then
        raise exception 'Enquiry received date cannot be later than an existing customer action, visit or sale.' using errcode='23514';
      end if;
      new.first_response_due_at := new.received_at + coalesce(old.first_response_due_at-old.received_at,interval '4 hours');
    end if;
  end if;
  return new;
end $$;
revoke all on function sales.guard_enquiry_dates() from public,anon,authenticated;
create trigger guard_enquiry_dates before insert or update on sales.leads for each row execute function sales.guard_enquiry_dates();

-- Append to existing view columns, retaining their order, security and grants.
create or replace view api.leads with (security_invoker=true) as select * from sales.leads;
do $$
declare definition text;
begin
  definition:=rtrim(pg_get_viewdef('api.inbox_leads'::regclass,true),';' || chr(10));
  -- The first FROM is the outer query; all lateral subqueries follow it.
  if definition !~ E'\n[ ]*FROM ' then raise exception 'Unexpected inbox view definition'; end if;
  definition:=regexp_replace(definition,E'\n[ ]*FROM ',E', l.received_at\n FROM ');
  execute 'create or replace view api.inbox_leads with (security_invoker=true) as '||definition;
end $$;

-- Keep the latest deployed function bodies and their ACLs. Only lead-date
-- references change, never task/activity/sale system timestamps.
do $$
declare f record; definition text; changed text;
begin
  for f in select p.oid,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='api' and p.proname in ('work_inquiry','inquiry_page','report_lead_source','funnel_dashboard','funnel_history','marketing_journey','command_centre_summary','link_lead_contact','find_identity_candidates','walk_in_inquiries','resolve_visit_inquiry','record_showroom_visit','sale_command'))
       or (n.nspname='sales' and p.proname in ('work_inquiry_as','resolve_walk_in_lead','attach_lead_identity')) loop
    definition:=pg_get_functiondef(f.oid);
    changed:=replace(definition,'l.created_at','l.received_at');
    if f.proname='inquiry_page' then changed:=replace(changed,'created_at desc, id','received_at desc, id'); end if;
    -- Compatibility return field name remains created_at for walk-in chooser.
    if f.proname='walk_in_inquiries' then changed:=replace(changed,'l.received_at, l.interest','l.received_at as created_at, l.interest'); end if;
    if f.proname='find_identity_candidates' then
      -- Preserve the lead_hits CTE column consumed by the candidate union.
      changed:=replace(changed,'l.source_channel, l.received_at,','l.source_channel, l.received_at as created_at,');
    end if;
    if f.proname='report_lead_source' then
      changed:=replace(changed,'l.received_at >= p_from', 'l.received_at >= (p_from::timestamp at time zone ''Asia/Kuala_Lumpur'')');
      changed:=replace(changed,'l.received_at < p_to + 1', 'l.received_at < ((p_to+1)::timestamp at time zone ''Asia/Kuala_Lumpur'')');
    end if;
    if f.proname='record_showroom_visit' then changed:=replace(changed,'select created_at from sales.leads','select received_at from sales.leads'); end if;
    if f.proname='resolve_walk_in_lead' then
      changed:=replace(changed,'created_by,created_at,interest','created_by,received_at,interest');
    end if;
    if f.proname in ('work_inquiry','work_inquiry_as') then
      changed:=replace(changed,$patch$or v_time < l.received_at then$patch$,'then');
      changed:=replace(changed,$patch$if length(coalesce(p_body,'')) > 4000$patch$,
        $patch$if v_time < l.received_at then raise exception 'Action time is earlier than the enquiry received date. Correct the enquiry date first for historical leads.' using errcode='22023'; end if;$patch$||chr(10)||$patch$  if length(coalesce(p_body,'')) > 4000$patch$);
    end if;
    if changed<>definition then execute changed; end if;
  end loop;
  if position('v_time < l.received_at' in pg_get_functiondef('api.work_inquiry(uuid,text,uuid,timestamptz,uuid,text,text,timestamptz)'::regprocedure))=0
    and to_regprocedure('sales.work_inquiry_as(uuid,uuid,text,uuid,text,uuid,timestamptz,uuid,text,text,timestamptz)') is null then
    raise exception 'Enquiry action date validation was not migrated';
  end if;
  if to_regprocedure('sales.work_inquiry_as(uuid,uuid,text,uuid,text,uuid,timestamptz,uuid,text,text,timestamptz)') is not null then
    if position('v_time < l.received_at' in pg_get_functiondef('sales.work_inquiry_as(uuid,uuid,text,uuid,text,uuid,timestamptz,uuid,text,text,timestamptz)'::regprocedure))=0 then
      raise exception 'Actor-based enquiry action date validation was not migrated';
    end if;
  end if;
end $$;

-- Incoming connectors already supply their actual event timestamp. Set both
-- receipt time and the response deadline atomically before returning.
do $$
declare definition text; anchor text := 'update sales.intake_events set status = ''processed'', lead_id = v_lead_id';
begin
  definition:=pg_get_functiondef('api.accept_intake(uuid,text,text,text,text,jsonb,jsonb,timestamptz,text,text)'::regprocedure);
  if position(anchor in definition)=0 then raise exception 'Unexpected accept_intake definition'; end if;
  definition:=replace(definition,anchor,
    'update sales.leads set received_at=coalesce(p_occurred_at,created_at), first_response_due_at=coalesce(p_occurred_at,created_at)+interval ''4 hours'' where id=v_lead_id;'||chr(10)||'  '||anchor);
  definition:=replace(definition,'l.created_at > now() - interval ''1 day''',
    'l.received_at > coalesce(p_occurred_at,now()) - interval ''1 day'' and l.received_at<=coalesce(p_occurred_at,now())');
  definition:=replace(definition,'order by l.created_at desc limit 1','order by l.received_at desc limit 1');
  execute definition;
end $$;

-- Manual capture accepts the actual received time inside the idempotent payload.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('api.create_manual_inquiry(jsonb,uuid)'::regprocedure);
  if position('v_key text; v_limit integer; v_unsafe boolean;' in definition)=0 then raise exception 'Unexpected manual inquiry definition'; end if;
  definition:=replace(definition,'v_key text; v_limit integer; v_unsafe boolean;',
    'v_key text; v_limit integer; v_unsafe boolean; v_received timestamptz:=coalesce((p_input->>''received_at'')::timestamptz,now());');
  definition:=replace(definition,'perform core.require_workspace(ws);',
    'perform core.require_workspace(ws);'||chr(10)||'  if not isfinite(v_received) or v_received>now()+interval ''5 minutes'' then raise exception ''Choose a valid enquiry received date that is not in the future.'' using errcode=''22023''; end if;');
  definition:=replace(definition,'''manual:''||p_request_id::text,now(),','''manual:''||p_request_id::text,v_received,');
  definition:=replace(definition,'first_response_due_at,notes,created_by)','first_response_due_at,notes,created_by,received_at)');
  definition:=replace(definition,'now()+interval ''4 hours'',nullif(btrim(p_input->>''notes''),''''),auth.uid()) returning id into v_lead;',
    'v_received+interval ''4 hours'',nullif(btrim(p_input->>''notes''),''''),auth.uid(),v_received) returning id into v_lead;');
  if position('auth.uid(),v_received)' in definition)=0 then raise exception 'Manual inquiry received date was not migrated'; end if;
  execute definition;
end $$;

create function api.correct_inquiry_received_at(p_lead_id uuid,p_received_at timestamptz,p_expected_received_at timestamptz,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l sales.leads%rowtype; a sales.activities%rowtype; result jsonb; before_value jsonb; after_value jsonb;
  payload jsonb:=jsonb_build_object('received_at',p_received_at,'expected_received_at',p_expected_received_at,'reason',p_reason);
begin
  perform core.require_permission('sales.write');
  select * into l from sales.leads where id=p_lead_id for update;
  if not found then raise exception 'Inquiry not found' using errcode='P0002'; end if;
  perform core.require_workspace(l.workspace_id);
  perform sales.require_lead_owner(l);
  if l.owner_id is not null and l.owner_id<>auth.uid() and not core.has_permission('sales.assign') then
    raise exception 'permission denied: not the owner' using errcode='42501';
  end if;
  if p_request_id is null then raise exception 'Request ID is required' using errcode='22023'; end if;
  select * into a from sales.activities where workspace_id=l.workspace_id and lead_id=l.id and request_id=p_request_id;
  if found then
    if a.actor_id is distinct from auth.uid() or a.metadata->'command' is distinct from payload then raise exception 'Request ID already used for a different action' using errcode='22023'; end if;
    return a.metadata->'result';
  end if;
  if p_received_at is null or not isfinite(p_received_at) or p_received_at>now()+interval '5 minutes' then
    raise exception 'Choose a valid enquiry received date that is not in the future.' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>4000 then
    raise exception 'Add a correction reason between 3 and 4000 characters.' using errcode='23514';
  end if;
  if l.received_at is distinct from p_expected_received_at then
    raise exception 'The enquiry date changed since you opened this form. Refresh and review the latest date.' using errcode='40001';
  end if;
  before_value:=jsonb_build_object('received_at',l.received_at,'first_response_due_at',l.first_response_due_at);
  update sales.leads set received_at=p_received_at where id=l.id returning * into l;
  after_value:=jsonb_build_object('received_at',l.received_at,'first_response_due_at',l.first_response_due_at);
  result:=jsonb_build_object('lead_id',l.id,'received_at',l.received_at);
  insert into sales.activities(workspace_id,kind,subject,body,occurred_at,actor_id,lead_id,contact_id,request_id,metadata)
  values(l.workspace_id,'note','Enquiry received date corrected',btrim(p_reason),now(),auth.uid(),l.id,l.contact_id,p_request_id,
    jsonb_build_object('event','inquiry_received_date','command',payload,'result',result,'before',before_value,'after',after_value));
  perform audit.emit(l.workspace_id,'inquiry.received_date','sales','leads',l.id,before_value,after_value,p_reason,'{}'::jsonb);
  return result;
end $$;
revoke all on function api.correct_inquiry_received_at(uuid,timestamptz,timestamptz,text,uuid) from public,anon;
grant execute on function api.correct_inquiry_received_at(uuid,timestamptz,timestamptz,text,uuid) to authenticated;

-- Date corrections are immutable history, like source corrections and remarks.
create or replace function sales.guard_inquiry_annotation() returns trigger language plpgsql set search_path='' as $$
begin
  if old.metadata->>'event' in ('inquiry_remark','inquiry_source','inquiry_received_date') and
    (tg_op='DELETE' or current_user in ('authenticated','anon')
      or (to_jsonb(new)-array['contact_id','account_id']) is distinct from (to_jsonb(old)-array['contact_id','account_id'])) then
    raise exception 'Inquiry remarks and corrections are history. Add a new remark or correction.' using errcode='23514';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function sales.guard_inquiry_annotation() from public,anon,authenticated;

update reporting.metric_definitions set
  formula=replace(replace(formula,'created_at','received_at'),'inquiries created in period','inquiries received in period'),
  grain=replace(grain,'Inquiry creation cohort','Enquiry received cohort')
where key in ('lead_first_response','lead_conversion','funnel_lead_sales');
notify pgrst, 'reload schema';
