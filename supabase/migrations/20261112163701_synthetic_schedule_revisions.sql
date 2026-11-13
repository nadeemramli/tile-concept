alter table fulfilment.draft_trips add column driver_id uuid;
alter table fulfilment.draft_placements add column stop_position bigint;
with ordered as (
  select allocation_id, row_number() over (partition by trip_id order by updated_at, allocation_id) as position
  from fulfilment.draft_placements where trip_id is not null
)
update fulfilment.draft_placements p set stop_position = o.position
from ordered o where p.allocation_id = o.allocation_id;
alter table fulfilment.draft_placements add check (
  (trip_id is null and stop_position is null)
  or (trip_id is not null and stop_position is not null and stop_position > 0)
);

create table fulfilment.schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references fulfilment.draft_trips(id),
  revision integer not null check (revision > 0),
  driver_id uuid not null,
  trip_label text not null,
  trip_date date not null,
  stops jsonb not null,
  published_by uuid not null,
  published_at timestamptz not null default clock_timestamp(),
  unique (trip_id, revision)
);
create table fulfilment.schedule_acknowledgements (
  revision_id uuid primary key references fulfilment.schedule_revisions(id),
  driver_id uuid not null,
  acknowledged_at timestamptz not null default clock_timestamp()
);
alter table fulfilment.schedule_revisions enable row level security;
alter table fulfilment.schedule_acknowledgements enable row level security;
revoke all on fulfilment.schedule_revisions, fulfilment.schedule_acknowledgements from public, anon, authenticated;

-- All coordinator edits, publication and acknowledgements use one transaction lock
-- per workspace. This also orders a publication against an acknowledgement.
create function fulfilment.lock_schedule(p_workspace uuid)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(p_workspace::text, 106))
$$;
revoke all on function fulfilment.lock_schedule(uuid) from public, anon, authenticated;

create function fulfilment.schedule_stops(p_trip uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'document', l.document_reference, 'line', l.line_reference, 'item', l.item_label,
    'quantity', a.quantity, 'unit', l.unit,
    'ready', a.quantity <= coalesce((
      select sum(w.quantity) from fulfilment.warehouse_events w
      where w.allocation_id = a.id and w.stage = 'ready'
    ), 0)
  ) order by p.stop_position, p.allocation_id), '[]'::jsonb)
  from fulfilment.draft_placements p
  join fulfilment.preparation_events a on a.id = p.allocation_id
  join fulfilment.order_lines l on l.id = a.line_id
  where p.trip_id = p_trip
$$;
revoke all on function fulfilment.schedule_stops(uuid) from public, anon, authenticated;

create function fulfilment.schedule_token(p_driver uuid, p_label text, p_date date, p_stops jsonb)
returns text language sql stable set search_path = '' as $$
  select md5(jsonb_build_array(p_driver, p_label, p_date, p_stops)::text)
$$;
revoke all on function fulfilment.schedule_token(uuid, text, date, jsonb) from public, anon, authenticated;

create function api.synthetic_schedule_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or auth.uid() is null or not core.has_permission('admin.coordinate') then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;
  return jsonb_build_object('board', api.synthetic_dispatch_drafts(), 'schedules', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tripId', t.id, 'driver', coalesce(profile.full_name, profile.email::text),
      'stops', s.stops, 'token', fulfilment.schedule_token(t.driver_id, t.label, t.trip_date, s.stops),
      'revision', r.revision, 'acknowledgedAt', a.acknowledged_at,
      'changed', r.id is null or
        fulfilment.schedule_token(t.driver_id, t.label, t.trip_date, s.stops) <>
        fulfilment.schedule_token(r.driver_id, r.trip_label, r.trip_date, r.stops)
    ) order by t.trip_date, t.label)
    from fulfilment.draft_trips t
    cross join lateral (select fulfilment.schedule_stops(t.id) as stops) s
    left join core.memberships m on m.workspace_id = t.workspace_id and m.user_id = t.driver_id
      and m.role_key = 'driver' and m.status = 'active'
    left join core.profiles profile on profile.user_id = m.user_id
    left join lateral (
      select * from fulfilment.schedule_revisions where trip_id = t.id order by revision desc limit 1
    ) r on true
    left join fulfilment.schedule_acknowledgements a on a.revision_id = r.id
    where t.workspace_id = v_workspace
  ), '[]'::jsonb));
end
$$;

create function api.reorder_synthetic_stop(p_trip uuid, p_allocation uuid, p_direction integer, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_trip fulfilment.draft_trips%rowtype;
  v_current fulfilment.draft_placements%rowtype;
  v_neighbour fulfilment.draft_placements%rowtype;
begin
  if v_workspace is null or auth.uid() is null or not core.has_permission('admin.coordinate') then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception 'invalid direction' using errcode = '22023';
  end if;
  perform fulfilment.lock_schedule(v_workspace);
  select * into v_trip from fulfilment.draft_trips where id = p_trip and workspace_id = v_workspace;
  if not found then
    raise exception 'draft trip unavailable' using errcode = '42501';
  end if;
  if p_token is distinct from fulfilment.schedule_token(
      v_trip.driver_id, v_trip.label, v_trip.trip_date, fulfilment.schedule_stops(p_trip)) then
    raise exception 'draft changed' using errcode = '40001';
  end if;
  select * into v_current from fulfilment.draft_placements where allocation_id = p_allocation and trip_id = p_trip;
  if not found then
    raise exception 'draft stop unavailable' using errcode = '22023';
  end if;
  select * into v_neighbour from fulfilment.draft_placements
  where trip_id = p_trip and sign(stop_position - v_current.stop_position) = p_direction
  order by abs(stop_position - v_current.stop_position) limit 1;
  if not found then
    return;
  end if;
  update fulfilment.draft_placements
  set stop_position = case when allocation_id = v_current.allocation_id then v_neighbour.stop_position else v_current.stop_position end,
      version = version + 1, updated_by = auth.uid(), updated_at = clock_timestamp()
  where allocation_id in (v_current.allocation_id, v_neighbour.allocation_id);
end
$$;

create function api.publish_synthetic_schedule(p_trip uuid, p_token text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_trip fulfilment.draft_trips%rowtype;
  v_last fulfilment.schedule_revisions%rowtype;
  v_stops jsonb;
  v_token text;
  v_revision integer;
begin
  if v_workspace is null or auth.uid() is null or not core.has_permission('admin.coordinate') then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;
  perform fulfilment.lock_schedule(v_workspace);
  select * into v_trip from fulfilment.draft_trips where id = p_trip and workspace_id = v_workspace;
  if not found then
    raise exception 'draft trip unavailable' using errcode = '42501';
  end if;
  v_stops := fulfilment.schedule_stops(p_trip);
  v_token := fulfilment.schedule_token(v_trip.driver_id, v_trip.label, v_trip.trip_date, v_stops);
  if p_token is distinct from v_token then
    raise exception 'draft changed' using errcode = '40001';
  end if;
  if jsonb_array_length(v_stops) = 0 or exists (
    select 1 from jsonb_array_elements(v_stops) as stop where (stop->>'ready')::boolean is not true
  ) or not exists (
    select 1 from core.memberships where workspace_id = v_workspace and user_id = v_trip.driver_id
      and role_key = 'driver' and status = 'active'
  ) then
    raise exception 'publication requires a nonempty ready trip and active assigned driver' using errcode = '23514';
  end if;
  select * into v_last from fulfilment.schedule_revisions where trip_id = p_trip order by revision desc limit 1;
  if found and v_token = fulfilment.schedule_token(v_last.driver_id, v_last.trip_label, v_last.trip_date, v_last.stops) then
    return v_last.revision;
  end if;
  v_revision := coalesce(v_last.revision, 0) + 1;
  insert into fulfilment.schedule_revisions (trip_id, revision, driver_id, trip_label, trip_date, stops, published_by)
  values (p_trip, v_revision, v_trip.driver_id, v_trip.label, v_trip.trip_date, v_stops, auth.uid());
  return v_revision;
end
$$;

create function api.my_synthetic_schedules()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or auth.uid() is null or not core.has_permission('delivery.read_own') then
    raise exception 'driver schedule denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'label', r.trip_label, 'date', r.trip_date,
      'revision', r.revision, 'stops', r.stops, 'previousStops', prior.stops,
      'acknowledgedAt', a.acknowledged_at) order by r.trip_date, r.trip_label)
    from fulfilment.draft_trips t
    join lateral (
      select * from fulfilment.schedule_revisions where trip_id = t.id order by revision desc limit 1
    ) r on r.driver_id = auth.uid()
    left join fulfilment.schedule_revisions prior on prior.trip_id = t.id
      and prior.revision = r.revision - 1 and prior.driver_id = r.driver_id
    left join fulfilment.schedule_acknowledgements a on a.revision_id = r.id
    where t.workspace_id = v_workspace
  ), '[]'::jsonb);
end
$$;

create function api.acknowledge_synthetic_schedule(p_revision uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_revision fulfilment.schedule_revisions%rowtype;
begin
  if v_workspace is null or auth.uid() is null or not core.has_permission('delivery.read_own') then
    raise exception 'driver schedule denied' using errcode = '42501';
  end if;
  perform fulfilment.lock_schedule(v_workspace);
  select r.* into v_revision from fulfilment.schedule_revisions r
  join fulfilment.draft_trips t on t.id = r.trip_id
  where r.id = p_revision and t.workspace_id = v_workspace and r.driver_id = auth.uid();
  if not found then
    raise exception 'driver schedule unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from fulfilment.schedule_revisions where trip_id = v_revision.trip_id and revision > v_revision.revision) then
    raise exception 'a newer schedule was published' using errcode = '40001';
  end if;
  insert into fulfilment.schedule_acknowledgements (revision_id, driver_id)
  values (p_revision, auth.uid()) on conflict (revision_id) do nothing;
end
$$;

revoke all on function api.synthetic_schedule_state(), api.reorder_synthetic_stop(uuid, uuid, integer, text),
  api.publish_synthetic_schedule(uuid, text), api.my_synthetic_schedules(), api.acknowledge_synthetic_schedule(uuid)
from public, anon;
grant execute on function api.synthetic_schedule_state(), api.reorder_synthetic_stop(uuid, uuid, integer, text),
  api.publish_synthetic_schedule(uuid, text), api.my_synthetic_schedules(), api.acknowledge_synthetic_schedule(uuid)
to authenticated;

create or replace function api.move_synthetic_dispatch_draft(p_allocation_id uuid, p_version integer, p_trip_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_current fulfilment.draft_placements%rowtype;
  v_position bigint;
begin
  if v_workspace is null or auth.uid() is null or not core.has_permission('admin.coordinate') then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;

  perform fulfilment.lock_schedule(v_workspace);

  -- Lock the source line so two first-time moves also share one lock.
  perform 1 from fulfilment.preparation_events a
  join fulfilment.order_lines l on l.id = a.line_id
  where a.id = p_allocation_id and a.allocation_id is null and l.workspace_id = v_workspace
  for update of l;
  if not found then
    raise exception 'dispatch allocation unavailable' using errcode = '42501';
  end if;
  if p_trip_id is not null and not exists (
    select 1 from fulfilment.draft_trips where id = p_trip_id and workspace_id = v_workspace
  ) then
    raise exception 'draft trip unavailable' using errcode = '22023';
  end if;

  select * into v_current from fulfilment.draft_placements where allocation_id = p_allocation_id;
  if p_version is distinct from coalesce(v_current.version, 0) then
    raise exception 'draft placement changed' using errcode = '40001';
  end if;
  if v_current.trip_id is not distinct from p_trip_id then
    return;
  end if;

  if p_trip_id is not null then
    select coalesce(max(stop_position), 0) + 1 into v_position
    from fulfilment.draft_placements where trip_id = p_trip_id;
  end if;
  insert into fulfilment.draft_placements (allocation_id, trip_id, version, updated_by, stop_position)
  values (p_allocation_id, p_trip_id, 1, auth.uid(), v_position)
  on conflict (allocation_id) do update
  set trip_id = excluded.trip_id, stop_position = excluded.stop_position, version = fulfilment.draft_placements.version + 1,
      updated_by = excluded.updated_by, updated_at = clock_timestamp();
end
$$;
