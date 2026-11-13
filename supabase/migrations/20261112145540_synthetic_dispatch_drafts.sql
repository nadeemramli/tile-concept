create table fulfilment.draft_trips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  label text not null check (char_length(btrim(label)) between 1 and 100),
  trip_date date not null,
  unique (workspace_id, trip_date, label)
);

create table fulfilment.draft_placements (
  allocation_id uuid primary key references fulfilment.preparation_events(id),
  trip_id uuid references fulfilment.draft_trips(id),
  version integer not null check (version > 0),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp()
);
create index draft_placements_trip_idx on fulfilment.draft_placements(trip_id);

alter table fulfilment.draft_trips enable row level security;
alter table fulfilment.draft_placements enable row level security;
revoke all on fulfilment.draft_trips, fulfilment.draft_placements from public, anon, authenticated;

create function api.synthetic_dispatch_drafts()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if auth.uid() is null or not core.has_permission('admin.coordinate') then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'date', t.trip_date)
        order by t.trip_date, t.label)
      from fulfilment.draft_trips t where t.workspace_id = v_workspace
    ), '[]'::jsonb),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'document', l.document_reference, 'line', l.line_reference, 'item', l.item_label,
        'quantity', a.quantity, 'unit', l.unit, 'origin', l.origin_label, 'confirmed', w.confirmed,
        'handedOver', w.handed_over, 'tripId', p.trip_id, 'version', coalesce(p.version, 0))
        order by l.document_reference, l.line_reference, a.recorded_at, a.id)
      from fulfilment.order_lines l
      join fulfilment.preparation_events a on a.line_id = l.id and a.allocation_id is null
      left join fulfilment.draft_placements p on p.allocation_id = a.id
      cross join lateral (
        select coalesce(sum(quantity) filter (where stage = 'ready'), 0) as confirmed,
               coalesce(sum(quantity) filter (where stage = 'handed_over'), 0) as handed_over
        from fulfilment.warehouse_events where allocation_id = a.id
      ) w
      where l.workspace_id = v_workspace
    ), '[]'::jsonb)
  );
end
$$;

create function api.move_synthetic_dispatch_draft(p_allocation_id uuid, p_version integer, p_trip_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_current fulfilment.draft_placements%rowtype;
begin
  if auth.uid() is null or not core.has_permission('admin.coordinate') then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;

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

  insert into fulfilment.draft_placements (allocation_id, trip_id, version, updated_by)
  values (p_allocation_id, p_trip_id, 1, auth.uid())
  on conflict (allocation_id) do update
  set trip_id = excluded.trip_id, version = fulfilment.draft_placements.version + 1,
      updated_by = excluded.updated_by, updated_at = clock_timestamp();
end
$$;

revoke all on function api.synthetic_dispatch_drafts() from public, anon;
revoke all on function api.move_synthetic_dispatch_draft(uuid, integer, uuid) from public, anon;
grant execute on function api.synthetic_dispatch_drafts() to authenticated;
grant execute on function api.move_synthetic_dispatch_draft(uuid, integer, uuid) to authenticated;
