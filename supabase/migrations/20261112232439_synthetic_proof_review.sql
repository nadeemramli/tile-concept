create table fulfilment.synthetic_proof_agreements (
  line_id uuid primary key references fulfilment.order_lines(id),
  version bigint not null default 1,
  reference text not null check (btrim(reference) <> ''),
  unit_price numeric(14,4) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric)
);

create function fulfilment.bump_synthetic_proof_agreement()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end $$;
create trigger synthetic_proof_agreement_version
  before update on fulfilment.synthetic_proof_agreements
  for each row execute function fulfilment.bump_synthetic_proof_agreement();
revoke all on function fulfilment.bump_synthetic_proof_agreement() from public, anon, authenticated;

create table fulfilment.synthetic_proof_approvers (
  workspace_id uuid not null references core.workspaces(id),
  user_id uuid not null references auth.users(id),
  primary key (workspace_id, user_id)
);

create table fulfilment.synthetic_proof_events (
  id bigint generated always as identity primary key,
  result_id uuid not null references fulfilment.delivery_results(id),
  evidence_version text not null,
  kind text not null check (kind in ('unclear', 'matched', 'discrepancy', 'approved')),
  observed_quantity numeric(14,3),
  observed_price numeric(14,4),
  quantity_mismatch boolean not null default false,
  price_mismatch boolean not null default false,
  note text,
  actor_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index synthetic_proof_events_latest_idx on fulfilment.synthetic_proof_events(result_id, id desc);
alter table fulfilment.synthetic_proof_agreements enable row level security;
alter table fulfilment.synthetic_proof_approvers enable row level security;
alter table fulfilment.synthetic_proof_events enable row level security;
revoke all on fulfilment.synthetic_proof_agreements, fulfilment.synthetic_proof_approvers,
  fulfilment.synthetic_proof_events from public, anon, authenticated;

create function fulfilment.can_review_synthetic_proof()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and core.has_permission('admin.coordinate')
    and core.current_role_key() in ('admin', 'business_admin', 'management')
$$;

create function fulfilment.can_approve_synthetic_proof()
returns boolean language sql stable set search_path = '' as $$
  select core.current_role_key() = 'management'
    and exists (select 1 from fulfilment.synthetic_proof_approvers a
      where a.workspace_id = core.current_workspace_id() and a.user_id = auth.uid())
$$;

create function fulfilment.synthetic_proof_inputs(p_workspace uuid)
returns table (result_id uuid, document text, line text, item text, unit text, ordered numeric,
  delivered numeric, planned numeric, agreement text, unit_price numeric, proof_name text, evidence_version text)
language sql stable set search_path = '' as $$
  select d.id, l.document_reference, l.line_reference, l.item_label, l.unit, l.ordered,
    d.delivered, d.planned, a.reference, a.unit_price, d.proof_name,
    encode(sha256(convert_to(jsonb_build_array(l.id, l.version, l.document_reference, l.line_reference,
      l.item_label, l.unit, l.ordered, a.version, a.reference, a.unit_price, d.revision_id, d.delivered, d.planned,
      d.receiving_pic, d.proof_name, d.proof_type, encode(sha256(d.proof_bytes), 'hex'))::text, 'UTF8')), 'hex')
  from fulfilment.delivery_results d
  join fulfilment.preparation_events e on e.id = d.allocation_id
  join fulfilment.order_lines l on l.id = e.line_id
  join fulfilment.schedule_revisions r on r.id = d.revision_id
  join fulfilment.draft_trips t on t.id = r.trip_id and t.workspace_id = l.workspace_id
  left join fulfilment.synthetic_proof_agreements a on a.line_id = l.id
  where l.workspace_id = p_workspace and d.delivered > 0
$$;
revoke all on function fulfilment.can_review_synthetic_proof(), fulfilment.can_approve_synthetic_proof(),
  fulfilment.synthetic_proof_inputs(uuid) from public, anon, authenticated;

create function api.synthetic_proof_review_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if v_workspace is null or not coalesce(fulfilment.can_review_synthetic_proof(), false) then
    raise exception 'proof review denied' using errcode = '42501';
  end if;
  return jsonb_build_object('canApprove', coalesce(fulfilment.can_approve_synthetic_proof(), false), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.result_id, 'document', i.document, 'line', i.line, 'item', i.item, 'unit', i.unit,
      'ordered', i.ordered, 'delivered', i.delivered, 'planned', i.planned, 'agreement', i.agreement, 'unitPrice', i.unit_price,
      'proof', i.proof_name, 'version', i.evidence_version, 'lastEvent', e.id::text,
      'status', case when i.proof_name is null then 'missing'
        when e.evidence_version = i.evidence_version then e.kind else 'unchecked' end,
      'changed', coalesce(e.evidence_version <> i.evidence_version, false),
      'history', history.entries
    ) order by i.document, i.line, i.result_id)
    from fulfilment.synthetic_proof_inputs(v_workspace) i
    left join lateral (
      select id, evidence_version, kind from fulfilment.synthetic_proof_events
      where result_id = i.result_id order by id desc limit 1
    ) e on true
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id::text, 'kind', h.kind, 'current', h.evidence_version = i.evidence_version,
        'quantity', h.observed_quantity, 'price', h.observed_price,
        'quantityMismatch', h.quantity_mismatch, 'priceMismatch', h.price_mismatch,
        'note', h.note, 'actor', coalesce(p.full_name, p.email::text, h.actor_id::text), 'at', h.recorded_at
      ) order by h.id desc), '[]'::jsonb) as entries
      from fulfilment.synthetic_proof_events h
      left join core.profiles p on p.user_id = h.actor_id
      where h.result_id = i.result_id
    ) history
  ), '[]'::jsonb));
end $$;

create function api.record_synthetic_proof_review(
  p_result uuid, p_version text, p_previous text, p_action text,
  p_quantity numeric default null, p_price numeric default null, p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_input record;
  v_previous fulfilment.synthetic_proof_events%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_kind text;
  v_quantity_mismatch boolean;
  v_price_mismatch boolean;
begin
  if v_workspace is null or not coalesce(fulfilment.can_review_synthetic_proof(), false) then
    raise exception 'proof review denied' using errcode = '42501';
  end if;
  if p_action = 'approve' and not coalesce(fulfilment.can_approve_synthetic_proof(), false) then
    raise exception 'manager designation required' using errcode = '42501';
  end if;
  -- Serialize proof decisions and prevent conflicting source/evidence changes during a decision.
  perform 1 from fulfilment.delivery_results d
  join fulfilment.preparation_events e on e.id = d.allocation_id
  join fulfilment.order_lines l on l.id = e.line_id
  where d.id = p_result and l.workspace_id = v_workspace
  for update of d, l;
  perform 1 from fulfilment.synthetic_proof_agreements a
  join fulfilment.preparation_events e on e.line_id = a.line_id
  join fulfilment.delivery_results d on d.allocation_id = e.id
  join fulfilment.order_lines l on l.id = e.line_id
  where d.id = p_result and l.workspace_id = v_workspace for share of a;

  select * into v_input from fulfilment.synthetic_proof_inputs(v_workspace) where result_id = p_result;
  if not found then raise exception 'proof review item unavailable' using errcode = '42501'; end if;
  select * into v_previous from fulfilment.synthetic_proof_events
    where result_id = p_result order by id desc limit 1;
  if p_version is distinct from v_input.evidence_version or nullif(p_previous, '') is distinct from v_previous.id::text then
    raise exception 'proof review changed' using errcode = '40001';
  end if;
  if v_input.proof_name is null or char_length(v_note) > 500 then
    raise exception 'review evidence unavailable or note too long' using errcode = '22023';
  end if;

  if p_action = 'approve' then
    if v_previous.kind is distinct from 'discrepancy' or v_previous.evidence_version <> p_version
      or v_note is null then
      raise exception 'current discrepancy and resolution required' using errcode = '22023';
    end if;
    v_kind := 'approved';
    p_quantity := v_previous.observed_quantity;
    p_price := v_previous.observed_price;
    v_quantity_mismatch := v_previous.quantity_mismatch;
    v_price_mismatch := v_previous.price_mismatch;
  else
    if v_previous.evidence_version = p_version and v_previous.kind in ('matched', 'discrepancy', 'approved') then
      raise exception 'current review already decided' using errcode = '40001';
    end if;
    if p_action = 'unclear' and v_note is not null then
      v_kind := 'unclear';
      p_quantity := null;
      p_price := null;
      v_quantity_mismatch := false;
      v_price_mismatch := false;
    elsif p_action = 'compare' and v_input.unit_price is not null
      and p_quantity between 0 and 99999999999.999 and p_quantity = round(p_quantity, 3)
      and p_price between 0 and 9999999999.9999 and p_price = round(p_price, 4) then
      v_quantity_mismatch := p_quantity <> v_input.delivered or p_quantity <> v_input.planned;
      v_price_mismatch := p_price <> v_input.unit_price;
      if (v_quantity_mismatch or v_price_mismatch) and v_note is null then
        raise exception 'describe the discrepancy' using errcode = '22023';
      end if;
      v_kind := case when v_quantity_mismatch or v_price_mismatch then 'discrepancy' else 'matched' end;
    else
      raise exception 'review values or explanation required' using errcode = '22023';
    end if;
  end if;
  insert into fulfilment.synthetic_proof_events (
    result_id, evidence_version, kind, observed_quantity, observed_price,
    quantity_mismatch, price_mismatch, note, actor_id
  ) values (p_result, p_version, v_kind, p_quantity, p_price,
    v_quantity_mismatch, v_price_mismatch, v_note, auth.uid());
end $$;

revoke all on function api.synthetic_proof_review_queue(),
  api.record_synthetic_proof_review(uuid,text,text,text,numeric,numeric,text) from public, anon, authenticated;
grant execute on function api.synthetic_proof_review_queue(),
  api.record_synthetic_proof_review(uuid,text,text,text,numeric,numeric,text) to authenticated;
