create table fulfilment.warehouse_events (
  id uuid primary key,
  line_id uuid not null,
  allocation_id uuid not null,
  stage text not null check (stage in ('ready', 'handed_over')),
  quantity numeric(14,3) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  recipient text,
  actor_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (line_id, allocation_id) references fulfilment.preparation_events(line_id, id),
  check ((stage = 'ready' and recipient is null)
    or (stage = 'handed_over' and recipient is not null and char_length(btrim(recipient)) between 1 and 120))
);
create index warehouse_events_allocation_idx on fulfilment.warehouse_events(allocation_id, stage);
alter table fulfilment.warehouse_events enable row level security;
revoke all on fulfilment.warehouse_events from public, anon, authenticated;

create function api.record_warehouse_stage(
  p_line_id uuid,
  p_allocation_id uuid,
  p_version integer,
  p_request_id uuid,
  p_stage text,
  p_quantity numeric,
  p_recipient text default null
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_recipient text := nullif(btrim(p_recipient), '');
  v_version integer;
  v_prior fulfilment.warehouse_events%rowtype;
  v_ready numeric;
  v_handed_over numeric;
  v_packed numeric;
begin
  if v_actor is null or not core.has_permission('preparation.read')
     or coalesce(core.current_role_key() not in ('warehouse', 'business_admin', 'admin'), true) then
    raise exception 'preparation denied' using errcode = '42501';
  end if;

  if p_request_id is null or p_version is null or p_version < 0
     or p_stage is null or p_stage not in ('ready', 'handed_over')
     or p_quantity is null or not (p_quantity between 0.001 and 99999999999.999)
     or p_quantity <> round(p_quantity, 3)
     or (p_stage = 'ready' and v_recipient is not null)
     or (p_stage = 'handed_over' and (v_recipient is null or char_length(v_recipient) > 120)) then
    raise exception 'invalid warehouse update' using errcode = '22023';
  end if;

  -- The existing allocation and packing command takes the same source-line lock.
  select version into v_version
  from fulfilment.order_lines
  where id = p_line_id and workspace_id = core.current_workspace_id()
  for update;
  if not found then
    raise exception 'preparation line unavailable' using errcode = '42501';
  end if;

  select * into v_prior from fulfilment.warehouse_events where id = p_request_id;
  if found then
    if v_prior.line_id = p_line_id and v_prior.allocation_id = p_allocation_id
      and v_prior.actor_id = v_actor and v_prior.stage = p_stage
      and v_prior.quantity = p_quantity and v_prior.recipient is not distinct from v_recipient then
      return;
    end if;
    raise exception 'preparation request conflict' using errcode = 'P0001';
  end if;
  if p_version <> v_version then
    raise exception 'preparation line changed' using errcode = '40001';
  end if;
  if not exists (
    select 1 from fulfilment.preparation_events
    where id = p_allocation_id and line_id = p_line_id and allocation_id is null
  ) then
    raise exception 'preparation allocation unavailable' using errcode = '22023';
  end if;

  select coalesce(sum(quantity) filter (where stage = 'ready'), 0),
         coalesce(sum(quantity) filter (where stage = 'handed_over'), 0)
  into v_ready, v_handed_over
  from fulfilment.warehouse_events where allocation_id = p_allocation_id;

  select coalesce(sum(quantity), 0) into v_packed
  from fulfilment.preparation_events where allocation_id = p_allocation_id;

  if (p_stage = 'ready' and v_ready + p_quantity > v_packed)
     or (p_stage = 'handed_over' and v_handed_over + p_quantity > v_ready) then
    raise exception 'warehouse update exceeds eligible quantity' using errcode = '23514';
  end if;

  insert into fulfilment.warehouse_events (id, line_id, allocation_id, stage, quantity, recipient, actor_id)
  values (p_request_id, p_line_id, p_allocation_id, p_stage, p_quantity, v_recipient, v_actor);
  update fulfilment.order_lines set version = version + 1 where id = p_line_id;
end
$$;

revoke all on function api.record_warehouse_stage(uuid, uuid, integer, uuid, text, numeric, text) from public, anon;
grant execute on function api.record_warehouse_stage(uuid, uuid, integer, uuid, text, numeric, text) to authenticated;

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
              'id', a.id, 'allocated', a.quantity,
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
