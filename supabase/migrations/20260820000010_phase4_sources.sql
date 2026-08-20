-- Phase 4 — Source Library, imports, OCR review (PRD §7.8, §12.5, §17).
-- Assets are stored privately with a checksum; re-importing identical content
-- is idempotent; extraction produces staged review items; nothing reaches the
-- catalog or a price list without a human approving it.

------------------------------------------------------------------------------
-- Register an uploaded artifact. Same checksum => same asset (idempotent);
-- changed content on the same name => a new version.
------------------------------------------------------------------------------
create or replace function api.register_source_asset(
  p_name text,
  p_kind text,
  p_checksum text,
  p_storage_path text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_page_count int default null,
  p_supplier_id uuid default null,
  p_brand_id uuid default null,
  p_url text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  existing ingest.source_assets%rowtype;
  same_name ingest.source_assets%rowtype;
  v_id uuid;
  v_version int;
  v_reused boolean := false;
begin
  perform core.require_permission('source.import');
  if nullif(trim(coalesce(p_checksum, '')), '') is null then
    raise exception 'a checksum is required so re-imports can be detected' using errcode = '23514';
  end if;

  select * into existing from ingest.source_assets where workspace_id = v_ws and checksum = p_checksum limit 1;
  if found then
    -- Identical content: no new asset, no new job.
    perform audit.emit(v_ws, 'source_asset.duplicate_ignored', 'ingest', 'source_assets', existing.id, null,
      jsonb_build_object('checksum', p_checksum), 'Re-import of identical content', '{}'::jsonb);
    return jsonb_build_object('id', existing.id, 'reused', true, 'version', (select max(version_no) from ingest.source_asset_versions where source_asset_id = existing.id));
  end if;

  select * into same_name from ingest.source_assets where workspace_id = v_ws and name = p_name order by created_at desc limit 1;
  if found then
    -- Same document, new content: supersede in place and version it.
    v_id := same_name.id;
    update ingest.source_assets
    set checksum = p_checksum, storage_path = coalesce(p_storage_path, storage_path), mime_type = coalesce(p_mime_type, mime_type),
        size_bytes = coalesce(p_size_bytes, size_bytes), page_count = coalesce(p_page_count, page_count),
        supplier_id = coalesce(p_supplier_id, supplier_id), brand_id = coalesce(p_brand_id, brand_id),
        url = coalesce(p_url, url), status = 'uploaded', received_at = now(), uploaded_by = auth.uid()
    where id = v_id;
    select coalesce(max(version_no), 0) + 1 into v_version from ingest.source_asset_versions where source_asset_id = v_id;
  else
    insert into ingest.source_assets (workspace_id, name, kind, supplier_id, brand_id, storage_bucket, storage_path, url, checksum, mime_type, size_bytes, page_count, uploaded_by, status)
    values (v_ws, p_name, p_kind, p_supplier_id, p_brand_id, 'source-assets', p_storage_path, p_url, p_checksum, p_mime_type, p_size_bytes, p_page_count, auth.uid(), 'uploaded')
    returning id into v_id;
    v_version := 1;
  end if;

  insert into ingest.source_asset_versions (source_asset_id, version_no, checksum, storage_path)
  values (v_id, v_version, p_checksum, p_storage_path);

  perform audit.emit(v_ws, 'source_asset.registered', 'ingest', 'source_assets', v_id, null,
    jsonb_build_object('name', p_name, 'kind', p_kind, 'version', v_version), null, '{}'::jsonb);
  return jsonb_build_object('id', v_id, 'reused', v_reused, 'version', v_version);
end $$;
grant execute on function api.register_source_asset(text,text,text,text,text,bigint,int,uuid,uuid,text) to authenticated;

------------------------------------------------------------------------------
-- Job lifecycle. The parse itself runs in the application (native text first,
-- OCR only for raster pages); this records it durably and visibly.
------------------------------------------------------------------------------
create or replace function api.create_ingestion_job(p_source_asset_id uuid, p_job_type text, p_parser_version text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a ingest.source_assets%rowtype; v_id uuid;
begin
  perform core.require_permission('source.import');
  select * into a from ingest.source_assets where id = p_source_asset_id;
  if not found then raise exception 'source asset not found'; end if;
  perform core.require_workspace(a.workspace_id);
  insert into ingest.ingestion_jobs (workspace_id, source_asset_id, job_type, status, parser_version, started_at, created_by)
  values (a.workspace_id, p_source_asset_id, p_job_type, 'running', p_parser_version, now(), auth.uid())
  returning id into v_id;
  update ingest.source_assets set status = 'processing' where id = p_source_asset_id;
  return v_id;
end $$;
grant execute on function api.create_ingestion_job(uuid,text,text) to authenticated;

/**
 * Store one extraction pass. Records carry the raw row plus the normalized
 * proposal and its confidence; every field keeps its source text and page
 * region so a reviewer can compare the proposal against the document.
 */
create or replace function api.record_extraction(
  p_job_id uuid,
  p_records jsonb,          -- [{row_no, page_no, raw, normalized, confidence, item_type, issues, fields:[{key,value,confidence,source_text,region}]}]
  p_status text default 'succeeded',
  p_error text default null,
  p_stats jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j ingest.ingestion_jobs%rowtype;
  rec jsonb;
  fld jsonb;
  v_record_id uuid;
  v_review_id uuid;
  n_records int := 0;
  n_review int := 0;
  n_dupe int := 0;
  v_code text;
  v_dupe boolean;
begin
  perform core.require_permission('source.import');
  select * into j from ingest.ingestion_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  perform core.require_workspace(j.workspace_id);

  for rec in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    v_code := core.normalize_key(rec->'normalized'->>'code');
    v_dupe := v_code is not null and exists (
      select 1 from merch.products pr where pr.workspace_id = j.workspace_id and pr.code_key = v_code);

    insert into ingest.ingestion_records (job_id, row_no, page_no, raw, normalized, confidence, status, issues)
    values (p_job_id, (rec->>'row_no')::int, (rec->>'page_no')::int, coalesce(rec->'raw', '{}'::jsonb), rec->'normalized',
            (rec->>'confidence')::numeric, case when v_dupe then 'duplicate' else 'valid' end, coalesce(rec->'issues', '[]'::jsonb))
    returning id into v_record_id;
    n_records := n_records + 1;
    if v_dupe then n_dupe := n_dupe + 1; end if;

    for fld in select * from jsonb_array_elements(coalesce(rec->'fields', '[]'::jsonb)) loop
      insert into ingest.extracted_fields (record_id, field_key, value, confidence, region, source_text)
      values (v_record_id, fld->>'key', fld->>'value', (fld->>'confidence')::numeric, fld->'region', fld->>'source_text');
    end loop;

    insert into ingest.review_items (workspace_id, job_id, record_id, item_type, proposed, conflicts, status, confidence)
    values (j.workspace_id, p_job_id, v_record_id, coalesce(rec->>'item_type', 'product'), coalesce(rec->'normalized', '{}'::jsonb),
            case when v_dupe then jsonb_build_array(jsonb_build_object('code', 'duplicate_product', 'detail', 'A product with this code already exists')) else coalesce(rec->'issues', '[]'::jsonb) end,
            'pending', (rec->>'confidence')::numeric)
    returning id into v_review_id;
    n_review := n_review + 1;
  end loop;

  update ingest.ingestion_jobs
  set status = p_status, finished_at = now(), error = p_error, attempts = attempts + 1,
      stats = coalesce(p_stats, '{}'::jsonb) || jsonb_build_object('records', n_records, 'review_items', n_review, 'duplicates', n_dupe)
  where id = p_job_id;
  update ingest.source_assets set status = case when p_status = 'succeeded' then 'processed' else 'failed' end where id = j.source_asset_id;

  if p_status <> 'succeeded' then
    insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
    values (j.workspace_id, 'ocr_low_confidence', 'high', 'ingestion_job', p_job_id, coalesce(p_error, 'Extraction failed'), coalesce(p_stats, '{}'::jsonb));
  end if;

  perform audit.emit(j.workspace_id, 'ingestion.completed', 'ingest', 'ingestion_jobs', p_job_id, null,
    jsonb_build_object('records', n_records, 'duplicates', n_dupe, 'status', p_status), p_error, '{}'::jsonb);
  return jsonb_build_object('records', n_records, 'review_items', n_review, 'duplicates', n_dupe);
end $$;
grant execute on function api.record_extraction(uuid,jsonb,text,text,jsonb) to authenticated;

------------------------------------------------------------------------------
-- Publish a reviewed item. Corrections are the reviewer's, not the parser's;
-- the published record always carries its source reference and confidence.
------------------------------------------------------------------------------
create or replace function api.approve_review_item(p_review_item_id uuid, p_corrections jsonb default '{}'::jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ri ingest.review_items%rowtype;
  j ingest.ingestion_jobs%rowtype;
  a ingest.source_assets%rowtype;
  d jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_price_id uuid;
  v_unit_id uuid;
  v_brand_id uuid;
  v_category_id uuid;
  v_list_id uuid;
begin
  perform core.require_permission('review.approve');
  select * into ri from ingest.review_items where id = p_review_item_id for update;
  if not found then raise exception 'review item not found'; end if;
  perform core.require_workspace(ri.workspace_id);
  if ri.status <> 'pending' then raise exception 'this item has already been reviewed'; end if;

  d := coalesce(ri.proposed, '{}'::jsonb) || coalesce(p_corrections, '{}'::jsonb);
  select * into j from ingest.ingestion_jobs where id = ri.job_id;
  select * into a from ingest.source_assets where id = j.source_asset_id;

  if ri.item_type in ('product', 'price') then
    v_brand_id := coalesce(nullif(d->>'brand_id','')::uuid, a.brand_id);
    v_category_id := nullif(d->>'category_id','')::uuid;
    v_unit_id := nullif(d->>'unit_id','')::uuid;

    -- Reuse an existing product with the same code before creating one.
    select pr.id into v_product_id from merch.products pr
    where pr.workspace_id = ri.workspace_id and pr.code_key = core.normalize_key(d->>'code') and pr.code_key is not null
    limit 1;

    if v_product_id is null then
      insert into merch.products (workspace_id, brand_id, supplier_id, category_id, name, code, color, finish, material, status,
                                  review_state, reviewed_by, reviewed_at, source_ref, source_asset_id, confidence, created_by)
      values (ri.workspace_id, v_brand_id, a.supplier_id, v_category_id,
              coalesce(nullif(d->>'name',''), nullif(d->>'code',''), 'Untitled product'), nullif(d->>'code',''),
              nullif(d->>'color',''), nullif(d->>'finish',''), nullif(d->>'material',''), 'active',
              'reviewed', auth.uid(), now(), coalesce(nullif(d->>'source_ref',''), a.name), a.id, ri.confidence, auth.uid())
      returning id into v_product_id;
    else
      update merch.products set review_state = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
             source_ref = coalesce(nullif(d->>'source_ref',''), a.name), source_asset_id = a.id
      where id = v_product_id;
    end if;

    select v.id into v_variant_id from merch.product_variants v
    where v.product_id = v_product_id and (v.sku_key = core.normalize_key(d->>'sku') or v.is_default) order by (v.sku_key = core.normalize_key(d->>'sku')) desc limit 1;
    if v_variant_id is null then
      insert into merch.product_variants (workspace_id, product_id, sku, name, dimensions, selling_unit_id, is_default)
      values (ri.workspace_id, v_product_id, coalesce(nullif(d->>'sku',''), nullif(d->>'code','')), 'Standard',
              coalesce(d->'dimensions', '{}'::jsonb), v_unit_id, true)
      returning id into v_variant_id;
    end if;
  end if;

  if ri.item_type = 'price' and nullif(d->>'amount','') is not null then
    v_list_id := nullif(d->>'price_list_id','')::uuid;
    if v_list_id is null then
      select pl.id into v_list_id from merch.price_lists pl
      where pl.workspace_id = ri.workspace_id and pl.status = 'active'
        and (pl.supplier_id = a.supplier_id or pl.supplier_id is null)
      order by (pl.supplier_id = a.supplier_id) desc, pl.created_at limit 1;
    end if;
    if v_list_id is null then raise exception 'no price list to publish into — choose one' using errcode = '23514'; end if;

    insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, min_quantity,
                                      valid_from, state, review_state, source_asset_id, source_ref, imported_at, created_by)
    values (ri.workspace_id, v_list_id, v_variant_id, (d->>'amount')::numeric, coalesce(nullif(d->>'currency',''), 'MYR'), v_unit_id,
            coalesce((d->>'min_quantity')::numeric, 1), coalesce((d->>'valid_from')::date, current_date),
            'draft', 'reviewed', a.id, coalesce(nullif(d->>'source_ref',''), a.name), now(), auth.uid())
    returning id into v_price_id;
    -- Publishing the price itself still goes through publish_price so the
    -- overlap rule and its override are enforced in one place.
  end if;

  update ingest.review_items
  set status = case when p_corrections = '{}'::jsonb or p_corrections is null then 'approved' else 'corrected' end,
      reviewed_by = auth.uid(), reviewed_at = now(), decision_note = p_note,
      published_object_id = coalesce(v_price_id, v_product_id)
  where id = p_review_item_id;
  update ingest.ingestion_records set status = 'published' where id = ri.record_id;

  perform audit.emit(ri.workspace_id, 'review_item.published', 'ingest', 'review_items', p_review_item_id, ri.proposed, d, p_note,
    jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id, 'price_id', v_price_id));
  return jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id, 'price_id', v_price_id);
end $$;
grant execute on function api.approve_review_item(uuid,jsonb,text) to authenticated;

create or replace function api.reject_review_item(p_review_item_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare ri ingest.review_items%rowtype;
begin
  perform core.require_permission('review.approve');
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'rejection reason required' using errcode = '23514'; end if;
  select * into ri from ingest.review_items where id = p_review_item_id for update;
  if not found then raise exception 'review item not found'; end if;
  perform core.require_workspace(ri.workspace_id);
  update ingest.review_items set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), decision_note = p_reason where id = p_review_item_id;
  update ingest.ingestion_records set status = 'rejected' where id = ri.record_id;
  perform audit.emit(ri.workspace_id, 'review_item.rejected', 'ingest', 'review_items', p_review_item_id, ri.proposed, null, p_reason, '{}'::jsonb);
end $$;
grant execute on function api.reject_review_item(uuid,text) to authenticated;

------------------------------------------------------------------------------
-- Read models for the library and the review queue.
------------------------------------------------------------------------------
create or replace view api.source_library with (security_invoker = true) as
select a.id, a.workspace_id, a.name, a.kind, a.status, a.checksum, a.mime_type, a.size_bytes, a.page_count,
       a.storage_bucket, a.storage_path, a.url, a.received_at, a.uploaded_by,
       s.name as supplier_name, b.name as brand_name,
       (select max(v.version_no) from ingest.source_asset_versions v where v.source_asset_id = a.id) as version_no,
       (select count(*) from ingest.ingestion_jobs j where j.source_asset_id = a.id) as job_count,
       (select count(*) from ingest.review_items ri join ingest.ingestion_jobs j2 on j2.id = ri.job_id where j2.source_asset_id = a.id and ri.status = 'pending') as pending_reviews,
       (select max(j3.finished_at) from ingest.ingestion_jobs j3 where j3.source_asset_id = a.id) as last_processed_at
from ingest.source_assets a
left join merch.suppliers s on s.id = a.supplier_id
left join merch.brands b on b.id = a.brand_id;
grant select on api.source_library to authenticated;

create or replace view api.review_queue with (security_invoker = true) as
select ri.id, ri.workspace_id, ri.item_type, ri.proposed, ri.conflicts, ri.status, ri.confidence,
       ri.reviewed_by, ri.reviewed_at, ri.decision_note, ri.created_at, ri.published_object_id,
       j.id as job_id, j.job_type, j.parser_version,
       a.id as source_asset_id, a.name as source_name, a.kind as source_kind, a.storage_bucket, a.storage_path, a.page_count,
       s.name as supplier_name,
       r.row_no, r.page_no, r.raw,
       (select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'value', f.value, 'confidence', f.confidence, 'region', f.region, 'source_text', f.source_text) order by f.field_key), '[]'::jsonb)
          from ingest.extracted_fields f where f.record_id = r.id) as fields
from ingest.review_items ri
join ingest.ingestion_jobs j on j.id = ri.job_id
join ingest.source_assets a on a.id = j.source_asset_id
left join merch.suppliers s on s.id = a.supplier_id
left join ingest.ingestion_records r on r.id = ri.record_id;
grant select on api.review_queue to authenticated;
