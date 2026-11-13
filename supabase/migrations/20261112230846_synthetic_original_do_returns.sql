-- Physical receipt is a document-level observation independent of delivery and proof.
create table fulfilment.original_do_returns (
  workspace_id uuid not null references core.workspaces(id),
  document_reference text not null check (btrim(document_reference) <> ''),
  received_by uuid not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, document_reference)
);
alter table fulfilment.original_do_returns enable row level security;
revoke all on fulfilment.original_do_returns from public, anon, authenticated;

create function fulfilment.synthetic_delivered_do_lines(p_workspace uuid)
returns table (document_reference text, line_reference text, result_id uuid, has_proof boolean)
language sql stable set search_path = '' as $$
  select l.document_reference, l.line_reference, d.id, d.proof_name is not null
  from fulfilment.order_lines l
  join fulfilment.preparation_events e on e.line_id = l.id
  join fulfilment.delivery_results d on d.allocation_id = e.id
  where l.workspace_id = p_workspace and d.delivered > 0
$$;
revoke all on function fulfilment.synthetic_delivered_do_lines(uuid) from public, anon, authenticated;

create function api.synthetic_original_do_returns()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
begin
  if auth.uid() is null or v_workspace is null or not core.has_permission('admin.coordinate') then
    raise exception 'original DO queue denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'document', d.document_reference,
      'proofs', d.proofs,
      'receivedAt', r.received_at,
      'receivedBy', coalesce(p.full_name, p.email::text, r.received_by::text)
    ) order by (r.received_at is not null), d.document_reference)
    from (
      select document_reference, coalesce(jsonb_agg(
        jsonb_build_object('id', result_id, 'line', line_reference) order by line_reference, result_id
      ) filter (where has_proof), '[]'::jsonb) as proofs
      from fulfilment.synthetic_delivered_do_lines(v_workspace)
      group by document_reference
    ) d
    left join fulfilment.original_do_returns r
      on r.workspace_id = v_workspace and r.document_reference = d.document_reference
    left join core.profiles p on p.user_id = r.received_by
  ), '[]'::jsonb);
end;
$$;

create function api.receive_synthetic_original_do(p_document text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid := core.current_workspace_id();
  v_actor uuid := auth.uid();
begin
  if v_actor is null or v_workspace is null or not core.has_permission('admin.coordinate') then
    raise exception 'original DO receipt denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from fulfilment.synthetic_delivered_do_lines(v_workspace) d
    where d.document_reference = p_document
  ) then
    raise exception 'delivered DO unavailable' using errcode = '22023';
  end if;

  insert into fulfilment.original_do_returns (workspace_id, document_reference, received_by)
  values (v_workspace, p_document, v_actor)
  on conflict (workspace_id, document_reference) do nothing;
end;
$$;

revoke all on function api.synthetic_original_do_returns(), api.receive_synthetic_original_do(text)
  from public, anon, authenticated;
grant execute on function api.synthetic_original_do_returns(), api.receive_synthetic_original_do(text)
  to authenticated;
