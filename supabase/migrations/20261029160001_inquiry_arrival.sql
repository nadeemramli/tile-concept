-- TILE-4: an inquiry's effective arrival, kept separate from when it was recorded.
--
-- sales.leads.created_at has always been read as the inquiry's arrival: the
-- inbox orders and ages on it, response times are measured from it, walk-in
-- matching compares visits with it, and the walk-in and import paths already
-- wrote the visit or source time into it. It keeps that meaning, now stated,
-- given a basis and validated:
--   created_at         the effective business arrival time
--   recorded_at        when this system recorded the inquiry; null on rows
--                      recorded before this column existed
--   arrival_basis      native     recorded as it arrived
--                      backdated  entered later with an earlier arrival time
--                      import     a provider export or connector supplied the time
--                      tracker    the showroom Daily Tracker supplied the date
--                      legacy     recorded before arrival tracking; created_at
--                                 may be the recording time or a time a script wrote
--   arrival_precision  exact | date (stored as 00:00 Kuala Lumpur) | unknown (legacy)
--
-- Chronology holds for every writer: an arrival is never in the future, and a
-- correction can never place it after a response, reply, qualification,
-- logged activity or showroom visit already recorded for the inquiry. The
-- existing api.work_inquiry check (an event cannot precede the inquiry's
-- created_at) therefore keeps comparing against the effective arrival, and a
-- response duration cannot be negative.

alter table sales.leads
  add column recorded_at timestamptz,
  add column arrival_basis text not null default 'legacy'
    check (arrival_basis in ('native','backdated','import','tracker','legacy')),
  add column arrival_precision text not null default 'unknown'
    check (arrival_precision in ('exact','date','unknown')),
  add column arrival_note text check (length(arrival_note) <= 1000);
-- Existing rows are legacy; a new row's basis is decided by the guard below.
alter table sales.leads alter column arrival_basis drop default, alter column arrival_precision drop default;
comment on column sales.leads.created_at is 'Effective business arrival of the inquiry (see arrival_basis/arrival_precision). recorded_at is when the system recorded it.';
comment on column sales.leads.recorded_at is 'When this system recorded the inquiry. Null for inquiries recorded before arrival tracking.';
comment on column sales.leads.arrival_basis is 'How the arrival time is known: native, backdated, import, tracker, or legacy (before arrival tracking).';

create function sales.guard_inquiry_arrival() returns trigger language plpgsql set search_path = '' as $$
declare v_first timestamptz; v_what text;
begin
  if tg_op = 'INSERT' then
    new.recorded_at := now();
    new.created_at := coalesce(new.created_at, now());
    new.arrival_precision := coalesce(new.arrival_precision, 'exact');
    new.arrival_basis := coalesce(new.arrival_basis,
      case when new.created_at < now() - interval '5 minutes' then 'backdated' else 'native' end);
    if new.arrival_basis = 'legacy' or new.arrival_precision = 'unknown' then
      raise exception 'Only inquiries recorded before arrival tracking are legacy' using errcode = '23514';
    end if;
    if current_user in ('authenticated','anon') and new.arrival_basis not in ('native','backdated') then
      raise exception 'Imported arrivals are recorded by the import, not typed in' using errcode = '42501';
    end if;
  else
    if row(new.created_at,new.recorded_at,new.arrival_basis,new.arrival_precision,new.arrival_note)
      is not distinct from row(old.created_at,old.recorded_at,old.arrival_basis,old.arrival_precision,old.arrival_note) then
      return new;
    end if;
    if current_user in ('authenticated','anon') then
      raise exception 'Correct an inquiry''s arrival with the arrival command so the change is checked and kept in history' using errcode = '42501';
    end if;
    if new.recorded_at is distinct from old.recorded_at then
      raise exception 'The recorded time is fixed when the inquiry is saved' using errcode = '23514';
    end if;
    if new.arrival_basis = 'legacy' and row(new.created_at,new.arrival_precision) is distinct from row(old.created_at,old.arrival_precision) then
      raise exception 'State how the corrected arrival is known: backdated, import or tracker' using errcode = '23514';
    end if;
    if new.arrival_basis <> 'legacy' and old.arrival_basis <> 'legacy' and new.arrival_precision = 'unknown' then
      raise exception 'Only legacy arrivals have an unknown precision' using errcode = '23514';
    end if;
  end if;

  if not isfinite(new.created_at) or new.created_at > now() + interval '5 minutes' then
    raise exception 'An inquiry cannot arrive in the future' using errcode = '23514';
  end if;
  if new.created_at < timestamptz '2000-01-01 00:00:00+08' then
    raise exception 'The arrival time is before 2000; check the date' using errcode = '23514';
  end if;
  if new.arrival_basis = 'native' and new.recorded_at is not null
    and abs(extract(epoch from (new.recorded_at - new.created_at))) > 300 then
    raise exception 'A native arrival is recorded as it happens. For an earlier arrival, state that it is backdated, imported or from the tracker.' using errcode = '23514';
  end if;
  if new.arrival_precision = 'date' and (new.created_at at time zone 'Asia/Kuala_Lumpur')::time <> time '00:00' then
    raise exception 'A date-only arrival is stored as the start of that Kuala Lumpur day' using errcode = '23514';
  end if;
  if new.arrival_basis = 'legacy' and new.arrival_precision <> 'unknown' then
    raise exception 'A legacy arrival has an unknown precision' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.created_at is distinct from old.created_at then
    select x.at, x.what into v_first, v_what from (
      values (new.first_response_at,'first response'),(new.first_whatsapp_sent_at,'first WhatsApp sent'),
             (new.first_customer_reply_at,'first customer reply'),(new.first_whatsapp_reply_at,'first WhatsApp reply'),
             (new.qualified_at,'qualification')
      union all
      select min(a.occurred_at),'logged activity' from sales.activities a
        where a.lead_id = new.id and a.workspace_id = new.workspace_id
          and not (a.kind = 'note' and a.metadata->>'event' = 'inquiry_arrival')
      union all
      select min(v.occurred_at),'showroom visit' from sales.visits v where v.lead_id = new.id and v.workspace_id = new.workspace_id
    ) x(at,what) where x.at is not null order by x.at limit 1;
    if v_first is not null and v_first < new.created_at then
      raise exception 'The inquiry cannot arrive after its % (%)', v_what,
        to_char(v_first at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI') using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function sales.guard_inquiry_arrival() from public, anon, authenticated;
create trigger guard_inquiry_arrival before insert or update on sales.leads
  for each row execute function sales.guard_inquiry_arrival();

create or replace view api.leads with (security_invoker = true) as select * from sales.leads;

-- Correct an arrival: who, why and the previous value go in the inquiry's history.
create function api.set_inquiry_arrival(p_lead_id uuid, p_arrived_at timestamptz, p_basis text, p_precision text,
  p_reason text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l sales.leads%rowtype; a sales.activities%rowtype; v_payload jsonb; v_result jsonb;
begin
  perform core.require_permission('sales.write');
  if p_request_id is null then raise exception 'Request ID is required' using errcode = '22023'; end if;
  select * into l from sales.leads where id = p_lead_id for update;
  if not found then raise exception 'Inquiry not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(l.workspace_id);
  perform sales.require_lead_owner(l);
  v_payload := jsonb_build_object('arrived_at',p_arrived_at,'basis',p_basis,'precision',p_precision,'reason',p_reason);
  select * into a from sales.activities where workspace_id = l.workspace_id and lead_id = l.id and request_id = p_request_id;
  if found then
    if a.metadata->'command' is distinct from v_payload then
      raise exception 'Request ID already used for a different action' using errcode = '22023';
    end if;
    return a.metadata->'result';
  end if;
  if p_basis is null or p_basis not in ('backdated','import','tracker') then
    raise exception 'Say how the arrival is known: backdated, import or tracker' using errcode = '23514';
  end if;
  if p_precision is null or p_precision not in ('exact','date') then
    raise exception 'Say whether the arrival is an exact time or a date only' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'Explain where the arrival time comes from (at least 5 characters)' using errcode = '23514';
  end if;
  if p_arrived_at is null then raise exception 'Enter the arrival time' using errcode = '23514'; end if;
  update sales.leads set created_at = p_arrived_at, arrival_basis = p_basis, arrival_precision = p_precision,
    arrival_note = btrim(p_reason) where id = l.id;
  v_result := jsonb_build_object('lead_id',l.id,'arrived_at',p_arrived_at,'arrival_basis',p_basis,'arrival_precision',p_precision);
  insert into sales.activities(workspace_id,kind,subject,body,actor_id,lead_id,contact_id,request_id,metadata)
  values (l.workspace_id,'note','Arrival time corrected',btrim(p_reason),auth.uid(),l.id,l.contact_id,p_request_id,
    jsonb_build_object('event','inquiry_arrival','command',v_payload,'result',v_result,
      'before',jsonb_build_object('arrived_at',l.created_at,'arrival_basis',l.arrival_basis,'arrival_precision',l.arrival_precision)));
  perform audit.emit(l.workspace_id,'inquiry.arrival_corrected','sales','leads',l.id,
    jsonb_build_object('arrived_at',l.created_at,'arrival_basis',l.arrival_basis,'arrival_precision',l.arrival_precision),
    v_result,btrim(p_reason),'{}'::jsonb);
  return v_result;
end $$;
revoke all on function api.set_inquiry_arrival(uuid,timestamptz,text,text,text,uuid) from public, anon;
grant execute on function api.set_inquiry_arrival(uuid,timestamptz,text,text,text,uuid) to authenticated;

-- Manual capture states the arrival (now, unless an earlier time is given)
-- and may state any classification it already knows. Everything else is
-- unchanged from 20260921051515_atomic_manual_inquiry.sql.
create or replace function api.create_manual_inquiry(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ws uuid:=core.current_workspace_id(); saved sales.manual_inquiry_requests%rowtype;
  v_lead uuid; v_intake uuid; v_contact uuid; v_candidates uuid[]; v_state text:='unlinked';
  v_phone text; v_email text; v_owner uuid; v_location uuid; v_products text[]; v_result jsonb;
  v_key text; v_limit integer; v_unsafe boolean; v_arrived timestamptz; v_precision text;
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
  for v_key,v_limit in select * from (values ('source_detail',200),('raw_name',200),('raw_phone',40),('raw_email',200),('raw_company',200),('interest',2000),('notes',4000),('raw_text',8000),
    ('arrived_at',40),('arrival_precision',10),('arrival_note',1000),
    ('buyer_role',40),('project_use',40),('work_type',40),('glc_involvement',40),('glc_party_role',40)) x(k,n) loop
    if (p_input ? v_key and jsonb_typeof(p_input->v_key) not in ('string','null')) or length(coalesce(p_input->>v_key,''))>v_limit then
      raise exception 'Invalid or too long inquiry field: %',v_key using errcode='23514';
    end if;
  end loop;
  if coalesce(nullif(btrim(p_input->>'raw_name'),''),nullif(btrim(p_input->>'raw_phone'),''),nullif(btrim(p_input->>'raw_email'),'')) is null then
    raise exception 'Provide at least a name, phone or email' using errcode='23514';
  end if;
  begin
    v_arrived:=nullif(p_input->>'arrived_at','')::timestamptz;
  exception when others then
    raise exception 'Enter a valid arrival time' using errcode='23514';
  end;
  v_precision:=coalesce(nullif(p_input->>'arrival_precision',''),'exact');
  if v_precision not in ('exact','date') then
    raise exception 'Say whether the arrival is an exact time or a date only' using errcode='23514';
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
  values(ws,p_input->>'source_channel','manual','manual:'||p_request_id::text,coalesce(v_arrived,now()),
    jsonb_build_object('name',nullif(btrim(p_input->>'raw_name'),''),'phone',nullif(btrim(p_input->>'raw_phone'),''),
      'email',v_email,'company',nullif(btrim(p_input->>'raw_company'),''),'interest',nullif(btrim(p_input->>'interest'),''),
      'source_detail',nullif(btrim(p_input->>'source_detail'),'')),nullif(p_input->>'raw_text',''),'processed',auth.uid())
  returning id into v_intake;
  -- created_at is the arrival; the arrival guard sets recorded_at and decides
  -- native or backdated, and the classification guard validates the values.
  insert into sales.leads(workspace_id,status,source_channel,source_detail,contact_id,raw_name,raw_phone,raw_email,raw_company,
    interest,product_interest,location_id,owner_id,assigned_at,first_response_due_at,notes,created_by,
    created_at,arrival_precision,arrival_note,buyer_role,project_use,work_type,glc_involvement,glc_party_role)
  values(ws,'new',p_input->>'source_channel',nullif(btrim(p_input->>'source_detail'),''),v_contact,
    nullif(btrim(p_input->>'raw_name'),''),nullif(btrim(p_input->>'raw_phone'),''),v_email,nullif(btrim(p_input->>'raw_company'),''),
    nullif(btrim(p_input->>'interest'),''),v_products,v_location,v_owner,case when v_owner is null then null else now() end,
    now()+interval '4 hours',nullif(btrim(p_input->>'notes'),''),auth.uid(),
    coalesce(v_arrived,now()),v_precision,nullif(btrim(p_input->>'arrival_note'),''),
    coalesce(nullif(p_input->>'buyer_role',''),'unknown'),coalesce(nullif(p_input->>'project_use',''),'unknown'),
    coalesce(nullif(p_input->>'work_type',''),'unknown'),coalesce(nullif(p_input->>'glc_involvement',''),'unknown'),
    nullif(p_input->>'glc_party_role','')) returning id into v_lead;
  update sales.intake_events set lead_id=v_lead where id=v_intake;
  insert into sales.lead_intake_links(lead_id,intake_event_id) values(v_lead,v_intake);
  v_result:=jsonb_build_object('lead_id',v_lead,'intake_id',v_intake,'contact_id',v_contact,'identity_state',v_state);
  perform audit.emit(ws,'inquiry.created','sales','leads',v_lead,null,v_result,null,'{}'::jsonb);
  insert into sales.manual_inquiry_requests(workspace_id,request_id,actor_id,payload,result) values(ws,p_request_id,auth.uid(),p_input,v_result);
  return v_result;
end $$;
revoke all on function api.create_manual_inquiry(jsonb,uuid) from public,anon;
grant execute on function api.create_manual_inquiry(jsonb,uuid) to authenticated;

-- Response time is measured only from an exact arrival, and never below zero.
-- A date-only arrival (the tracker) or an inconsistent legacy row still counts
-- as a lead and as responded; it is left out of the median, not forced into it.
create or replace function api.report_lead_source(p_from date default null, p_to date default null)
returns table (source_channel text, leads bigint, responded bigint, median_response_minutes numeric, qualified bigint, converted bigint, disqualified bigint)
language sql stable security definer set search_path = '' as $$
  select l.source_channel,
         count(*),
         count(*) filter (where l.first_response_at is not null),
         round((percentile_cont(0.5) within group (order by case
           when l.arrival_precision <> 'date' and l.first_response_at >= l.created_at
           then extract(epoch from (l.first_response_at - l.created_at)) / 60 end))::numeric, 1),
         count(*) filter (where l.qualified_at is not null),
         count(*) filter (where l.status = 'converted'),
         count(*) filter (where l.status = 'disqualified')
  from sales.leads l
  where l.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
    and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to + 1)
  group by l.source_channel
  order by 2 desc
$$;
grant execute on function api.report_lead_source(date,date) to authenticated;

update reporting.metric_definitions
set formula = 'Median of first_response_at minus the inquiry''s effective arrival (created_at), per source, over inquiries whose arrival is an exact time and precedes the response',
    caveat = 'Only counts responses logged in the app; a reply sent from a personal phone is invisible here. Date-only (Daily Tracker) arrivals are excluded from the median, and a legacy arrival may be the time the record was created rather than when the customer arrived.'
where key = 'lead_first_response';
