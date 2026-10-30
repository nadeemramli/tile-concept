-- TILE-21: human-confirmed merging of duplicate catalogue PRODUCTS.
-- (Customer / PIC duplicates are identity.merge_contacts — a different thing.)
--
-- A reviewer previews the merge, sees every record that will move and every
-- conflict that blocks it, decides per variant whether it moves to the
-- survivor or merges into one of the survivor's variants, and confirms with a
-- reason. api.merge_products recomputes the same preview under row locks and
-- refuses when anything changed since the reviewer saw it (fingerprint), when
-- a conflict exists, or when the products are not both in the caller's
-- workspace. Nothing is deleted except byte-identical duplicates (an equal
-- attribute value or packaging row), and those are kept in the merge record.
-- The merged product stays as an archived row pointing at its survivor, with
-- its merged-away variant shells, so provenance and audit history remain.
--
-- References re-pointed: every foreign key to merch.products and
-- merch.product_variants (22), plus the two soft references that carry
-- commercial history without a foreign key, sales.purchase_items and
-- sales.quote_items.product_variant_id.

alter table merch.products
  add column if not exists merged_into_product_id uuid references merch.products(id) on delete set null,
  add column if not exists merged_at timestamptz;

create table merch.product_merges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  survivor_product_id uuid not null references merch.products(id) on delete cascade,
  merged_product_id uuid not null unique references merch.products(id) on delete cascade,
  variant_map jsonb not null,
  impact jsonb not null,
  removed_duplicates jsonb not null default '[]'::jsonb,
  reason text not null check (btrim(reason) <> ''),
  merged_by uuid references auth.users(id),
  merged_at timestamptz not null default now()
);
create index product_merges_survivor_idx on merch.product_merges (survivor_product_id);
alter table merch.product_merges enable row level security;
create policy member_read on merch.product_merges for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('catalog.read')));
grant select on merch.product_merges to authenticated;
grant all on merch.product_merges to service_role;
create view api.product_merges with (security_invoker = true) as select * from merch.product_merges;
grant select on api.product_merges to authenticated;

-- The products view froze its column list; expose the merge pointer.
create or replace view api.products with (security_invoker = true) as select * from merch.products;

------------------------------------------------------------------------------
-- Impact: what would move, what blocks, and a fingerprint of all of it.
------------------------------------------------------------------------------
create or replace function merch.product_merge_impact(p_survivor uuid, p_merged uuid, p_map jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s merch.products%rowtype;
  m merch.products%rowtype;
  v_map jsonb := coalesce(p_map, '{}'::jsonb);
  v_conflicts jsonb := '[]'::jsonb;
  v_variants jsonb;
  v_survivor_variants jsonb;
  v_counts jsonb;
  v_merged_variants uuid[];
  r record;
begin
  select * into s from merch.products where id = p_survivor;
  select * into m from merch.products where id = p_merged;
  if s.id is null or m.id is null then raise exception 'product not found' using errcode = 'P0002'; end if;

  if s.id = m.id then
    v_conflicts := v_conflicts || jsonb_build_object('code', 'same_product', 'message', 'Choose two different products.');
  end if;
  if s.workspace_id <> m.workspace_id then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if m.merged_into_product_id is not null then
    v_conflicts := v_conflicts || jsonb_build_object('code', 'already_merged', 'message', 'The duplicate was already merged into another product.');
  end if;
  if s.merged_into_product_id is not null then
    v_conflicts := v_conflicts || jsonb_build_object('code', 'survivor_merged', 'message', 'The surviving product was itself merged away; pick its survivor instead.');
  end if;
  if s.status = 'archived' then
    v_conflicts := v_conflicts || jsonb_build_object('code', 'survivor_archived', 'message', 'The surviving product is archived. Choose an active product to keep.');
  end if;

  -- The variant map: keys are the duplicate's variants, values a survivor variant or null (move).
  for r in select key, value from jsonb_each(v_map) loop
    if not exists (select 1 from merch.product_variants where id::text = r.key and product_id = m.id) then
      v_conflicts := v_conflicts || jsonb_build_object('code', 'invalid_variant_map', 'message', 'A mapped variant does not belong to the duplicate product.');
    elsif jsonb_typeof(r.value) = 'string' and not exists (select 1 from merch.product_variants where id::text = (r.value #>> '{}') and product_id = s.id) then
      v_conflicts := v_conflicts || jsonb_build_object('code', 'invalid_variant_map', 'message', 'A target variant does not belong to the surviving product.');
    end if;
  end loop;
  select coalesce(array_agg(key::uuid), '{}') into v_merged_variants from jsonb_each(v_map) where jsonb_typeof(value) = 'string';

  -- Product-level facts that disagree.
  for r in
    select d.label, a.value as a_value, b.value as b_value
    from merch.product_attribute_values a
    join merch.product_attribute_values b on b.attribute_definition_id = a.attribute_definition_id and b.product_id = s.id and b.variant_id is null
    left join merch.attribute_definitions d on d.id = a.attribute_definition_id
    where a.product_id = m.id and a.variant_id is null and a.value is distinct from b.value
  loop
    v_conflicts := v_conflicts || jsonb_build_object('code', 'attribute_conflict', 'message', format('Products disagree on %s.', coalesce(r.label, 'an attribute')));
  end loop;

  -- Per merged variant pair.
  for r in
    select l.id as lv, l.sku as l_sku, t.id as tv, t.sku as t_sku
    from jsonb_each_text(v_map) e
    join merch.product_variants l on l.id::text = e.key and l.product_id = m.id
    join merch.product_variants t on t.id::text = e.value and t.product_id = s.id
  loop
    if exists (select 1 from merch.variant_prices a join merch.variant_prices b
                 on b.variant_id = r.tv and b.state = 'current' and b.price_list_id = a.price_list_id
                and coalesce(b.unit_id, '00000000-0000-0000-0000-000000000000') = coalesce(a.unit_id, '00000000-0000-0000-0000-000000000000')
                and b.min_quantity = a.min_quantity
               where a.variant_id = r.lv and a.state = 'current') then
      v_conflicts := v_conflicts || jsonb_build_object('code', 'current_price_conflict',
        'message', format('%s and %s both have a current price on the same list, unit and quantity. Supersede one before merging the variants, or move the variant instead.', coalesce(r.l_sku, 'the duplicate variant'), coalesce(r.t_sku, 'the survivor variant')));
    end if;
    if exists (select 1 from merch.packaging_configurations a join merch.packaging_configurations b on b.variant_id = r.tv and b.pack_label = a.pack_label
               where a.variant_id = r.lv
                 and (to_jsonb(a) - array['id','variant_id','workspace_id','created_at','updated_at']) is distinct from (to_jsonb(b) - array['id','variant_id','workspace_id','created_at','updated_at'])) then
      v_conflicts := v_conflicts || jsonb_build_object('code', 'packaging_conflict', 'message', format('%s and %s define the same pack differently.', coalesce(r.l_sku, 'the duplicate variant'), coalesce(r.t_sku, 'the survivor variant')));
    end if;
    if exists (select 1 from merch.product_attribute_values a join merch.product_attribute_values b on b.variant_id = r.tv and b.attribute_definition_id = a.attribute_definition_id
               where a.variant_id = r.lv and a.value is distinct from b.value) then
      v_conflicts := v_conflicts || jsonb_build_object('code', 'attribute_conflict', 'message', format('%s and %s disagree on a variant attribute.', coalesce(r.l_sku, 'the duplicate variant'), coalesce(r.t_sku, 'the survivor variant')));
    end if;
    if exists (select 1 from stock.inventory_snapshots a join stock.inventory_snapshots b on b.variant_id = r.tv and b.location_id = a.location_id
               where a.variant_id = r.lv and a.location_id is not null) then
      v_conflicts := v_conflicts || jsonb_build_object('code', 'stock_location_conflict',
        'message', format('%s and %s both hold stock records at the same warehouse; merging them would mix two balances. Move the variant instead.', coalesce(r.l_sku, 'the duplicate variant'), coalesce(r.t_sku, 'the survivor variant')));
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'sku', v.sku, 'name', v.name, 'supplier_code', v.supplier_code, 'status', v.status, 'updated_at', v.updated_at,
      'target', case when jsonb_typeof(v_map -> v.id::text) = 'string' then v_map ->> v.id::text end,
      'suggested_target', (select t.id from merch.product_variants t where t.product_id = s.id
                             and ((v.sku_key is not null and t.sku_key = v.sku_key) or (v.supplier_code_key is not null and t.supplier_code_key = v.supplier_code_key))
                           order by t.created_at limit 1),
      'prices', (select count(*) from merch.variant_prices x where x.variant_id = v.id),
      'stock_records', (select count(*) from stock.inventory_snapshots x where x.variant_id = v.id) + (select count(*) from stock.inventory_movements x where x.variant_id = v.id)
                       + (select count(*) from stock.inventory_item_mappings x where x.variant_id = v.id) + (select count(*) from stock.supplier_availability_snapshots x where x.variant_id = v.id)
                       + (select count(*) from stock.stock_reconciliation_cases x where x.variant_id = v.id),
      'sales_lines', (select count(*) from sales.purchase_items x where x.product_variant_id = v.id) + (select count(*) from sales.quote_items x where x.product_variant_id = v.id),
      'media', (select count(*) from merch.product_media x where x.variant_id = v.id)
    ) order by v.created_at), '[]'::jsonb)
  into v_variants from merch.product_variants v where v.product_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'sku', v.sku, 'name', v.name, 'supplier_code', v.supplier_code, 'updated_at', v.updated_at) order by v.created_at), '[]'::jsonb)
  into v_survivor_variants from merch.product_variants v where v.product_id = s.id;

  select jsonb_build_object(
    'variants_moved', (select count(*) from merch.product_variants where product_id = m.id and not (id = any (v_merged_variants))),
    'variants_merged', cardinality(v_merged_variants),
    'prices', (select count(*) from merch.variant_prices x join merch.product_variants v on v.id = x.variant_id where v.product_id = m.id),
    'stock_records', (select coalesce(sum((e->>'stock_records')::int), 0) from jsonb_array_elements(v_variants) e)
                     + (select count(*) from stock.supplier_availability_snapshots x where x.product_id = m.id and x.variant_id is null),
    'sales_lines', (select coalesce(sum((e->>'sales_lines')::int), 0) from jsonb_array_elements(v_variants) e),
    'media', (select count(*) from merch.product_media where product_id = m.id),
    'aliases', (select count(*) from merch.product_aliases where product_id = m.id),
    'attribute_values', (select count(*) from merch.product_attribute_values where product_id = m.id),
    'catalog_entries', (select count(*) from merch.catalog_entries where product_id = m.id),
    'certificate_scopes', (select count(*) from merch.certificate_scopes where product_id = m.id or variant_id in (select id from merch.product_variants where product_id = m.id)),
    'source_links', (select count(*) from ingest.variant_candidates x join merch.product_variants v on v.id = x.published_variant_id where v.product_id = m.id)
                    + (select count(*) from ingest.media_asset_variant_links x join merch.product_variants v on v.id = x.product_variant_id where v.product_id = m.id)
  ) into v_counts;

  return jsonb_build_object(
    'survivor', jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code, 'status', s.status, 'review_state', s.review_state, 'version', s.version, 'brand_id', s.brand_id, 'category_id', s.category_id, 'source_ref', s.source_ref,
                                   'variants', v_survivor_variants, 'media', (select count(*) from merch.product_media where product_id = s.id and archived_at is null)),
    'merged', jsonb_build_object('id', m.id, 'name', m.name, 'code', m.code, 'status', m.status, 'review_state', m.review_state, 'version', m.version, 'brand_id', m.brand_id, 'category_id', m.category_id, 'source_ref', m.source_ref,
                                 'variants', v_variants),
    'variant_map', v_map,
    'counts', v_counts,
    'conflicts', v_conflicts,
    'fingerprint', md5(jsonb_build_array(s.version, m.version, v_map, v_variants, v_survivor_variants, v_counts, v_conflicts)::text)
  );
end $$;
revoke all on function merch.product_merge_impact(uuid, uuid, jsonb) from public;

create or replace function api.preview_product_merge(p_survivor uuid, p_merged uuid, p_variant_map jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ws uuid;
begin
  perform core.require_permission('catalog.write');
  for v_ws in select workspace_id from merch.products where id in (p_survivor, p_merged) loop
    perform core.require_workspace(v_ws);
  end loop;
  return merch.product_merge_impact(p_survivor, p_merged, p_variant_map);
end $$;
revoke all on function api.preview_product_merge(uuid, uuid, jsonb) from public;
grant execute on function api.preview_product_merge(uuid, uuid, jsonb) to authenticated;

------------------------------------------------------------------------------
-- The merge itself: one transaction, under locks, only what was previewed.
------------------------------------------------------------------------------
create or replace function api.merge_products(
  p_survivor uuid, p_merged uuid, p_variant_map jsonb, p_reason text, p_expected_fingerprint text, p_confirmed boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s merch.products%rowtype;
  m merch.products%rowtype;
  v_map jsonb := coalesce(p_variant_map, '{}'::jsonb);
  v_impact jsonb;
  v_removed jsonb := '[]'::jsonb;
  v_merged_variants uuid[];
  v_survivor_has_primary boolean;
  v_merge_id uuid;
  r record;
begin
  perform core.require_permission('catalog.write');
  if not coalesce(p_confirmed, false) then
    raise exception 'a merge needs explicit confirmation' using errcode = '23514';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'state why these are the same product' using errcode = '23514';
  end if;

  -- Lock both in a fixed order so two reviewers cannot interleave.
  perform 1 from merch.products where id in (p_survivor, p_merged) order by id for update;
  select * into s from merch.products where id = p_survivor;
  select * into m from merch.products where id = p_merged;
  if s.id is null or m.id is null then raise exception 'product not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(s.workspace_id);
  perform core.require_workspace(m.workspace_id);
  perform 1 from merch.product_variants where product_id in (s.id, m.id) order by id for update;

  v_impact := merch.product_merge_impact(s.id, m.id, v_map);
  if jsonb_array_length(v_impact -> 'conflicts') > 0 then
    raise exception 'merge refused: %', (select string_agg(c ->> 'message', ' ') from jsonb_array_elements(v_impact -> 'conflicts') c)
      using errcode = '23514';
  end if;
  if p_expected_fingerprint is distinct from v_impact ->> 'fingerprint' then
    raise exception 'these products changed since the preview; preview the merge again' using errcode = '40001';
  end if;
  select coalesce(array_agg(key::uuid), '{}') into v_merged_variants from jsonb_each(v_map) where jsonb_typeof(value) = 'string';

  -- 1. Variants merged into a survivor variant: every reference follows.
  for r in select key::uuid as lv, value::uuid as tv from jsonb_each_text(v_map) where value is not null loop
    with d as (delete from merch.packaging_configurations a using merch.packaging_configurations b
               where a.variant_id = r.lv and b.variant_id = r.tv and b.pack_label = a.pack_label returning to_jsonb(a) as row)
    select v_removed || coalesce(jsonb_agg(jsonb_build_object('table', 'packaging_configurations', 'row', d.row)), '[]') into v_removed from d;
    with d as (delete from merch.product_attribute_values a using merch.product_attribute_values b
               where a.variant_id = r.lv and b.variant_id = r.tv and b.attribute_definition_id = a.attribute_definition_id returning to_jsonb(a) as row)
    select v_removed || coalesce(jsonb_agg(jsonb_build_object('table', 'product_attribute_values', 'row', d.row)), '[]') into v_removed from d;

    update merch.packaging_configurations set variant_id = r.tv where variant_id = r.lv;
    update merch.product_attribute_values set variant_id = r.tv, product_id = s.id where variant_id = r.lv;
    update merch.variant_prices set variant_id = r.tv where variant_id = r.lv;
    update merch.catalog_entries set variant_id = r.tv, product_id = s.id where variant_id = r.lv;
    update merch.product_media set variant_id = r.tv where variant_id = r.lv;
    update merch.unit_conversions set context_variant_id = r.tv where context_variant_id = r.lv;
    update merch.product_status_history set variant_id = r.tv where variant_id = r.lv;
    update merch.certificate_scopes set variant_id = r.tv where variant_id = r.lv;
    update stock.inventory_item_mappings set variant_id = r.tv where variant_id = r.lv;
    update stock.inventory_snapshots set variant_id = r.tv where variant_id = r.lv;
    update stock.inventory_movements set variant_id = r.tv where variant_id = r.lv;
    update stock.supplier_availability_snapshots set variant_id = r.tv, product_id = s.id where variant_id = r.lv;
    update stock.stock_reconciliation_cases set variant_id = r.tv where variant_id = r.lv;
    update ingest.variant_candidates set published_variant_id = r.tv where published_variant_id = r.lv;
    update ingest.media_asset_variant_links set product_variant_id = r.tv where product_variant_id = r.lv;
    update sales.purchase_items set product_variant_id = r.tv where product_variant_id = r.lv;
    update sales.quote_items set product_variant_id = r.tv where product_variant_id = r.lv;
    -- The emptied variant stays, archived, under the merged product.
    update merch.product_variants set status = 'archived', is_default = false where id = r.lv;
  end loop;

  -- 2. Product-level facts: identical duplicates removed (and kept in the record), the rest moved.
  with d as (delete from merch.product_attribute_values a using merch.product_attribute_values b
             where a.product_id = m.id and a.variant_id is null and b.product_id = s.id and b.variant_id is null
               and b.attribute_definition_id = a.attribute_definition_id returning to_jsonb(a) as row)
  select v_removed || coalesce(jsonb_agg(jsonb_build_object('table', 'product_attribute_values', 'row', d.row)), '[]') into v_removed from d;
  update merch.product_attribute_values set product_id = s.id where product_id = m.id and (variant_id is null or not (variant_id = any (v_merged_variants)));

  -- 3. Remaining variants move to the survivor and never displace its default.
  update merch.product_variants set product_id = s.id, is_default = false where product_id = m.id and not (id = any (v_merged_variants));

  -- 4. Media: the survivor's primary image wins; nothing else changes.
  select exists (select 1 from merch.product_media where product_id = s.id and is_primary and archived_at is null) into v_survivor_has_primary;
  update merch.product_media set is_primary = false
  where product_id = m.id and is_primary
    and (v_survivor_has_primary or not (kind = 'image' and archived_at is null and review_state = 'reviewed' and usage_rights_state = 'accepted'));
  update merch.product_media set product_id = s.id where product_id = m.id;

  update merch.catalog_entries set product_id = s.id where product_id = m.id;
  update merch.certificate_scopes set product_id = s.id where product_id = m.id;
  update stock.supplier_availability_snapshots set product_id = s.id where product_id = m.id;
  update merch.product_aliases set product_id = s.id where product_id = m.id;

  -- 5. The duplicate's name and code stay findable as aliases of the survivor.
  insert into merch.product_aliases (workspace_id, product_id, alias, source)
  select s.workspace_id, s.id, a.alias, 'merged_product:' || m.id
  from (values (m.name), (m.code)) a(alias)
  where nullif(btrim(a.alias), '') is not null
    and core.normalize_key(a.alias) is distinct from core.normalize_key(s.name)
    and core.normalize_key(a.alias) is distinct from s.code_key
    and not exists (select 1 from merch.product_aliases x where x.product_id = s.id and x.alias_key = core.normalize_key(a.alias));

  update merch.products set status = 'archived', merged_into_product_id = s.id, merged_at = now() where id = m.id;

  insert into merch.product_merges (workspace_id, survivor_product_id, merged_product_id, variant_map, impact, removed_duplicates, reason, merged_by)
  values (s.workspace_id, s.id, m.id, v_map, v_impact, v_removed, p_reason, auth.uid())
  returning id into v_merge_id;

  perform audit.emit(s.workspace_id, 'product.merged', 'merch', 'products', s.id,
    jsonb_build_object('merged_product', v_impact -> 'merged'), jsonb_build_object('counts', v_impact -> 'counts', 'variant_map', v_map), p_reason,
    jsonb_build_object('merge_id', v_merge_id, 'merged_product_id', m.id));
  perform audit.emit(s.workspace_id, 'product.merged_away', 'merch', 'products', m.id,
    jsonb_build_object('status', m.status), jsonb_build_object('status', 'archived', 'merged_into_product_id', s.id), p_reason,
    jsonb_build_object('merge_id', v_merge_id, 'survivor_product_id', s.id));
  return v_merge_id;
end $$;
revoke all on function api.merge_products(uuid, uuid, jsonb, text, text, boolean) from public;
grant execute on function api.merge_products(uuid, uuid, jsonb, text, text, boolean) to authenticated;
