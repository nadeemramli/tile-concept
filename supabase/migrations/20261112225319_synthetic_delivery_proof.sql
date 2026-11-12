-- Bounded synthetic proof is written atomically with the result. No pending or public file is exposed.
create table fulfilment.delivery_results (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null unique references fulfilment.preparation_events(id),
  revision_id uuid not null references fulfilment.schedule_revisions(id),
  delivered numeric(14,3) not null check (delivered >= 0 and delivered <> 'NaN'::numeric),
  planned numeric(14,3) not null check (planned > 0 and delivered <= planned),
  receiving_pic text,
  reason text,
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  proof_name text,
  proof_type text,
  proof_bytes bytea,
  check ((proof_name is null and proof_type is null and proof_bytes is null)
    or (proof_name is not null and proof_type is not null and proof_bytes is not null)),
  check (delivered = 0 or (receiving_pic is not null and proof_bytes is not null)),
  check (delivered = planned or reason is not null)
);
create index delivery_results_actor_idx on fulfilment.delivery_results(recorded_by);
alter table fulfilment.delivery_results enable row level security;
revoke all on fulfilment.delivery_results from public, anon, authenticated;

create function api.record_synthetic_delivery(
  p_revision uuid, p_allocation uuid, p_delivered numeric,
  p_pic text default null, p_reason text default null,
  p_proof_name text default null, p_proof_type text default null, p_proof_base64 text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_actor uuid := auth.uid();
  v_revision fulfilment.schedule_revisions%rowtype;
  v_prior fulfilment.delivery_results%rowtype;
  v_stop jsonb;
  v_planned numeric;
  v_pic text := nullif(btrim(p_pic), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_name text := nullif(btrim(p_proof_name), '');
  v_bytes bytea;
  v_size integer;
  v_result uuid;
begin
  if v_workspace is null or v_actor is null or not core.has_permission('delivery.read_own') then
    raise exception 'delivery recording denied' using errcode = '42501';
  end if;
  perform fulfilment.lock_schedule(v_workspace);
  select r.* into v_revision from fulfilment.schedule_revisions r
  join fulfilment.draft_trips t on t.id = r.trip_id
  where r.id = p_revision and r.driver_id = v_actor and t.workspace_id = v_workspace;
  if not found then
    raise exception 'delivery stop unavailable' using errcode = '42501';
  end if;
  select stop into v_stop from jsonb_array_elements(v_revision.stops) stop
  where stop->>'id' = p_allocation::text;
  if v_stop is null then
    raise exception 'delivery stop unavailable' using errcode = '42501';
  end if;
  v_planned := (v_stop->>'quantity')::numeric;
  if p_delivered is null or not (p_delivered between 0 and v_planned)
     or p_delivered <> round(p_delivered, 3) then
    raise exception 'invalid delivered quantity' using errcode = '23514';
  end if;
  if (p_delivered > 0 and v_pic is null) or char_length(v_pic) > 120
     or (p_delivered < v_planned and v_reason is null) or char_length(v_reason) > 500 then
    raise exception 'receiving PIC or reason missing' using errcode = '22023';
  end if;

  if p_proof_base64 is not null then
    -- 700 KiB keeps the whole browser form below the default action size limit.
    if char_length(p_proof_base64) > 955736 or v_name is null or char_length(v_name) > 150
       or v_name ~ '[[:cntrl:]/\\]' then
      raise exception 'invalid proof' using errcode = '22023';
    end if;
    v_bytes := decode(p_proof_base64, 'base64');
    v_size := octet_length(v_bytes);
    if not (v_size between 12 and 716800) or not coalesce(
      case p_proof_type
        when 'application/pdf' then substring(v_bytes from 1 for 5) = decode('255044462d','hex')
          and position(decode('2525454f46','hex') in substring(v_bytes from greatest(1,v_size-63))) > 0
        when 'image/jpeg' then substring(v_bytes from 1 for 3) = decode('ffd8ff','hex')
          and substring(v_bytes from v_size-1) = decode('ffd9','hex')
        when 'image/png' then substring(v_bytes from 1 for 8) = decode('89504e470d0a1a0a','hex')
          and substring(v_bytes from v_size-7) = decode('49454e44ae426082','hex')
        else false
      end, false) then
      raise exception 'invalid proof' using errcode = '22023';
    end if;
  elsif p_delivered > 0 or p_proof_type is not null or v_name is not null then
    raise exception 'signed proof required' using errcode = '22023';
  end if;

  select * into v_prior from fulfilment.delivery_results where allocation_id = p_allocation;
  if found then
    if v_prior.revision_id = p_revision and v_prior.recorded_by = v_actor
       and v_prior.delivered = p_delivered and v_prior.receiving_pic is not distinct from v_pic
       and v_prior.reason is not distinct from v_reason and v_prior.proof_name is not distinct from v_name
       and v_prior.proof_type is not distinct from p_proof_type and v_prior.proof_bytes is not distinct from v_bytes then
      return v_prior.id;
    end if;
    raise exception 'delivery already recorded' using errcode = '23505';
  end if;
  if exists (select 1 from fulfilment.schedule_revisions where trip_id = v_revision.trip_id and revision > v_revision.revision)
    or not exists (select 1 from fulfilment.schedule_acknowledgements where revision_id = p_revision and driver_id = v_actor) then
    raise exception 'acknowledge current schedule before recording' using errcode = '40001';
  end if;

  insert into fulfilment.delivery_results
    (allocation_id, revision_id, delivered, planned, receiving_pic, reason, recorded_by, proof_name, proof_type, proof_bytes)
  values (p_allocation, p_revision, p_delivered, v_planned, v_pic, v_reason, v_actor, v_name, p_proof_type, v_bytes)
  returning id into v_result;
  return v_result;
end
$$;

create function api.my_synthetic_delivery_results()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'allocation', d.allocation_id,
    'delivered', d.delivered, 'planned', d.planned, 'pic', d.receiving_pic, 'reason', d.reason,
    'recordedAt', d.recorded_at, 'recordedBy', coalesce(p.full_name, p.email::text, d.recorded_by::text),
    'proof', d.proof_name)), '[]'::jsonb)
  from fulfilment.delivery_results d
  join fulfilment.schedule_revisions r on r.id = d.revision_id
  join fulfilment.draft_trips t on t.id = r.trip_id
  left join core.profiles p on p.user_id = d.recorded_by
  where d.recorded_by = auth.uid() and t.workspace_id = core.current_workspace_id()
    and core.has_permission('delivery.read_own')
$$;

create function api.synthetic_delivery_proof(p_result uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', d.proof_name, 'type', d.proof_type, 'base64', encode(d.proof_bytes, 'base64'))
  from fulfilment.delivery_results d
  join fulfilment.schedule_revisions r on r.id = d.revision_id
  join fulfilment.draft_trips t on t.id = r.trip_id
  where d.id = p_result and d.proof_bytes is not null and t.workspace_id = core.current_workspace_id()
    and ((d.recorded_by = auth.uid() and core.has_permission('delivery.read_own')) or core.has_permission('admin.coordinate'))
$$;

revoke all on function api.record_synthetic_delivery(uuid,uuid,numeric,text,text,text,text,text),
  api.my_synthetic_delivery_results(), api.synthetic_delivery_proof(uuid) from public, anon;
grant execute on function api.record_synthetic_delivery(uuid,uuid,numeric,text,text,text,text,text),
  api.my_synthetic_delivery_results(), api.synthetic_delivery_proof(uuid) to authenticated;

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
  if exists (select 1 from fulfilment.delivery_results where allocation_id = p_allocation_id) then
    raise exception 'recorded delivery cannot move' using errcode = '55000';
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

create or replace function api.reorder_synthetic_stop(p_trip uuid, p_allocation uuid, p_direction integer, p_token text)
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
  if exists (select 1 from fulfilment.delivery_results
    where allocation_id in (v_current.allocation_id, v_neighbour.allocation_id)) then
    raise exception 'recorded delivery cannot move' using errcode = '55000';
  end if;
  update fulfilment.draft_placements
  set stop_position = case when allocation_id = v_current.allocation_id then v_neighbour.stop_position else v_current.stop_position end,
      version = version + 1, updated_by = auth.uid(), updated_at = clock_timestamp()
  where allocation_id in (v_current.allocation_id, v_neighbour.allocation_id);
end
$$;
