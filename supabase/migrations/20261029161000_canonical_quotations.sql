-- TILE-5: one canonical quotation record, with preparation, issue and sending
-- kept as separate facts and every earlier version preserved.
--
-- Before this migration a quotation could live in three unlinked places
-- (sales.quotes behind an opportunity, sales.visits.quotation_ref/amount, and
-- sales.visit_quotation_files), and the pipeline dialog wrote a quote in four
-- separate inserts with no idempotency. Now:
--
--   * sales.quotes is the only quotation identity. It may be anchored to an
--     inquiry (lead), a showroom visit or an opportunity; at least one is
--     required, and quoting never creates an opportunity.
--   * Every quote number and SQL Account reference is registered once per
--     workspace in sales.quote_references, normalised, so the same SQ number
--     always resolves to the same canonical quote.
--   * A version is prepared (issued_at null), then issued, then sent. Sending is
--     its own append-only fact in sales.quote_deliveries carrying the actual
--     version, time, channel, sender and evidence. A version is immutable apart
--     from the single prepared -> issued transition.
--   * History (outcomes, anchor changes, send voids, evidence decisions) is
--     append-only in sales.quote_events.
--   * Visit quotation notes and files are evidence, not quotes. They resolve to
--     a canonical quote through the reference registry or a reviewer decision,
--     and otherwise show as 'unreviewed'. Nothing here, and nothing on upload,
--     creates a sent quotation.
--   * All writes go through api.quote_command, idempotent on p_request_id.
--
-- Counting: api.quote_send_facts classifies each non-voided delivery as
-- 'first_quote' (the first delivery of the quote, whichever version it was),
-- 'revision' (the first delivery of any other version) or 'resend'.

------------------------------------------------------------------------------
-- 1. Quote identity and anchors
------------------------------------------------------------------------------
create or replace function core.quote_ref_key(p_ref text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p_ref, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
comment on function core.quote_ref_key(text) is
  'Normalised quotation reference: letters and digits only, upper case. "sq-00123" and "SQ 00123" are the same document.';

-- An opportunity is now one optional anchor among three, and deleting one must
-- not silently delete the quotation history behind it.
alter table sales.quotes drop constraint quotes_opportunity_id_fkey;
alter table sales.quotes
  alter column opportunity_id drop not null,
  add constraint quotes_opportunity_id_fkey foreign key (opportunity_id) references sales.opportunities(id),
  add column lead_id uuid references sales.leads(id),
  add column visit_id uuid references sales.visits(id),
  add column contact_id uuid references identity.contacts(id) on delete set null,
  add column account_id uuid references identity.accounts(id) on delete set null,
  add column origin text;

update sales.quotes set origin = 'legacy' where origin is null;
update sales.quotes q set contact_id = o.contact_id, account_id = o.account_id
  from sales.opportunities o where o.id = q.opportunity_id and q.contact_id is null and q.account_id is null;

alter table sales.quotes
  alter column origin set not null,
  add constraint quotes_origin_check check (origin in ('inbox','visit','pipeline','visit_review','legacy')),
  add constraint quotes_anchor_check check (opportunity_id is not null or lead_id is not null or visit_id is not null);
create index quotes_lead_idx on sales.quotes (lead_id);
create index quotes_visit_idx on sales.quotes (visit_id);

comment on column sales.quotes.status is
  'draft = nothing issued yet; issued / revised = one / several versions issued; accepted / rejected / expired = recorded customer outcome. Sending is not a status: see sales.quote_deliveries.';
comment on column sales.quotes.origin is
  'Where the quote was first recorded: inbox, visit, pipeline, visit_review (created by a reviewer from historical visit evidence) or legacy (before TILE-5).';

------------------------------------------------------------------------------
-- 2. Versions: prepared -> issued, otherwise immutable
------------------------------------------------------------------------------
alter table sales.quote_versions
  add column prepared_at timestamptz,
  add column issued_by uuid references auth.users(id),
  add column evidence_state text;

update sales.quote_versions set prepared_at = coalesce(issued_at, created_at), evidence_state = 'legacy' where evidence_state is null;

alter table sales.quote_versions
  alter column prepared_at set not null,
  alter column evidence_state set not null,
  add constraint quote_versions_evidence_state_check check (evidence_state in ('staff_entered','unverified_historical','legacy')),
  add constraint quote_versions_issue_order_check check (issued_at is null or issued_at >= prepared_at or evidence_state = 'legacy');

comment on column sales.quote_versions.prepared_at is 'Business time the version was prepared (effective date). created_at is when it was recorded.';
comment on column sales.quote_versions.issued_at is 'Business time the version was issued. Null means prepared only. Sending is recorded separately.';
comment on column sales.quote_versions.evidence_state is
  'staff_entered = recorded by staff from the quote itself; unverified_historical = created by a reviewer from a visit note or file whose contents and sending were not confirmed; legacy = before TILE-5.';

------------------------------------------------------------------------------
-- 3. Reference registry
------------------------------------------------------------------------------
create table sales.quote_references (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  ref_key text not null check (ref_key ~ '^[A-Z0-9]{1,100}$'),
  quote_id uuid not null references sales.quotes(id) on delete cascade,
  ref_text text not null,
  ref_kind text not null check (ref_kind in ('quote_number','external_ref')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, ref_key)
);
create index quote_references_quote_idx on sales.quote_references (quote_id);
comment on table sales.quote_references is
  'Every quote number and SQL Account quotation reference, normalised by core.quote_ref_key. One reference belongs to exactly one canonical quote.';

insert into sales.quote_references (workspace_id, ref_key, quote_id, ref_text, ref_kind, created_by)
select q.workspace_id, core.quote_ref_key(q.quote_number), q.id, q.quote_number, 'quote_number', q.created_by
from sales.quotes q where core.quote_ref_key(q.quote_number) is not null
on conflict do nothing;
insert into sales.quote_references (workspace_id, ref_key, quote_id, ref_text, ref_kind, created_by)
select v.workspace_id, core.quote_ref_key(v.external_ref), v.quote_id, v.external_ref, 'external_ref', v.created_by
from sales.quote_versions v where core.quote_ref_key(v.external_ref) is not null
on conflict do nothing;
insert into sales.quote_references (workspace_id, ref_key, quote_id, ref_text, ref_kind, created_by)
select d.workspace_id, core.quote_ref_key(d.document_number), d.object_id, d.document_number, 'external_ref', d.created_by
from sales.external_document_links d
where d.object_type = 'quote' and d.document_type = 'quotation' and core.quote_ref_key(d.document_number) is not null
  and exists (select 1 from sales.quotes q where q.id = d.object_id and q.workspace_id = d.workspace_id)
on conflict do nothing;

------------------------------------------------------------------------------
-- 4. Sending, voids, history
------------------------------------------------------------------------------
create table sales.quote_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  quote_id uuid not null references sales.quotes(id) on delete cascade,
  quote_version_id uuid not null references sales.quote_versions(id) on delete cascade,
  sent_at timestamptz not null,
  channel text not null check (channel in ('whatsapp','email','in_person','printed','phone_call','other')),
  sent_by uuid not null references auth.users(id),
  evidence text not null check (evidence in ('staff_attested','message_reference','customer_acknowledged')),
  evidence_ref text check (evidence_ref is null or length(evidence_ref) between 1 and 200),
  note text check (note is null or length(note) <= 2000),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  request_id uuid not null,
  unique (workspace_id, request_id),
  -- The same version sent on the same channel at the same moment is one fact,
  -- however many times the form is submitted.
  unique (quote_version_id, channel, sent_at)
);
create index quote_deliveries_quote_idx on sales.quote_deliveries (quote_id, sent_at);
create index quote_deliveries_ws_sent_idx on sales.quote_deliveries (workspace_id, sent_at);
comment on table sales.quote_deliveries is
  'Append-only: a quote version actually reached the customer. sent_at is business time; recorded_at is when staff recorded it.';

create table sales.quote_delivery_voids (
  delivery_id uuid primary key references sales.quote_deliveries(id) on delete cascade,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  voided_by uuid not null references auth.users(id),
  voided_at timestamptz not null default now()
);
comment on table sales.quote_delivery_voids is 'Append-only: a delivery recorded in error. The delivery row is kept; counts exclude it.';

create table sales.quote_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  quote_id uuid not null references sales.quotes(id) on delete cascade,
  quote_version_id uuid references sales.quote_versions(id) on delete cascade,
  delivery_id uuid references sales.quote_deliveries(id) on delete cascade,
  event_type text not null check (event_type in ('prepared','revised','issued','sent','send_voided','accepted','rejected','expired','reopened','anchors_changed','evidence_linked')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid references auth.users(id),
  reason text,
  details jsonb not null default '{}'::jsonb,
  request_id uuid
);
create index quote_events_quote_idx on sales.quote_events (quote_id, recorded_at);

------------------------------------------------------------------------------
-- 5. Visit evidence decisions (a reviewer says what a visit note or file is)
------------------------------------------------------------------------------
create table sales.visit_quote_evidence_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  visit_id uuid not null references sales.visits(id) on delete cascade,
  evidence_kind text not null check (evidence_kind in ('reference','file')),
  file_id uuid references sales.visit_quotation_files(id) on delete cascade,
  evidence_key text generated always as (evidence_kind || ':' || coalesce(file_id, visit_id)::text) stored,
  resolution text not null check (resolution in ('linked','unresolved','not_a_quote')),
  quote_id uuid references sales.quotes(id) on delete cascade,
  quote_version_id uuid references sales.quote_versions(id) on delete cascade,
  snapshot jsonb not null,
  reason text check (reason is null or length(reason) <= 500),
  supersedes_id uuid unique references sales.visit_quote_evidence_decisions(id) on delete cascade,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  check ((evidence_kind = 'file') = (file_id is not null)),
  check ((resolution = 'linked') = (quote_id is not null)),
  check (quote_version_id is null or quote_id is not null),
  check (resolution <> 'unresolved' or reason is not null)
);
-- One chain per evidence item: one first decision, and each later decision
-- supersedes exactly one (the unique supersedes_id above).
create unique index visit_quote_evidence_first_idx on sales.visit_quote_evidence_decisions (evidence_key) where supersedes_id is null;
create index visit_quote_evidence_visit_idx on sales.visit_quote_evidence_decisions (visit_id);

-- Quotation files are evidence that decisions above point at. Deleting a whole
-- workspace (the weekly demo reset) relies on cascading foreign keys, and this
-- one did not cascade, so one guest-uploaded quotation file made the reset fail.
alter table sales.visit_quotation_files drop constraint visit_quotation_files_workspace_id_fkey,
  add constraint visit_quotation_files_workspace_id_fkey foreign key (workspace_id) references core.workspaces(id) on delete cascade;

------------------------------------------------------------------------------
-- 6. Request ledger
------------------------------------------------------------------------------
create table sales.quote_requests (
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, request_id)
);

------------------------------------------------------------------------------
-- 7. Immutability guards
------------------------------------------------------------------------------
-- Deletes are allowed only as part of deleting the whole workspace (the demo
-- reset); the workspace row is already gone when the cascade reaches here.
create or replace function sales.reject_quote_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from core.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  raise exception 'sales.% is append-only; record a superseding entry instead', tg_table_name using errcode = '0A000';
end $$;
revoke all on function sales.reject_quote_history_mutation() from public;

create trigger quote_deliveries_append_only before update or delete on sales.quote_deliveries
  for each row execute function sales.reject_quote_history_mutation();
create trigger quote_delivery_voids_append_only before update or delete on sales.quote_delivery_voids
  for each row execute function sales.reject_quote_history_mutation();
create trigger quote_events_append_only before update or delete on sales.quote_events
  for each row execute function sales.reject_quote_history_mutation();
create trigger visit_quote_evidence_append_only before update or delete on sales.visit_quote_evidence_decisions
  for each row execute function sales.reject_quote_history_mutation();
create trigger quote_references_append_only before update or delete on sales.quote_references
  for each row execute function sales.reject_quote_history_mutation();

create or replace function sales.guard_quote_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from core.workspaces w where w.id = old.workspace_id) then return old; end if;
    raise exception 'Quote versions cannot be deleted; prepare a revision instead' using errcode = '0A000';
  end if;
  if old.issued_at is null and new.issued_at is not null and new.issued_by is not null
     and (to_jsonb(new) - 'issued_at' - 'issued_by') = (to_jsonb(old) - 'issued_at' - 'issued_by') then
    return new;
  end if;
  raise exception 'Quote version % is immutable; prepare a revision instead', old.version_no using errcode = '0A000';
end $$;
revoke all on function sales.guard_quote_version() from public;
create trigger quote_versions_immutable before update or delete on sales.quote_versions
  for each row execute function sales.guard_quote_version();

------------------------------------------------------------------------------
-- 8. Access: read through api views, write only through api.quote_command
------------------------------------------------------------------------------
revoke insert, update, delete on sales.quotes, sales.quote_versions, sales.quote_items from authenticated;
revoke insert, update, delete on api.quotes, api.quote_versions, api.quote_items from authenticated;

do $$
declare t text;
begin
  foreach t in array array['quote_references','quote_deliveries','quote_delivery_voids','quote_events','visit_quote_evidence_decisions']
  loop
    execute format('alter table sales.%I enable row level security', t);
    execute format($p$create policy member_read on sales.%I for select to authenticated
      using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.read')))$p$, t);
    execute format('grant select on sales.%I to authenticated', t);
    execute format('grant all on sales.%I to service_role', t);
    execute format('create view api.%I with (security_invoker = true) as select * from sales.%I', t, t);
    execute format('grant select on api.%I to authenticated', t);
    execute format('grant all on api.%I to service_role', t);
  end loop;
end $$;
alter table sales.quote_requests enable row level security;
revoke all on sales.quote_requests from public, anon, authenticated;

-- New columns must be visible through the existing views.
create or replace view api.quotes with (security_invoker = true) as select * from sales.quotes;
create or replace view api.quote_versions with (security_invoker = true) as select * from sales.quote_versions;

------------------------------------------------------------------------------
-- 9. Read models
------------------------------------------------------------------------------
create view api.quote_send_facts with (security_invoker = true) as
select d.id as delivery_id, d.workspace_id, d.quote_id, d.quote_version_id, v.version_no,
  d.sent_at, d.channel, d.sent_by, d.evidence, d.recorded_by, d.recorded_at,
  (d.sent_at at time zone 'Asia/Kuala_Lumpur')::date as sent_local_date,
  date_trunc('week', d.sent_at at time zone 'Asia/Kuala_Lumpur')::date as sent_week_start,
  case
    when row_number() over (partition by d.quote_id order by d.sent_at, d.recorded_at, d.id) = 1 then 'first_quote'
    when row_number() over (partition by d.quote_version_id order by d.sent_at, d.recorded_at, d.id) = 1 then 'revision'
    else 'resend'
  end as send_kind
from sales.quote_deliveries d
join sales.quote_versions v on v.id = d.quote_version_id
where not exists (select 1 from sales.quote_delivery_voids x where x.delivery_id = d.id);
grant select on api.quote_send_facts to authenticated;
grant all on api.quote_send_facts to service_role;
comment on view api.quote_send_facts is
  'One row per non-voided delivery. send_kind: first_quote = the first delivery of the quote (whichever version), revision = first delivery of any other version, resend = a version already delivered. Weeks are Monday-Sunday in Asia/Kuala_Lumpur on sent_at.';

create view api.quote_register with (security_invoker = true) as
with sends as (
  select f.quote_id, count(*) as send_count, count(distinct f.quote_version_id) as versions_sent,
    min(f.sent_at) as first_sent_at, max(f.sent_at) as last_sent_at,
    min(f.version_no) filter (where f.send_kind = 'first_quote') as first_sent_version_no
  from api.quote_send_facts f group by f.quote_id
), issued as (
  select v.quote_id, count(*) as issued_versions from sales.quote_versions v where v.issued_at is not null group by v.quote_id
)
select q.id as quote_id, q.workspace_id, q.quote_number, q.status, q.origin,
  q.opportunity_id, q.lead_id, q.visit_id, q.contact_id, q.account_id, q.current_version_no, q.created_at, q.created_by, q.updated_at,
  cv.id as current_version_id, cv.total_amount as current_total_amount, cv.currency as current_currency,
  cv.prepared_at as current_prepared_at, cv.issued_at as current_issued_at, cv.valid_until as current_valid_until,
  cv.external_ref as current_external_ref, cv.evidence_state as current_evidence_state,
  coalesce(i.issued_versions, 0) as issued_versions,
  coalesce(s.send_count, 0) as send_count, coalesce(s.versions_sent, 0) as versions_sent,
  s.first_sent_at, s.first_sent_version_no, s.last_sent_at,
  case
    when q.status in ('accepted','rejected','expired') then q.status
    when coalesce(s.send_count, 0) > 0 then 'sent'
    when coalesce(i.issued_versions, 0) > 0 then 'issued'
    else 'prepared'
  end as lifecycle,
  coalesce('opportunity:' || coalesce(q.opportunity_id, l.converted_opportunity_id)::text, 'lead:' || q.lead_id::text, 'visit:' || q.visit_id::text) as pursuit_key
from sales.quotes q
left join sales.quote_versions cv on cv.quote_id = q.id and cv.version_no = q.current_version_no
left join sales.leads l on l.id = q.lead_id
left join sends s on s.quote_id = q.id
left join issued i on i.quote_id = q.id;
grant select on api.quote_register to authenticated;
grant all on api.quote_register to service_role;
comment on view api.quote_register is
  'One row per canonical quote with its current version, issue and send state. lifecycle: prepared, issued, sent, accepted, rejected, expired. pursuit_key groups quotes of one pursuit: the opportunity (direct or via the converted inquiry), else the inquiry, else the visit.';

create view api.visit_quote_evidence with (security_invoker = true) as
with items as (
  select v.workspace_id, v.id as visit_id, 'reference'::text as evidence_kind, null::uuid as file_id,
    v.quotation_ref as reference_text, v.quotation_amount as amount, null::text as file_name, v.occurred_at as visit_occurred_at
  from sales.visits v where v.quotation_ref is not null or v.quotation_amount is not null
  union all
  select f.workspace_id, f.visit_id, 'file', f.id, null, null, f.file_name, v.occurred_at
  from sales.visit_quotation_files f join sales.visits v on v.id = f.visit_id
  where f.uploaded_at is not null
)
select i.workspace_id, i.visit_id, i.evidence_kind, i.file_id, i.reference_text, i.amount, i.file_name, i.visit_occurred_at,
  i.evidence_kind || ':' || coalesce(i.file_id, i.visit_id)::text as evidence_key,
  d.id as decision_id, d.resolution as decided_resolution, d.decided_at, d.decided_by, d.reason as decision_reason,
  d.quote_version_id as decided_version_id, m.quote_id as matched_quote_id,
  coalesce(d.resolution, case when m.quote_id is not null then 'matched' else 'unreviewed' end) as resolution,
  case when d.resolution = 'linked' then d.quote_id when d.id is null then m.quote_id end as quote_id,
  (d.id is not null and i.evidence_kind = 'reference'
    and ((d.snapshot ->> 'reference_text') is distinct from i.reference_text or (d.snapshot ->> 'amount')::numeric is distinct from i.amount)) as changed_since_decision
from items i
left join lateral (
  select x.* from sales.visit_quote_evidence_decisions x
  where x.evidence_key = i.evidence_kind || ':' || coalesce(i.file_id, i.visit_id)::text
    and not exists (select 1 from sales.visit_quote_evidence_decisions y where y.supersedes_id = x.id)
) d on true
left join sales.quote_references m on i.evidence_kind = 'reference' and m.workspace_id = i.workspace_id
  and m.ref_key = core.quote_ref_key(i.reference_text);
grant select on api.visit_quote_evidence to authenticated;
grant all on api.visit_quote_evidence to service_role;
comment on view api.visit_quote_evidence is
  'Each visit quotation note (SQ number / amount) and uploaded file, and what it is: linked / unresolved / not_a_quote (a reviewer decided), matched (its SQ number is a registered quote reference) or unreviewed. Evidence is never counted as a sent quotation.';

create or replace function api.quote_send_summary(p_from date, p_to date)
returns table (week_start date, first_quotes bigint, revisions bigint, resends bigint, quoted_pursuits bigint,
  sends_without_pursuit bigint, versions_prepared bigint, unverified_versions_prepared bigint)
language sql stable security invoker set search_path = '' as $$
  with sent as (
    select f.sent_week_start as wk,
      count(*) filter (where f.send_kind = 'first_quote') as first_quotes,
      count(*) filter (where f.send_kind = 'revision') as revisions,
      count(*) filter (where f.send_kind = 'resend') as resends,
      count(distinct r.pursuit_key) filter (where f.send_kind <> 'resend') as quoted_pursuits,
      count(*) filter (where r.pursuit_key is null) as sends_without_pursuit
    from api.quote_send_facts f join api.quote_register r on r.quote_id = f.quote_id
    where f.sent_local_date between p_from and p_to
    group by 1
  ), prepared as (
    select date_trunc('week', v.prepared_at at time zone 'Asia/Kuala_Lumpur')::date as wk,
      count(*) as versions_prepared,
      count(*) filter (where v.evidence_state = 'unverified_historical') as unverified_versions_prepared
    from api.quote_versions v
    where (v.prepared_at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
    group by 1
  )
  select coalesce(s.wk, p.wk), coalesce(s.first_quotes, 0), coalesce(s.revisions, 0), coalesce(s.resends, 0),
    coalesce(s.quoted_pursuits, 0), coalesce(s.sends_without_pursuit, 0),
    coalesce(p.versions_prepared, 0), coalesce(p.unverified_versions_prepared, 0)
  from sent s full join prepared p on p.wk = s.wk
  where p_from <= p_to
  order by 1
$$;
revoke all on function api.quote_send_summary(date,date) from public, anon;
grant execute on function api.quote_send_summary(date,date) to authenticated, service_role;
comment on function api.quote_send_summary(date,date) is
  'Per Monday-Sunday week (Asia/Kuala_Lumpur): first quotations sent, revisions sent, resends, distinct quoted pursuits, and versions prepared (by prepared_at) with how many are unverified historical. Respects the caller''s row-level security.';

------------------------------------------------------------------------------
-- 10. Internal helpers (called only from api.quote_command)
------------------------------------------------------------------------------
create or replace function sales.quote_anchors(p_ws uuid, p_opportunity_id uuid, p_lead_id uuid, p_visit_id uuid,
  out opportunity_id uuid, out lead_id uuid, out visit_id uuid, out contact_id uuid, out account_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  o sales.opportunities%rowtype; l sales.leads%rowtype; v sales.visits%rowtype;
  contacts uuid[]; accounts uuid[];
begin
  opportunity_id := p_opportunity_id; lead_id := p_lead_id; visit_id := p_visit_id;
  if visit_id is not null then
    select * into v from sales.visits x where x.id = visit_id and x.workspace_id = p_ws;
    if not found then raise exception 'Visit not found in this workspace' using errcode = '42501'; end if;
    if v.lead_id is not null and lead_id is not null and v.lead_id <> lead_id then
      raise exception 'This visit is linked to a different inquiry' using errcode = '23514';
    end if;
    lead_id := coalesce(lead_id, v.lead_id);
  end if;
  if lead_id is not null then
    select * into l from sales.leads x where x.id = lead_id and x.workspace_id = p_ws;
    if not found or not (core.has_permission('sales.read_all') or core.has_permission('sales.leads.read_all') or l.owner_id is null or l.owner_id = uid) then
      raise exception 'Inquiry not found in this workspace' using errcode = '42501';
    end if;
    if l.converted_opportunity_id is not null and opportunity_id is not null and l.converted_opportunity_id <> opportunity_id then
      raise exception 'This inquiry was converted to a different opportunity' using errcode = '23514';
    end if;
    -- Linking to the opportunity the inquiry already became; never creating one.
    opportunity_id := coalesce(opportunity_id, l.converted_opportunity_id);
  end if;
  if opportunity_id is not null then
    select * into o from sales.opportunities x where x.id = opportunity_id and x.workspace_id = p_ws;
    if not found then raise exception 'Opportunity not found in this workspace' using errcode = '42501'; end if;
    if not core.has_permission('sales.read_all') and o.owner_id is not null and o.owner_id <> uid then
      raise exception 'Only the owner or a sales manager can quote on this opportunity' using errcode = '42501';
    end if;
    if o.archived_at is not null then raise exception 'Restore the opportunity before quoting on it' using errcode = '23514'; end if;
    if o.lead_id is not null and lead_id is not null and o.lead_id <> lead_id and l.converted_opportunity_id is distinct from o.id then
      raise exception 'This opportunity belongs to a different inquiry' using errcode = '23514';
    end if;
    lead_id := coalesce(lead_id, o.lead_id);
  end if;
  if opportunity_id is null and lead_id is null and visit_id is null then
    raise exception 'Choose the inquiry, visit or opportunity this quote belongs to' using errcode = '23514';
  end if;
  contacts := array(select distinct c from unnest(array[o.contact_id, l.contact_id, v.contact_id]) c where c is not null);
  accounts := array(select distinct a from unnest(array[o.account_id, l.account_id, v.account_id]) a where a is not null);
  if cardinality(contacts) > 1 then raise exception 'The linked records name different customers. Resolve the identity first' using errcode = '23514'; end if;
  if cardinality(accounts) > 1 then raise exception 'The linked records name different companies. Resolve the identity first' using errcode = '23514'; end if;
  contact_id := contacts[1]; account_id := accounts[1];
end $$;
revoke all on function sales.quote_anchors(uuid,uuid,uuid,uuid) from public, anon, authenticated;

create or replace function sales.quote_register_ref(p_ws uuid, p_quote_id uuid, p_ref text, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare k text := core.quote_ref_key(p_ref); owner_quote uuid; owner_number text;
begin
  if k is null then return; end if;
  select r.quote_id into owner_quote from sales.quote_references r where r.workspace_id = p_ws and r.ref_key = k;
  if owner_quote = p_quote_id then return; end if;
  if owner_quote is not null then
    select q.quote_number into owner_number from sales.quotes q where q.id = owner_quote;
    raise exception 'Reference % already belongs to quote %. Open that quote and add a revision instead', p_ref, coalesce(owner_number, owner_quote::text)
      using errcode = '23505', detail = owner_quote::text;
  end if;
  insert into sales.quote_references (workspace_id, ref_key, quote_id, ref_text, ref_kind, created_by)
  values (p_ws, k, p_quote_id, btrim(p_ref), p_kind, auth.uid());
end $$;
revoke all on function sales.quote_register_ref(uuid,uuid,text,text) from public, anon, authenticated;

create or replace function sales.quote_note(p_quote sales.quotes, p_event text, p_version_id uuid, p_delivery_id uuid,
  p_occurred_at timestamptz, p_reason text, p_details jsonb, p_request_id uuid, p_subject text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into sales.quote_events (workspace_id, quote_id, quote_version_id, delivery_id, event_type, occurred_at, actor_id, reason, details, request_id)
  values (p_quote.workspace_id, p_quote.id, p_version_id, p_delivery_id, p_event, p_occurred_at, auth.uid(), p_reason, coalesce(p_details, '{}'), p_request_id);
  insert into sales.activities (workspace_id, kind, subject, body, occurred_at, actor_id, contact_id, account_id, opportunity_id, lead_id, visit_id, metadata)
  values (p_quote.workspace_id, 'system', p_subject, p_reason, p_occurred_at, auth.uid(), p_quote.contact_id, p_quote.account_id,
    p_quote.opportunity_id, p_quote.lead_id, p_quote.visit_id,
    jsonb_build_object('quote_id', p_quote.id, 'quote_version_id', p_version_id, 'delivery_id', p_delivery_id, 'quote_event', p_event));
end $$;
revoke all on function sales.quote_note(sales.quotes,text,uuid,uuid,timestamptz,text,jsonb,uuid,text) from public, anon, authenticated;

create or replace function sales.quote_refresh_status(p_quote_id uuid)
returns void language sql security definer set search_path = '' as $$
  update sales.quotes q set status = case
      when (select count(*) from sales.quote_versions v where v.quote_id = q.id and v.issued_at is not null) > 1 then 'revised'
      when exists (select 1 from sales.quote_versions v where v.quote_id = q.id and v.issued_at is not null) then 'issued'
      else 'draft' end
  where q.id = p_quote_id and q.status in ('draft','issued','revised')
$$;
revoke all on function sales.quote_refresh_status(uuid) from public, anon, authenticated;

create or replace function sales.quote_time(p_value text, p_label text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare t timestamptz;
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then raise exception '% is required', p_label using errcode = '23514'; end if;
  t := p_value::timestamptz;
  if t > now() + interval '5 minutes' then raise exception '% cannot be in the future', p_label using errcode = '23514'; end if;
  return t;
end $$;
revoke all on function sales.quote_time(text,text) from public, anon, authenticated;

-- Prepare a version (and optionally issue and send it in the same transaction).
create or replace function sales.quote_add_version(p_quote sales.quotes, p_input jsonb, p_evidence_state text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ver sales.quote_versions%rowtype;
  amount numeric := nullif(p_input->>'total_amount', '')::numeric;
  cur text := p_input->>'currency';
  prepared timestamptz := coalesce(sales.quote_time(coalesce(p_input->>'prepared_at', now()::text), 'Preparation time'), now());
  result jsonb;
begin
  if cur is null or cur !~ '^[A-Z]{3}$' then raise exception 'State the quote currency (three letters, for example MYR)' using errcode = '23514'; end if;
  if amount is not null and (amount < 0 or amount::text in ('NaN','Infinity')) then raise exception 'Quote total must be zero or a positive amount' using errcode = '23514'; end if;
  if nullif(p_input->>'valid_until', '') is not null and (p_input->>'valid_until')::date < (prepared at time zone 'Asia/Kuala_Lumpur')::date then
    raise exception 'Valid-until cannot be before the quote was prepared' using errcode = '23514';
  end if;
  insert into sales.quote_versions (workspace_id, quote_id, version_no, prepared_at, valid_until, total_amount, currency, external_ref, notes, evidence_state, created_by)
  values (p_quote.workspace_id, p_quote.id, p_quote.current_version_no + 1, prepared, nullif(p_input->>'valid_until', '')::date, amount, cur,
    nullif(btrim(p_input->>'external_ref'), ''), nullif(btrim(p_input->>'notes'), ''), p_evidence_state, auth.uid())
  returning * into ver;
  perform sales.quote_register_ref(p_quote.workspace_id, p_quote.id, ver.external_ref, 'external_ref');
  update sales.quotes set current_version_no = ver.version_no where id = p_quote.id;
  perform sales.quote_note(p_quote, case when ver.version_no = 1 then 'prepared' else 'revised' end, ver.id, null, prepared, null,
    jsonb_build_object('version_no', ver.version_no, 'total_amount', amount, 'currency', cur, 'external_ref', ver.external_ref, 'evidence_state', p_evidence_state),
    p_request_id, format('Quote %s v%s prepared', coalesce(p_quote.quote_number, ver.external_ref, 'without number'), ver.version_no));
  result := jsonb_build_object('quote_id', p_quote.id, 'version_id', ver.id, 'version_no', ver.version_no);
  if p_input ? 'issue' and jsonb_typeof(p_input->'issue') = 'object' then
    result := result || sales.quote_issue(ver.id, p_input->'issue', p_request_id);
  end if;
  if p_input ? 'send' and jsonb_typeof(p_input->'send') = 'object' then
    result := result || sales.quote_send(ver.id, p_input->'send', p_request_id);
  end if;
  return result;
end $$;

create or replace function sales.quote_issue(p_version_id uuid, p_input jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ver sales.quote_versions%rowtype; q sales.quotes%rowtype; issued timestamptz;
begin
  select * into ver from sales.quote_versions where id = p_version_id for update;
  select * into q from sales.quotes where id = ver.quote_id;
  if ver.issued_at is not null then
    return jsonb_build_object('issued_at', ver.issued_at, 'already_issued', true);
  end if;
  if q.status in ('accepted','rejected','expired') then raise exception 'Reopen the quote before issuing a version' using errcode = '23514'; end if;
  issued := sales.quote_time(p_input->>'issued_at', 'Issue time');
  if issued < ver.prepared_at then raise exception 'A version cannot be issued before it was prepared' using errcode = '23514'; end if;
  update sales.quote_versions set issued_at = issued, issued_by = auth.uid() where id = ver.id;
  perform sales.quote_refresh_status(q.id);
  perform sales.quote_note(q, 'issued', ver.id, null, issued, null, jsonb_build_object('version_no', ver.version_no), p_request_id,
    format('Quote %s v%s issued', coalesce(q.quote_number, ver.external_ref, 'without number'), ver.version_no));
  return jsonb_build_object('issued_at', issued, 'already_issued', false);
end $$;

create or replace function sales.quote_send(p_version_id uuid, p_input jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ver sales.quote_versions%rowtype; q sales.quotes%rowtype; d sales.quote_deliveries%rowtype;
  sent timestamptz := sales.quote_time(p_input->>'sent_at', 'Send time');
  ch text := p_input->>'channel'; ev text := p_input->>'evidence';
  sender uuid := coalesce(nullif(p_input->>'sent_by', '')::uuid, auth.uid());
  issue_result jsonb := '{}';
begin
  select * into ver from sales.quote_versions where id = p_version_id for update;
  select * into q from sales.quotes where id = ver.quote_id;
  if q.status in ('accepted','rejected','expired') then raise exception 'Reopen the quote before recording another send' using errcode = '23514'; end if;
  if ch is null or ch not in ('whatsapp','email','in_person','printed','phone_call','other') then raise exception 'Choose how the quote was sent' using errcode = '23514'; end if;
  if ev is null or ev not in ('staff_attested','message_reference','customer_acknowledged') then raise exception 'State the evidence that the quote was sent' using errcode = '23514'; end if;
  if ev = 'message_reference' and nullif(btrim(p_input->>'evidence_ref'), '') is null then raise exception 'Enter the message reference' using errcode = '23514'; end if;
  if not exists (select 1 from core.memberships m where m.workspace_id = q.workspace_id and m.user_id = sender and m.status = 'active') then
    raise exception 'Choose an active workspace member as the sender' using errcode = '23514';
  end if;
  if ver.issued_at is null then
    if coalesce((p_input->>'issue_if_prepared')::boolean, false) then
      issue_result := sales.quote_issue(ver.id, jsonb_build_object('issued_at', coalesce(nullif(p_input->>'issued_at', ''), sent::text)), p_request_id);
      select * into ver from sales.quote_versions where id = p_version_id;
    else
      raise exception 'Issue version % before recording that it was sent', ver.version_no using errcode = '23514';
    end if;
  end if;
  if sent < ver.issued_at then raise exception 'A version cannot be sent before it was issued' using errcode = '23514'; end if;
  select * into d from sales.quote_deliveries x where x.quote_version_id = ver.id and x.channel = ch and x.sent_at = sent;
  if found then
    return issue_result || jsonb_build_object('delivery_id', d.id, 'duplicate', true);
  end if;
  insert into sales.quote_deliveries (workspace_id, quote_id, quote_version_id, sent_at, channel, sent_by, evidence, evidence_ref, note, recorded_by, request_id)
  values (q.workspace_id, q.id, ver.id, sent, ch, sender, ev, nullif(btrim(p_input->>'evidence_ref'), ''), nullif(btrim(p_input->>'note'), ''), auth.uid(), p_request_id)
  returning * into d;
  perform sales.quote_note(q, 'sent', ver.id, d.id, sent, null,
    jsonb_build_object('version_no', ver.version_no, 'channel', ch, 'evidence', ev, 'sent_by', sender), p_request_id,
    format('Quote %s v%s sent (%s)', coalesce(q.quote_number, ver.external_ref, 'without number'), ver.version_no, replace(ch, '_', ' ')));
  return issue_result || jsonb_build_object('delivery_id', d.id, 'duplicate', false);
end $$;
revoke all on function sales.quote_add_version(sales.quotes,jsonb,text,uuid) from public, anon, authenticated;
revoke all on function sales.quote_issue(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function sales.quote_send(uuid,jsonb,uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 11. The command
------------------------------------------------------------------------------
create or replace function api.quote_command(p_action text, p_input jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := core.current_workspace_id(); uid uuid := auth.uid();
  payload jsonb := jsonb_build_object('action', p_action, 'input', coalesce(p_input, '{}'));
  prior sales.quote_requests%rowtype;
  q sales.quotes%rowtype; before_q jsonb;
  ver sales.quote_versions%rowtype; d sales.quote_deliveries%rowtype;
  a record; result jsonb;
  reason text := nullif(btrim(p_input->>'reason'), '');
  vis sales.visits%rowtype; f sales.visit_quotation_files%rowtype;
  ev_kind text; ev_key text; cur_decision sales.visit_quote_evidence_decisions%rowtype; snap jsonb; resolution text;
  link_quote uuid; link_version uuid; ref_quote uuid; decision_id uuid;
begin
  perform core.require_permission('sales.write'); perform core.require_workspace(ws);
  if p_request_id is null then raise exception 'A request id is required' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text || p_request_id::text, 0));
  select * into prior from sales.quote_requests where workspace_id = ws and request_id = p_request_id;
  if found then
    if prior.actor_id <> uid or prior.payload <> payload then raise exception 'Retry differs from original command' using errcode = '23514'; end if;
    return prior.result || jsonb_build_object('replayed', true);
  end if;
  if p_action not in ('prepare','revise','issue','send','void_send','accept','reject','expire','reopen','link','resolve_evidence') then
    raise exception 'Unknown quote action' using errcode = '23514';
  end if;

  -- Actions on an existing quote lock it first; anchors are re-checked so a
  -- caller who cannot see the inquiry or opportunity cannot act on its quote.
  if p_action in ('revise','accept','reject','expire','reopen','link') then
    select * into q from sales.quotes where id = nullif(p_input->>'quote_id', '')::uuid and workspace_id = ws for update;
    if not found then raise exception 'Quote not found' using errcode = '42501'; end if;
  elsif p_action in ('issue','send') then
    select * into ver from sales.quote_versions where id = nullif(p_input->>'version_id', '')::uuid and workspace_id = ws;
    if not found then raise exception 'Quote version not found' using errcode = '42501'; end if;
    select * into q from sales.quotes where id = ver.quote_id for update;
  elsif p_action = 'void_send' then
    select * into d from sales.quote_deliveries where id = nullif(p_input->>'delivery_id', '')::uuid and workspace_id = ws;
    if not found then raise exception 'Send record not found' using errcode = '42501'; end if;
    select * into q from sales.quotes where id = d.quote_id for update;
  end if;
  if q.id is not null and p_action <> 'link' then
    perform sales.quote_anchors(ws, q.opportunity_id, q.lead_id, q.visit_id);
  end if;
  before_q := to_jsonb(q);

  if p_action = 'prepare' then
    select * into a from sales.quote_anchors(ws, nullif(p_input->>'opportunity_id', '')::uuid, nullif(p_input->>'lead_id', '')::uuid, nullif(p_input->>'visit_id', '')::uuid);
    if coalesce(p_input->>'origin', '') not in ('inbox','visit','pipeline') then raise exception 'Unknown quote origin' using errcode = '23514'; end if;
    insert into sales.quotes (workspace_id, opportunity_id, lead_id, visit_id, contact_id, account_id, quote_number, status, current_version_no, origin, created_by)
    values (ws, a.opportunity_id, a.lead_id, a.visit_id, a.contact_id, a.account_id, nullif(btrim(p_input->>'quote_number'), ''), 'draft', 0, p_input->>'origin', uid)
    returning * into q;
    perform sales.quote_register_ref(ws, q.id, q.quote_number, 'quote_number');
    result := sales.quote_add_version(q, p_input, 'staff_entered', p_request_id);

  elsif p_action = 'revise' then
    if (p_input->>'base_version_no')::int is distinct from q.current_version_no then
      raise exception 'Quote changed: version % is now the latest. Refresh and try again', q.current_version_no using errcode = '40001';
    end if;
    if q.status in ('accepted','rejected','expired') then raise exception 'Reopen the quote before revising it' using errcode = '23514'; end if;
    result := sales.quote_add_version(q, p_input, 'staff_entered', p_request_id);

  elsif p_action = 'issue' then
    result := jsonb_build_object('quote_id', q.id, 'version_id', ver.id, 'version_no', ver.version_no) || sales.quote_issue(ver.id, p_input, p_request_id);

  elsif p_action = 'send' then
    result := jsonb_build_object('quote_id', q.id, 'version_id', ver.id, 'version_no', ver.version_no) || sales.quote_send(ver.id, p_input, p_request_id);

  elsif p_action = 'void_send' then
    if reason is null or length(reason) < 3 then raise exception 'A reason is required' using errcode = '23514'; end if;
    if exists (select 1 from sales.quote_delivery_voids where delivery_id = d.id) then
      result := jsonb_build_object('quote_id', q.id, 'delivery_id', d.id, 'already_voided', true);
    else
      insert into sales.quote_delivery_voids (delivery_id, workspace_id, reason, voided_by) values (d.id, ws, reason, uid);
      perform sales.quote_note(q, 'send_voided', d.quote_version_id, d.id, now(), reason, jsonb_build_object('sent_at', d.sent_at, 'channel', d.channel), p_request_id,
        format('Quote %s send record voided', coalesce(q.quote_number, 'without number')));
      result := jsonb_build_object('quote_id', q.id, 'delivery_id', d.id, 'already_voided', false);
    end if;

  elsif p_action in ('accept','reject','expire') then
    if q.status in ('accepted','rejected','expired') then raise exception 'This quote already has an outcome. Reopen it first' using errcode = '23514'; end if;
    if not exists (select 1 from sales.quote_versions v where v.quote_id = q.id and v.issued_at is not null) then
      raise exception 'Only an issued quote can be accepted, rejected or expired' using errcode = '23514';
    end if;
    if p_action = 'reject' and reason is null then raise exception 'A reason is required' using errcode = '23514'; end if;
    -- An outcome is recorded on the quote only. It is not a sale and does not
    -- move the opportunity: purchases and stage changes have their own commands.
    update sales.quotes set status = case p_action when 'accept' then 'accepted' when 'reject' then 'rejected' else 'expired' end
      where id = q.id returning * into q;
    perform sales.quote_note(q, q.status, null, null, coalesce(sales.quote_time(coalesce(p_input->>'occurred_at', now()::text), 'Outcome time'), now()), reason,
      '{}', p_request_id, format('Quote %s %s', coalesce(q.quote_number, 'without number'), q.status));
    result := jsonb_build_object('quote_id', q.id, 'status', q.status);

  elsif p_action = 'reopen' then
    if q.status not in ('accepted','rejected','expired') then raise exception 'Only a quote with an outcome can be reopened' using errcode = '23514'; end if;
    if reason is null then raise exception 'A reason is required' using errcode = '23514'; end if;
    update sales.quotes set status = 'draft' where id = q.id;
    perform sales.quote_refresh_status(q.id);
    select * into q from sales.quotes where id = q.id;
    perform sales.quote_note(q, 'reopened', null, null, now(), reason, jsonb_build_object('previous_status', before_q->>'status'), p_request_id,
      format('Quote %s reopened', coalesce(q.quote_number, 'without number')));
    result := jsonb_build_object('quote_id', q.id, 'status', q.status);

  elsif p_action = 'link' then
    if reason is null then raise exception 'A reason is required' using errcode = '23514'; end if;
    perform sales.quote_anchors(ws, q.opportunity_id, q.lead_id, q.visit_id);
    select * into a from sales.quote_anchors(ws,
      case when p_input ? 'opportunity_id' then nullif(p_input->>'opportunity_id', '')::uuid else q.opportunity_id end,
      case when p_input ? 'lead_id' then nullif(p_input->>'lead_id', '')::uuid else q.lead_id end,
      case when p_input ? 'visit_id' then nullif(p_input->>'visit_id', '')::uuid else q.visit_id end);
    update sales.quotes set opportunity_id = a.opportunity_id, lead_id = a.lead_id, visit_id = a.visit_id, contact_id = a.contact_id, account_id = a.account_id
      where id = q.id returning * into q;
    perform sales.quote_note(q, 'anchors_changed', null, null, now(), reason,
      jsonb_build_object('before', jsonb_build_object('opportunity_id', before_q->'opportunity_id', 'lead_id', before_q->'lead_id', 'visit_id', before_q->'visit_id'),
        'after', jsonb_build_object('opportunity_id', q.opportunity_id, 'lead_id', q.lead_id, 'visit_id', q.visit_id)), p_request_id,
      format('Quote %s links changed', coalesce(q.quote_number, 'without number')));
    result := jsonb_build_object('quote_id', q.id);

  elsif p_action = 'resolve_evidence' then
    select * into vis from sales.visits where id = nullif(p_input->>'visit_id', '')::uuid and workspace_id = ws for update;
    if not found then raise exception 'Visit not found' using errcode = '42501'; end if;
    if nullif(p_input->>'file_id', '') is not null then
      select * into f from sales.visit_quotation_files where id = (p_input->>'file_id')::uuid and visit_id = vis.id and uploaded_at is not null;
      if not found then raise exception 'Quotation file not found on this visit' using errcode = '42501'; end if;
      ev_kind := 'file'; snap := jsonb_build_object('file_name', f.file_name, 'file_size', f.file_size);
    else
      if vis.quotation_ref is null and vis.quotation_amount is null then raise exception 'This visit has no quotation note to review' using errcode = '23514'; end if;
      ev_kind := 'reference'; snap := jsonb_build_object('reference_text', vis.quotation_ref, 'amount', vis.quotation_amount);
    end if;
    ev_key := ev_kind || ':' || coalesce(f.id, vis.id)::text;
    perform pg_advisory_xact_lock(hashtextextended(ev_key, 0));
    select x.* into cur_decision from sales.visit_quote_evidence_decisions x
      where x.evidence_key = ev_key and not exists (select 1 from sales.visit_quote_evidence_decisions y where y.supersedes_id = x.id);
    if cur_decision.id is distinct from nullif(p_input->>'expected_decision_id', '')::uuid then
      raise exception 'Someone else reviewed this evidence. Refresh and try again' using errcode = '40001';
    end if;
    resolution := p_input->>'resolution';
    if resolution = 'create_prepared' then
      -- A reviewed, unverified prepared record: never issued or sent here.
      if ev_kind = 'reference' then
        select r.quote_id into ref_quote from sales.quote_references r where r.workspace_id = ws and r.ref_key = core.quote_ref_key(vis.quotation_ref);
        if ref_quote is not null then raise exception 'This SQ number already belongs to a quote. Link the evidence to it instead' using errcode = '23505', detail = ref_quote::text; end if;
      end if;
      select * into a from sales.quote_anchors(ws, null, vis.lead_id, vis.id);
      insert into sales.quotes (workspace_id, opportunity_id, lead_id, visit_id, contact_id, account_id, quote_number, status, current_version_no, origin, created_by)
      values (ws, a.opportunity_id, a.lead_id, a.visit_id, a.contact_id, a.account_id, nullif(btrim(p_input->>'quote_number'), ''), 'draft', 0, 'visit_review', uid)
      returning * into q;
      perform sales.quote_register_ref(ws, q.id, q.quote_number, 'quote_number');
      result := sales.quote_add_version(q, jsonb_build_object(
          'currency', p_input->>'currency',
          'total_amount', case when ev_kind = 'reference' then vis.quotation_amount end,
          'external_ref', case when ev_kind = 'reference' then vis.quotation_ref end,
          'prepared_at', vis.occurred_at,
          'notes', 'Created from visit evidence by review; contents and sending not verified.'),
        'unverified_historical', p_request_id);
      link_quote := q.id; link_version := (result->>'version_id')::uuid; resolution := 'linked';
    elsif resolution = 'link' then
      select * into q from sales.quotes where id = nullif(p_input->>'quote_id', '')::uuid and workspace_id = ws;
      if not found then raise exception 'Quote not found' using errcode = '42501'; end if;
      perform sales.quote_anchors(ws, q.opportunity_id, q.lead_id, q.visit_id);
      if nullif(p_input->>'version_id', '') is not null and not exists (
        select 1 from sales.quote_versions v where v.id = (p_input->>'version_id')::uuid and v.quote_id = q.id) then
        raise exception 'That version belongs to a different quote' using errcode = '23514';
      end if;
      if ev_kind = 'reference' then
        select r.quote_id into ref_quote from sales.quote_references r where r.workspace_id = ws and r.ref_key = core.quote_ref_key(vis.quotation_ref);
        if ref_quote is not null and ref_quote <> q.id then raise exception 'This SQ number belongs to a different quote' using errcode = '23514'; end if;
      end if;
      link_quote := q.id; link_version := nullif(p_input->>'version_id', '')::uuid; resolution := 'linked';
      result := jsonb_build_object('quote_id', q.id, 'version_id', link_version);
    elsif resolution in ('unresolved','not_a_quote') then
      if reason is null then raise exception 'A reason is required' using errcode = '23514'; end if;
      result := '{}';
    else
      raise exception 'Choose how to resolve this evidence' using errcode = '23514';
    end if;
    insert into sales.visit_quote_evidence_decisions (workspace_id, visit_id, evidence_kind, file_id, resolution, quote_id, quote_version_id, snapshot, reason, supersedes_id, decided_by)
    values (ws, vis.id, ev_kind, f.id, resolution, link_quote, link_version, snap, reason, cur_decision.id, uid)
    returning id into decision_id;
    perform audit.emit(ws, 'quote.resolve_evidence', 'sales', 'visit_quote_evidence_decisions', decision_id, to_jsonb(cur_decision),
      (select to_jsonb(x) from sales.visit_quote_evidence_decisions x where x.id = decision_id), reason, coalesce(result, '{}'));
    if link_quote is not null then
      select * into q from sales.quotes where id = link_quote;
      perform sales.quote_note(q, 'evidence_linked', (result->>'version_id')::uuid, null, now(), reason,
        jsonb_build_object('visit_id', vis.id, 'evidence_kind', ev_kind, 'file_id', f.id, 'decision_id', decision_id), p_request_id,
        format('Visit quotation %s linked to quote %s', ev_kind, coalesce(q.quote_number, 'without number')));
    end if;
    result := result || jsonb_build_object('decision_id', decision_id, 'resolution', resolution);
  end if;

  if q.id is not null and p_action <> 'resolve_evidence' then
    perform audit.emit(ws, 'quote.' || p_action, 'sales', 'quotes', q.id, before_q, (select to_jsonb(x) from sales.quotes x where x.id = q.id), reason, coalesce(result, '{}'));
  end if;
  insert into sales.quote_requests (workspace_id, request_id, actor_id, payload, result) values (ws, p_request_id, uid, payload, result);
  return result;
end $$;
revoke all on function api.quote_command(text,jsonb,uuid) from public, anon;
grant execute on function api.quote_command(text,jsonb,uuid) to authenticated;
comment on function api.quote_command(text,jsonb,uuid) is
  'Every quotation write. prepare/revise add a prepared version (optionally issue/send objects in the same transaction); issue; send (append-only delivery, deduplicated on version+channel+time); void_send; accept/reject/expire/reopen (outcome only, never a sale); link (change anchors, history kept); resolve_evidence (visit note or file -> linked / create_prepared / unresolved / not_a_quote). Idempotent on p_request_id.';
