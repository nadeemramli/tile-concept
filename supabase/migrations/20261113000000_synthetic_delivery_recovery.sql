-- TILE-46: dispatch decides what happens to an undelivered balance.
-- A redelivery plans the balance again as a new stop on the same source line; a return records
-- that the goods physically came back. Neither decision posts stock or changes the order quantity.
alter table fulfilment.preparation_events
  add column redelivery_of uuid references fulfilment.delivery_results(id),
  add check (redelivery_of is null or allocation_id is null);
create index preparation_events_redelivery_idx on fulfilment.preparation_events(redelivery_of)
  where redelivery_of is not null;

create table fulfilment.delivery_recoveries (
  id uuid primary key,
  result_id uuid not null references fulfilment.delivery_results(id),
  kind text not null check (kind in ('redelivery', 'return')),
  quantity numeric(14,3) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  note text check (note is null or char_length(note) between 1 and 500),
  allocation_id uuid references fulfilment.preparation_events(id),
  actor_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check ((kind = 'redelivery' and allocation_id is not null)
    or (kind = 'return' and allocation_id is null and note is not null))
);
create index delivery_recoveries_result_idx on fulfilment.delivery_recoveries(result_id);
alter table fulfilment.delivery_recoveries enable row level security;
revoke all on fulfilment.delivery_recoveries from public, anon, authenticated;

-- Management can inspect the queue; only admin employees and platform admins decide (PRD 3.5).
create function fulfilment.can_read_delivery_recovery()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and core.has_permission('admin.coordinate')
    and core.current_role_key() in ('admin', 'business_admin', 'management')
$$;
create function fulfilment.can_decide_delivery_recovery()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and core.has_permission('admin.coordinate')
    and core.current_role_key() in ('admin', 'business_admin')
$$;
revoke all on function fulfilment.can_read_delivery_recovery(), fulfilment.can_decide_delivery_recovery()
  from public, anon, authenticated;

create function api.synthetic_delivery_recovery_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or not coalesce(fulfilment.can_read_delivery_recovery(), false) then
    raise exception 'delivery recovery denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'canDecide', coalesce(fulfilment.can_decide_delivery_recovery(), false),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'document', l.document_reference, 'line', l.line_reference, 'item', l.item_label,
        'unit', l.unit, 'trip', r.trip_label, 'date', r.trip_date,
        'planned', d.planned, 'delivered', d.delivered, 'reason', d.reason,
        'recordedBy', coalesce(p.full_name, p.email::text, d.recorded_by::text), 'recordedAt', d.recorded_at,
        'redelivery', e.redelivery_of is not null,
        'open', d.planned - d.delivered - decided.quantity,
        'decisions', decided.entries
      ) order by (d.planned - d.delivered - decided.quantity = 0), d.recorded_at, d.id)
      from fulfilment.delivery_results d
      join fulfilment.preparation_events e on e.id = d.allocation_id
      join fulfilment.order_lines l on l.id = e.line_id
      join fulfilment.schedule_revisions r on r.id = d.revision_id
      left join core.profiles p on p.user_id = d.recorded_by
      cross join lateral (
        select coalesce(sum(c.quantity), 0) as quantity, coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'kind', c.kind, 'quantity', c.quantity, 'note', c.note,
          'actor', coalesce(cp.full_name, cp.email::text, c.actor_id::text), 'at', c.recorded_at
        ) order by c.recorded_at, c.id), '[]'::jsonb) as entries
        from fulfilment.delivery_recoveries c
        left join core.profiles cp on cp.user_id = c.actor_id
        where c.result_id = d.id
      ) decided
      where l.workspace_id = v_workspace and d.delivered < d.planned
    ), '[]'::jsonb)
  );
end $$;

create function api.record_synthetic_delivery_recovery(
  p_request uuid, p_result uuid, p_kind text, p_quantity numeric, p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_actor uuid := auth.uid();
  v_note text := nullif(btrim(p_note), '');
  v_line uuid;
  v_open numeric;
  v_prior fulfilment.delivery_recoveries%rowtype;
  v_allocation uuid;
begin
  if v_workspace is null or not coalesce(fulfilment.can_decide_delivery_recovery(), false) then
    raise exception 'delivery recovery denied' using errcode = '42501';
  end if;
  if p_request is null or p_kind is null or p_kind not in ('redelivery', 'return')
     or p_quantity is null or not (p_quantity between 0.001 and 99999999999.999)
     or p_quantity <> round(p_quantity, 3) or char_length(v_note) > 500
     or (p_kind = 'return' and v_note is null) then
    raise exception 'invalid recovery decision' using errcode = '22023';
  end if;

  -- Same locks as scheduling and preparation, so a decision cannot race a move, publish or allocation.
  perform fulfilment.lock_schedule(v_workspace);
  select l.id, d.planned - d.delivered into v_line, v_open
  from fulfilment.delivery_results d
  join fulfilment.preparation_events e on e.id = d.allocation_id
  join fulfilment.order_lines l on l.id = e.line_id
  where d.id = p_result and l.workspace_id = v_workspace
  for update of l;
  if not found then
    raise exception 'delivery result unavailable' using errcode = '42501';
  end if;

  select * into v_prior from fulfilment.delivery_recoveries where id = p_request;
  if found then
    if v_prior.result_id = p_result and v_prior.actor_id = v_actor and v_prior.kind = p_kind
       and v_prior.quantity = p_quantity and v_prior.note is not distinct from v_note then
      return;
    end if;
    raise exception 'recovery request conflict' using errcode = 'P0001';
  end if;

  select v_open - coalesce(sum(quantity), 0) into v_open
  from fulfilment.delivery_recoveries where result_id = p_result;
  if p_quantity > v_open then
    raise exception 'recovery exceeds outstanding quantity' using errcode = '23514';
  end if;

  if p_kind = 'redelivery' then
    insert into fulfilment.preparation_events (id, line_id, quantity, shortage, actor_id, redelivery_of)
    values (gen_random_uuid(), v_line, p_quantity, 0, v_actor, p_result)
    returning id into v_allocation;
  end if;
  insert into fulfilment.delivery_recoveries (id, result_id, kind, quantity, note, allocation_id, actor_id)
  values (p_request, p_result, p_kind, p_quantity, v_note, v_allocation, v_actor);
  update fulfilment.order_lines set version = version + 1 where id = v_line;
end $$;

revoke all on function api.synthetic_delivery_recovery_queue(),
  api.record_synthetic_delivery_recovery(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function api.synthetic_delivery_recovery_queue(),
  api.record_synthetic_delivery_recovery(uuid, uuid, text, numeric, text) to authenticated;

-- A redelivery plans goods that were already allocated once, so it must not consume the
-- line's remaining ordered quantity. Only the allocation balance below changes.
create or replace function api.record_preparation(
  p_line_id uuid,
  p_version integer,
  p_request_id uuid,
  p_quantity numeric,
  p_shortage numeric,
  p_allocation_id uuid default null
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_line fulfilment.order_lines%rowtype;
  v_prior fulfilment.preparation_events%rowtype;
  v_allocated numeric;
  v_used numeric;
begin
  if not core.has_permission('preparation.read')
     or coalesce(core.current_role_key() not in ('warehouse', 'business_admin', 'admin'), true) then
    raise exception 'preparation denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_version is null or p_version < 0
     or p_quantity is null or p_shortage is null
     or not (p_quantity between 0 and 99999999999.999 and p_shortage between 0 and 99999999999.999)
     or p_quantity <> round(p_quantity, 3) or p_shortage <> round(p_shortage, 3)
     or p_quantity + p_shortage = 0 or (p_allocation_id is null and p_shortage <> 0) then
    raise exception 'invalid preparation quantity' using errcode = '22023';
  end if;

  -- Serialize all commands affecting the same source line before reading balances.
  select * into v_line from fulfilment.order_lines
  where id = p_line_id and workspace_id = core.current_workspace_id()
  for update;
  if not found then
    raise exception 'preparation line unavailable' using errcode = '42501';
  end if;

  select * into v_prior from fulfilment.preparation_events where id = p_request_id;
  if found then
    if v_prior.line_id = p_line_id and v_prior.actor_id = v_actor
      and v_prior.allocation_id is not distinct from p_allocation_id
      and v_prior.quantity = p_quantity and v_prior.shortage = p_shortage then
      return;
    end if;
    raise exception 'preparation request conflict' using errcode = 'P0001';
  end if;

  if p_version <> v_line.version then
    raise exception 'preparation line changed' using errcode = '40001';
  end if;

  if p_allocation_id is null then
    select coalesce(sum(quantity), 0) into v_used
    from fulfilment.preparation_events
    where line_id = p_line_id and allocation_id is null and redelivery_of is null;
    v_allocated := v_line.ordered;
  else
    select quantity into v_allocated from fulfilment.preparation_events
    where id = p_allocation_id and line_id = p_line_id and allocation_id is null;
    if not found then
      raise exception 'preparation allocation unavailable' using errcode = '22023';
    end if;
    select coalesce(sum(quantity + shortage), 0) into v_used
    from fulfilment.preparation_events where allocation_id = p_allocation_id;
  end if;
  if v_used + p_quantity + p_shortage > v_allocated then
    raise exception 'preparation exceeds remaining quantity' using errcode = '23514';
  end if;

  insert into fulfilment.preparation_events (id, line_id, allocation_id, quantity, shortage, actor_id)
  values (p_request_id, p_line_id, p_allocation_id, p_quantity, p_shortage, v_actor);
  update fulfilment.order_lines set version = version + 1 where id = p_line_id;
end
$$;

-- Both read models gain one flag so screens can label a redelivery and keep it out of line totals.
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
        'item', l.item_label, 'unit', l.unit, 'origin', l.origin_label,
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
        'redelivery', a.redelivery_of is not null)
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
