-- Extend the existing private feedback handoff to every resolved showroom visit.
-- Showroom staff may reveal the recipient for this audited handoff without
-- granting unrestricted phone/email reveals in the rest of the CRM.
insert into core.role_permissions(role_key,permission) values('showroom','feedback.send') on conflict do nothing;
alter table feedback.requests alter column purchase_id drop not null;
alter table feedback.requests add constraint feedback_source_required check (purchase_id is not null or visit_id is not null);
create unique index feedback_visit_only_unique on feedback.requests (visit_id) where purchase_id is null;
alter table feedback.requests add column whatsapp_sent_at timestamptz;
alter table feedback.requests add column review_outcome text not null default 'unknown'
  check (review_outcome in ('unknown','customer_reported','staff_verified','declined'));
alter table feedback.requests add column review_outcome_note text;
alter table feedback.requests add column review_outcome_at timestamptz;
alter table feedback.requests add column review_outcome_by uuid references core.profiles(user_id);
alter table feedback.media drop constraint media_request_id_key;
create index feedback_media_request_idx on feedback.media(request_id, created_at);
alter table feedback.handoff_events drop constraint handoff_events_event_type_check;
alter table feedback.handoff_events add constraint handoff_events_event_type_check check (event_type in (
  'request_created','whatsapp_opened','whatsapp_sent','customer_link_opened','feedback_confirmed',
  'feedback_declined','google_handoff_opened','photo_downloaded','token_revoked','token_reissued',
  'review_customer_reported','review_staff_verified','review_declined','review_reset','photo_prepared'
));

create or replace function api.feedback_workbench(p_visit_id uuid default null, p_purchase_id uuid default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_request feedback.requests%rowtype; v_contact uuid; v_phone text;
begin
  perform core.require_permission('sales.write');
  if num_nonnulls(p_visit_id,p_purchase_id,p_request_id) <> 1 then raise exception 'Choose one visit, purchase or feedback request' using errcode='23514'; end if;
  if p_request_id is not null then
    select * into v_request from feedback.requests where id=p_request_id and workspace_id=core.current_workspace_id();
    if not found then raise exception 'Feedback request not found' using errcode='P0002'; end if;
    p_purchase_id:=v_request.purchase_id; p_visit_id:=case when p_purchase_id is null then v_request.visit_id else null end;
  end if;
  if p_purchase_id is not null then
    select jsonb_build_object('purchase_id',p.id,'purchase_ref',p.external_ref,'purchased_at',p.purchased_at,'amount',p.amount,'currency',p.currency,
      'visit_id',p.visit_id,'contact_id',p.contact_id,'customer_name',c.display_name,'location_name',l.name,'salesperson_name',pr.full_name), p.contact_id
      into v_context,v_contact
    from sales.purchases p join identity.contacts c on c.id=p.contact_id and c.workspace_id=p.workspace_id
    left join core.business_locations l on l.id=p.location_id left join core.profiles pr on pr.user_id=p.salesperson_id
    where p.id=p_purchase_id and p.workspace_id=core.current_workspace_id() and p.status not in ('voided','draft');
    if v_request.id is null then select * into v_request from feedback.requests where purchase_id=p_purchase_id; end if;
  else
    select jsonb_build_object('purchase_id',null,'purchase_ref',null,'purchased_at',v.occurred_at,'amount',null,'currency',null,
      'visit_id',v.id,'contact_id',v.contact_id,'customer_name',c.display_name,'location_name',l.name,'salesperson_name',pr.full_name),v.contact_id
      into v_context,v_contact
    from sales.visits v join identity.contacts c on c.id=v.contact_id and c.workspace_id=v.workspace_id
    left join core.business_locations l on l.id=v.location_id left join core.profiles pr on pr.user_id=v.staff_user_id
    where v.id=p_visit_id and v.workspace_id=core.current_workspace_id();
    if v_request.id is null then
      select * into v_request from feedback.requests where visit_id=p_visit_id order by (purchase_id is null) desc,created_at desc limit 1;
    end if;
  end if;
  if v_context is null then raise exception 'Visit or eligible purchase not found' using errcode='P0002'; end if;
  if core.has_permission('contact.reveal') or core.has_permission('feedback.send') then
    select normalized_value into v_phone from identity.contact_points where contact_id=v_contact and workspace_id=core.current_workspace_id() and kind in ('phone','whatsapp') order by is_primary desc,created_at limit 1;
    perform audit.emit(core.current_workspace_id(),'feedback.phone_revealed','identity','contacts',v_contact,null,null,null,jsonb_build_object('purpose','feedback_handoff'));
  end if;
  return v_context || jsonb_build_object('phone',v_phone,'existing_request_id',v_request.id,'request',case when v_request.id is null then null else
    jsonb_build_object('id',v_request.id,'status',v_request.status,'whatsapp_sent_at',v_request.whatsapp_sent_at,'review_outcome',v_request.review_outcome,
      'review_outcome_note',v_request.review_outcome_note,'review_outcome_at',v_request.review_outcome_at,'customer_confirmed_at',v_request.customer_confirmed_at,
      'google_handoff_opened_at',v_request.google_handoff_opened_at,'photo_permission',v_request.photo_permission,
      'expires_at',(select expires_at from feedback.customer_access_tokens where request_id=v_request.id),
      'photo_count',(select count(*) from feedback.media m join storage.objects o on o.bucket_id=m.bucket_id and o.name=m.object_path where m.request_id=v_request.id),
      'events',coalesce((select jsonb_agg(e) from (select event_type,occurred_at,metadata from feedback.handoff_events where request_id=v_request.id order by occurred_at desc limit 20)e),'[]'::jsonb)) end);
end $$;
revoke all on function api.feedback_workbench(uuid,uuid,uuid) from public,anon;
grant execute on function api.feedback_workbench(uuid,uuid,uuid) to authenticated;

create or replace function api.prepare_visit_feedback(p_input jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_visit sales.visits%rowtype; v_id uuid; v_answers jsonb:=p_input->'answers'; v_existing uuid;
begin
  perform core.require_permission('sales.write');
  select * into v_visit from sales.visits where id=(p_input->>'visit_id')::uuid and workspace_id=core.current_workspace_id() for update;
  if not found then raise exception 'Visit not found' using errcode='P0002'; end if;
  select id into v_existing from feedback.requests where visit_id=v_visit.id order by (purchase_id is null) desc,created_at desc limit 1;
  if v_existing is not null then raise exception 'Feedback already exists; open the existing request' using errcode='23505'; end if;
  if not exists(select 1 from identity.contacts c where c.id=v_visit.contact_id and c.workspace_id=v_visit.workspace_id and c.archived_at is null and c.merged_into_contact_id is null and not c.is_provisional) then
    raise exception 'Resolve the customer before requesting feedback' using errcode='23514'; end if;
  if coalesce((p_input->>'whatsapp_consent')::boolean,false) is not true then raise exception 'Customer agreement to receive the link is required' using errcode='23514'; end if;
  if coalesce(jsonb_typeof(v_answers),'')<>'array' or jsonb_array_length(v_answers)<>5 then raise exception 'Exactly five feedback answers required' using errcode='23514'; end if;
  if (select count(*) from jsonb_array_elements(v_answers)a where length(trim(coalesce(a->>'answer_text','')))>0)<2
    or exists(select 1 from jsonb_array_elements(v_answers)a where length(coalesce(a->>'answer_text',''))>1000) then raise exception 'Record at least two answers, up to 1000 characters each' using errcode='23514'; end if;
  if coalesce(p_input->>'token_hash','') !~ '^[0-9a-f]{64}$' or (p_input->>'expires_at')::timestamptz is null
    or (p_input->>'expires_at')::timestamptz<=now() or (p_input->>'expires_at')::timestamptz>now()+interval '8 days' then raise exception 'Invalid private link' using errcode='23514'; end if;
  if length(trim(coalesce(p_input->>'generated_text','')))<5 or length(p_input->>'generated_text')>2000 then raise exception 'Invalid feedback draft' using errcode='23514'; end if;
  insert into feedback.requests(workspace_id,visit_id,contact_id,location_id,salesperson_id,question_set_version,whatsapp_consent,photo_permission,review_url,created_by)
  values(v_visit.workspace_id,v_visit.id,v_visit.contact_id,v_visit.location_id,coalesce(v_visit.staff_user_id,auth.uid()),'showroom_v2',true,
    coalesce((p_input->>'photo_permission')::boolean,false),nullif(p_input->>'review_url',''),auth.uid()) returning id into v_id;
  insert into feedback.answers(workspace_id,request_id,question_key,question_text,answer_text,position,captured_by)
  select v_visit.workspace_id,v_id,x.question_key,x.question_text,nullif(trim(x.answer_text),''),x.position,auth.uid()
  from jsonb_to_recordset(v_answers)x(question_key text,question_text text,answer_text text,position smallint);
  insert into feedback.drafts(workspace_id,request_id,generation_mode,model_id,prompt_version,input_hash,generated_text,customer_text)
  values(v_visit.workspace_id,v_id,p_input->>'generation_mode',nullif(p_input->>'model_id',''),p_input->>'prompt_version',p_input->>'input_hash',trim(p_input->>'generated_text'),trim(p_input->>'generated_text'));
  insert into feedback.customer_access_tokens(workspace_id,request_id,token_hash,expires_at)
  values(v_visit.workspace_id,v_id,p_input->>'token_hash',(p_input->>'expires_at')::timestamptz);
  insert into feedback.handoff_events(workspace_id,request_id,event_type,actor_id) values(v_visit.workspace_id,v_id,'request_created',auth.uid());
  perform audit.emit(v_visit.workspace_id,'feedback.request_created','feedback','requests',v_id,null,null,null,jsonb_build_object('visit_id',v_visit.id));
  return v_id;
end $$;
revoke all on function api.prepare_visit_feedback(jsonb) from public,anon;
grant execute on function api.prepare_visit_feedback(jsonb) to authenticated;

create or replace function api.manage_feedback_request(p_request_id uuid,p_action text,p_note text default '',p_token_hash text default null,p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r feedback.requests%rowtype; v_event text;
begin
  perform core.require_permission('sales.write');
  select * into r from feedback.requests where id=p_request_id and workspace_id=core.current_workspace_id() for update;
  if not found then raise exception 'Feedback request not found' using errcode='P0002'; end if;
  if p_action in ('review_customer_reported','review_staff_verified','review_declined','review_reset','revoke') and length(trim(coalesce(p_note,'')))<5 then raise exception 'Record a reason or verification evidence (at least 5 characters)' using errcode='23514'; end if;
  if length(p_note)>2000 then raise exception 'Note is too long' using errcode='23514'; end if;
  v_event:=p_action;
  if p_action='whatsapp_sent' then
    if not r.whatsapp_consent then raise exception 'Customer agreement is required' using errcode='23514'; end if;
    if r.whatsapp_sent_at is not null then return; end if;
    update feedback.requests set whatsapp_sent_at=now() where id=r.id;
  elsif p_action in ('review_customer_reported','review_staff_verified','review_declined','review_reset') then
    update feedback.requests set review_outcome=case p_action when 'review_reset' then 'unknown' else replace(p_action,'review_','') end,
      review_outcome_note=trim(p_note),review_outcome_at=now(),review_outcome_by=auth.uid() where id=r.id;
  elsif p_action='revoke' then
    update feedback.customer_access_tokens set revoked_at=now() where request_id=r.id;
    update feedback.requests set status='revoked' where id=r.id; v_event:='token_revoked';
  elsif p_action='reissue' then
    if not r.whatsapp_consent then raise exception 'Customer agreement is required' using errcode='23514'; end if;
    if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '8 days' then raise exception 'Invalid private link' using errcode='23514'; end if;
    update feedback.customer_access_tokens set token_hash=p_token_hash,expires_at=p_expires_at,revoked_at=null,last_used_at=null where request_id=r.id;
    update feedback.requests set status=case when customer_confirmed_at is null then 'awaiting_customer' else 'confirmed' end where id=r.id;
    v_event:='token_reissued';
  else raise exception 'Unsupported feedback action' using errcode='23514'; end if;
  insert into feedback.handoff_events(workspace_id,request_id,event_type,actor_id,metadata) values(r.workspace_id,r.id,v_event,auth.uid(),jsonb_build_object('note',nullif(trim(p_note),'')));
  perform audit.emit(r.workspace_id,'feedback.'||v_event,'feedback','requests',r.id,null,null,null,jsonb_build_object('note',nullif(trim(p_note),'')));
end $$;
revoke all on function api.manage_feedback_request(uuid,text,text,text,timestamptz) from public,anon;
grant execute on function api.manage_feedback_request(uuid,text,text,text,timestamptz) to authenticated;

-- Small image uploads use the staff JWT and immutable, pre-authorized paths.
update storage.buckets set file_size_limit=5242880 where id='feedback-media';
create or replace function api.prepare_feedback_photo(p_request_id uuid,p_media_id uuid,p_mime_type text,p_size_bytes bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare r feedback.requests%rowtype; m feedback.media%rowtype; v_path text;
begin
  perform core.require_permission('sales.write');
  select * into r from feedback.requests where id=p_request_id and workspace_id=core.current_workspace_id() for update;
  if not found then raise exception 'Feedback request not found' using errcode='P0002'; end if;
  if not r.photo_permission or r.status in ('revoked','expired') then raise exception 'Customer media permission and an active request are required' using errcode='23514'; end if;
  if p_media_id is null or p_mime_type not in ('image/jpeg','image/png','image/webp') or p_size_bytes is null or p_size_bytes<1 or p_size_bytes>5242880 then raise exception 'Use JPEG, PNG or WebP photos up to 5 MB each' using errcode='23514'; end if;
  select * into m from feedback.media where id=p_media_id;
  if found then
    if m.request_id<>r.id or m.uploaded_by<>auth.uid() or m.mime_type<>p_mime_type or m.size_bytes<>p_size_bytes then raise exception 'Photo request does not match' using errcode='23514'; end if;
    return m.object_path;
  end if;
  if (select count(*) from feedback.media where request_id=r.id)>=6 then raise exception 'Up to six photos per feedback request' using errcode='23514'; end if;
  v_path:=r.workspace_id::text||'/'||r.id::text||'/'||p_media_id::text||case p_mime_type when 'image/png' then '.png' when 'image/webp' then '.webp' else '.jpg' end;
  insert into feedback.media(id,workspace_id,request_id,object_path,mime_type,size_bytes,uploaded_by) values(p_media_id,r.workspace_id,r.id,v_path,p_mime_type,p_size_bytes,auth.uid());
  insert into feedback.handoff_events(workspace_id,request_id,event_type,actor_id) values(r.workspace_id,r.id,'photo_prepared',auth.uid());
  return v_path;
end $$;
revoke all on function api.prepare_feedback_photo(uuid,uuid,text,bigint) from public,anon;
grant execute on function api.prepare_feedback_photo(uuid,uuid,text,bigint) to authenticated;
create policy feedback_photo_insert on storage.objects for insert to authenticated with check (
  bucket_id='feedback-media' and exists(select 1 from feedback.media m join feedback.requests r on r.id=m.request_id
    where m.object_path=name and m.workspace_id=(select core.current_workspace_id()) and m.uploaded_by=(select auth.uid())
      and r.photo_permission and r.status not in ('expired','revoked') and (select core.has_permission('sales.write')))
);
create policy feedback_photo_read on storage.objects for select to authenticated using (
  bucket_id='feedback-media' and exists(select 1 from feedback.media m where m.object_path=name
    and m.workspace_id=(select core.current_workspace_id()) and (select core.has_permission('sales.read')))
);

create or replace function api.feedback_photos_by_token(p_token_hash text)
returns table(media_id uuid,bucket_id text,object_path text,mime_type text) language sql stable security definer set search_path='' as $$
  select m.id,m.bucket_id,m.object_path,m.mime_type from feedback.customer_access_tokens t
  join feedback.requests r on r.id=t.request_id join feedback.media m on m.request_id=r.id
  join storage.objects o on o.bucket_id=m.bucket_id and o.name=m.object_path
  where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now() and r.status not in ('expired','revoked') and r.photo_permission
  order by m.created_at,m.id
$$;
revoke all on function api.feedback_photos_by_token(text) from public,anon,authenticated;
grant execute on function api.feedback_photos_by_token(text) to service_role;

create or replace view api.feedback_requests with(security_invoker=true) as
select r.id,r.workspace_id,r.purchase_id,r.visit_id,r.contact_id,r.location_id,r.salesperson_id,r.status,r.question_set_version,r.whatsapp_consent,
  r.photo_permission,r.benefit_status,r.benefit_reference,r.customer_confirmed_at,r.google_handoff_opened_at,r.created_at,r.updated_at,
  c.display_name as customer_name,p.external_ref as purchase_ref,coalesce(p.purchased_at,v.occurred_at) as purchased_at,p.amount as purchase_amount,p.currency as purchase_currency,
  l.name as location_name,pr.full_name as salesperson_name,
  exists(select 1 from feedback.media m join storage.objects o on o.bucket_id=m.bucket_id and o.name=m.object_path where m.request_id=r.id) as has_photo,
  r.whatsapp_sent_at,r.review_outcome,r.review_outcome_note,r.review_outcome_at
from feedback.requests r join identity.contacts c on c.id=r.contact_id
left join sales.purchases p on p.id=r.purchase_id left join sales.visits v on v.id=r.visit_id
left join core.business_locations l on l.id=r.location_id left join core.profiles pr on pr.user_id=r.salesperson_id;

create or replace function api.get_feedback_by_token(p_token_hash text)
returns table(request_id uuid,status text,expires_at timestamptz,customer_name text,purchased_at timestamptz,location_name text,answers jsonb,draft_text text,has_photo boolean,review_url text,benefit_status text)
language sql stable security definer set search_path='' as $$
select r.id,r.status,t.expires_at,split_part(c.display_name,' ',1),coalesce(p.purchased_at,v.occurred_at),l.name,
  coalesce((select jsonb_agg(jsonb_build_object('question_key',a.question_key,'question_text',a.question_text,'answer_text',a.answer_text,'position',a.position) order by a.position) from feedback.answers a where a.request_id=r.id),'[]'::jsonb),
  coalesce(d.customer_text,d.generated_text),exists(select 1 from api.feedback_photos_by_token(p_token_hash)),
  case when r.benefit_status='not_offered' then r.review_url else null end,r.benefit_status
from feedback.customer_access_tokens t join feedback.requests r on r.id=t.request_id join identity.contacts c on c.id=r.contact_id
join feedback.drafts d on d.request_id=r.id left join sales.purchases p on p.id=r.purchase_id left join sales.visits v on v.id=r.visit_id
left join core.business_locations l on l.id=r.location_id
where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now() and r.status not in ('expired','revoked')
$$;
