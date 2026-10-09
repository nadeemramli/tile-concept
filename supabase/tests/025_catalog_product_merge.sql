-- TILE-21: human-confirmed catalogue product merge.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- Synthetic fixtures. S = survivor, D = duplicate, C = conflict pair, X = another workspace.
insert into core.workspaces(id, name, slug) values ('ca7a3000-0000-4000-8000-00000000000a', 'Synthetic merge isolation', 'synthetic-merge-isolation');
insert into merch.products(id, workspace_id, name, code, status) values
  ('ca7a3000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Synthetic Merge Tile', 'SYN-MRG', 'active'),
  ('ca7a3000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Synthetic Merge Tile (dup)', 'SYN-MRG-OLD', 'active'),
  ('ca7a3000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'Synthetic Conflict A', 'SYN-CA', 'active'),
  ('ca7a3000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', 'Synthetic Conflict B', 'SYN-CB', 'active'),
  ('ca7a3000-0000-4000-8000-000000000005', 'ca7a3000-0000-4000-8000-00000000000a', 'Synthetic Other Workspace', 'SYN-X', 'active');
insert into merch.product_variants(id, workspace_id, product_id, sku, is_default) values
  ('ca7a3000-0000-4000-8000-000000000011', '11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000001', 'SYN-MRG-60', true),
  ('ca7a3000-0000-4000-8000-000000000021', '11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000002', 'SYN-MRG-60', true),
  ('ca7a3000-0000-4000-8000-000000000022', '11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000002', 'SYN-MRG-120', false),
  ('ca7a3000-0000-4000-8000-000000000031', '11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000003', 'SYN-C', true),
  ('ca7a3000-0000-4000-8000-000000000041', '11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000004', 'SYN-C', true),
  ('ca7a3000-0000-4000-8000-000000000051', 'ca7a3000-0000-4000-8000-00000000000a', 'ca7a3000-0000-4000-8000-000000000005', 'SYN-X', true);

-- History hanging off the duplicate's variants: a price, stock, a sales line, media, an alias, an identical attribute.
insert into merch.variant_prices(id, workspace_id, price_list_id, variant_id, amount, currency, min_quantity, state, review_state, valid_from) values
  ('ca7a3000-0000-4000-8000-000000000061', '11111111-1111-1111-1111-111111111111', '37373737-0000-0000-0000-000000000001', 'ca7a3000-0000-4000-8000-000000000021', 55, 'MYR', 1, 'current', 'reviewed', '2026-09-01'),
  ('ca7a3000-0000-4000-8000-000000000062', '11111111-1111-1111-1111-111111111111', '37373737-0000-0000-0000-000000000001', 'ca7a3000-0000-4000-8000-000000000031', 10, 'MYR', 1, 'current', 'reviewed', '2026-09-01'),
  ('ca7a3000-0000-4000-8000-000000000063', '11111111-1111-1111-1111-111111111111', '37373737-0000-0000-0000-000000000001', 'ca7a3000-0000-4000-8000-000000000041', 11, 'MYR', 1, 'current', 'reviewed', '2026-09-01');
insert into stock.inventory_snapshots(id, workspace_id, source_id, location_id, variant_id, on_hand, available)
select 'ca7a3000-0000-4000-8000-000000000071', '11111111-1111-1111-1111-111111111111', s.id, l.id, 'ca7a3000-0000-4000-8000-000000000021', 12, 12
from stock.inventory_sources s, stock.inventory_locations l where s.workspace_id = '11111111-1111-1111-1111-111111111111' and s.key = 'sql_account' and l.source_id = s.id limit 1;
insert into stock.inventory_movements(id, workspace_id, source_id, variant_id, quantity, movement_type)
select 'ca7a3000-0000-4000-8000-000000000072', '11111111-1111-1111-1111-111111111111', id, 'ca7a3000-0000-4000-8000-000000000022', 3, 'receipt'
from stock.inventory_sources where workspace_id = '11111111-1111-1111-1111-111111111111' and key = 'sql_account';
insert into sales.purchase_items(id, purchase_id, description, product_variant_id)
select 'ca7a3000-0000-4000-8000-000000000073', id, 'Synthetic line', 'ca7a3000-0000-4000-8000-000000000021' from sales.purchases limit 1;
insert into merch.product_media(id, workspace_id, product_id, storage_path, kind, review_state, usage_rights_state, is_primary) values
  ('ca7a3000-0000-4000-8000-000000000081', '11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111/syn/s.jpg', 'image', 'reviewed', 'accepted', true),
  ('ca7a3000-0000-4000-8000-000000000082', '11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111/syn/d.jpg', 'image', 'reviewed', 'accepted', true);
insert into merch.product_aliases(workspace_id, product_id, alias, source) values ('11111111-1111-1111-1111-111111111111', 'ca7a3000-0000-4000-8000-000000000002', 'SYN legacy name', 'synthetic');
insert into merch.product_attribute_values(workspace_id, product_id, attribute_definition_id, value)
select '11111111-1111-1111-1111-111111111111', p, d.id, '"600"'::jsonb
from (values ('ca7a3000-0000-4000-8000-000000000001'::uuid), ('ca7a3000-0000-4000-8000-000000000002'::uuid)) v(p),
     merch.attribute_definitions d where d.workspace_id = '11111111-1111-1111-1111-111111111111' and d.key = 'width_mm';

create function pg_temp.fp(s uuid, d uuid, m jsonb) returns text language sql as $$ select api.preview_product_merge(s, d, m) ->> 'fingerprint' $$;
create function pg_temp.map() returns jsonb language sql as $$ select '{"ca7a3000-0000-4000-8000-000000000021":"ca7a3000-0000-4000-8000-000000000011","ca7a3000-0000-4000-8000-000000000022":null}'::jsonb $$;

------------------------------------------------------------------------------
-- Permission and workspace denials
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002')$$, '42501', 'permission denied: catalog.write', 'sales cannot preview a merge');
select throws_ok($$select api.merge_products('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002','{}','x','x',true)$$, '42501', 'permission denied: catalog.write', 'sales cannot merge');
select is((select count(*) from api.product_merges where merged_product_id::text like 'ca7a3000%'), 0::bigint, 'nothing merged yet');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000005')$$, '42501', 'workspace access denied', 'cross-workspace preview refused');
select throws_ok($$select api.merge_products('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000005','{}','dup','x',true)$$, '42501', 'workspace access denied', 'cross-workspace merge refused');

------------------------------------------------------------------------------
-- Preview: comparison, suggestions, impact, conflicts
------------------------------------------------------------------------------
select is((select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002') -> 'merged' -> 'variants' -> 0 ->> 'suggested_target'),
  'ca7a3000-0000-4000-8000-000000000011', 'same SKU is suggested as a variant pair');
select is((select (api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002', pg_temp.map()) -> 'counts' ->> 'variants_merged')::int), 1, 'preview counts the merged variant');
select is((select (api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002', pg_temp.map()) -> 'counts' ->> 'stock_records')::int), 2, 'preview counts stock records that will move');
select is((select (api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002', pg_temp.map()) -> 'counts' ->> 'sales_lines')::int),
  1, 'preview counts commercial lines it cannot itself see');
select is((select jsonb_array_length(api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002', pg_temp.map()) -> 'conflicts')), 0, 'no conflicts for the clean pair');
select ok((select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000003','ca7a3000-0000-4000-8000-000000000004','{"ca7a3000-0000-4000-8000-000000000041":"ca7a3000-0000-4000-8000-000000000031"}') -> 'conflicts' @> '[{"code":"current_price_conflict"}]'),
  'two current prices on one list are reported as a conflict');
select ok((select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000001') -> 'conflicts' @> '[{"code":"same_product"}]'), 'a product cannot merge into itself');
select ok((select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002','{"ca7a3000-0000-4000-8000-000000000031":null}') -> 'conflicts' @> '[{"code":"invalid_variant_map"}]'), 'a foreign variant in the map is refused');

------------------------------------------------------------------------------
-- Refusals that leave everything untouched
------------------------------------------------------------------------------
select throws_ok($$select api.merge_products('ca7a3000-0000-4000-8000-000000000003','ca7a3000-0000-4000-8000-000000000004','{"ca7a3000-0000-4000-8000-000000000041":"ca7a3000-0000-4000-8000-000000000031"}','same tile',
  pg_temp.fp('ca7a3000-0000-4000-8000-000000000003','ca7a3000-0000-4000-8000-000000000004','{"ca7a3000-0000-4000-8000-000000000041":"ca7a3000-0000-4000-8000-000000000031"}'),true)$$,
  '23514', null, 'a conflicting merge is refused');
select is((select variant_id from merch.variant_prices where id = 'ca7a3000-0000-4000-8000-000000000063'), 'ca7a3000-0000-4000-8000-000000000041'::uuid, 'refused merge moved nothing');
select throws_ok($$select api.merge_products('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002',pg_temp.map(),'same tile',pg_temp.fp('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002',pg_temp.map()),false)$$,
  '23514', 'a merge needs explicit confirmation', 'unconfirmed merge refused');
select throws_ok($$select api.merge_products('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002',pg_temp.map(),'  ',pg_temp.fp('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002',pg_temp.map()),true)$$,
  '23514', 'state why these are the same product', 'merge without a reason refused');
select throws_ok($$select api.merge_products('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002',pg_temp.map(),'same tile','stale-fingerprint',true)$$,
  '40001', null, 'a merge based on a stale preview is refused');

------------------------------------------------------------------------------
-- The merge
------------------------------------------------------------------------------
select lives_ok($$select api.merge_products('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002',pg_temp.map(),'Same series, duplicate import (synthetic)',
  pg_temp.fp('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002',pg_temp.map()),true)$$, 'operator merges after confirming the preview');
select is((select merged_into_product_id from api.products where id = 'ca7a3000-0000-4000-8000-000000000002'), 'ca7a3000-0000-4000-8000-000000000001'::uuid, 'duplicate points at its survivor');
select is((select status from api.products where id = 'ca7a3000-0000-4000-8000-000000000002'), 'archived', 'duplicate is archived, not deleted');
select is((select variant_id from api.variant_prices where id = 'ca7a3000-0000-4000-8000-000000000061'), 'ca7a3000-0000-4000-8000-000000000011'::uuid, 'price history follows the merged variant');
select is((select product_id from api.product_variants where id = 'ca7a3000-0000-4000-8000-000000000022'), 'ca7a3000-0000-4000-8000-000000000001'::uuid, 'unmatched variant moves to the survivor');
select is((select is_default from api.product_variants where id = 'ca7a3000-0000-4000-8000-000000000022'), false, 'moved variant does not displace the default');
select is((select status from api.product_variants where id = 'ca7a3000-0000-4000-8000-000000000021'), 'archived', 'merged-away variant shell is archived');
select is((select id from api.product_media where product_id = 'ca7a3000-0000-4000-8000-000000000001' and is_primary), 'ca7a3000-0000-4000-8000-000000000081'::uuid, 'the survivor keeps its primary image');
select is((select count(*) from api.product_media where product_id = 'ca7a3000-0000-4000-8000-000000000001'), 2::bigint, 'the duplicate''s media moved');
select ok((select count(*) = 3 from api.product_aliases where product_id = 'ca7a3000-0000-4000-8000-000000000001' and alias in ('SYN legacy name','Synthetic Merge Tile (dup)','SYN-MRG-OLD')), 'old aliases, name and code stay findable');
select is((select count(*) from api.product_attribute_values where product_id = 'ca7a3000-0000-4000-8000-000000000001' and variant_id is null), 1::bigint, 'identical attribute de-duplicated');
select is((select jsonb_array_length(removed_duplicates) from api.product_merges where merged_product_id = 'ca7a3000-0000-4000-8000-000000000002'), 1, 'the removed duplicate is kept in the merge record');
select is((select count(*) from api.product_merges where merged_product_id = 'ca7a3000-0000-4000-8000-000000000002' and merged_by = 'aaaaaaaa-0000-0000-0000-000000000006'), 1::bigint, 'merge record attributed');
reset role;
select is((select variant_id from stock.inventory_snapshots where id = 'ca7a3000-0000-4000-8000-000000000071'), 'ca7a3000-0000-4000-8000-000000000011'::uuid, 'stock snapshot follows the merged variant');
select is((select variant_id from stock.inventory_movements where id = 'ca7a3000-0000-4000-8000-000000000072'), 'ca7a3000-0000-4000-8000-000000000022'::uuid, 'movement stays on its moved variant');
select is((select product_variant_id from sales.purchase_items where id = 'ca7a3000-0000-4000-8000-000000000073'), 'ca7a3000-0000-4000-8000-000000000011'::uuid, 'commercial line follows the merged variant');
select ok(not exists (
  select 1 from merch.product_variants v where v.id in ('ca7a3000-0000-4000-8000-000000000021') and (
    exists (select 1 from merch.variant_prices where variant_id = v.id) or exists (select 1 from stock.inventory_snapshots where variant_id = v.id)
    or exists (select 1 from sales.purchase_items where product_variant_id = v.id))), 'nothing is left pointing at the merged-away variant');
select is((select count(*) from audit.audit_events where action in ('product.merged','product.merged_away') and object_id in ('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002')), 2::bigint, 'merge audited on both products');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok((select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000001','ca7a3000-0000-4000-8000-000000000002') -> 'conflicts' @> '[{"code":"already_merged"}]'), 'an already-merged product cannot be merged again');
select ok((select api.preview_product_merge('ca7a3000-0000-4000-8000-000000000002','ca7a3000-0000-4000-8000-000000000003') -> 'conflicts' @> '[{"code":"survivor_merged"}]'), 'a merged-away product cannot survive');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select merged_into_product_id from api.products where id = 'ca7a3000-0000-4000-8000-000000000002'), 'ca7a3000-0000-4000-8000-000000000001'::uuid, 'sales sees where the duplicate went');
select is((select count(*) from api.product_merges where merged_product_id = 'ca7a3000-0000-4000-8000-000000000002'), 1::bigint, 'catalogue readers see the merge record');
select * from finish();
rollback;
