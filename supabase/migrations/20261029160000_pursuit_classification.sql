-- TILE-4: buyer role and project segmentation on the buying pursuit.
--
-- A pursuit is one buying inquiry and, once converted, its opportunity. The
-- lead and its opportunity carry the same classification (kept in step by
-- trigger), so a pursuit is counted once however many stakeholders, visits or
-- messages it collects, and one person can hold a different role in each of
-- their pursuits. A contact's customer_type stays a fact about the person; it
-- is never copied onto a pursuit.
--
-- Four independent dimensions, each with an explicit Unknown:
--   buyer_role        who is buying in this pursuit
--   project_use       what the finished space is used for
--   work_type         new build or renovation
--   glc_involvement   whether a government-linked company is a party, and if
--                     so, glc_party_role says which party
-- A residential job for a GLC is residential + GLC yes: one pursuit, counted
-- once per dimension, never in a combined "institutional" bucket.
--
-- Unknown is a stated state, not a default fact: a raw inquiry saves with
-- unknown values, qualification must classify or explicitly flag what is
-- missing, and a later source that disagrees with a recorded value is held as
-- a conflict for review instead of overwriting it.

------------------------------------------------------------------------------
-- 1. Taxonomy. Configuration lives in one table that the UI, the commands and
--    the importers all read; src/features/classification/taxonomy.ts mirrors it.
------------------------------------------------------------------------------
create table core.classification_values (
  dimension text not null check (dimension in ('buyer_role','project_use','work_type','glc_involvement','glc_party_role')),
  key text not null check (key ~ '^[a-z][a-z_]*$'),
  label text not null,
  hint text not null check (length(btrim(hint)) > 0),
  -- Reporting rows group on this. Legacy roles keep their own group: they are
  -- preserved as recorded, never folded into another role.
  reporting_group text not null,
  -- Offered when capturing new work. Legacy values stay valid on existing
  -- records and in imports but are not offered as a first choice.
  is_primary boolean not null default true,
  is_legacy boolean not null default false,
  -- Source spellings (lower case, single spaces) that mean exactly this value.
  aliases text[] not null default '{}',
  position int not null,
  primary key (dimension, key)
);
alter table core.classification_values enable row level security;
create policy anyone_read on core.classification_values for select to authenticated using (true);
grant select on core.classification_values to authenticated;
grant all on core.classification_values to service_role;

insert into core.classification_values(dimension,key,label,hint,reporting_group,is_primary,is_legacy,aliases,position) values
  ('buyer_role','end_user','End user','The person or business that will use the finished space, such as a homeowner or a shop owner.','end_user',true,false,array['end user','enduser','homeowner','home owner'],1),
  ('buyer_role','contractor','Contractor','A contractor buying or specifying for a client''s job.','contractor',true,false,array['main contractor','sub contractor','subcontractor'],2),
  ('buyer_role','interior_designer','Interior designer','An interior designer specifying for a client''s job.','interior_designer',true,false,array['interior designer','designer','id'],3),
  ('buyer_role','developer','Developer','Property developer. Kept from earlier records; reported as its own group.','developer',false,true,array['property developer'],4),
  ('buyer_role','architect','Architect','Architect. Kept from earlier records; reported as its own group.','architect',false,true,array[]::text[],5),
  ('buyer_role','retailer','Retailer','Retailer or dealer. Kept from earlier records; reported as its own group.','retailer',false,true,array['retail'],6),
  ('buyer_role','other','Other','Known, but none of the listed roles. Say who in the note.','other',true,false,array[]::text[],7),
  ('buyer_role','unknown','Unknown','Not yet established. Counted as unknown in reports, never guessed.','unknown',true,false,array['not sure','not known'],8),
  ('project_use','residential','Residential','Homes: landed houses, condominiums, apartments.','residential',true,false,array[]::text[],1),
  ('project_use','commercial','Commercial','Offices, shops, retail and other business premises.','commercial',true,false,array[]::text[],2),
  ('project_use','hospitality','Hospitality','Hotels, resorts and serviced accommodation.','hospitality',true,false,array[]::text[],3),
  ('project_use','mixed','Mixed use','One project combining more than one use, such as shops below homes.','mixed',true,false,array['mixed use','mixed development'],4),
  ('project_use','other','Other','Known, but none of the listed uses. Say which in the note.','other',true,false,array[]::text[],5),
  ('project_use','unknown','Unknown','Not yet established. Counted as unknown in reports, never guessed.','unknown',true,false,array['not sure','not known'],6),
  ('work_type','new_build','New build','A new building or a first fit-out.','new_build',true,false,array['new build','new construction'],1),
  ('work_type','renovation','Renovation','Changing or replacing finishes in an existing space.','renovation',true,false,array['reno','refurbishment'],2),
  ('work_type','other','Other','Known, but neither a new build nor a renovation.','other',true,false,array[]::text[],3),
  ('work_type','unknown','Unknown','Not yet established. Counted as unknown in reports, never guessed.','unknown',true,false,array['not sure','not known'],4),
  ('glc_involvement','yes','GLC involved','A government-linked company is a party to this project. Independent of project use.','yes',true,false,array['glc'],1),
  ('glc_involvement','no','No GLC','No government-linked company is a party to this project.','no',true,false,array['non glc','non-glc'],2),
  ('glc_involvement','unknown','Unknown','Not yet established whether a GLC is involved.','unknown',true,false,array['not sure','not known'],3),
  ('glc_party_role','end_client','End client','The GLC owns or will use the finished space.','end_client',true,false,array['client','owner'],1),
  ('glc_party_role','developer','Developer','The GLC is the developer.','developer',true,false,array[]::text[],2),
  ('glc_party_role','main_contractor','Main contractor','The GLC is the main contractor.','main_contractor',true,false,array['contractor'],3),
  ('glc_party_role','consultant','Consultant','The GLC is a consultant on the project.','consultant',true,false,array[]::text[],4),
  ('glc_party_role','other','Other','Another party role. Say which in the note.','other',true,false,array[]::text[],5),
  ('glc_party_role','unknown','Unknown','A GLC is involved but its role is not yet established.','unknown',true,false,array[]::text[],6);

create or replace view api.classification_values with (security_invoker = true) as
select * from core.classification_values;
grant select on api.classification_values to authenticated;

-- Maps a source spelling to a taxonomy key, or null when it means nothing we
-- know. Callers decide what an unmatched value means; this never guesses.
create function core.classification_key(p_dimension text, p_raw text) returns text
language sql stable set search_path = '' as $$
  select v.key from core.classification_values v
  where v.dimension = p_dimension and nullif(btrim(p_raw),'') is not null
    and (v.key = lower(btrim(p_raw))
      or regexp_replace(lower(btrim(p_raw)),'[[:space:]_-]+',' ','g') = any(v.aliases)
      or regexp_replace(lower(btrim(p_raw)),'[[:space:]_-]+',' ','g') = replace(v.key,'_',' '))
  order by v.position limit 1
$$;
grant execute on function core.classification_key(text,text) to authenticated, service_role;

------------------------------------------------------------------------------
-- 2. A contact's own customer type accepts the same role keys. The earlier
--    'homeowner' and 'designer' labels stay valid on the records that use them.
------------------------------------------------------------------------------
alter table identity.contacts drop constraint contacts_customer_type_check;
alter table identity.contacts add constraint contacts_customer_type_check check (customer_type in
  ('end_user','contractor','interior_designer','developer','architect','retailer','other','homeowner','designer'));
-- "Unknown" on a person is the absence of a value, so a later visit can still fill it.
create function identity.normalize_contact_customer_type() returns trigger language plpgsql set search_path = '' as $$
begin
  new.customer_type := nullif(nullif(btrim(new.customer_type),''),'unknown');
  return new;
end $$;
create trigger contacts_customer_type_normalize before insert or update of customer_type on identity.contacts
  for each row execute function identity.normalize_contact_customer_type();

------------------------------------------------------------------------------
-- 3. Classification on the pursuit: the lead and its opportunity.
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','opportunities'] loop
    execute format($f$alter table sales.%I
      add column buyer_role text not null default 'unknown',
      add column project_use text not null default 'unknown',
      add column work_type text not null default 'unknown',
      add column glc_involvement text not null default 'unknown',
      add column glc_party_role text,
      add column classification_state text not null default 'unreviewed'
        check (classification_state in ('unreviewed','complete','missing_flagged','conflict')),
      add column classification_basis text not null default 'legacy'
        check (classification_basis in ('legacy','capture','qualification','correction','walk_in','import','inherited','backfill')),
      add column classification_note text check (length(classification_note) <= 2000),
      add column classification_flagged_at timestamptz,
      add column classification_conflict jsonb check (classification_conflict is null or jsonb_typeof(classification_conflict) = 'object'),
      add column classification_version integer not null default 0,
      add column classification_updated_at timestamptz,
      add column classification_updated_by uuid references auth.users(id)$f$, t);
    execute format('create index %I on sales.%I(workspace_id, classification_state) where classification_state <> %L',
      t || '_classification_queue_idx', t, 'complete');
  end loop;
end $$;
comment on column sales.leads.buyer_role is 'Buyer role in this pursuit (core.classification_values). Independent of the contact''s own customer_type.';
comment on column sales.leads.classification_basis is 'How the current classification was last set. legacy = recorded before classification existed and not yet reviewed.';
comment on column sales.leads.classification_conflict is 'A later source (visit, import) that disagreed with a recorded value. Held for review; the recorded value is not overwritten.';

create table sales.classification_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  lead_id uuid references sales.leads(id) on delete cascade,
  opportunity_id uuid references sales.opportunities(id) on delete cascade,
  basis text not null,
  before_values jsonb,
  after_values jsonb not null,
  conflict jsonb,
  source_values jsonb,
  reason text,
  request_id uuid,
  actor_id uuid references auth.users(id),
  occurred_at timestamptz not null default now(),
  check (lead_id is not null or opportunity_id is not null)
);
create index classification_events_lead_idx on sales.classification_events(lead_id, occurred_at desc) where lead_id is not null;
create index classification_events_opp_idx on sales.classification_events(opportunity_id, occurred_at desc) where opportunity_id is not null;
alter table sales.classification_events enable row level security;
create policy member_read on sales.classification_events for select to authenticated using (
  workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('sales.read'))
  and ((lead_id is not null and lead_id in (select l.id from sales.leads l))
    or (opportunity_id is not null and opportunity_id in (select o.id from sales.opportunities o))));
grant select on sales.classification_events to authenticated;
create function sales.classification_history_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Classification history is append-only. Record a correction instead.' using errcode = '23514';
end $$;
create trigger classification_history_immutable before update on sales.classification_events
  for each row execute function sales.classification_history_immutable();
create or replace view api.classification_events with (security_invoker = true) as
select * from sales.classification_events;
grant select on api.classification_events to authenticated;

create table sales.classification_requests (
  workspace_id uuid not null references core.workspaces(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, request_id)
);
alter table sales.classification_requests enable row level security;
revoke all on sales.classification_requests from public, anon, authenticated;

create function sales.classification_values_of(p_role text, p_use text, p_work text, p_glc text, p_party text, p_state text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('buyer_role',p_role,'project_use',p_use,'work_type',p_work,
    'glc_involvement',p_glc,'glc_party_role',p_party,'classification_state',p_state)
$$;

-- Validation, state and versioning for every writer. Authenticated callers
-- reach these columns only through the classification commands.
create function sales.classification_before() returns trigger language plpgsql set search_path = '' as $$
declare v_bad text; v_complete boolean; v_changed boolean; v_lead uuid; src record;
begin
  -- The same function guards both tables; only an opportunity has lead_id.
  if tg_table_name = 'opportunities' then v_lead := (to_jsonb(new)->>'lead_id')::uuid; end if;
  if tg_op = 'UPDATE' and current_user in ('authenticated','anon') and
    row(new.buyer_role,new.project_use,new.work_type,new.glc_involvement,new.glc_party_role,new.classification_state,
        new.classification_basis,new.classification_note,new.classification_flagged_at,new.classification_conflict,
        new.classification_version,new.classification_updated_at,new.classification_updated_by)
    is distinct from
    row(old.buyer_role,old.project_use,old.work_type,old.glc_involvement,old.glc_party_role,old.classification_state,
        old.classification_basis,old.classification_note,old.classification_flagged_at,old.classification_conflict,
        old.classification_version,old.classification_updated_at,old.classification_updated_by) then
    raise exception 'Change a classification through the classification command so it is validated and kept in history' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and current_user in ('authenticated','anon') and new.classification_basis not in ('legacy','capture') then
    raise exception 'A new record can only be captured, not given another classification basis' using errcode = '42501';
  end if;

  -- An opportunity opened from an inquiry continues that pursuit.
  if tg_op = 'INSERT' and v_lead is not null
    and new.buyer_role = 'unknown' and new.project_use = 'unknown' and new.work_type = 'unknown' and new.glc_involvement = 'unknown' then
    select l.buyer_role, l.project_use, l.work_type, l.glc_involvement, l.glc_party_role, l.classification_note,
           l.classification_flagged_at, l.classification_conflict, l.classification_basis
      into src from sales.leads l where l.id = v_lead and l.workspace_id = new.workspace_id;
    if found then
      new.buyer_role := src.buyer_role; new.project_use := src.project_use; new.work_type := src.work_type;
      new.glc_involvement := src.glc_involvement; new.glc_party_role := src.glc_party_role;
      new.classification_note := src.classification_note; new.classification_flagged_at := src.classification_flagged_at;
      new.classification_conflict := src.classification_conflict;
      new.classification_basis := case when src.classification_basis = 'legacy' then 'legacy' else 'inherited' end;
    end if;
  end if;

  if new.glc_involvement = 'yes' then
    new.glc_party_role := coalesce(new.glc_party_role, 'unknown');
  elsif new.glc_party_role is not null then
    raise exception 'A GLC party role applies only when a GLC is involved' using errcode = '23514';
  end if;
  select string_agg(x.f, ', ' order by x.n) into v_bad
  from (values (1,'buyer_role',new.buyer_role),(2,'project_use',new.project_use),(3,'work_type',new.work_type),
               (4,'glc_involvement',new.glc_involvement),(5,'glc_party_role',new.glc_party_role)) x(n,f,v)
  where x.v is not null and not exists (select 1 from core.classification_values c where c.dimension = x.f and c.key = x.v);
  if v_bad is not null then
    raise exception 'Choose a listed value for: %', v_bad using errcode = '23514';
  end if;

  v_complete := new.buyer_role <> 'unknown' and new.project_use <> 'unknown' and new.work_type <> 'unknown'
    and new.glc_involvement <> 'unknown' and coalesce(new.glc_party_role,'') <> 'unknown';
  if v_complete then new.classification_flagged_at := null; end if;
  new.classification_state := case
    when new.classification_conflict is not null then 'conflict'
    when v_complete then 'complete'
    when new.classification_flagged_at is not null then 'missing_flagged'
    else 'unreviewed' end;

  if tg_op = 'INSERT' then
    if new.classification_basis = 'legacy' and tg_table_name = 'leads' then new.classification_basis := 'capture'; end if;
    if new.classification_basis = 'legacy' and tg_table_name = 'opportunities' and v_lead is null then new.classification_basis := 'capture'; end if;
    v_changed := new.buyer_role <> 'unknown' or new.project_use <> 'unknown' or new.work_type <> 'unknown'
      or new.glc_involvement <> 'unknown' or new.classification_state <> 'unreviewed';
  else
    v_changed := row(new.buyer_role,new.project_use,new.work_type,new.glc_involvement,new.glc_party_role,new.classification_state,new.classification_conflict)
      is distinct from row(old.buyer_role,old.project_use,old.work_type,old.glc_involvement,old.glc_party_role,old.classification_state,old.classification_conflict);
  end if;
  if v_changed then
    new.classification_version := case when tg_op = 'INSERT' then 1 else old.classification_version + 1 end;
    new.classification_updated_at := now();
    new.classification_updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.classification_version := old.classification_version;
    new.classification_updated_at := old.classification_updated_at;
    new.classification_updated_by := old.classification_updated_by;
  end if;
  return new;
end $$;
revoke all on function sales.classification_before() from public, anon, authenticated;

-- History for every change, and the paired record kept in step. A copy made
-- to keep the pair in step is not a second decision, so it writes no event.
create function sales.classification_after() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb; v_lead uuid; v_opp uuid; v_source text; v_request text;
begin
  if coalesce(current_setting('tile.classification_sync', true), '') = 'on' then return null; end if;
  v_after := sales.classification_values_of(new.buyer_role,new.project_use,new.work_type,new.glc_involvement,new.glc_party_role,new.classification_state);
  if tg_op = 'UPDATE' then
    v_before := sales.classification_values_of(old.buyer_role,old.project_use,old.work_type,old.glc_involvement,old.glc_party_role,old.classification_state);
    if v_before = v_after and new.classification_conflict is not distinct from old.classification_conflict then return null; end if;
  elsif new.classification_version = 0 then
    return null; -- a raw capture with nothing stated is not a classification event
  end if;
  if tg_table_name = 'leads' then
    v_lead := new.id; v_opp := (to_jsonb(new)->>'converted_opportunity_id')::uuid;
  else
    v_opp := new.id; v_lead := (to_jsonb(new)->>'lead_id')::uuid;
  end if;
  v_source := nullif(current_setting('tile.classification_source', true), '');
  v_request := nullif(current_setting('tile.classification_request', true), '');
  insert into sales.classification_events(workspace_id,lead_id,opportunity_id,basis,before_values,after_values,conflict,source_values,reason,request_id,actor_id)
  values (new.workspace_id, v_lead, v_opp, new.classification_basis, v_before, v_after, new.classification_conflict,
    v_source::jsonb, new.classification_note, v_request::uuid, auth.uid());

  perform set_config('tile.classification_sync', 'on', true);
  if tg_table_name = 'leads' and v_opp is not null then
    update sales.opportunities o set buyer_role = new.buyer_role, project_use = new.project_use, work_type = new.work_type,
      glc_involvement = new.glc_involvement, glc_party_role = new.glc_party_role, classification_basis = new.classification_basis,
      classification_note = new.classification_note, classification_flagged_at = new.classification_flagged_at,
      classification_conflict = new.classification_conflict
    where o.id = v_opp and o.workspace_id = new.workspace_id
      and row(o.buyer_role,o.project_use,o.work_type,o.glc_involvement,o.glc_party_role,o.classification_flagged_at,o.classification_conflict)
        is distinct from row(new.buyer_role,new.project_use,new.work_type,new.glc_involvement,new.glc_party_role,new.classification_flagged_at,new.classification_conflict);
  elsif tg_table_name = 'opportunities' and v_lead is not null then
    update sales.leads l set buyer_role = new.buyer_role, project_use = new.project_use, work_type = new.work_type,
      glc_involvement = new.glc_involvement, glc_party_role = new.glc_party_role, classification_basis = new.classification_basis,
      classification_note = new.classification_note, classification_flagged_at = new.classification_flagged_at,
      classification_conflict = new.classification_conflict
    where l.id = v_lead and l.workspace_id = new.workspace_id
      and (l.converted_opportunity_id is null or l.converted_opportunity_id = new.id)
      and row(l.buyer_role,l.project_use,l.work_type,l.glc_involvement,l.glc_party_role,l.classification_flagged_at,l.classification_conflict)
        is distinct from row(new.buyer_role,new.project_use,new.work_type,new.glc_involvement,new.glc_party_role,new.classification_flagged_at,new.classification_conflict);
  end if;
  perform set_config('tile.classification_sync', '', true);
  return null;
end $$;
revoke all on function sales.classification_after() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['leads','opportunities'] loop
    execute format('create trigger classification_before before insert or update on sales.%I for each row execute function sales.classification_before()', t);
    execute format('create trigger classification_after after insert or update on sales.%I for each row execute function sales.classification_after()', t);
  end loop;
end $$;

-- The api views pick up the new columns (appended, so existing columns keep their order).
create or replace view api.leads with (security_invoker = true) as select * from sales.leads;
create or replace view api.opportunities with (security_invoker = true) as select * from sales.opportunities;

------------------------------------------------------------------------------
-- 4. Commands.
------------------------------------------------------------------------------
create function sales.classification_label(p_dimension text) returns text language sql immutable set search_path = '' as $$
  select case p_dimension when 'buyer_role' then 'buyer role' when 'project_use' then 'project use' when 'work_type' then 'work type'
    when 'glc_involvement' then 'GLC involvement' when 'glc_party_role' then 'GLC party role' else p_dimension end
$$;

-- Classify one pursuit, given either its inquiry or its opportunity.
--   mode capture|qualification|correction; qualification also qualifies the
--   inquiry and refuses to proceed with an unknown unless it is flagged.
--   expected_version guards against a stale screen.
--   Changing or clearing a value that was already known, and dismissing a held
--   conflict, need a reason; filling an unknown does not.
create function api.classify_pursuit(p_input jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := core.current_workspace_id(); uid uuid := auth.uid();
  saved sales.classification_requests%rowtype; l sales.leads%rowtype; o sales.opportunities%rowtype;
  v_lead uuid; v_opp uuid; v_mode text; v_reason text; v_flag boolean;
  cur jsonb; nxt jsonb; cur_conflict jsonb; cur_flag timestamptz; cur_version integer;
  v_changed_known text; v_missing text; v_result jsonb; v_key text;
  v_order text[] := array['buyer_role','project_use','work_type','glc_involvement','glc_party_role'];
begin
  perform core.require_permission('sales.write');
  perform core.require_workspace(ws);
  if p_request_id is null or p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'A request ID and classification are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text || ':classification:' || p_request_id::text, 0));
  select * into saved from sales.classification_requests where workspace_id = ws and request_id = p_request_id;
  if found then
    if saved.actor_id <> uid or saved.payload is distinct from p_input then
      raise exception 'Request ID already used for a different classification' using errcode = '22023';
    end if;
    return saved.result;
  end if;

  v_lead := nullif(p_input->>'lead_id','')::uuid; v_opp := nullif(p_input->>'opportunity_id','')::uuid;
  v_mode := coalesce(p_input->>'mode','correction'); v_reason := nullif(btrim(p_input->>'reason'),'');
  v_flag := coalesce((p_input->>'flag_missing')::boolean, false);
  if (v_lead is null) = (v_opp is null) then
    raise exception 'Classify either the inquiry or the opportunity' using errcode = '22023';
  end if;
  if v_mode not in ('capture','qualification','correction') then
    raise exception 'Unknown classification mode' using errcode = '22023';
  end if;
  if length(coalesce(v_reason,'')) > 2000 then raise exception 'The note is too long' using errcode = '23514'; end if;
  foreach v_key in array array['buyer_role','project_use','work_type','glc_involvement'] loop
    if jsonb_typeof(p_input->v_key) is distinct from 'string' then
      raise exception 'State the % (choose Unknown when it is not known)', sales.classification_label(v_key) using errcode = '22023';
    end if;
  end loop;
  if p_input ? 'glc_party_role' and jsonb_typeof(p_input->'glc_party_role') not in ('string','null') then
    raise exception 'Choose a listed GLC party role' using errcode = '22023';
  end if;

  -- Lock order matches the rest of the sales commands: inquiry, then opportunity.
  if v_opp is not null then
    select lead_id into v_lead from sales.opportunities where id = v_opp and workspace_id = ws;
    if v_lead is not null then
      select * into l from sales.leads where id = v_lead and workspace_id = ws for update;
    end if;
    select * into o from sales.opportunities where id = v_opp and workspace_id = ws for update;
    if not found then raise exception 'Opportunity not found' using errcode = '42501'; end if;
    if not core.has_permission('sales.read_all') and o.owner_id is not null and o.owner_id <> uid then
      raise exception 'Only the owner or a sales manager can change this opportunity' using errcode = '42501';
    end if;
    cur := sales.classification_values_of(o.buyer_role,o.project_use,o.work_type,o.glc_involvement,o.glc_party_role,null);
    cur_conflict := o.classification_conflict; cur_flag := o.classification_flagged_at; cur_version := o.classification_version;
  else
    select * into l from sales.leads where id = v_lead and workspace_id = ws for update;
    if not found then raise exception 'Inquiry not found' using errcode = '42501'; end if;
    perform sales.require_lead_owner(l);
    if l.converted_opportunity_id is not null then
      select * into o from sales.opportunities where id = l.converted_opportunity_id and workspace_id = ws for update;
    end if;
    cur := sales.classification_values_of(l.buyer_role,l.project_use,l.work_type,l.glc_involvement,l.glc_party_role,null);
    cur_conflict := l.classification_conflict; cur_flag := l.classification_flagged_at; cur_version := l.classification_version;
  end if;
  if v_mode = 'qualification' then
    if p_input->>'opportunity_id' is not null then
      raise exception 'Qualify the inquiry, not the opportunity' using errcode = '22023';
    end if;
    if l.status in ('disqualified','duplicate') then
      raise exception 'Reopen the inquiry before qualifying it' using errcode = '23514';
    end if;
  end if;
  if (p_input->>'expected_version')::integer is distinct from cur_version then
    raise exception 'The classification changed since you opened it. Refresh and review it before saving.' using errcode = '40001';
  end if;

  nxt := jsonb_build_object('buyer_role',p_input->>'buyer_role','project_use',p_input->>'project_use','work_type',p_input->>'work_type',
    'glc_involvement',p_input->>'glc_involvement',
    'glc_party_role',case when p_input->>'glc_involvement' = 'yes' then coalesce(nullif(p_input->>'glc_party_role',''),'unknown') else nullif(p_input->>'glc_party_role','') end,
    'classification_state',null);

  select string_agg(sales.classification_label(c.key), ', ' order by array_position(v_order, c.key)) into v_changed_known
  from jsonb_each_text(cur - 'classification_state') c
  where c.value is not null and c.value <> 'unknown' and c.value is distinct from nxt->>c.key;
  if v_changed_known is not null and length(coalesce(v_reason,'')) < 5 then
    raise exception 'Explain why the % changed (at least 5 characters)', v_changed_known using errcode = '23514';
  end if;
  if cur_conflict is not null and length(coalesce(v_reason,'')) < 5 then
    raise exception 'Explain how the conflicting classification was resolved (at least 5 characters)' using errcode = '23514';
  end if;

  select string_agg(sales.classification_label(c.key), ', ' order by array_position(v_order, c.key)) into v_missing
  from jsonb_each_text(nxt - 'classification_state') c where c.value = 'unknown';
  if v_missing is null then v_flag := false; end if;
  if v_flag and length(coalesce(v_reason,'')) < 3 then
    raise exception 'Say what is missing and why (at least 3 characters)' using errcode = '23514';
  end if;
  if v_mode = 'qualification' and v_missing is not null and not v_flag then
    raise exception 'Classify the % or flag it as missing before qualifying', v_missing using errcode = '23514';
  end if;

  perform set_config('tile.classification_request', p_request_id::text, true);
  if v_opp is not null then
    update sales.opportunities set buyer_role = nxt->>'buyer_role', project_use = nxt->>'project_use', work_type = nxt->>'work_type',
      glc_involvement = nxt->>'glc_involvement', glc_party_role = nxt->>'glc_party_role', classification_basis = v_mode,
      classification_note = v_reason, classification_conflict = null,
      classification_flagged_at = case when v_flag then coalesce(cur_flag, now()) end
    where id = o.id;
  else
    update sales.leads set buyer_role = nxt->>'buyer_role', project_use = nxt->>'project_use', work_type = nxt->>'work_type',
      glc_involvement = nxt->>'glc_involvement', glc_party_role = nxt->>'glc_party_role', classification_basis = v_mode,
      classification_note = v_reason, classification_conflict = null,
      classification_flagged_at = case when v_flag then coalesce(cur_flag, now()) end
    where id = l.id;
  end if;
  perform set_config('tile.classification_request', '', true);

  if v_mode = 'qualification' then
    update sales.leads set status = case when status in ('new','contact_attempted','contacted') then 'qualified' else status end,
      qualified_at = coalesce(qualified_at, now()) where id = l.id;
    insert into sales.activities(workspace_id,kind,subject,body,actor_id,lead_id,contact_id,metadata)
    values (ws,'note','Inquiry qualified',v_reason,uid,l.id,l.contact_id,
      jsonb_build_object('event','inquiry_qualified','missing',v_missing,'flagged',v_flag));
  end if;

  if v_opp is not null then
    select jsonb_build_object('lead_id',x.lead_id,'opportunity_id',x.id,'classification_state',x.classification_state,'classification_version',x.classification_version)
      into v_result from sales.opportunities x where x.id = o.id;
  else
    select jsonb_build_object('lead_id',x.id,'opportunity_id',x.converted_opportunity_id,'classification_state',x.classification_state,'classification_version',x.classification_version)
      into v_result from sales.leads x where x.id = l.id;
  end if;
  perform audit.emit(ws,'pursuit.classified','sales',case when v_opp is null then 'leads' else 'opportunities' end,coalesce(v_opp,v_lead),
    cur, nxt, v_reason, jsonb_build_object('mode',v_mode,'flagged',v_flag));
  insert into sales.classification_requests(workspace_id,request_id,actor_id,payload,result) values (ws,p_request_id,uid,p_input,v_result);
  return v_result;
end $$;
revoke all on function api.classify_pursuit(jsonb,uuid) from public, anon;
grant execute on function api.classify_pursuit(jsonb,uuid) to authenticated;

------------------------------------------------------------------------------
-- 5. A showroom visit states the buyer role for the inquiry it belongs to.
--    It fills an unknown; when the inquiry already says something else it is
--    held as a conflict and the recorded value stands until someone decides.
--    Visits linked before this existed (legacy links) are not re-read.
------------------------------------------------------------------------------
create function sales.classify_from_visit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_key text; l sales.leads%rowtype;
begin
  if new.lead_id is null or nullif(btrim(new.customer_type),'') is null or new.inquiry_link_state = 'legacy' then return null; end if;
  if tg_op = 'UPDATE' and new.lead_id is not distinct from old.lead_id then return null; end if;
  v_key := core.classification_key('buyer_role', new.customer_type);
  if v_key is null or v_key = 'unknown' then return null; end if;
  select * into l from sales.leads where id = new.lead_id and workspace_id = new.workspace_id for update;
  if not found or l.buyer_role = v_key then return null; end if;
  perform set_config('tile.classification_source',
    jsonb_build_object('visit_id',new.id,'customer_type',new.customer_type,'visit_at',new.occurred_at)::text, true);
  if l.buyer_role = 'unknown' then
    update sales.leads set buyer_role = v_key, classification_basis = 'walk_in',
      classification_note = 'Buyer role recorded at a showroom visit' where id = l.id;
  else
    update sales.leads set classification_basis = 'walk_in',
      classification_note = 'A showroom visit recorded a different buyer role',
      classification_conflict = coalesce(classification_conflict,'{}'::jsonb) || jsonb_build_object('buyer_role',
        jsonb_build_object('recorded',l.buyer_role,'proposed',v_key,'source','walk_in','source_value',new.customer_type,
          'visit_id',new.id,'at',new.occurred_at))
    where id = l.id;
  end if;
  perform set_config('tile.classification_source', '', true);
  return null;
end $$;
revoke all on function sales.classify_from_visit() from public, anon, authenticated;
create trigger classify_from_visit after insert or update of lead_id on sales.visits
  for each row execute function sales.classify_from_visit();

------------------------------------------------------------------------------
-- 6. Pursuit grain, review queue and report.
------------------------------------------------------------------------------
-- One row per pursuit: an opportunity (with its inquiry, if any), or an
-- inquiry that has not become one. Duplicates belong to their original.
create view sales.pursuits as
select o.workspace_id, o.id as pursuit_id, 'opportunity'::text as pursuit_kind, o.lead_id, o.id as opportunity_id,
  coalesce(l.created_at, o.created_at) as arrived_at, o.owner_id, o.contact_id, o.account_id, o.project_id,
  o.buyer_role, o.project_use, o.work_type, o.glc_involvement, o.glc_party_role,
  o.classification_state, o.classification_basis, o.classification_version
from sales.opportunities o
left join sales.leads l on l.id = o.lead_id and l.workspace_id = o.workspace_id
where o.archived_at is null
union all
select l.workspace_id, l.id, 'inquiry', l.id, null, l.created_at, l.owner_id, l.contact_id, l.account_id, null,
  l.buyer_role, l.project_use, l.work_type, l.glc_involvement, l.glc_party_role,
  l.classification_state, l.classification_basis, l.classification_version
from sales.leads l
where l.status <> 'duplicate' and l.duplicate_of_lead_id is null and l.converted_opportunity_id is null
  and not exists (select 1 from sales.opportunities o where o.lead_id = l.id and o.workspace_id = l.workspace_id);
revoke all on sales.pursuits from public, anon, authenticated;

-- Pursuits that need a person: a held conflict, missing values flagged at
-- qualification, or past qualification without a full classification
-- (including records from before classification existed).
create view api.classification_queue with (security_invoker = true) as
select o.workspace_id, 'opportunity'::text as subject_type, o.id as subject_id, o.lead_id, o.id as opportunity_id,
  o.name as title, o.status as pursuit_status, o.owner_id, o.contact_id,
  coalesce(l.created_at, o.created_at) as arrived_at,
  o.buyer_role, o.project_use, o.work_type, o.glc_involvement, o.glc_party_role,
  o.classification_state, o.classification_basis, o.classification_note, o.classification_flagged_at,
  o.classification_conflict, o.classification_version, o.classification_updated_at
from sales.opportunities o
left join sales.leads l on l.id = o.lead_id and l.workspace_id = o.workspace_id
where o.archived_at is null and o.classification_state <> 'complete'
union all
select l.workspace_id, 'inquiry', l.id, l.id, null,
  coalesce(nullif(l.raw_name,''), nullif(l.raw_company,''), 'Inquiry'), l.status, l.owner_id, l.contact_id,
  l.created_at,
  l.buyer_role, l.project_use, l.work_type, l.glc_involvement, l.glc_party_role,
  l.classification_state, l.classification_basis, l.classification_note, l.classification_flagged_at,
  l.classification_conflict, l.classification_version, l.classification_updated_at
from sales.leads l
where l.converted_opportunity_id is null and l.status <> 'duplicate' and l.duplicate_of_lead_id is null
  and (l.classification_state in ('conflict','missing_flagged') or (l.status = 'qualified' and l.classification_state <> 'complete'));
grant select on api.classification_queue to authenticated;

create function api.report_pursuit_segments(p_from date default null, p_to date default null, p_grain text default 'week')
returns table (period_start date, period_end date, dimension text, dimension_label text, value text, value_label text, is_legacy boolean,
  pursuits bigint, complete bigint, unreviewed bigint, missing_flagged bigint, conflict bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_grain text := coalesce(p_grain,'week'); v_step interval; v_from timestamptz; v_to timestamptz;
begin
  if auth.uid() is null or not core.has_permission('report.read') then
    raise exception 'Permission denied: report.read' using errcode = '42501';
  end if;
  if v_grain not in ('day','week','month') then
    raise exception 'Choose a daily, weekly or monthly breakdown' using errcode = '23514';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The period must start before it ends' using errcode = '23514';
  end if;
  v_step := case v_grain when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end;
  v_from := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Kuala_Lumpur' end;
  v_to := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur' end;
  return query
  with p as (
    select date_trunc(v_grain, x.arrived_at at time zone 'Asia/Kuala_Lumpur')::date as bucket, x.*
    from sales.pursuits x
    where x.workspace_id in (select core.member_workspace_ids())
      and (v_from is null or x.arrived_at >= v_from) and (v_to is null or x.arrived_at < v_to)
  ), cells as (
    select p.bucket, d.dimension, d.value, p.classification_state
    from p cross join lateral (values ('buyer_role',p.buyer_role),('project_use',p.project_use),('work_type',p.work_type),
      ('glc_involvement',p.glc_involvement),('glc_party_role',p.glc_party_role)) d(dimension,value)
    where d.value is not null
  )
  select c.bucket, (c.bucket + v_step - interval '1 day')::date, c.dimension,
    case c.dimension when 'buyer_role' then 'Buyer role' when 'project_use' then 'Project use' when 'work_type' then 'Work type'
      when 'glc_involvement' then 'GLC involvement' else 'GLC party role' end,
    c.value, coalesce(cv.label, c.value), coalesce(cv.is_legacy,false),
    count(*), count(*) filter (where c.classification_state = 'complete'), count(*) filter (where c.classification_state = 'unreviewed'),
    count(*) filter (where c.classification_state = 'missing_flagged'), count(*) filter (where c.classification_state = 'conflict')
  from cells c left join core.classification_values cv on cv.dimension = c.dimension and cv.key = c.value
  group by c.bucket, c.dimension, c.value, cv.label, cv.is_legacy, cv.position
  order by c.bucket desc, array_position(array['buyer_role','project_use','work_type','glc_involvement','glc_party_role'], c.dimension), cv.position;
end $$;
revoke all on function api.report_pursuit_segments(date,date,text) from public, anon;
grant execute on function api.report_pursuit_segments(date,date,text) to authenticated;

insert into reporting.metric_definitions (key, name, report_key, formula, grain, sources, pii_class, caveat, quality) values
  ('pursuit_segments', 'Pursuits by buyer role and project segment', 'pursuit_segments',
   'Count of pursuits (an opportunity, or an inquiry that has not become one) by arrival period and by each classification value; each pursuit is counted once per dimension',
   'Pursuit', array['sales.leads','sales.opportunities','core.classification_values'], 'aggregate',
   'Unknown is reported as Unknown, never spread across other values. Records from before classification existed stay Unknown until reviewed or backfilled.', 'monitored')
on conflict (key) do nothing;
