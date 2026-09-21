-- Explicit platform labels never reclassify historical Meta/website inquiries.
alter table sales.leads drop constraint leads_source_channel_check;
alter table sales.leads add constraint leads_source_channel_check check (source_channel in
  ('tiktok','meta','facebook','instagram','google_ads','website','whatsapp','dm','call','email','referral','walk_in','other'));
alter table sales.intake_events drop constraint intake_events_source_channel_check;
alter table sales.intake_events add constraint intake_events_source_channel_check check (source_channel in
  ('tiktok','meta','facebook','instagram','google_ads','website','whatsapp','dm','call','email','referral','walk_in','other'));

create function api.annotate_inquiry(p_lead_id uuid, p_request_id uuid, p_action text, p_body text,
  p_source text default null, p_detail text default null, p_expected_source text default null,
  p_expected_detail text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l sales.leads%rowtype; a sales.activities%rowtype; v_result jsonb; v_before jsonb;
  v_payload jsonb := jsonb_build_object('action',p_action,'body',p_body,'source',p_source,'detail',p_detail,
    'expected_source',p_expected_source,'expected_detail',p_expected_detail);
begin
  perform core.require_permission('sales.write');
  select * into l from sales.leads where id=p_lead_id for update;
  if not found then raise exception 'Inquiry not found' using errcode='P0002'; end if;
  perform core.require_workspace(l.workspace_id);
  perform sales.require_lead_owner(l);
  if p_request_id is null then raise exception 'Request ID is required' using errcode='22023'; end if;
  select * into a from sales.activities where workspace_id=l.workspace_id and lead_id=l.id and request_id=p_request_id;
  if found then
    if a.metadata->'command' is distinct from v_payload then raise exception 'Request ID already used for a different action' using errcode='22023'; end if;
    return a.metadata->'result';
  end if;
  if p_action is null or p_action not in ('remark','source') then raise exception 'Unknown inquiry annotation' using errcode='22023'; end if;
  if length(btrim(coalesce(p_body,''))) < 3 or length(p_body)>4000 then
    raise exception 'Add a remark or evidence/reason between 3 and 4000 characters' using errcode='23514';
  end if;
  if p_action='source' then
    if p_source is null or p_source not in ('tiktok','meta','facebook','instagram','google_ads','website','whatsapp','dm','call','email','referral','walk_in','other') or length(coalesce(p_detail,''))>200 then
      raise exception 'Choose a valid source and detail up to 200 characters' using errcode='23514';
    end if;
    if l.source_channel is distinct from p_expected_source or l.source_detail is distinct from p_expected_detail then
      raise exception 'The source changed since you opened this form. Close it and review the latest source.' using errcode='40001';
    end if;
    v_before:=jsonb_build_object('source_channel',l.source_channel,'source_detail',l.source_detail);
    update sales.leads set source_channel=p_source,source_detail=nullif(btrim(p_detail),'') where id=l.id;
  end if;
  v_result:=jsonb_build_object('lead_id',l.id,'action',p_action);
  insert into sales.activities(workspace_id,kind,subject,body,occurred_at,actor_id,lead_id,contact_id,request_id,metadata)
  values(l.workspace_id,'note',case when p_action='source' then 'Inquiry source corrected' else 'Inquiry remark' end,
    btrim(p_body),now(),auth.uid(),l.id,l.contact_id,p_request_id,
    jsonb_build_object('event','inquiry_'||p_action,'command',v_payload,'result',v_result,'before',v_before,
      'after',case when p_action='source' then jsonb_build_object('source_channel',p_source,'source_detail',nullif(btrim(p_detail),'')) else null end));
  perform audit.emit(l.workspace_id,'inquiry.'||p_action,'sales','leads',l.id,v_before,
    v_result||case when p_action='source' then jsonb_build_object('source_channel',p_source,'source_detail',nullif(btrim(p_detail),'')) else '{}'::jsonb end,p_body,'{}'::jsonb);
  return v_result;
end $$;
revoke all on function api.annotate_inquiry(uuid,uuid,text,text,text,text,text,text) from public,anon;
grant execute on function api.annotate_inquiry(uuid,uuid,text,text,text,text,text,text) to authenticated;

create function sales.guard_inquiry_annotation() returns trigger language plpgsql set search_path='' as $$
begin
  if old.metadata->>'event' in ('inquiry_remark','inquiry_source') then
    raise exception 'Inquiry remarks and source corrections are history. Add a new remark or correction.' using errcode='23514';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function sales.guard_inquiry_annotation() from public,anon,authenticated;
create trigger protect_inquiry_annotations before update or delete on sales.activities
  for each row execute function sales.guard_inquiry_annotation();

-- A broadcast is only an invalidation signal. Names, phone numbers, IDs, task
-- contents and sale amounts stay behind fresh permissioned server queries.
-- Statement transition tables coalesce bulk imports into one signal/workspace.
create function sales.broadcast_inbox_changes() returns trigger language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;
begin
  for v_workspace in select distinct workspace_id from inbox_changed_rows loop
    begin
      perform realtime.send('{"changed":true}'::jsonb,'inbox_changed','inquiries:'||v_workspace::text,true);
    exception when others then
      -- Notifications must not abort a sale or staff action. The client also
      -- re-fetches on focus/reconnect and uses a bounded polling fallback.
      null;
    end;
  end loop;
  return null;
end $$;
revoke all on function sales.broadcast_inbox_changes() from public,anon,authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array['leads','tasks','activities','visits','purchases','sale_events'] loop
    execute format('create trigger inbox_changed_insert after insert on sales.%I referencing new table as inbox_changed_rows for each statement execute function sales.broadcast_inbox_changes()',v_table);
    execute format('create trigger inbox_changed_update after update on sales.%I referencing new table as inbox_changed_rows for each statement execute function sales.broadcast_inbox_changes()',v_table);
    execute format('create trigger inbox_changed_delete after delete on sales.%I referencing old table as inbox_changed_rows for each statement execute function sales.broadcast_inbox_changes()',v_table);
  end loop;
end $$;

create policy inquiry_invalidation_read on realtime.messages for select to authenticated
using (extension='broadcast'
  and topic=(select realtime.topic())
  and (select core.has_permission('sales.read'))
  and (select realtime.topic())='inquiries:'||(select core.current_workspace_id())::text);
