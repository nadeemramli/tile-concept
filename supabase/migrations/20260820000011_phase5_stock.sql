-- Phase 5 — Stock and supplier availability (PRD §7.7, §17).
-- In-house stock stays SQL Account's fact, mirrored read-only as snapshots.
-- Supplier availability is evidence with an age, never a movement ledger.
-- Unknown, stale, low, out and ask-supplier never collapse into zero.

------------------------------------------------------------------------------
-- Supplier availability snapshot. New snapshots supersede the displayed value
-- but never delete history.
------------------------------------------------------------------------------
create or replace function api.record_supplier_availability(
  p_supplier_id uuid,
  p_availability text,
  p_variant_id uuid default null,
  p_product_id uuid default null,
  p_quantity numeric default null,
  p_unit_id uuid default null,
  p_expected_replenishment date default null,
  p_source_channel text default 'call',
  p_evidence_storage_path text default null,
  p_notes text default null,
  p_captured_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_prev uuid;
  v_id uuid;
begin
  perform core.require_permission('stock.write');
  if p_availability not in ('available','low','out','made_to_order','ask_supplier','unknown') then
    raise exception 'availability must be available, low, out, made_to_order, ask_supplier or unknown' using errcode = '23514';
  end if;
  if p_variant_id is null and p_product_id is null then
    raise exception 'a snapshot needs a product or a variant' using errcode = '23514';
  end if;
  if p_availability = 'available' and p_quantity is not null and p_quantity < 0 then
    raise exception 'quantity cannot be negative' using errcode = '23514';
  end if;

  select id into v_prev from stock.supplier_availability_snapshots
  where workspace_id = v_ws and supplier_id = p_supplier_id
    and (p_variant_id is not null and variant_id = p_variant_id or p_variant_id is null and product_id = p_product_id)
  order by captured_at desc limit 1;

  insert into stock.supplier_availability_snapshots (
    workspace_id, supplier_id, variant_id, product_id, availability, quantity, unit_id,
    expected_replenishment, source_channel, evidence_storage_path, submitted_by, captured_at, notes, supersedes_id)
  values (v_ws, p_supplier_id, p_variant_id, p_product_id, p_availability, p_quantity, p_unit_id,
          p_expected_replenishment, p_source_channel, p_evidence_storage_path, auth.uid(), coalesce(p_captured_at, now()), p_notes, v_prev)
  returning id into v_id;

  -- Recording an update clears the "this supplier has gone quiet" flag.
  update ingest.data_quality_issues set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where workspace_id = v_ws and issue_type = 'stale_snapshot' and object_id = p_supplier_id and status = 'open';

  perform audit.emit(v_ws, 'supplier_snapshot.published', 'stock', 'supplier_availability_snapshots', v_id, null,
    jsonb_build_object('availability', p_availability, 'quantity', p_quantity, 'source', p_source_channel), p_notes, '{}'::jsonb);
  return v_id;
end $$;
grant execute on function api.record_supplier_availability(uuid,text,uuid,uuid,numeric,uuid,date,text,text,text,timestamptz) to authenticated;

------------------------------------------------------------------------------
-- In-house stock arrives from the local SQL Account connector as normalized
-- snapshots. Read-only by design: nothing here writes back to SQL Account,
-- and the app never subtracts a quotation on its own.
------------------------------------------------------------------------------
create or replace function api.record_inventory_snapshot(
  p_source_key text,
  p_external_item_code text,
  p_on_hand numeric default null,
  p_allocated numeric default null,
  p_available numeric default null,
  p_location_code text default null,
  p_unit_id uuid default null,
  p_source_timestamp timestamptz default null,
  p_checkpoint text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  src stock.inventory_sources%rowtype;
  loc stock.inventory_locations%rowtype;
  map stock.inventory_item_mappings%rowtype;
  v_id uuid;
begin
  perform core.require_permission('stock.write');
  select * into src from stock.inventory_sources where workspace_id = v_ws and key = p_source_key;
  if not found then raise exception 'unknown inventory source %', p_source_key using errcode = '23503'; end if;

  if p_location_code is not null then
    select * into loc from stock.inventory_locations where source_id = src.id and external_code = p_location_code;
    if not found then
      insert into stock.inventory_locations (workspace_id, source_id, external_code, name)
      values (v_ws, src.id, p_location_code, p_location_code) returning * into loc;
    end if;
  end if;

  -- Unmapped item codes are surfaced, not silently dropped.
  select * into map from stock.inventory_item_mappings where source_id = src.id and external_item_code = p_external_item_code;
  if not found then
    insert into stock.inventory_item_mappings (workspace_id, source_id, external_item_code, status)
    values (v_ws, src.id, p_external_item_code, 'unmapped') returning * into map;
    insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
    values (v_ws, 'unmapped_field', 'medium', 'inventory_item_mapping', map.id,
            format('Item code %s from %s is not mapped to a product', p_external_item_code, src.name),
            jsonb_build_object('source', p_source_key, 'external_item_code', p_external_item_code));
  end if;

  insert into stock.inventory_snapshots (workspace_id, source_id, location_id, variant_id, external_item_code,
                                         on_hand, allocated, available, unit_id, source_timestamp, checkpoint)
  values (v_ws, src.id, loc.id, map.variant_id, p_external_item_code, p_on_hand, p_allocated, p_available,
          coalesce(p_unit_id, map.unit_id), coalesce(p_source_timestamp, now()), p_checkpoint)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function api.record_inventory_snapshot(text,text,numeric,numeric,numeric,text,uuid,timestamptz,text) to authenticated;

create or replace function api.map_inventory_item(p_mapping_id uuid, p_variant_id uuid, p_unit_id uuid default null, p_ignore boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare m stock.inventory_item_mappings%rowtype;
begin
  perform core.require_permission('stock.write');
  select * into m from stock.inventory_item_mappings where id = p_mapping_id for update;
  if not found then raise exception 'mapping not found'; end if;
  perform core.require_workspace(m.workspace_id);
  update stock.inventory_item_mappings
  set variant_id = case when p_ignore then null else p_variant_id end,
      unit_id = coalesce(p_unit_id, unit_id),
      status = case when p_ignore then 'ignored' else 'mapped' end
  where id = p_mapping_id;
  -- Back-fill the snapshots already received under this code.
  if not p_ignore then
    update stock.inventory_snapshots s set variant_id = p_variant_id
    where s.source_id = m.source_id and s.external_item_code = m.external_item_code and s.variant_id is null;
  end if;
  update ingest.data_quality_issues set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where object_type = 'inventory_item_mapping' and object_id = p_mapping_id and status = 'open';
  perform audit.emit(m.workspace_id, 'inventory_item.mapped', 'stock', 'inventory_item_mappings', p_mapping_id, null,
    jsonb_build_object('variant_id', p_variant_id, 'ignored', p_ignore), null, '{}'::jsonb);
end $$;
grant execute on function api.map_inventory_item(uuid,uuid,uuid,boolean) to authenticated;

------------------------------------------------------------------------------
-- Reconciliation: compare the authority's number with the app's own evidence.
-- It records a discrepancy; it never overwrites SQL Account.
------------------------------------------------------------------------------
create or replace function api.open_reconciliation_case(p_variant_id uuid, p_source_id uuid, p_expected numeric, p_observed numeric, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid := core.current_workspace_id(); v_id uuid;
begin
  perform core.require_permission('stock.write');
  insert into stock.stock_reconciliation_cases (workspace_id, variant_id, source_id, expected, observed, status, notes)
  values (v_ws, p_variant_id, p_source_id, p_expected, p_observed, 'open', p_notes)
  returning id into v_id;
  perform audit.emit(v_ws, 'stock_reconciliation.opened', 'stock', 'stock_reconciliation_cases', v_id, null,
    jsonb_build_object('expected', p_expected, 'observed', p_observed), p_notes, '{}'::jsonb);
  return v_id;
end $$;
grant execute on function api.open_reconciliation_case(uuid,uuid,numeric,numeric,text) to authenticated;

create or replace function api.resolve_reconciliation_case(p_case_id uuid, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare c stock.stock_reconciliation_cases%rowtype;
begin
  perform core.require_permission('stock.write');
  if p_status not in ('investigating','resolved','accepted') then raise exception 'unknown status %', p_status using errcode = '23514'; end if;
  if nullif(trim(coalesce(p_notes, '')), '') is null then raise exception 'record what was found' using errcode = '23514'; end if;
  select * into c from stock.stock_reconciliation_cases where id = p_case_id for update;
  if not found then raise exception 'case not found'; end if;
  perform core.require_workspace(c.workspace_id);
  update stock.stock_reconciliation_cases
  set status = p_status, notes = p_notes, resolved_at = case when p_status in ('resolved','accepted') then now() end
  where id = p_case_id;
  perform audit.emit(c.workspace_id, 'stock_reconciliation.updated', 'stock', 'stock_reconciliation_cases', p_case_id,
    jsonb_build_object('status', c.status), jsonb_build_object('status', p_status), p_notes, '{}'::jsonb);
end $$;
grant execute on function api.resolve_reconciliation_case(uuid,text,text) to authenticated;

------------------------------------------------------------------------------
-- Availability read model. Every value carries its source, location/supplier,
-- unit, timestamp and freshness band — and states stay distinct.
------------------------------------------------------------------------------
create or replace view api.stock_availability with (security_invoker = true) as
with in_house as (
  select distinct on (s.variant_id, s.location_id)
    s.variant_id, s.location_id, s.source_id, s.on_hand, s.allocated, s.available, s.unit_id,
    s.source_timestamp, s.captured_at, s.external_item_code, s.workspace_id
  from stock.inventory_snapshots s
  order by s.variant_id, s.location_id, s.captured_at desc
),
supplier as (
  select distinct on (sa.supplier_id, coalesce(sa.variant_id, sa.product_id))
    sa.id, sa.supplier_id, sa.variant_id, sa.product_id, sa.availability, sa.quantity, sa.unit_id,
    sa.expected_replenishment, sa.source_channel, sa.captured_at, sa.evidence_storage_path, sa.submitted_by, sa.workspace_id, sa.notes
  from stock.supplier_availability_snapshots sa
  order by sa.supplier_id, coalesce(sa.variant_id, sa.product_id), sa.captured_at desc
)
select
  'in_house'::text as source_kind,
  ih.workspace_id, ih.variant_id, v.product_id, pr.name as product_name, pr.code as product_code,
  src.name as source_name, loc.name as location_name, null::uuid as supplier_id, null::text as supplier_name,
  case when ih.available is null and ih.on_hand is null then 'unknown'
       when coalesce(ih.available, ih.on_hand) <= 0 then 'out'
       when coalesce(ih.available, ih.on_hand) < 10 then 'low'
       else 'available' end as availability,
  coalesce(ih.available, ih.on_hand) as quantity,
  ih.on_hand, ih.allocated, u.code as unit_code,
  ih.source_timestamp as as_of, null::date as expected_replenishment, null::text as source_channel,
  coalesce(src.freshness_sla_minutes, 240) as sla_minutes, src.is_authoritative, null::text as evidence_storage_path, null::text as notes
from in_house ih
join merch.product_variants v on v.id = ih.variant_id
join merch.products pr on pr.id = v.product_id
join stock.inventory_sources src on src.id = ih.source_id
left join stock.inventory_locations loc on loc.id = ih.location_id
left join merch.units_of_measure u on u.id = ih.unit_id
union all
select
  'supplier'::text,
  sp.workspace_id, sp.variant_id, coalesce(v2.product_id, sp.product_id), pr2.name, pr2.code,
  'Supplier update'::text, null::text, sp.supplier_id, sup.name,
  sp.availability, sp.quantity, null::numeric, null::numeric, u2.code,
  sp.captured_at, sp.expected_replenishment, sp.source_channel,
  coalesce(fp.fresh_hours * 60, 4320), false, sp.evidence_storage_path, sp.notes
from supplier sp
join merch.suppliers sup on sup.id = sp.supplier_id
left join merch.product_variants v2 on v2.id = sp.variant_id
left join merch.products pr2 on pr2.id = coalesce(v2.product_id, sp.product_id)
left join merch.units_of_measure u2 on u2.id = sp.unit_id
left join stock.stock_freshness_policies fp on fp.supplier_id = sp.supplier_id;
grant select on api.stock_availability to authenticated;

-- Suppliers whose last update is older than their policy — the weekly queue.
create or replace view api.stale_supplier_queue with (security_invoker = true) as
select s.id as supplier_id, s.workspace_id, s.name as supplier_name,
       max(sa.captured_at) as last_update_at,
       coalesce(fp.fresh_hours, 72) as fresh_hours,
       coalesce(fp.aging_hours, 168) as aging_hours,
       count(sa.id) as snapshot_count,
       case
         when max(sa.captured_at) is null then 'unknown'
         when max(sa.captured_at) > now() - make_interval(hours => coalesce(fp.fresh_hours, 72)) then 'fresh'
         when max(sa.captured_at) > now() - make_interval(hours => coalesce(fp.aging_hours, 168)) then 'aging'
         else 'stale'
       end as freshness
from merch.suppliers s
left join stock.supplier_availability_snapshots sa on sa.supplier_id = s.id
left join stock.stock_freshness_policies fp on fp.supplier_id = s.id
where s.status = 'active'
group by s.id, s.workspace_id, s.name, fp.fresh_hours, fp.aging_hours;
grant select on api.stale_supplier_queue to authenticated;

-- Flag suppliers that have gone quiet. Called from the app; safe to re-run.
create or replace function api.flag_stale_suppliers()
returns int language plpgsql security definer set search_path = '' as $$
declare v_ws uuid := core.current_workspace_id(); r record; n int := 0;
begin
  perform core.require_permission('stock.write');
  for r in select * from api.stale_supplier_queue q where q.workspace_id = v_ws and q.freshness in ('stale','unknown') loop
    if not exists (select 1 from ingest.data_quality_issues d
                   where d.workspace_id = v_ws and d.issue_type = 'stale_snapshot' and d.object_id = r.supplier_id and d.status = 'open') then
      insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
      values (v_ws, 'stale_snapshot', 'medium', 'supplier', r.supplier_id,
              format('%s has no availability update within its freshness policy', r.supplier_name),
              jsonb_build_object('last_update_at', r.last_update_at, 'freshness', r.freshness));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
grant execute on function api.flag_stale_suppliers() to authenticated;
