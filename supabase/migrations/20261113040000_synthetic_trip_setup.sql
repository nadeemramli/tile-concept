-- Trip setup, sample orders and the PRD 3.5 write boundary for dispatch.
-- Until now trips, drivers and sample lines could only be created with direct SQL.

-- PRD 3.5 / 3.8: management inspects; planning, publishing and paper receipt belong to admin
-- employees and platform admins. Enforced on the rows so every existing command inherits it.
create function fulfilment.require_dispatch_writer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(core.current_role_key() not in ('admin', 'business_admin'), true) then
    raise exception 'dispatch changes are limited to admin employees' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function fulfilment.require_dispatch_writer() from public, anon, authenticated;
create trigger dispatch_writer_trips before insert or update on fulfilment.draft_trips
  for each row execute function fulfilment.require_dispatch_writer();
create trigger dispatch_writer_placements before insert or update on fulfilment.draft_placements
  for each row execute function fulfilment.require_dispatch_writer();
create trigger dispatch_writer_revisions before insert on fulfilment.schedule_revisions
  for each row execute function fulfilment.require_dispatch_writer();
create trigger dispatch_writer_paper before insert on fulfilment.original_do_returns
  for each row execute function fulfilment.require_dispatch_writer();

create function api.synthetic_drivers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or auth.uid() is null or not core.has_permission('admin.coordinate') then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.user_id,
      'name', coalesce(p.full_name, p.email::text, m.user_id::text)) order by p.full_name, m.user_id)
    from core.memberships m
    left join core.profiles p on p.user_id = m.user_id
    where m.workspace_id = v_workspace and m.role_key = 'driver' and m.status = 'active'
  ), '[]'::jsonb);
end $$;

create function api.create_synthetic_trip(p_label text, p_date date, p_driver uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_label text := nullif(btrim(p_label), '');
  v_trip uuid;
begin
  if v_workspace is null or not coalesce(fulfilment.can_decide_delivery_recovery(), false) then
    raise exception 'dispatch coordination denied' using errcode = '42501';
  end if;
  if v_label is null or char_length(v_label) > 100 or p_date is null then
    raise exception 'invalid trip' using errcode = '22023';
  end if;
  if p_driver is not null and not exists (
    select 1 from core.memberships where workspace_id = v_workspace and user_id = p_driver
      and role_key = 'driver' and status = 'active'
  ) then
    raise exception 'driver unavailable' using errcode = '22023';
  end if;
  perform fulfilment.lock_schedule(v_workspace);
  insert into fulfilment.draft_trips (workspace_id, label, trip_date, driver_id)
  values (v_workspace, v_label, p_date, p_driver)
  returning id into v_trip;
  return v_trip;
end $$;

-- Changing the driver changes the schedule token, so the trip shows unpublished changes and the
-- new driver must acknowledge a new revision before recording anything.
create function api.assign_synthetic_trip_driver(p_trip uuid, p_token text, p_driver uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_trip fulfilment.draft_trips%rowtype;
begin
  if v_workspace is null or not coalesce(fulfilment.can_decide_delivery_recovery(), false) then
    raise exception 'dispatch coordination denied' using errcode = '42501';
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
  if p_driver is not null and not exists (
    select 1 from core.memberships where workspace_id = v_workspace and user_id = p_driver
      and role_key = 'driver' and status = 'active'
  ) then
    raise exception 'driver unavailable' using errcode = '22023';
  end if;
  update fulfilment.draft_trips set driver_id = p_driver where id = p_trip and driver_id is distinct from p_driver;
end $$;

-- Sample orders for local review. Fixed synthetic references, never real documents; running it
-- again adds nothing. It stands in for the SQL Accounting import until that contract exists.
create function api.load_synthetic_fulfilment_samples()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_added integer;
begin
  if v_workspace is null or not coalesce(fulfilment.can_decide_delivery_recovery(), false) then
    raise exception 'sample orders denied' using errcode = '42501';
  end if;
  with added as (
    insert into fulfilment.order_lines
      (workspace_id, document_reference, line_reference, item_label, unit, origin_label, origin_kind, ordered)
    select v_workspace, s.document, s.line, s.item, s.unit, s.origin, s.kind, s.ordered
    from (values
      ('SAMPLE-DO-1001', '1', 'Sample porcelain tile 600x600 grey', 'box', 'Sample warehouse', 'warehouse', 40),
      ('SAMPLE-DO-1001', '2', 'Sample skirting 100x600 grey', 'pc', 'Sample warehouse', 'warehouse', 24),
      ('SAMPLE-DO-1002', '1', 'Sample mosaic sheet 300x300', 'sheet', 'Sample warehouse', 'warehouse', 12.5),
      ('SAMPLE-DO-1003', '1', 'Sample slab 1200x2400', 'pc', 'Sample supplier yard', 'supplier', 6),
      ('SAMPLE-DO-1004', '1', 'Sample outdoor tile 300x600', 'box', 'Sample warehouse', 'warehouse', 18)
    ) as s(document, line, item, unit, origin, kind, ordered)
    on conflict (workspace_id, document_reference, line_reference) do nothing
    returning id, document_reference, line_reference
  ), priced as (
    insert into fulfilment.synthetic_proof_agreements (line_id, reference, unit_price)
    select a.id, 'SAMPLE-QUOTE-' || right(a.document_reference, 4),
      case a.document_reference || '/' || a.line_reference
        when 'SAMPLE-DO-1001/1' then 88.5 when 'SAMPLE-DO-1001/2' then 12
        when 'SAMPLE-DO-1002/1' then 45.25 when 'SAMPLE-DO-1003/1' then 620 else 73 end
    from added a
    on conflict (line_id) do nothing
  )
  select count(*) into v_added from added;
  return v_added;
end $$;

revoke all on function api.synthetic_drivers(), api.create_synthetic_trip(text, date, uuid),
  api.assign_synthetic_trip_driver(uuid, text, uuid), api.load_synthetic_fulfilment_samples()
  from public, anon, authenticated;
grant execute on function api.synthetic_drivers(), api.create_synthetic_trip(text, date, uuid),
  api.assign_synthetic_trip_driver(uuid, text, uuid), api.load_synthetic_fulfilment_samples()
  to authenticated;
