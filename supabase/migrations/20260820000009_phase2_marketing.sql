-- Phase 2 — Marketing Opportunities and Shoot Calendar (PRD §7.11, §17).
-- Nomination, media permission, tentative/confirmed bookings with conflict
-- detection, rescheduling history, outcomes, and asset review gates.

------------------------------------------------------------------------------
-- Nominate an existing customer project for content work.
-- Never creates a customer, project, or opportunity record.
------------------------------------------------------------------------------
create or replace function api.nominate_content_opportunity(
  p_project_id uuid,
  p_content_types text[],
  p_story_angle text default null,
  p_nomination_reason text default null,
  p_readiness_state text default 'in_progress',
  p_target_window_start date default null,
  p_target_window_end date default null,
  p_priority text default 'normal',
  p_products_used text[] default '{}',
  p_site_notes text default null,
  p_interview_subjects text default null,
  p_special_requirements text default null,
  p_opportunity_id uuid default null,
  p_purchase_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  pr identity.projects%rowtype;
  v_id uuid;
begin
  perform core.require_permission('marketing.write');
  select * into pr from identity.projects where id = p_project_id;
  if not found then raise exception 'project not found'; end if;
  perform core.require_workspace(pr.workspace_id);
  if coalesce(array_length(p_content_types, 1), 0) = 0 then
    raise exception 'at least one content type is required' using errcode = '23514';
  end if;

  insert into marketing.content_opportunities (
    workspace_id, project_id, contact_id, account_id, opportunity_id, purchase_id,
    nominated_by, customer_owner_id, status, story_angle, nomination_reason, content_types,
    readiness_state, target_window_start, target_window_end, priority, products_used,
    site_notes, interview_subjects, special_requirements)
  values (
    pr.workspace_id, p_project_id, pr.primary_contact_id, pr.account_id, p_opportunity_id, p_purchase_id,
    auth.uid(), coalesce(pr.owner_id, auth.uid()), 'nominated', p_story_angle, p_nomination_reason, coalesce(p_content_types, '{}'),
    coalesce(p_readiness_state, 'in_progress'), p_target_window_start, p_target_window_end, coalesce(p_priority, 'normal'), coalesce(p_products_used, '{}'),
    p_site_notes, p_interview_subjects, p_special_requirements)
  returning id into v_id;

  insert into marketing.content_opportunity_status_events (content_opportunity_id, from_status, to_status, reason, actor_id)
  values (v_id, null, 'nominated', p_nomination_reason, auth.uid());

  -- The permission record exists from the start so its state is always visible.
  insert into marketing.media_permission_records (workspace_id, content_opportunity_id, contact_id, account_id, status, recorded_by)
  values (pr.workspace_id, v_id, pr.primary_contact_id, pr.account_id, 'not_requested', auth.uid());

  insert into sales.activities (workspace_id, kind, subject, body, actor_id, contact_id, account_id, project_id, opportunity_id, metadata)
  values (pr.workspace_id, 'system', 'Nominated for marketing content', p_story_angle, auth.uid(), pr.primary_contact_id, pr.account_id, p_project_id, p_opportunity_id,
          jsonb_build_object('content_opportunity_id', v_id, 'content_types', p_content_types));

  perform audit.emit(pr.workspace_id, 'content_opportunity.nominated', 'marketing', 'content_opportunities', v_id, null,
    jsonb_build_object('project_id', p_project_id, 'content_types', p_content_types), p_nomination_reason, '{}'::jsonb);
  return v_id;
end $$;
grant execute on function api.nominate_content_opportunity(uuid,text[],text,text,text,date,date,text,text[],text,text,text,uuid,uuid) to authenticated;

------------------------------------------------------------------------------
-- Review decision on a nomination (accept / needs info / defer / decline).
------------------------------------------------------------------------------
create or replace function api.set_content_opportunity_status(p_id uuid, p_status text, p_reason text default null, p_marketing_owner_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare co marketing.content_opportunities%rowtype;
begin
  perform core.require_permission('marketing.write');
  select * into co from marketing.content_opportunities where id = p_id for update;
  if not found then raise exception 'content opportunity not found'; end if;
  perform core.require_workspace(co.workspace_id);
  if p_status not in ('nominated','under_review','needs_info','accepted','deferred','declined','scheduled','completed','cancelled') then
    raise exception 'unknown status %', p_status using errcode = '23514';
  end if;
  if p_status in ('declined','deferred','cancelled') and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required to decline, defer or cancel' using errcode = '23514';
  end if;

  update marketing.content_opportunities
  set status = p_status,
      marketing_owner_id = coalesce(p_marketing_owner_id, marketing_owner_id, case when p_status in ('accepted','scheduled') then auth.uid() end)
  where id = p_id;

  insert into marketing.content_opportunity_status_events (content_opportunity_id, from_status, to_status, reason, actor_id)
  values (p_id, co.status, p_status, p_reason, auth.uid());

  perform audit.emit(co.workspace_id, 'content_opportunity.status_changed', 'marketing', 'content_opportunities', p_id,
    jsonb_build_object('status', co.status), jsonb_build_object('status', p_status), p_reason, '{}'::jsonb);
end $$;
grant execute on function api.set_content_opportunity_status(uuid,text,text,uuid) to authenticated;

create or replace function api.set_project_readiness(p_id uuid, p_readiness text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare co marketing.content_opportunities%rowtype;
begin
  perform core.require_permission('marketing.write');
  select * into co from marketing.content_opportunities where id = p_id;
  if not found then raise exception 'content opportunity not found'; end if;
  perform core.require_workspace(co.workspace_id);
  update marketing.content_opportunities set readiness_state = p_readiness where id = p_id;
  perform audit.emit(co.workspace_id, 'content_opportunity.readiness_changed', 'marketing', 'content_opportunities', p_id,
    jsonb_build_object('readiness_state', co.readiness_state), jsonb_build_object('readiness_state', p_readiness), p_note, '{}'::jsonb);
end $$;
grant execute on function api.set_project_readiness(uuid,text,text) to authenticated;

------------------------------------------------------------------------------
-- Media permission (PRD §7.11): separate from contact consent, with scope,
-- evidence, restrictions, expiry and revocation. Publishing gates on it.
------------------------------------------------------------------------------
create or replace function api.record_media_permission(
  p_content_opportunity_id uuid,
  p_status text,
  p_granted_by_name text default null,
  p_permitted_capture text[] default '{}',
  p_permitted_uses text[] default '{}',
  p_restrictions text default null,
  p_expires_at date default null,
  p_evidence_storage_path text default null,
  p_granted_at timestamptz default null,
  p_revocation_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  co marketing.content_opportunities%rowtype;
  rec marketing.media_permission_records%rowtype;
begin
  perform core.require_permission('marketing.write');
  select * into co from marketing.content_opportunities where id = p_content_opportunity_id;
  if not found then raise exception 'content opportunity not found'; end if;
  perform core.require_workspace(co.workspace_id);
  if p_status not in ('not_requested','requested','verbal_pending_written','approved','approved_with_restrictions','declined','revoked','expired') then
    raise exception 'unknown permission status %', p_status using errcode = '23514';
  end if;
  if p_status in ('approved','approved_with_restrictions') then
    if nullif(trim(coalesce(p_granted_by_name, '')), '') is null then
      raise exception 'record who granted the permission' using errcode = '23514';
    end if;
    if coalesce(array_length(p_permitted_uses, 1), 0) = 0 then
      raise exception 'record at least one permitted use' using errcode = '23514';
    end if;
  end if;
  if p_status = 'approved_with_restrictions' and nullif(trim(coalesce(p_restrictions, '')), '') is null then
    raise exception 'describe the restrictions' using errcode = '23514';
  end if;
  if p_status = 'revoked' and nullif(trim(coalesce(p_revocation_reason, '')), '') is null then
    raise exception 'revocation reason required' using errcode = '23514';
  end if;

  select * into rec from marketing.media_permission_records where content_opportunity_id = p_content_opportunity_id order by created_at limit 1 for update;
  if not found then
    insert into marketing.media_permission_records (workspace_id, content_opportunity_id, contact_id, account_id, status, recorded_by)
    values (co.workspace_id, p_content_opportunity_id, co.contact_id, co.account_id, 'not_requested', auth.uid())
    returning * into rec;
  end if;

  update marketing.media_permission_records set
    status = p_status,
    granted_by_name = coalesce(p_granted_by_name, granted_by_name),
    granted_at = case when p_status in ('approved','approved_with_restrictions') then coalesce(p_granted_at, granted_at, now()) else granted_at end,
    permitted_capture = case when coalesce(array_length(p_permitted_capture, 1), 0) > 0 then p_permitted_capture else permitted_capture end,
    permitted_uses = case when coalesce(array_length(p_permitted_uses, 1), 0) > 0 then p_permitted_uses else permitted_uses end,
    restrictions = coalesce(p_restrictions, restrictions),
    expires_at = coalesce(p_expires_at, expires_at),
    evidence_storage_path = coalesce(p_evidence_storage_path, evidence_storage_path),
    revoked_at = case when p_status = 'revoked' then now() else revoked_at end,
    revocation_reason = case when p_status = 'revoked' then p_revocation_reason else revocation_reason end,
    recorded_by = auth.uid()
  where id = rec.id;

  -- Revocation or expiry sends already-usable assets back for review; the
  -- evidence trail is never erased.
  if p_status in ('revoked','expired','declined') then
    update marketing.shoot_outputs set state = 'permission_review_required'
    where content_opportunity_id = p_content_opportunity_id and state in ('usable','reviewing','uploaded');
  end if;

  perform audit.emit(co.workspace_id, 'media_permission.changed', 'marketing', 'media_permission_records', rec.id,
    jsonb_build_object('status', rec.status), jsonb_build_object('status', p_status), coalesce(p_revocation_reason, p_restrictions), '{}'::jsonb);
  return rec.id;
end $$;
grant execute on function api.record_media_permission(uuid,text,text,text[],text[],text,date,text,timestamptz,text) to authenticated;

------------------------------------------------------------------------------
-- Booking conflicts: participant overlap, site double-booking, and travel
-- buffer. Returned as data so the UI can explain before anyone confirms.
------------------------------------------------------------------------------
create or replace function api.shoot_conflicts(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_participant_ids uuid[] default '{}',
  p_booking_id uuid default null,
  p_buffer_minutes int default 45
) returns table (kind text, severity text, detail text, booking_id uuid, user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_ws uuid := core.current_workspace_id();
begin
  perform core.require_permission('marketing.read');
  return query
  -- same person on an overlapping confirmed/tentative booking
  select 'participant'::text, case when b.status = 'confirmed' then 'blocking' else 'warning' end,
         format('%s is already on "%s" (%s)', coalesce(p.full_name, 'A participant'), coalesce(b.title, 'a booking'), b.status),
         b.id, sp.user_id
  from marketing.shoot_bookings b
  join marketing.shoot_participants sp on sp.shoot_booking_id = b.id
  left join core.profiles p on p.user_id = sp.user_id
  where b.workspace_id = v_ws and b.status in ('tentative','confirmed','customer_confirmation_pending','standby')
    and (p_booking_id is null or b.id <> p_booking_id)
    and sp.user_id = any(coalesce(p_participant_ids, '{}'))
    and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at)
  union all
  -- not enough travel buffer between back-to-back bookings for the same person
  select 'travel_buffer', 'warning',
         format('Only %s minutes between this and "%s"',
                greatest(0, round(extract(epoch from least(abs(b.starts_at - p_ends_at), abs(p_starts_at - b.ends_at))) / 60)::int),
                coalesce(b.title, 'another booking')),
         b.id, sp.user_id
  from marketing.shoot_bookings b
  join marketing.shoot_participants sp on sp.shoot_booking_id = b.id
  where b.workspace_id = v_ws and b.status in ('tentative','confirmed','customer_confirmation_pending')
    and (p_booking_id is null or b.id <> p_booking_id)
    and sp.user_id = any(coalesce(p_participant_ids, '{}'))
    and not (tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at))
    and least(abs(extract(epoch from (b.starts_at - p_ends_at))), abs(extract(epoch from (p_starts_at - b.ends_at)))) < coalesce(p_buffer_minutes, 45) * 60
  union all
  -- another shoot already scheduled at the same site
  select 'site', 'warning', format('Another shoot is booked at this site ("%s")', coalesce(b.title, 'booking')), b.id, null::uuid
  from marketing.shoot_bookings b
  join marketing.shoot_locations l on l.shoot_booking_id = b.id
  where b.workspace_id = v_ws and b.status in ('tentative','confirmed','customer_confirmation_pending')
    and (p_booking_id is null or b.id <> p_booking_id)
    and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at)
    and l.project_site_id in (
      select sl.project_site_id from marketing.shoot_locations sl where p_booking_id is not null and sl.shoot_booking_id = p_booking_id);
end $$;
grant execute on function api.shoot_conflicts(timestamptz,timestamptz,uuid[],uuid,int) to authenticated;

------------------------------------------------------------------------------
-- Create or reschedule a booking. Tentative holds are open to marketing
-- writers; confirming crew capacity needs marketing.confirm, and a blocking
-- conflict needs an explicit audited override.
------------------------------------------------------------------------------
create or replace function api.upsert_shoot_booking(
  p_content_opportunity_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_status text default 'tentative',
  p_title text default null,
  p_booking_id uuid default null,
  p_participants jsonb default '[]'::jsonb,   -- [{user_id, role, status}]
  p_sites jsonb default '[]'::jsonb,          -- [{project_site_id, sequence, travel_buffer_minutes, notes}]
  p_notes text default null,
  p_reason text default null,
  p_override boolean default false,
  p_all_day boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  co marketing.content_opportunities%rowtype;
  b marketing.shoot_bookings%rowtype;
  v_id uuid;
  v_participants uuid[];
  v_blocking int;
  item jsonb;
begin
  perform core.require_permission('marketing.write');
  select * into co from marketing.content_opportunities where id = p_content_opportunity_id;
  if not found then raise exception 'content opportunity not found'; end if;
  perform core.require_workspace(co.workspace_id);
  if p_ends_at <= p_starts_at then raise exception 'the end time must be after the start time' using errcode = '23514'; end if;
  if p_status not in ('proposed','tentative','standby','customer_confirmation_pending','confirmed') then
    raise exception 'a booking is created or moved as proposed, tentative, standby, pending or confirmed' using errcode = '23514';
  end if;
  if p_status = 'confirmed' and not core.has_permission('marketing.confirm') then
    raise exception 'permission denied: confirming crew capacity requires marketing.confirm' using errcode = '42501';
  end if;

  select coalesce(array_agg((e->>'user_id')::uuid) filter (where nullif(e->>'user_id','') is not null), '{}')
  into v_participants from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) e;

  -- Confirmed bookings may not silently collide with another confirmed booking.
  if p_status = 'confirmed' then
    select count(*) into v_blocking from api.shoot_conflicts(p_starts_at, p_ends_at, v_participants, p_booking_id) c where c.severity = 'blocking';
    if v_blocking > 0 then
      if not p_override then
        raise exception 'a confirmed booking already has one of these people — override with a reason to proceed' using errcode = '23505';
      end if;
      if nullif(trim(coalesce(p_reason, '')), '') is null then
        raise exception 'override reason required' using errcode = '23514';
      end if;
    end if;
  end if;

  if p_booking_id is null then
    insert into marketing.shoot_bookings (workspace_id, content_opportunity_id, status, starts_at, ends_at, all_day, title, coordinator_id, notes, created_by)
    values (co.workspace_id, p_content_opportunity_id, p_status, p_starts_at, p_ends_at, coalesce(p_all_day, false),
            coalesce(p_title, 'Shoot'), auth.uid(), p_notes, auth.uid())
    returning id into v_id;
    insert into marketing.shoot_booking_status_events (shoot_booking_id, from_status, to_status, reason, actor_id)
    values (v_id, null, p_status, p_reason, auth.uid());
  else
    select * into b from marketing.shoot_bookings where id = p_booking_id for update;
    if not found then raise exception 'booking not found'; end if;
    perform core.require_workspace(b.workspace_id);
    -- Rescheduling keeps the prior slot in history.
    if (b.starts_at, b.ends_at) is distinct from (p_starts_at, p_ends_at) or b.status is distinct from p_status then
      insert into marketing.shoot_booking_status_events (shoot_booking_id, from_status, to_status, previous_starts_at, previous_ends_at, reason, actor_id)
      values (p_booking_id, b.status, p_status, b.starts_at, b.ends_at, p_reason, auth.uid());
    end if;
    update marketing.shoot_bookings
    set status = p_status, starts_at = p_starts_at, ends_at = p_ends_at, all_day = coalesce(p_all_day, all_day),
        title = coalesce(p_title, title), notes = coalesce(p_notes, notes)
    where id = p_booking_id;
    v_id := p_booking_id;
  end if;

  if jsonb_typeof(p_participants) = 'array' then
    delete from marketing.shoot_participants where shoot_booking_id = v_id;
    for item in select * from jsonb_array_elements(p_participants) loop
      insert into marketing.shoot_participants (shoot_booking_id, user_id, external_name, role, status)
      values (v_id, nullif(item->>'user_id','')::uuid, nullif(item->>'external_name',''), coalesce(item->>'role','crew'), coalesce(item->>'status','assigned'));
    end loop;
  end if;
  if jsonb_typeof(p_sites) = 'array' and jsonb_array_length(p_sites) > 0 then
    delete from marketing.shoot_locations where shoot_booking_id = v_id;
    for item in select * from jsonb_array_elements(p_sites) loop
      insert into marketing.shoot_locations (shoot_booking_id, project_site_id, sequence, travel_buffer_minutes, notes)
      values (v_id, nullif(item->>'project_site_id','')::uuid, coalesce((item->>'sequence')::int, 1), coalesce((item->>'travel_buffer_minutes')::int, 0), nullif(item->>'notes',''));
    end loop;
  end if;

  if p_status in ('tentative','confirmed','customer_confirmation_pending') and co.status in ('nominated','under_review','needs_info','accepted') then
    update marketing.content_opportunities set status = 'scheduled' where id = p_content_opportunity_id;
    insert into marketing.content_opportunity_status_events (content_opportunity_id, from_status, to_status, reason, actor_id)
    values (p_content_opportunity_id, co.status, 'scheduled', 'Shoot booked', auth.uid());
  end if;

  perform audit.emit(co.workspace_id, case when p_booking_id is null then 'shoot_booking.created' else 'shoot_booking.updated' end,
    'marketing', 'shoot_bookings', v_id, null,
    jsonb_build_object('status', p_status, 'starts_at', p_starts_at, 'ends_at', p_ends_at), p_reason,
    jsonb_build_object('override', p_override));
  return v_id;
end $$;
grant execute on function api.upsert_shoot_booking(uuid,timestamptz,timestamptz,text,text,uuid,jsonb,jsonb,text,text,boolean,boolean) to authenticated;

------------------------------------------------------------------------------
-- Close out a visit: outcome, reason, and the follow-up task it may create.
------------------------------------------------------------------------------
create or replace function api.record_shoot_outcome(p_booking_id uuid, p_outcome text, p_reason text default null, p_follow_up text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b marketing.shoot_bookings%rowtype;
  co marketing.content_opportunities%rowtype;
begin
  perform core.require_permission('marketing.write');
  select * into b from marketing.shoot_bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found'; end if;
  perform core.require_workspace(b.workspace_id);
  if p_outcome not in ('completed','partially_completed','postponed','cancelled') then
    raise exception 'outcome must be completed, partially completed, postponed or cancelled' using errcode = '23514';
  end if;
  if p_outcome <> 'completed' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason required for anything other than a completed shoot' using errcode = '23514';
  end if;

  update marketing.shoot_bookings set status = p_outcome, outcome = p_outcome, outcome_reason = p_reason where id = p_booking_id;
  insert into marketing.shoot_booking_status_events (shoot_booking_id, from_status, to_status, reason, actor_id)
  values (p_booking_id, b.status, p_outcome, p_reason, auth.uid());

  select * into co from marketing.content_opportunities where id = b.content_opportunity_id;
  if p_outcome = 'completed' then
    update marketing.content_opportunities set status = 'completed' where id = b.content_opportunity_id;
  end if;

  insert into sales.activities (workspace_id, kind, subject, body, actor_id, contact_id, account_id, project_id, metadata)
  values (b.workspace_id, 'system', format('Shoot %s', replace(p_outcome, '_', ' ')), p_reason, auth.uid(), co.contact_id, co.account_id, co.project_id,
          jsonb_build_object('shoot_booking_id', p_booking_id));

  if nullif(trim(coalesce(p_follow_up, '')), '') is not null then
    insert into sales.tasks (workspace_id, title, description, assignee_id, contact_id, account_id, project_id, due_at, created_by)
    values (b.workspace_id, p_follow_up, 'Follow-up from the shoot', coalesce(b.coordinator_id, auth.uid()), co.contact_id, co.account_id, co.project_id, now() + interval '3 days', auth.uid());
  end if;

  perform audit.emit(b.workspace_id, 'shoot_booking.outcome_recorded', 'marketing', 'shoot_bookings', p_booking_id,
    jsonb_build_object('status', b.status), jsonb_build_object('status', p_outcome), p_reason, '{}'::jsonb);
end $$;
grant execute on function api.record_shoot_outcome(uuid,text,text,text) to authenticated;

------------------------------------------------------------------------------
-- Assets: registering an output, and the review that may mark it usable.
-- "Usable" is gated on an accepted, unexpired permission.
------------------------------------------------------------------------------
create or replace function api.register_shoot_output(
  p_content_opportunity_id uuid, p_kind text, p_storage_path text,
  p_shoot_booking_id uuid default null, p_caption text default null,
  p_mime_type text default null, p_size_bytes bigint default null, p_captured_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare co marketing.content_opportunities%rowtype; v_id uuid;
begin
  perform core.require_permission('marketing.write');
  select * into co from marketing.content_opportunities where id = p_content_opportunity_id;
  if not found then raise exception 'content opportunity not found'; end if;
  perform core.require_workspace(co.workspace_id);
  insert into marketing.shoot_outputs (workspace_id, shoot_booking_id, content_opportunity_id, kind, storage_path, caption, mime_type, size_bytes, state, captured_at, uploaded_by)
  values (co.workspace_id, p_shoot_booking_id, p_content_opportunity_id, p_kind, p_storage_path, p_caption, p_mime_type, p_size_bytes, 'uploaded', coalesce(p_captured_at, now()), auth.uid())
  returning id into v_id;
  perform audit.emit(co.workspace_id, 'shoot_output.registered', 'marketing', 'shoot_outputs', v_id, null, jsonb_build_object('kind', p_kind), null, '{}'::jsonb);
  return v_id;
end $$;
grant execute on function api.register_shoot_output(uuid,text,text,uuid,text,text,bigint,timestamptz) to authenticated;

create or replace function api.review_shoot_output(p_output_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o marketing.shoot_outputs%rowtype;
  perm marketing.media_permission_records%rowtype;
begin
  perform core.require_permission('marketing.confirm');
  select * into o from marketing.shoot_outputs where id = p_output_id for update;
  if not found then raise exception 'output not found'; end if;
  perform core.require_workspace(o.workspace_id);
  if p_decision not in ('usable','restricted','rejected') then
    raise exception 'decision must be usable, restricted or rejected' using errcode = '23514';
  end if;

  if p_decision = 'usable' then
    select * into perm from marketing.media_permission_records where content_opportunity_id = o.content_opportunity_id order by created_at limit 1;
    if perm.id is null or perm.status not in ('approved','approved_with_restrictions') then
      raise exception 'customer media permission is not approved for this project' using errcode = '42501';
    end if;
    if perm.expires_at is not null and perm.expires_at < current_date then
      raise exception 'the customer media permission expired on %', perm.expires_at using errcode = '42501';
    end if;
    if perm.revoked_at is not null then
      raise exception 'the customer media permission was revoked' using errcode = '42501';
    end if;
  end if;

  update marketing.shoot_outputs set state = p_decision where id = p_output_id;
  insert into marketing.content_asset_reviews (shoot_output_id, reviewer_id, decision, reason)
  values (p_output_id, auth.uid(), p_decision, p_reason);
  perform audit.emit(o.workspace_id, 'shoot_output.reviewed', 'marketing', 'shoot_outputs', p_output_id,
    jsonb_build_object('state', o.state), jsonb_build_object('state', p_decision), p_reason, '{}'::jsonb);
end $$;
grant execute on function api.review_shoot_output(uuid,text,text) to authenticated;

------------------------------------------------------------------------------
-- Calendar read model: one row per booking with everything the views need.
------------------------------------------------------------------------------
create or replace view api.shoot_calendar with (security_invoker = true) as
select
  b.id, b.workspace_id, b.content_opportunity_id, b.title, b.status, b.starts_at, b.ends_at, b.all_day,
  b.timezone, b.coordinator_id, b.outcome, b.outcome_reason, b.notes,
  co.project_id, co.contact_id, co.account_id, co.story_angle, co.content_types, co.readiness_state, co.priority,
  pr.name as project_name, pr.area as project_area,
  c.display_name as contact_name, a.name as account_name,
  perm.status as permission_status, perm.expires_at as permission_expires_at,
  (select coalesce(jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'name', pf.full_name, 'role', sp.role, 'status', sp.status) order by sp.role), '[]'::jsonb)
     from marketing.shoot_participants sp left join core.profiles pf on pf.user_id = sp.user_id
     where sp.shoot_booking_id = b.id) as participants,
  (select count(*) from marketing.shoot_locations sl where sl.shoot_booking_id = b.id) as site_count,
  (select count(*) from marketing.shoot_outputs so where so.shoot_booking_id = b.id) as output_count
from marketing.shoot_bookings b
join marketing.content_opportunities co on co.id = b.content_opportunity_id
left join identity.projects pr on pr.id = co.project_id
left join identity.contacts c on c.id = co.contact_id
left join identity.accounts a on a.id = co.account_id
left join lateral (
  select * from marketing.media_permission_records m where m.content_opportunity_id = co.id order by m.created_at limit 1
) perm on true;
grant select on api.shoot_calendar to authenticated;
