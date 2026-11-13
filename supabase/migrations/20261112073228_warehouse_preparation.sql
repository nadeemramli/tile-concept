-- Local fixture input stands in for the future read-only delivery order adapter.
-- Preparation events reference the source line and never modify order quantities or stock.
create schema fulfilment;

create table fulfilment.order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id),
  document_reference text not null check (btrim(document_reference) <> ''),
  line_reference text not null check (btrim(line_reference) <> ''),
  item_label text not null check (btrim(item_label) <> ''),
  unit text not null check (btrim(unit) <> ''),
  origin_label text not null check (btrim(origin_label) <> ''),
  ordered numeric(14,3) not null check (ordered > 0 and ordered <> 'NaN'::numeric),
  version integer not null default 0,
  unique (workspace_id, document_reference, line_reference)
);

create table fulfilment.preparation_events (
  id uuid primary key,
  line_id uuid not null references fulfilment.order_lines(id),
  allocation_id uuid references fulfilment.preparation_events(id),
  quantity numeric(14,3) not null check (quantity >= 0 and quantity <> 'NaN'::numeric),
  shortage numeric(14,3) not null default 0 check (shortage >= 0 and shortage <> 'NaN'::numeric),
  actor_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (line_id, id),
  foreign key (line_id, allocation_id) references fulfilment.preparation_events(line_id, id),
  check (
    (allocation_id is null and quantity > 0 and shortage = 0)
    or (allocation_id is not null and quantity + shortage > 0)
  )
);
create index preparation_events_allocation_idx on fulfilment.preparation_events(allocation_id);
alter table fulfilment.order_lines enable row level security;
alter table fulfilment.preparation_events enable row level security;
revoke all on schema fulfilment from public, anon, authenticated;
revoke all on all tables in schema fulfilment from public, anon, authenticated;

create function api.preparation_queue()
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

create function api.record_preparation(
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
    from fulfilment.preparation_events where line_id = p_line_id and allocation_id is null;
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

revoke all on function api.preparation_queue() from public, anon;
revoke all on function api.record_preparation(uuid, integer, uuid, numeric, numeric, uuid) from public, anon;
grant execute on function api.preparation_queue() to authenticated;
grant execute on function api.record_preparation(uuid, integer, uuid, numeric, numeric, uuid) to authenticated;
