-- Additive post-purchase customer feedback and voluntary Google review handoff.
-- The existing walk-in transaction is intentionally untouched. Feedback starts
-- only from an accepted purchase and all customer-token access stays server-side.

create schema if not exists feedback;
comment on schema feedback is 'Private post-purchase feedback, customer drafts, media and voluntary review handoffs';

create table feedback.requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  purchase_id uuid not null references sales.purchases(id),
  visit_id uuid references sales.visits(id),
  contact_id uuid not null references identity.contacts(id),
  location_id uuid references core.business_locations(id),
  salesperson_id uuid references core.profiles(user_id),
  status text not null default 'awaiting_customer'
    check (status in ('awaiting_customer','confirmed','declined','expired','revoked')),
  question_set_version text not null default 'post_purchase_v1',
  whatsapp_consent boolean not null default false,
  photo_permission boolean not null default false,
  benefit_status text not null default 'not_offered'
    check (benefit_status in ('not_offered','granted_for_private_feedback')),
  benefit_reference text,
  review_url text,
  customer_confirmed_at timestamptz,
  google_handoff_opened_at timestamptz,
  created_by uuid not null references core.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_request_purchase_unique unique (purchase_id),
  constraint feedback_request_review_url_google check (
    review_url is null or review_url ~* '^https://(g\.page|maps\.app\.goo\.gl|search\.google\.com|([a-z0-9-]+\.)*google\.com)(/|$)'
  )
);

create table feedback.answers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null references feedback.requests(id) on delete cascade,
  question_key text not null,
  question_text text not null,
  answer_text text,
  position smallint not null check (position between 1 and 5),
  captured_by uuid not null references core.profiles(user_id),
  captured_at timestamptz not null default now(),
  unique (request_id, question_key),
  unique (request_id, position)
);

create table feedback.drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null unique references feedback.requests(id) on delete cascade,
  generation_mode text not null check (generation_mode in ('llm','deterministic')),
  model_id text,
  prompt_version text not null,
  input_hash text not null,
  generated_text text not null,
  customer_text text,
  customer_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table feedback.media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null unique references feedback.requests(id) on delete cascade,
  bucket_id text not null default 'feedback-media',
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  permission_scope text not null default 'private_feedback_and_customer_download'
    check (permission_scope = 'private_feedback_and_customer_download'),
  uploaded_by uuid not null references core.profiles(user_id),
  created_at timestamptz not null default now()
);

create table feedback.customer_access_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null unique references feedback.requests(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table feedback.handoff_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null references feedback.requests(id) on delete cascade,
  event_type text not null check (event_type in (
    'request_created','whatsapp_opened','customer_link_opened','feedback_confirmed',
    'feedback_declined','google_handoff_opened','photo_downloaded','token_revoked'
  )),
  actor_id uuid references core.profiles(user_id),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index feedback_requests_workspace_created_idx on feedback.requests (workspace_id, created_at desc);
create index feedback_requests_contact_idx on feedback.requests (contact_id, created_at desc);
create index feedback_requests_status_idx on feedback.requests (workspace_id, status, created_at desc);
create index feedback_answers_request_idx on feedback.answers (request_id, position);
create index feedback_events_request_idx on feedback.handoff_events (request_id, occurred_at desc);
create index feedback_tokens_active_idx on feedback.customer_access_tokens (token_hash, expires_at) where revoked_at is null;

create trigger feedback_requests_updated_at before update on feedback.requests
for each row execute function core.set_updated_at();
create trigger feedback_drafts_updated_at before update on feedback.drafts
for each row execute function core.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['requests','answers','drafts','media','customer_access_tokens','handoff_events']
  loop
    execute format('alter table feedback.%I enable row level security', t);
    execute format($p$create policy staff_read on feedback.%I for select to authenticated
      using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.read')))$p$, t);
  end loop;
end $$;

create policy staff_insert_requests on feedback.requests for insert to authenticated
  with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.write')) and created_by = (select auth.uid()));
create policy staff_update_requests on feedback.requests for update to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.write')))
  with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.write')));

do $$
declare t text;
begin
  foreach t in array array['answers','drafts','media','customer_access_tokens','handoff_events']
  loop
    execute format($p$create policy staff_insert on feedback.%I for insert to authenticated
      with check (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.write')))$p$, t);
  end loop;
end $$;

grant usage on schema feedback to authenticated, service_role;
grant select on all tables in schema feedback to authenticated;
grant all on all tables in schema feedback to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-media', 'feedback-media', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Staff list. Contact points and raw answer/draft text are deliberately absent.
create or replace view api.feedback_requests
with (security_invoker = true) as
select
  r.id, r.workspace_id, r.purchase_id, r.visit_id, r.contact_id, r.location_id,
  r.salesperson_id, r.status, r.question_set_version, r.whatsapp_consent,
  r.photo_permission, r.benefit_status, r.benefit_reference,
  r.customer_confirmed_at, r.google_handoff_opened_at, r.created_at, r.updated_at,
  c.display_name as customer_name,
  p.external_ref as purchase_ref,
  p.purchased_at,
  p.amount as purchase_amount,
  p.currency as purchase_currency,
  l.name as location_name,
  pr.full_name as salesperson_name,
  (m.id is not null) as has_photo
from feedback.requests r
join identity.contacts c on c.id = r.contact_id
join sales.purchases p on p.id = r.purchase_id
left join core.business_locations l on l.id = r.location_id
left join core.profiles pr on pr.user_id = r.salesperson_id
left join feedback.media m on m.request_id = r.id;

grant select on api.feedback_requests to authenticated, service_role;

create or replace function api.feedback_purchase_context(p_purchase_id uuid)
returns table (
  purchase_id uuid, purchase_ref text, purchased_at timestamptz, amount numeric, currency text,
  contact_id uuid, customer_name text, phone text, visit_id uuid, location_id uuid,
  location_name text, salesperson_id uuid, salesperson_name text, existing_request_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.require_permission('sales.write');
  return query
  select p.id, p.external_ref, p.purchased_at, p.amount, p.currency::text,
    p.contact_id, c.display_name,
    case when core.has_permission('contact.reveal') then cp.normalized_value else null end,
    p.visit_id, p.location_id, l.name, p.salesperson_id, pr.full_name, fr.id
  from sales.purchases p
  join identity.contacts c on c.id = p.contact_id
  left join lateral (
    select x.normalized_value from identity.contact_points x
    where x.contact_id = p.contact_id and x.kind in ('phone','whatsapp')
    order by x.is_primary desc, x.created_at asc limit 1
  ) cp on true
  left join core.business_locations l on l.id = p.location_id
  left join core.profiles pr on pr.user_id = p.salesperson_id
  left join feedback.requests fr on fr.purchase_id = p.id
  where p.id = p_purchase_id
    and p.workspace_id = core.current_workspace_id()
    and p.status <> 'voided';
end $$;

revoke all on function api.feedback_purchase_context(uuid) from public;
grant execute on function api.feedback_purchase_context(uuid) to authenticated;

create or replace function api.create_feedback_request(
  p_purchase_id uuid,
  p_answers jsonb,
  p_token_hash text,
  p_expires_at timestamptz,
  p_generated_text text,
  p_generation_mode text,
  p_model_id text,
  p_prompt_version text,
  p_input_hash text,
  p_review_url text default null,
  p_photo_permission boolean default false,
  p_whatsapp_consent boolean default false,
  p_benefit_status text default 'not_offered',
  p_benefit_reference text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_purchase sales.purchases%rowtype;
  v_request_id uuid;
begin
  perform core.require_permission('sales.write');
  v_ws := core.current_workspace_id();
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> 5 then
    raise exception 'Exactly five versioned feedback answers are required' using errcode = '23514';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid customer token hash' using errcode = '23514';
  end if;
  if p_expires_at <= now() then
    raise exception 'Customer link expiry must be in the future' using errcode = '23514';
  end if;
  if p_benefit_status not in ('not_offered','granted_for_private_feedback') then
    raise exception 'Invalid private-feedback benefit state' using errcode = '23514';
  end if;

  select * into v_purchase from sales.purchases
  where id = p_purchase_id and workspace_id = v_ws and status <> 'voided' for share;
  if not found then raise exception 'Eligible purchase not found' using errcode = 'P0002'; end if;
  if v_purchase.contact_id is null then raise exception 'Resolve the customer before requesting feedback' using errcode = '23514'; end if;

  insert into feedback.requests (
    workspace_id, purchase_id, visit_id, contact_id, location_id, salesperson_id,
    whatsapp_consent, photo_permission, benefit_status, benefit_reference, review_url, created_by
  ) values (
    v_ws, v_purchase.id, v_purchase.visit_id, v_purchase.contact_id, v_purchase.location_id,
    coalesce(v_purchase.salesperson_id, auth.uid()), p_whatsapp_consent, p_photo_permission,
    p_benefit_status, nullif(trim(p_benefit_reference), ''), nullif(trim(p_review_url), ''), auth.uid()
  ) returning id into v_request_id;

  insert into feedback.answers (workspace_id, request_id, question_key, question_text, answer_text, position, captured_by)
  select v_ws, v_request_id, x.question_key, x.question_text, nullif(trim(x.answer_text), ''), x.position, auth.uid()
  from jsonb_to_recordset(p_answers) as x(question_key text, question_text text, answer_text text, position smallint);

  if (select count(*) from feedback.answers where request_id = v_request_id) <> 5 then
    raise exception 'Feedback answers must contain five unique questions' using errcode = '23514';
  end if;

  insert into feedback.drafts (
    workspace_id, request_id, generation_mode, model_id, prompt_version,
    input_hash, generated_text, customer_text
  ) values (
    v_ws, v_request_id, p_generation_mode, nullif(trim(p_model_id), ''), p_prompt_version,
    p_input_hash, trim(p_generated_text), trim(p_generated_text)
  );

  insert into feedback.customer_access_tokens (workspace_id, request_id, token_hash, expires_at)
  values (v_ws, v_request_id, p_token_hash, p_expires_at);
  insert into feedback.handoff_events (workspace_id, request_id, event_type, actor_id)
  values (v_ws, v_request_id, 'request_created', auth.uid());
  perform audit.emit(v_ws, 'feedback.request_created', 'feedback', 'requests', v_request_id, null, null, null,
    jsonb_build_object('purchase_id', v_purchase.id, 'generation_mode', p_generation_mode,
      'benefit_status', p_benefit_status, 'photo_permission', p_photo_permission));

  return jsonb_build_object('request_id', v_request_id);
end $$;

revoke all on function api.create_feedback_request(uuid,jsonb,text,timestamptz,text,text,text,text,text,text,boolean,boolean,text,text) from public;
grant execute on function api.create_feedback_request(uuid,jsonb,text,timestamptz,text,text,text,text,text,text,boolean,boolean,text,text) to authenticated;

create or replace function api.attach_feedback_media(
  p_request_id uuid, p_object_path text, p_mime_type text, p_size_bytes bigint
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_request feedback.requests%rowtype; v_id uuid;
begin
  perform core.require_permission('sales.write');
  select * into v_request from feedback.requests
  where id = p_request_id and workspace_id = core.current_workspace_id();
  if not found then raise exception 'Feedback request not found' using errcode = 'P0002'; end if;
  if not v_request.photo_permission then raise exception 'Photo permission was not recorded' using errcode = '23514'; end if;
  if p_object_path !~ ('^' || v_request.workspace_id::text || '/' || v_request.id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'Invalid feedback media path' using errcode = '23514';
  end if;
  insert into feedback.media (workspace_id, request_id, object_path, mime_type, size_bytes, uploaded_by)
  values (v_request.workspace_id, v_request.id, p_object_path, p_mime_type, p_size_bytes, auth.uid())
  returning id into v_id;
  perform audit.emit(v_request.workspace_id, 'feedback.photo_attached', 'feedback', 'media', v_id, null, null, null,
    jsonb_build_object('request_id', v_request.id, 'mime_type', p_mime_type, 'size_bytes', p_size_bytes));
  return v_id;
end $$;

revoke all on function api.attach_feedback_media(uuid,text,text,bigint) from public;
grant execute on function api.attach_feedback_media(uuid,text,text,bigint) to authenticated;

create or replace function api.log_feedback_staff_event(p_request_id uuid, p_event_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request feedback.requests%rowtype;
begin
  perform core.require_permission('sales.write');
  if p_event_type <> 'whatsapp_opened' then raise exception 'Unsupported staff event'; end if;
  select * into v_request from feedback.requests where id = p_request_id and workspace_id = core.current_workspace_id();
  if not found then raise exception 'Feedback request not found' using errcode = 'P0002'; end if;
  insert into feedback.handoff_events (workspace_id, request_id, event_type, actor_id)
  values (v_request.workspace_id, v_request.id, p_event_type, auth.uid());
end $$;

revoke all on function api.log_feedback_staff_event(uuid,text) from public;
grant execute on function api.log_feedback_staff_event(uuid,text) to authenticated;

create or replace function api.get_feedback_by_token(p_token_hash text)
returns table (
  request_id uuid, status text, expires_at timestamptz, customer_name text,
  purchased_at timestamptz, location_name text, answers jsonb, draft_text text,
  has_photo boolean, review_url text, benefit_status text
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  select r.id, r.status, t.expires_at, split_part(c.display_name, ' ', 1),
    p.purchased_at, l.name,
    coalesce((select jsonb_agg(jsonb_build_object(
      'question_key', a.question_key, 'question_text', a.question_text,
      'answer_text', a.answer_text, 'position', a.position
    ) order by a.position) from feedback.answers a where a.request_id = r.id), '[]'::jsonb),
    coalesce(d.customer_text, d.generated_text), (m.id is not null), r.review_url, r.benefit_status
  from feedback.customer_access_tokens t
  join feedback.requests r on r.id = t.request_id
  join identity.contacts c on c.id = r.contact_id
  join sales.purchases p on p.id = r.purchase_id
  join feedback.drafts d on d.request_id = r.id
  left join core.business_locations l on l.id = r.location_id
  left join feedback.media m on m.request_id = r.id
  where t.token_hash = p_token_hash and t.revoked_at is null and t.expires_at > now()
    and r.status not in ('expired','revoked');
end $$;

revoke all on function api.get_feedback_by_token(text) from public;
grant execute on function api.get_feedback_by_token(text) to service_role;

create or replace function api.confirm_feedback_by_token(p_token_hash text, p_customer_text text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_request_id uuid; v_ws uuid;
begin
  if length(trim(coalesce(p_customer_text, ''))) < 5 or length(p_customer_text) > 2000 then
    raise exception 'Please keep the review draft between 5 and 2000 characters' using errcode = '23514';
  end if;
  select t.request_id, t.workspace_id into v_request_id, v_ws
  from feedback.customer_access_tokens t join feedback.requests r on r.id = t.request_id
  where t.token_hash = p_token_hash and t.revoked_at is null and t.expires_at > now()
    and r.status not in ('expired','revoked') for update of t;
  if not found then return false; end if;
  update feedback.drafts set customer_text = trim(p_customer_text), customer_confirmed_at = now()
  where request_id = v_request_id;
  update feedback.requests set status = 'confirmed', customer_confirmed_at = now()
  where id = v_request_id;
  update feedback.customer_access_tokens set last_used_at = now() where request_id = v_request_id;
  insert into feedback.handoff_events (workspace_id, request_id, event_type)
  values (v_ws, v_request_id, 'feedback_confirmed');
  perform audit.emit(v_ws, 'feedback.confirmed', 'feedback', 'requests', v_request_id, null, null, null,
    jsonb_build_object('source', 'customer_token'));
  return true;
end $$;

revoke all on function api.confirm_feedback_by_token(text,text) from public;
grant execute on function api.confirm_feedback_by_token(text,text) to service_role;

create or replace function api.log_feedback_customer_event(p_token_hash text, p_event_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_request_id uuid; v_ws uuid;
begin
  if p_event_type not in ('customer_link_opened','google_handoff_opened','photo_downloaded') then
    raise exception 'Unsupported customer event' using errcode = '23514';
  end if;
  select t.request_id, t.workspace_id into v_request_id, v_ws
  from feedback.customer_access_tokens t join feedback.requests r on r.id = t.request_id
  where t.token_hash = p_token_hash and t.revoked_at is null and t.expires_at > now()
    and r.status not in ('expired','revoked');
  if not found then return false; end if;
  insert into feedback.handoff_events (workspace_id, request_id, event_type)
  values (v_ws, v_request_id, p_event_type);
  update feedback.customer_access_tokens set last_used_at = now() where request_id = v_request_id;
  if p_event_type = 'google_handoff_opened' then
    update feedback.requests set google_handoff_opened_at = coalesce(google_handoff_opened_at, now()) where id = v_request_id;
  end if;
  return true;
end $$;

revoke all on function api.log_feedback_customer_event(text,text) from public;
grant execute on function api.log_feedback_customer_event(text,text) to service_role;

create or replace function api.get_feedback_media_by_token(p_token_hash text)
returns table (bucket_id text, object_path text, mime_type text)
language sql stable security definer set search_path = '' as $$
  select m.bucket_id, m.object_path, m.mime_type
  from feedback.customer_access_tokens t
  join feedback.requests r on r.id = t.request_id
  join feedback.media m on m.request_id = r.id
  where t.token_hash = p_token_hash and t.revoked_at is null and t.expires_at > now()
    and r.status not in ('expired','revoked')
$$;

revoke all on function api.get_feedback_media_by_token(text) from public;
grant execute on function api.get_feedback_media_by_token(text) to service_role;
