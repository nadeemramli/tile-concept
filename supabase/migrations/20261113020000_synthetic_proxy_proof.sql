-- TILE-45: signed proof can be added after the delivery is recorded, by the driver or by authorized
-- staff on the driver's behalf. The real uploader, time and on-behalf reason are stored (PRD 5,
-- Signed documents). A delivery without proof stays "Missing proof" in the review queue.
alter table fulfilment.delivery_results
  drop constraint delivery_results_check2,
  add constraint delivery_results_recipient_check check (delivered = 0 or receiving_pic is not null),
  add column proof_uploaded_by uuid,
  add column proof_uploaded_at timestamptz,
  add column proof_reason text check (proof_reason is null or char_length(proof_reason) between 1 and 500);
update fulfilment.delivery_results
  set proof_uploaded_by = recorded_by, proof_uploaded_at = recorded_at
  where proof_bytes is not null;
alter table fulfilment.delivery_results add constraint delivery_results_uploader_check
  check ((proof_bytes is null) = (proof_uploaded_by is null) and (proof_bytes is null) = (proof_uploaded_at is null)
    and (proof_reason is null or proof_bytes is not null));

-- Proof supplied with the delivery itself is the recording driver's own upload.
create function fulfilment.stamp_proof_uploader()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.proof_bytes is not null and new.proof_uploaded_by is null then
    new.proof_uploaded_by := new.recorded_by;
    new.proof_uploaded_at := new.recorded_at;
  end if;
  return new;
end $$;
create trigger delivery_proof_uploader before insert on fulfilment.delivery_results
  for each row execute function fulfilment.stamp_proof_uploader();

create function fulfilment.decode_synthetic_proof(p_name text, p_type text, p_base64 text)
returns bytea language plpgsql immutable set search_path = '' as $$
declare
  v_bytes bytea;
  v_size integer;
begin
  if p_base64 is null or char_length(p_base64) > 955736 or p_name is null or char_length(p_name) > 150
     or p_name ~ '[[:cntrl:]/\\]' then
    raise exception 'invalid proof' using errcode = '22023';
  end if;
  begin
    v_bytes := decode(p_base64, 'base64');
  exception when others then
    raise exception 'invalid proof' using errcode = '22023';
  end;
  v_size := octet_length(v_bytes);
  if not (v_size between 12 and 716800) or not coalesce(
    case p_type
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
  return v_bytes;
end $$;
revoke all on function fulfilment.stamp_proof_uploader(), fulfilment.decode_synthetic_proof(text, text, text)
  from public, anon, authenticated;

create function api.attach_synthetic_delivery_proof(
  p_result uuid, p_name text, p_type text, p_base64 text, p_reason text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_name text := nullif(btrim(p_name), '');
  v_row fulfilment.delivery_results%rowtype;
  v_own boolean;
  v_bytes bytea;
begin
  if v_workspace is null or v_actor is null then
    raise exception 'proof upload denied' using errcode = '42501';
  end if;
  select d.* into v_row from fulfilment.delivery_results d
  join fulfilment.schedule_revisions r on r.id = d.revision_id
  join fulfilment.draft_trips t on t.id = r.trip_id
  where d.id = p_result and t.workspace_id = v_workspace
  for update of d;
  v_own := found and v_row.recorded_by = v_actor and core.has_permission('delivery.read_own');
  if not found or not (v_own or coalesce(fulfilment.can_review_synthetic_proof(), false)) then
    raise exception 'proof upload denied' using errcode = '42501';
  end if;
  if v_row.delivered = 0 or char_length(v_reason) > 500 or (not v_own and v_reason is null) then
    raise exception 'on-behalf reason required for a delivered result' using errcode = '22023';
  end if;
  v_bytes := fulfilment.decode_synthetic_proof(v_name, p_type, p_base64);
  if v_row.proof_bytes is not null then
    if v_row.proof_bytes = v_bytes and v_row.proof_uploaded_by = v_actor then
      return;
    end if;
    raise exception 'proof already stored' using errcode = '55000';
  end if;
  update fulfilment.delivery_results
  set proof_name = v_name, proof_type = p_type, proof_bytes = v_bytes,
      proof_uploaded_by = v_actor, proof_uploaded_at = clock_timestamp(),
      proof_reason = case when v_own then null else v_reason end
  where id = p_result;
end $$;

create function api.synthetic_proof_uploads()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or not coalesce(fulfilment.can_review_synthetic_proof(), false) then
    raise exception 'proof review denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('result', d.id,
      'driver', coalesce(dp.full_name, dp.email::text, d.recorded_by::text),
      'uploader', coalesce(up.full_name, up.email::text, d.proof_uploaded_by::text),
      'at', d.proof_uploaded_at, 'reason', d.proof_reason,
      'onBehalf', d.proof_uploaded_by is distinct from d.recorded_by and d.proof_uploaded_by is not null))
    from fulfilment.delivery_results d
    join fulfilment.schedule_revisions r on r.id = d.revision_id
    join fulfilment.draft_trips t on t.id = r.trip_id
    left join core.profiles dp on dp.user_id = d.recorded_by
    left join core.profiles up on up.user_id = d.proof_uploaded_by
    where t.workspace_id = v_workspace and d.delivered > 0
  ), '[]'::jsonb);
end $$;

revoke all on function api.attach_synthetic_delivery_proof(uuid, text, text, text, text),
  api.synthetic_proof_uploads() from public, anon, authenticated;
grant execute on function api.attach_synthetic_delivery_proof(uuid, text, text, text, text),
  api.synthetic_proof_uploads() to authenticated;

-- The driver may now record a delivery first and add the signed proof afterwards.
create or replace function api.record_synthetic_delivery(
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
  elsif p_proof_type is not null or v_name is not null then
    raise exception 'invalid proof' using errcode = '22023';
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
