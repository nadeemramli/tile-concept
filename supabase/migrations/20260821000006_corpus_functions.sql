-- Corpus migration 6/6 — import lifecycle and the strict review gate.
--
-- The important change here is api.approve_review_item. Its previous body
-- (20260820000010_phase4_sources.sql:167) filled in whatever the source did not
-- say: currency became 'MYR', valid_from became today, min_quantity became 1, a
-- nameless product became 'Untitled product', and the price list was guessed
-- from the first active one matching the supplier. Each of those turns "we do
-- not know" into a published commercial fact.
--
-- It now collects every unresolved semantic and refuses with 23514, naming
-- them. Publication still stops at state='draft'; going live remains a separate
-- api.publish_price call, which is unchanged.

------------------------------------------------------------------------------
-- Import run lifecycle. The importer runs server-side under the secret key, but
-- these are written as permission-checked definer functions so the same
-- lifecycle is available to an authenticated operator without granting direct
-- table access.
------------------------------------------------------------------------------
create or replace function api.start_import_run(
  p_run_key text,
  p_pipeline_version text,
  p_target_env text,
  p_parser_name text default null,
  p_parser_version text default null,
  p_corpus_cutoff date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_id uuid;
begin
  perform core.require_permission('source.import');
  if nullif(trim(coalesce(p_run_key, '')), '') is null then
    raise exception 'a run key is required so an interrupted import can resume' using errcode = '23514';
  end if;

  -- Resuming an existing run is the normal case, not an error.
  select id into v_id from ingest.import_runs where workspace_id = v_ws and run_key = p_run_key;
  if found then
    update ingest.import_runs set status = 'running', completed_at = null where id = v_id;
    return v_id;
  end if;

  insert into ingest.import_runs (workspace_id, run_key, corpus_cutoff, pipeline_version,
                                  parser_name, parser_version, target_env, status, created_by)
  values (v_ws, p_run_key, p_corpus_cutoff, p_pipeline_version,
          p_parser_name, p_parser_version, p_target_env, 'running', auth.uid())
  returning id into v_id;

  perform audit.emit(v_ws, 'import_run.started', 'ingest', 'import_runs', v_id, null,
    jsonb_build_object('run_key', p_run_key, 'target_env', p_target_env), null, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function api.start_import_run(text,text,text,text,text,date) from public;
grant execute on function api.start_import_run(text,text,text,text,text,date) to authenticated, service_role;

create or replace function api.record_import_item(
  p_import_run_id uuid,
  p_item_kind text,
  p_external_key text,
  p_status text,
  p_checksum text default null,
  p_expected_count bigint default null,
  p_actual_count bigint default null,
  p_message text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r ingest.import_runs%rowtype; v_id uuid;
begin
  perform core.require_permission('source.import');
  select * into r from ingest.import_runs where id = p_import_run_id;
  if not found then raise exception 'import run not found'; end if;
  perform core.require_workspace(r.workspace_id);

  insert into ingest.import_items (workspace_id, import_run_id, item_kind, external_key, checksum,
                                   expected_count, actual_count, status, attempts, message)
  values (r.workspace_id, p_import_run_id, p_item_kind, p_external_key, p_checksum,
          p_expected_count, p_actual_count, p_status, 1, p_message)
  on conflict (workspace_id, item_kind, external_key) do update
    set import_run_id = excluded.import_run_id,
        checksum = coalesce(excluded.checksum, ingest.import_items.checksum),
        expected_count = coalesce(excluded.expected_count, ingest.import_items.expected_count),
        actual_count = coalesce(excluded.actual_count, ingest.import_items.actual_count),
        status = excluded.status,
        attempts = ingest.import_items.attempts + 1,
        message = excluded.message,
        updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function api.record_import_item(uuid,text,text,text,text,bigint,bigint,text) from public;
grant execute on function api.record_import_item(uuid,text,text,text,text,bigint,bigint,text) to authenticated, service_role;

create or replace function api.finish_import_run(
  p_import_run_id uuid,
  p_status text,
  p_counts jsonb default '{}'::jsonb,
  p_warning_count int default 0,
  p_error_code text default null,
  p_error_detail_safe text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare r ingest.import_runs%rowtype;
begin
  perform core.require_permission('source.import');
  select * into r from ingest.import_runs where id = p_import_run_id for update;
  if not found then raise exception 'import run not found'; end if;
  perform core.require_workspace(r.workspace_id);

  update ingest.import_runs
  set status = p_status, completed_at = now(), counts = coalesce(p_counts, '{}'::jsonb),
      warning_count = coalesce(p_warning_count, 0), error_code = p_error_code,
      error_detail_safe = p_error_detail_safe
  where id = p_import_run_id;

  perform audit.emit(r.workspace_id, 'import_run.finished', 'ingest', 'import_runs', p_import_run_id, null,
    jsonb_build_object('status', p_status, 'counts', p_counts), null, '{}'::jsonb);
end $$;
revoke all on function api.finish_import_run(uuid,text,jsonb,int,text,text) from public;
grant execute on function api.finish_import_run(uuid,text,jsonb,int,text,text) to authenticated, service_role;

------------------------------------------------------------------------------
-- The strict review gate.
------------------------------------------------------------------------------
create or replace function api.approve_review_item(
  p_review_item_id uuid,
  p_corrections jsonb default '{}'::jsonb,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ri ingest.review_items%rowtype;
  j ingest.ingestion_jobs%rowtype;
  a ingest.source_assets%rowtype;
  pl merch.price_lists%rowtype;
  d jsonb;
  missing text[] := '{}';
  v_product_id uuid;
  v_variant_id uuid;
  v_price_id uuid;
  v_unit_id uuid;
  v_qty_unit_id uuid;
  v_brand_id uuid;
  v_category_id uuid;
  v_list_id uuid;
  v_version_id uuid;
  v_amount numeric;
  v_currency char(3);
  v_tax_basis text;
  v_price_type text;
  v_market text;
  v_valid_from date;
  v_valid_to date;
  v_min_qty numeric;
  v_name text;
begin
  perform core.require_permission('review.approve');
  select * into ri from ingest.review_items where id = p_review_item_id for update;
  if not found then raise exception 'review item not found'; end if;
  perform core.require_workspace(ri.workspace_id);
  if ri.status <> 'pending' then raise exception 'this item has already been reviewed'; end if;

  -- Corrections win over the machine proposal.
  d := coalesce(ri.proposed, '{}'::jsonb) || coalesce(p_corrections, '{}'::jsonb);
  select * into j from ingest.ingestion_jobs where id = ri.job_id;
  select * into a from ingest.source_assets where id = j.source_asset_id;

  ----------------------------------------------------------------------------
  -- Collect every unresolved semantic first, then refuse once with all of them.
  -- A reviewer should not have to discover the blockers one failed click at a
  -- time.
  ----------------------------------------------------------------------------
  if ri.item_type in ('product', 'price') then
    v_brand_id   := coalesce(nullif(d->>'brand_id', '')::uuid, a.brand_id);
    v_category_id := nullif(d->>'category_id', '')::uuid;
    v_unit_id    := nullif(d->>'unit_id', '')::uuid;
    v_name       := coalesce(nullif(d->>'name', ''), nullif(d->>'code', ''));

    if v_name is null then missing := array_append(missing, 'name or code'); end if;
    if v_brand_id is null then missing := array_append(missing, 'brand_id'); end if;
  end if;

  if ri.item_type = 'product' then
    if v_category_id is null then missing := array_append(missing, 'category_id'); end if;
    if v_unit_id is null then missing := array_append(missing, 'unit_id (selling unit)'); end if;
  end if;

  if ri.item_type = 'price' then
    v_amount      := nullif(d->>'amount', '')::numeric;
    v_currency    := upper(nullif(d->>'currency', ''));
    v_tax_basis   := nullif(d->>'tax_basis', '');
    v_price_type  := nullif(d->>'price_type', '');
    v_market      := nullif(d->>'market', '');
    v_valid_from  := nullif(d->>'valid_from', '')::date;
    v_valid_to    := nullif(d->>'valid_to', '')::date;
    v_list_id     := nullif(d->>'price_list_id', '')::uuid;
    v_qty_unit_id := nullif(d->>'quantity_unit_id', '')::uuid;
    v_min_qty     := nullif(d->>'min_quantity', '')::numeric;

    if v_amount is null then missing := array_append(missing, 'amount'); end if;
    if v_currency is null then missing := array_append(missing, 'currency'); end if;
    if v_unit_id is null then missing := array_append(missing, 'unit_id (price unit basis)'); end if;
    -- 'unknown' is an honest extraction result, not an approvable tax basis.
    if v_tax_basis is null or v_tax_basis = 'unknown' then missing := array_append(missing, 'tax_basis'); end if;
    if v_price_type is null then missing := array_append(missing, 'price_type'); end if;
    if v_market is null then missing := array_append(missing, 'market'); end if;
    if v_valid_from is null then missing := array_append(missing, 'valid_from'); end if;
    if v_min_qty is null then missing := array_append(missing, 'min_quantity'); end if;
    -- No auto-selected price list: which programme a price belongs to is a
    -- commercial decision, not a lookup.
    if v_list_id is null then missing := array_append(missing, 'price_list_id'); end if;
  end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'cannot approve: the source does not establish %. Resolve each explicitly — none of these is defaulted.',
      array_to_string(missing, ', ')
      using errcode = '23514';
  end if;

  ----------------------------------------------------------------------------
  -- Identity: reuse an existing product with the same code before creating one.
  ----------------------------------------------------------------------------
  if ri.item_type in ('product', 'price') then
    select pr.id into v_product_id from merch.products pr
    where pr.workspace_id = ri.workspace_id
      and pr.code_key = core.normalize_key(d->>'code')
      and pr.code_key is not null
    limit 1;

    if v_product_id is null then
      insert into merch.products (workspace_id, brand_id, supplier_id, category_id, name, code,
                                  color, finish, material, status, review_state, reviewed_by, reviewed_at,
                                  source_ref, source_asset_id, confidence, created_by)
      values (ri.workspace_id, v_brand_id, a.supplier_id, v_category_id, v_name, nullif(d->>'code', ''),
              nullif(d->>'color', ''), nullif(d->>'finish', ''), nullif(d->>'material', ''),
              'active', 'reviewed', auth.uid(), now(),
              coalesce(nullif(d->>'source_ref', ''), a.name), a.id, ri.confidence, auth.uid())
      returning id into v_product_id;
    else
      update merch.products
      set review_state = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
          source_ref = coalesce(nullif(d->>'source_ref', ''), a.name), source_asset_id = a.id
      where id = v_product_id;
    end if;

    select v.id into v_variant_id from merch.product_variants v
    where v.product_id = v_product_id
      and (v.sku_key = core.normalize_key(d->>'sku') or v.is_default)
    order by (v.sku_key = core.normalize_key(d->>'sku')) desc
    limit 1;

    if v_variant_id is null then
      insert into merch.product_variants (workspace_id, product_id, sku, supplier_code, name, dimensions,
                                          selling_unit_id, is_default)
      values (ri.workspace_id, v_product_id, coalesce(nullif(d->>'sku', ''), nullif(d->>'code', '')),
              nullif(d->>'supplier_code', ''), 'Standard', coalesce(d->'dimensions', '{}'::jsonb),
              v_unit_id, true)
      returning id into v_variant_id;
    end if;
  end if;

  ----------------------------------------------------------------------------
  -- Price: the list is named explicitly and must belong to this workspace.
  ----------------------------------------------------------------------------
  if ri.item_type = 'price' then
    select * into pl from merch.price_lists where id = v_list_id and workspace_id = ri.workspace_id;
    if not found then
      raise exception 'price list not found in this workspace' using errcode = '23514';
    end if;

    -- Attach to the price-list version that covers the effective date, if the
    -- reviewer named one; otherwise leave it null rather than guessing.
    v_version_id := nullif(d->>'price_list_version_id', '')::uuid;

    insert into merch.variant_prices (workspace_id, price_list_id, price_list_version_id, variant_id,
                                      amount, currency, unit_id, quantity_unit_id, min_quantity,
                                      valid_from, valid_to, tax_basis, price_type, market,
                                      customer_tier, state, review_state, source_asset_id,
                                      source_version_id, source_ref, source_page_or_row,
                                      imported_at, created_by)
    values (ri.workspace_id, v_list_id, v_version_id, v_variant_id,
            v_amount, v_currency, v_unit_id, v_qty_unit_id, v_min_qty,
            v_valid_from, v_valid_to, v_tax_basis, v_price_type, v_market,
            nullif(d->>'customer_tier', ''), 'draft', 'reviewed', a.id,
            a.current_version_id, coalesce(nullif(d->>'source_ref', ''), a.name),
            nullif(d->>'source_page_or_row', ''), now(), auth.uid())
    returning id into v_price_id;
    -- Publishing still goes through api.publish_price so the overlap rule and
    -- its override live in one place.
  end if;

  update ingest.review_items
  set status = case when p_corrections = '{}'::jsonb or p_corrections is null then 'approved' else 'corrected' end,
      reviewed_by = auth.uid(), reviewed_at = now(), decision_note = p_note,
      published_object_id = coalesce(v_price_id, v_product_id)
  where id = p_review_item_id;

  if ri.record_id is not null then
    update ingest.ingestion_records set status = 'published' where id = ri.record_id;
  end if;

  insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id,
                                       decision, corrected_value, reason, reviewed_by)
  values (ri.workspace_id, 'review_item', p_review_item_id,
          case when p_corrections = '{}'::jsonb or p_corrections is null then 'approved' else 'corrected' end,
          nullif(p_corrections, '{}'::jsonb), p_note, auth.uid());

  perform audit.emit(ri.workspace_id, 'review_item.published', 'ingest', 'review_items', p_review_item_id,
    ri.proposed, d, p_note,
    jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id, 'price_id', v_price_id));

  return jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id, 'price_id', v_price_id);
end $$;
grant execute on function api.approve_review_item(uuid,jsonb,text) to authenticated;

------------------------------------------------------------------------------
-- Certificate approval.
--
-- A certificate found in a brand folder certifies whatever it says it
-- certifies, which is usually not "every SKU of that brand". Approval requires
-- a resolved scope; 'unknown' is refused.
------------------------------------------------------------------------------
create or replace function api.approve_certificate_candidate(
  p_candidate_id uuid,
  p_corrections jsonb default '{}'::jsonb,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c ingest.certificate_candidates%rowtype;
  d jsonb;
  missing text[] := '{}';
  v_scope_type text;
  v_cert_id uuid;
  v_expires date;
  v_issued date;
  v_validity text;
begin
  perform core.require_permission('review.approve');
  select * into c from ingest.certificate_candidates where id = p_candidate_id for update;
  if not found then raise exception 'certificate candidate not found'; end if;
  perform core.require_workspace(c.workspace_id);
  if c.review_state = 'approved' then raise exception 'this candidate has already been approved'; end if;

  d := coalesce(p_corrections, '{}'::jsonb);
  v_scope_type := coalesce(nullif(d->>'scope_type', ''), c.scope_type);

  if coalesce(nullif(d->>'title', ''), c.title_candidate) is null then missing := array_append(missing, 'title'); end if;
  if nullif(d->>'certificate_type', '') is null then missing := array_append(missing, 'certificate_type'); end if;
  if v_scope_type is null or v_scope_type = 'unknown' then
    missing := array_append(missing, 'scope_type (a folder location does not establish scope)');
  end if;
  -- The issuer may be explicitly unresolved, but that has to be stated.
  if nullif(d->>'issuing_organization_id', '') is null and coalesce((d->>'issuer_unresolved')::boolean, false) is false then
    missing := array_append(missing, 'issuing_organization_id (or issuer_unresolved=true)');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'cannot approve certificate: unresolved %', array_to_string(missing, ', ')
      using errcode = '23514';
  end if;

  v_issued  := nullif(d->>'issued_on', '')::date;
  v_expires := nullif(d->>'expires_on', '')::date;
  -- A stated "no expiry" and an unread expiry are different facts.
  v_validity := coalesce(
    nullif(d->>'validity_state', ''),
    case
      when v_expires is null and coalesce((d->>'not_dated')::boolean, false) then 'not_dated'
      when v_expires is null then 'unknown'
      when v_expires < current_date then 'expired'
      when v_expires < current_date + 90 then 'expiring'
      else 'valid'
    end);

  insert into merch.certificates (workspace_id, certificate_type, certificate_number, title,
                                  issuing_organization_id, holder_organization_id, standard_code,
                                  issued_on, expires_on, validity_state, source_asset_id,
                                  source_version_id, review_state, reviewed_by, reviewed_at, created_by)
  values (c.workspace_id, d->>'certificate_type', nullif(d->>'certificate_number', ''),
          coalesce(nullif(d->>'title', ''), c.title_candidate),
          nullif(d->>'issuing_organization_id', '')::uuid,
          nullif(d->>'holder_organization_id', '')::uuid,
          nullif(d->>'standard_code', ''), v_issued, v_expires, v_validity,
          c.source_asset_id, nullif(d->>'source_version_id', '')::uuid,
          'reviewed', auth.uid(), now(), auth.uid())
  returning id into v_cert_id;

  insert into merch.certificate_scopes (workspace_id, certificate_id, scope_type, organization_id,
                                        brand_id, product_category_id, product_id, variant_id,
                                        facility_text, scope_text_raw, review_state, reviewed_by, reviewed_at)
  values (c.workspace_id, v_cert_id, v_scope_type,
          nullif(d->>'organization_id', '')::uuid, nullif(d->>'brand_id', '')::uuid,
          nullif(d->>'product_category_id', '')::uuid, nullif(d->>'product_id', '')::uuid,
          nullif(d->>'variant_id', '')::uuid, nullif(d->>'facility_text', ''),
          coalesce(nullif(d->>'scope_text_raw', ''), c.scope_text_raw),
          'reviewed', auth.uid(), now());

  update ingest.certificate_candidates
  set review_state = 'approved', published_certificate_id = v_cert_id, updated_at = now()
  where id = p_candidate_id;

  insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id, review_target_key,
                                       decision, corrected_value, reason, reviewed_by)
  values (c.workspace_id, 'certificate_candidate', p_candidate_id, c.candidate_key,
          'approved', nullif(p_corrections, '{}'::jsonb), p_note, auth.uid());

  perform audit.emit(c.workspace_id, 'certificate.published', 'merch', 'certificates', v_cert_id, null,
    jsonb_build_object('candidate_key', c.candidate_key, 'scope_type', v_scope_type), p_note, '{}'::jsonb);
  return v_cert_id;
end $$;
grant execute on function api.approve_certificate_candidate(uuid,jsonb,text) to authenticated;

------------------------------------------------------------------------------
-- Media link approval and product-media publication.
--
-- Two separate gates on purpose: approving that an image really shows a variant
-- is a factual decision; publishing it is also a rights decision.
------------------------------------------------------------------------------
create or replace function api.approve_media_link(
  p_link_id uuid,
  p_variant_id uuid,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l ingest.media_asset_variant_links%rowtype; v merch.product_variants%rowtype;
begin
  perform core.require_permission('review.approve');
  select * into l from ingest.media_asset_variant_links where id = p_link_id for update;
  if not found then raise exception 'media link not found'; end if;
  perform core.require_workspace(l.workspace_id);

  -- A same-document association means "these appeared in one PDF". That is
  -- discovery context, not a product-image match.
  if l.link_basis = 'same_source_document' then
    raise exception 'a same-document link cannot be approved: re-link it to an exact page/region, supplier code, or manual match first'
      using errcode = '23514';
  end if;

  select * into v from merch.product_variants where id = p_variant_id;
  if not found then raise exception 'product variant not found'; end if;
  perform core.require_workspace(v.workspace_id);

  update ingest.media_asset_variant_links
  set product_variant_id = p_variant_id, review_state = 'approved',
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_link_id;

  insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id, review_target_key,
                                       decision, reason, reviewed_by)
  values (l.workspace_id, 'media_asset_variant_link', p_link_id, l.external_key, 'approved', p_note, auth.uid());
  return p_link_id;
end $$;
grant execute on function api.approve_media_link(uuid,uuid,text) to authenticated;

create or replace function api.publish_product_media(
  p_link_id uuid,
  p_alt_text text default null,
  p_sort_order int default 0,
  p_is_primary boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l ingest.media_asset_variant_links%rowtype;
  m ingest.media_assets%rowtype;
  v merch.product_variants%rowtype;
  v_id uuid;
begin
  perform core.require_permission('catalog.write');
  select * into l from ingest.media_asset_variant_links where id = p_link_id for update;
  if not found then raise exception 'media link not found'; end if;
  perform core.require_workspace(l.workspace_id);

  if l.review_state <> 'approved' or l.product_variant_id is null then
    raise exception 'this image is not a reviewed match for a variant yet' using errcode = '23514';
  end if;

  select * into m from ingest.media_assets where id = l.media_asset_id;
  if m.usage_rights_state <> 'accepted' then
    raise exception 'image usage rights are % — publication needs accepted rights', m.usage_rights_state
      using errcode = '23514';
  end if;
  if m.review_state <> 'approved' then
    raise exception 'the media asset itself has not been reviewed' using errcode = '23514';
  end if;

  select * into v from merch.product_variants where id = l.product_variant_id;

  insert into merch.product_media (workspace_id, product_id, variant_id, storage_bucket, storage_path,
                                   kind, caption, source_ref, is_primary, media_asset_id,
                                   media_asset_variant_link_id, usage_rights_state, review_state,
                                   alt_text, sort_order, reviewed_by, reviewed_at)
  values (l.workspace_id, v.product_id, v.id, m.storage_bucket, m.object_path,
          case when m.mime_type = 'application/pdf' then 'pdf' else 'image' end,
          p_alt_text, m.source_path, p_is_primary, m.id, l.id, 'accepted', 'reviewed',
          p_alt_text, coalesce(p_sort_order, 0), auth.uid(), now())
  returning id into v_id;

  perform audit.emit(l.workspace_id, 'product_media.published', 'merch', 'product_media', v_id, null,
    jsonb_build_object('media_asset_id', m.id, 'link_basis', l.link_basis), null, '{}'::jsonb);
  return v_id;
end $$;
grant execute on function api.publish_product_media(uuid,text,int,boolean) to authenticated;

------------------------------------------------------------------------------
-- Reconciliation read model. The importer compares these counts against the
-- corpus manifests; a divergence is an exception, not a rounding difference.
------------------------------------------------------------------------------
create or replace view api.corpus_reconciliation with (security_invoker = true) as
select
  a.id as workspace_id,
  (select count(*) from ingest.source_assets s where s.workspace_id = a.id and s.provider = 'google_drive') as source_assets,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'uploaded') as versions_uploaded,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'binary_not_staged') as versions_deferred,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'connector_text_only') as versions_connector_only,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'excluded_by_policy') as versions_excluded,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id) as media_assets,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id and m.asset_kind = 'pdf_page_render') as page_renders,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id and m.asset_kind = 'standalone_image') as standalone_images,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id and m.asset_kind = 'source_pdf') as source_pdfs,
  (select count(*) from ingest.visual_observations o where o.workspace_id = a.id) as visual_observations,
  (select count(*) from ingest.media_asset_variant_links k where k.workspace_id = a.id) as media_links,
  (select count(*) from ingest.variant_candidates c where c.workspace_id = a.id) as variant_candidates,
  (select count(*) from ingest.price_candidates c where c.workspace_id = a.id) as price_candidates,
  (select count(*) from ingest.certificate_candidates c where c.workspace_id = a.id) as certificate_candidates,
  (select count(*) from ingest.catalog_edition_candidates c where c.workspace_id = a.id) as catalog_edition_candidates,
  (select count(*) from ingest.commercial_amount_observations c where c.workspace_id = a.id) as commercial_amount_observations,
  (select count(*) from ingest.duplicate_code_groups g where g.workspace_id = a.id) as duplicate_code_groups,
  (select count(*) from ingest.shape_profiles p where p.workspace_id = a.id) as shape_profiles,
  (select count(*) from ingest.review_items r where r.workspace_id = a.id and r.task_type is not null) as corpus_review_tasks,
  -- The headline safety number: anything not pending here has been published.
  (select count(*) from ingest.variant_candidates c where c.workspace_id = a.id and c.review_state <> 'pending_review') as variant_candidates_not_pending,
  (select count(*) from ingest.price_candidates c where c.workspace_id = a.id and c.review_state <> 'pending_review') as price_candidates_not_pending,
  (select count(*) from ingest.certificate_candidates c where c.workspace_id = a.id and c.review_state <> 'pending_review') as certificate_candidates_not_pending
from core.workspaces a;
grant select on api.corpus_reconciliation to authenticated, service_role;
