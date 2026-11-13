-- TILE-48: one read-only exception view over the fulfilment records (PRD 3.3).
-- It computes from the same source rows as the working queues and grants no edit or approval.
create function api.synthetic_management_exceptions(p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or p_today is null or not coalesce(fulfilment.can_read_delivery_recovery(), false) then
    raise exception 'management exceptions denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    -- Stops on a trip dated before today with no recorded result, and past trips never published.
    'late', coalesce((
      select jsonb_agg(x.entry order by x.trip_date, x.label, x.sort) from (
        select t.trip_date, t.label, s.ordinality as sort, jsonb_build_object('trip', t.label, 'date', t.trip_date,
          'document', s.stop->>'document', 'line', s.stop->>'line', 'published', true) as entry
        from fulfilment.draft_trips t
        join lateral (
          select * from fulfilment.schedule_revisions where trip_id = t.id order by revision desc limit 1
        ) r on true
        cross join lateral jsonb_array_elements(r.stops) with ordinality as s(stop, ordinality)
        where t.workspace_id = v_workspace and t.trip_date < p_today
          and not exists (select 1 from fulfilment.delivery_results d where d.allocation_id = (s.stop->>'id')::uuid)
        union all
        select t.trip_date, t.label, 0, jsonb_build_object('trip', t.label, 'date', t.trip_date,
          'document', null, 'line', null, 'published', false)
        from fulfilment.draft_trips t
        where t.workspace_id = v_workspace and t.trip_date < p_today
          and exists (select 1 from fulfilment.draft_placements p where p.trip_id = t.id)
          and not exists (select 1 from fulfilment.schedule_revisions r where r.trip_id = t.id)
      ) x
    ), '[]'::jsonb),
    'unacknowledged', coalesce((
      select jsonb_agg(jsonb_build_object('trip', t.label, 'date', t.trip_date, 'revision', r.revision,
        'driver', coalesce(p.full_name, p.email::text, r.driver_id::text), 'publishedAt', r.published_at)
        order by t.trip_date, t.label)
      from fulfilment.draft_trips t
      join lateral (
        select * from fulfilment.schedule_revisions where trip_id = t.id order by revision desc limit 1
      ) r on true
      left join core.profiles p on p.user_id = r.driver_id
      where t.workspace_id = v_workspace
        and not exists (select 1 from fulfilment.schedule_acknowledgements a where a.revision_id = r.id)
    ), '[]'::jsonb),
    'unresolved', coalesce((
      select jsonb_agg(jsonb_build_object('document', l.document_reference, 'line', l.line_reference,
        'unit', l.unit, 'open', d.planned - d.delivered - c.decided, 'reason', d.reason, 'failed', d.delivered = 0)
        order by d.recorded_at, d.id)
      from fulfilment.delivery_results d
      join fulfilment.preparation_events e on e.id = d.allocation_id
      join fulfilment.order_lines l on l.id = e.line_id
      cross join lateral (
        select coalesce(sum(quantity), 0) as decided from fulfilment.delivery_recoveries where result_id = d.id
      ) c
      where l.workspace_id = v_workspace and d.planned - d.delivered - c.decided > 0
    ), '[]'::jsonb),
    'proof', coalesce((
      select jsonb_agg(jsonb_build_object('document', q.document, 'line', q.line, 'status', q.status)
        order by q.document, q.line, q.result_id)
      from (
        select i.result_id, i.document, i.line, case when i.proof_name is null then 'missing'
          when e.evidence_version = i.evidence_version then e.kind else 'unchecked' end as status
        from fulfilment.synthetic_proof_inputs(v_workspace) i
        left join lateral (
          select evidence_version, kind from fulfilment.synthetic_proof_events
          where result_id = i.result_id order by id desc limit 1
        ) e on true
      ) q
      where q.status in ('missing', 'unchecked', 'unclear', 'discrepancy')
    ), '[]'::jsonb),
    'paper', coalesce((
      select jsonb_agg(jsonb_build_object('document', d.document_reference) order by d.document_reference)
      from (select distinct document_reference from fulfilment.synthetic_delivered_do_lines(v_workspace)) d
      where not exists (select 1 from fulfilment.original_do_returns r
        where r.workspace_id = v_workspace and r.document_reference = d.document_reference)
    ), '[]'::jsonb),
    'pickup', coalesce((
      select jsonb_agg(jsonb_build_object('document', l.document_reference, 'line', l.line_reference,
        'supplier', l.origin_label, 'trip', t.label, 'date', t.trip_date)
        order by t.trip_date, l.document_reference, l.line_reference, a.id)
      from fulfilment.order_lines l
      join fulfilment.preparation_events a on a.line_id = l.id and a.allocation_id is null
      join fulfilment.draft_placements p on p.allocation_id = a.id
      join fulfilment.draft_trips t on t.id = p.trip_id
      where l.workspace_id = v_workspace and l.origin_kind = 'supplier'
        and not exists (select 1 from fulfilment.delivery_results d where d.allocation_id = a.id)
        and a.quantity > coalesce((select sum(k.quantity) from fulfilment.pickup_events k
          where k.allocation_id = a.id and k.stage = 'supplier_ready'), 0)
    ), '[]'::jsonb)
  );
end $$;

revoke all on function api.synthetic_management_exceptions(date) from public, anon, authenticated;
grant execute on function api.synthetic_management_exceptions(date) to authenticated;
