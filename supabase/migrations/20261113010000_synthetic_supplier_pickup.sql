-- TILE-40: supplier pickup point -> our lorry -> customer (PRD 4.1, path 2).
-- Supplier lines skip warehouse packing. Admin records verified supplier readiness, the pickup is
-- recorded with actual quantities, and delivery cannot exceed what was picked up. No stock is posted.
alter table fulfilment.order_lines
  add column origin_kind text not null default 'warehouse' check (origin_kind in ('warehouse', 'supplier'));

create table fulfilment.pickup_events (
  id uuid primary key,
  line_id uuid not null,
  allocation_id uuid not null,
  stage text not null check (stage in ('supplier_ready', 'picked_up')),
  quantity numeric(14,3) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  note text check (note is null or char_length(note) between 1 and 500),
  actor_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (line_id, allocation_id) references fulfilment.preparation_events(line_id, id)
);
create index pickup_events_allocation_idx on fulfilment.pickup_events(allocation_id, stage);
alter table fulfilment.pickup_events enable row level security;
revoke all on fulfilment.pickup_events from public, anon, authenticated;

-- Goods that never enter our warehouse get no packing, readiness or handover record there.
create function fulfilment.refuse_supplier_packing()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'preparation_events' and new.allocation_id is null then
    return new;
  end if;
  if exists (select 1 from fulfilment.order_lines where id = new.line_id and origin_kind = 'supplier') then
    raise exception 'supplier pickup lines are not prepared in the warehouse' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger supplier_lines_skip_packing before insert on fulfilment.preparation_events
  for each row execute function fulfilment.refuse_supplier_packing();
create trigger supplier_lines_skip_warehouse before insert on fulfilment.warehouse_events
  for each row execute function fulfilment.refuse_supplier_packing();

create function fulfilment.require_pickup_before_delivery()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_picked numeric;
begin
  if new.delivered > 0 and exists (
    select 1 from fulfilment.preparation_events e
    join fulfilment.order_lines l on l.id = e.line_id
    where e.id = new.allocation_id and l.origin_kind = 'supplier'
  ) then
    select coalesce(sum(quantity), 0) into v_picked from fulfilment.pickup_events
    where allocation_id = new.allocation_id and stage = 'picked_up';
    if new.delivered > v_picked then
      raise exception 'pickup required before delivery' using errcode = 'TP001';
    end if;
  end if;
  return new;
end $$;
create trigger supplier_pickup_precedes_delivery before insert on fulfilment.delivery_results
  for each row execute function fulfilment.require_pickup_before_delivery();
revoke all on function fulfilment.refuse_supplier_packing(), fulfilment.require_pickup_before_delivery()
  from public, anon, authenticated;

-- A supplier stop is ready once the supplier's readiness covers it. Warehouse stops keep the
-- exact same shape, so tokens and published revisions of existing trips do not change.
create or replace function fulfilment.schedule_stops(p_trip uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'document', l.document_reference, 'line', l.line_reference, 'item', l.item_label,
    'quantity', a.quantity, 'unit', l.unit,
    'ready', a.quantity <= coalesce(case when l.origin_kind = 'supplier' then (
      select sum(k.quantity) from fulfilment.pickup_events k
      where k.allocation_id = a.id and k.stage = 'supplier_ready'
    ) else (
      select sum(w.quantity) from fulfilment.warehouse_events w
      where w.allocation_id = a.id and w.stage = 'ready'
    ) end, 0)
  ) || case when l.origin_kind = 'supplier' then jsonb_build_object('pickup', l.origin_label) else '{}'::jsonb end
  order by p.stop_position, p.allocation_id), '[]'::jsonb)
  from fulfilment.draft_placements p
  join fulfilment.preparation_events a on a.id = p.allocation_id
  join fulfilment.order_lines l on l.id = a.line_id
  where p.trip_id = p_trip
$$;

create function api.record_synthetic_pickup(
  p_request uuid, p_allocation uuid, p_stage text, p_quantity numeric, p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_actor uuid := auth.uid();
  v_note text := nullif(btrim(p_note), '');
  v_staff boolean := coalesce(fulfilment.can_decide_delivery_recovery(), false);
  v_line uuid;
  v_quantity numeric;
  v_ready numeric;
  v_picked numeric;
  v_prior fulfilment.pickup_events%rowtype;
begin
  if v_workspace is null or v_actor is null then
    raise exception 'pickup denied' using errcode = '42501';
  end if;
  if p_request is null or p_stage is null or p_stage not in ('supplier_ready', 'picked_up')
     or p_quantity is null or not (p_quantity between 0.001 and 99999999999.999)
     or p_quantity <> round(p_quantity, 3) or char_length(v_note) > 500 then
    raise exception 'invalid pickup update' using errcode = '22023';
  end if;
  perform fulfilment.lock_schedule(v_workspace);
  -- The driver may record a pickup only for a stop on their own acknowledged current schedule.
  if not v_staff and not (p_stage = 'picked_up' and core.has_permission('delivery.read_own') and exists (
    select 1 from fulfilment.draft_placements p
    join lateral (
      select * from fulfilment.schedule_revisions where trip_id = p.trip_id order by revision desc limit 1
    ) r on r.driver_id = v_actor
    join fulfilment.schedule_acknowledgements k on k.revision_id = r.id and k.driver_id = v_actor
    where p.allocation_id = p_allocation
      and exists (select 1 from jsonb_array_elements(r.stops) s where s->>'id' = p_allocation::text)
  )) then
    raise exception 'pickup denied' using errcode = '42501';
  end if;

  select l.id, a.quantity into v_line, v_quantity
  from fulfilment.preparation_events a
  join fulfilment.order_lines l on l.id = a.line_id
  where a.id = p_allocation and a.allocation_id is null
    and l.workspace_id = v_workspace and l.origin_kind = 'supplier'
  for update of l;
  if not found then
    raise exception 'supplier pickup unavailable' using errcode = '42501';
  end if;

  select * into v_prior from fulfilment.pickup_events where id = p_request;
  if found then
    if v_prior.allocation_id = p_allocation and v_prior.actor_id = v_actor and v_prior.stage = p_stage
       and v_prior.quantity = p_quantity and v_prior.note is not distinct from v_note then
      return;
    end if;
    raise exception 'pickup request conflict' using errcode = 'P0001';
  end if;

  select coalesce(sum(quantity) filter (where stage = 'supplier_ready'), 0),
         coalesce(sum(quantity) filter (where stage = 'picked_up'), 0)
  into v_ready, v_picked from fulfilment.pickup_events where allocation_id = p_allocation;
  if (p_stage = 'supplier_ready' and v_ready + p_quantity > v_quantity)
     or (p_stage = 'picked_up' and v_picked + p_quantity > v_ready) then
    raise exception 'pickup exceeds eligible quantity' using errcode = '23514';
  end if;

  insert into fulfilment.pickup_events (id, line_id, allocation_id, stage, quantity, note, actor_id)
  values (p_request, v_line, p_allocation, p_stage, p_quantity, v_note, v_actor);
  update fulfilment.order_lines set version = version + 1 where id = v_line;
end $$;

create function api.synthetic_supplier_pickups()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or not coalesce(fulfilment.can_read_delivery_recovery(), false) then
    raise exception 'supplier pickup denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'canRecord', coalesce(fulfilment.can_decide_delivery_recovery(), false),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'document', l.document_reference, 'line', l.line_reference, 'item', l.item_label,
        'unit', l.unit, 'supplier', l.origin_label, 'quantity', a.quantity,
        'ready', k.ready, 'pickedUp', k.picked, 'trip', t.label, 'date', t.trip_date, 'events', k.entries
      ) order by (k.picked >= a.quantity), l.document_reference, l.line_reference, a.recorded_at, a.id)
      from fulfilment.order_lines l
      join fulfilment.preparation_events a on a.line_id = l.id and a.allocation_id is null
      left join fulfilment.draft_placements p on p.allocation_id = a.id
      left join fulfilment.draft_trips t on t.id = p.trip_id
      cross join lateral (
        select coalesce(sum(e.quantity) filter (where e.stage = 'supplier_ready'), 0) as ready,
               coalesce(sum(e.quantity) filter (where e.stage = 'picked_up'), 0) as picked,
               coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'quantity', e.quantity, 'note', e.note,
                 'actor', coalesce(pr.full_name, pr.email::text, e.actor_id::text), 'at', e.recorded_at)
                 order by e.recorded_at, e.id) filter (where e.id is not null), '[]'::jsonb) as entries
        from fulfilment.pickup_events e
        left join core.profiles pr on pr.user_id = e.actor_id
        where e.allocation_id = a.id
      ) k
      where l.workspace_id = v_workspace and l.origin_kind = 'supplier'
    ), '[]'::jsonb)
  );
end $$;

create function api.my_synthetic_pickups()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('allocation', s->>'id',
    'ready', coalesce((select sum(quantity) from fulfilment.pickup_events
      where allocation_id = (s->>'id')::uuid and stage = 'supplier_ready'), 0),
    'pickedUp', coalesce((select sum(quantity) from fulfilment.pickup_events
      where allocation_id = (s->>'id')::uuid and stage = 'picked_up'), 0))), '[]'::jsonb)
  from fulfilment.draft_trips t
  join lateral (
    select * from fulfilment.schedule_revisions where trip_id = t.id order by revision desc limit 1
  ) r on r.driver_id = auth.uid()
  cross join lateral jsonb_array_elements(r.stops) s
  where t.workspace_id = core.current_workspace_id() and core.has_permission('delivery.read_own') and s ? 'pickup'
$$;

revoke all on function api.record_synthetic_pickup(uuid, uuid, text, numeric, text),
  api.synthetic_supplier_pickups(), api.my_synthetic_pickups() from public, anon, authenticated;
grant execute on function api.record_synthetic_pickup(uuid, uuid, text, numeric, text),
  api.synthetic_supplier_pickups(), api.my_synthetic_pickups() to authenticated;

-- Read models gain the supplier flag; supplier readiness and pickup count as confirmed and collected.
create or replace function api.preparation_queue()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not core.has_permission('preparation.read') then
    raise exception 'preparation denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', l.id, 'document', l.document_reference, 'line', l.line_reference,
        'item', l.item_label, 'unit', l.unit, 'origin', l.origin_label, 'supplier', l.origin_kind = 'supplier',
        'ordered', l.ordered, 'version', l.version,
        'allocations', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', a.id, 'allocated', a.quantity, 'redelivery', a.redelivery_of is not null,
              'updates', coalesce((
                select jsonb_agg(
                  jsonb_build_object('packed', p.quantity, 'shortage', p.shortage,
                    'recordedAt', p.recorded_at, 'recordedBy', coalesce(pr.full_name, p.actor_id::text))
                  order by p.recorded_at, p.id
                )
                from fulfilment.preparation_events p
                left join core.profiles pr on pr.user_id = p.actor_id
                where p.allocation_id = a.id
              ), '[]'::jsonb),
              'warehouse', coalesce((
                select jsonb_agg(
                  jsonb_build_object('stage', w.stage, 'quantity', w.quantity, 'recipient', w.recipient,
                    'recordedAt', w.recorded_at, 'recordedBy', coalesce(pr.full_name, w.actor_id::text))
                  order by w.recorded_at, w.id
                )
                from fulfilment.warehouse_events w
                left join core.profiles pr on pr.user_id = w.actor_id
                where w.allocation_id = a.id
              ), '[]'::jsonb)
            ) order by a.recorded_at, a.id
          )
          from fulfilment.preparation_events a
          where a.line_id = l.id and a.allocation_id is null
        ), '[]'::jsonb)
      ) order by l.document_reference, l.line_reference
    )
    from fulfilment.order_lines l
    where l.workspace_id = core.current_workspace_id()
  ), '[]'::jsonb);
end
$$;

create or replace function api.synthetic_dispatch_drafts()
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
        'handedOver', w.handed_over, 'tripId', p.trip_id, 'version', coalesce(p.version, 0),
        'redelivery', a.redelivery_of is not null, 'supplier', l.origin_kind = 'supplier')
        order by l.document_reference, l.line_reference, a.recorded_at, a.id)
      from fulfilment.order_lines l
      join fulfilment.preparation_events a on a.line_id = l.id and a.allocation_id is null
      left join fulfilment.draft_placements p on p.allocation_id = a.id
      cross join lateral (
        select coalesce(sum(quantity) filter (where stage = 'ready'), 0) + coalesce((select sum(k.quantity)
          from fulfilment.pickup_events k where k.allocation_id = a.id and k.stage = 'supplier_ready'), 0) as confirmed,
               coalesce(sum(quantity) filter (where stage = 'handed_over'), 0) + coalesce((select sum(k.quantity)
          from fulfilment.pickup_events k where k.allocation_id = a.id and k.stage = 'picked_up'), 0) as handed_over
        from fulfilment.warehouse_events where allocation_id = a.id
      ) w
      where l.workspace_id = v_workspace
    ), '[]'::jsonb)
  );
end
$$;
