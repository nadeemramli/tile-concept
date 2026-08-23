-- Give the published catalog a vocabulary, and fill it from what the sources say.
--
-- 5,087 products are live with a name, a code, a brand and a price, and nothing
-- that says what a tile actually *is* — no size, no thickness, no packaging.
-- merch.attribute_definitions and merch.category_attribute_rules were defined in
-- the local seed and never applied to a real database, so the vocabulary existed
-- only in a demo fixture.
--
-- This migration does two separable things:
--
--   1. Installs the vocabulary (the seed's set, plus cartons_per_pallet, which
--      the corpus supplies for 3,743 variants and the seed never anticipated).
--   2. Fills it from the corpus, for the dimensions and packaging the sources
--      state outright.
--
-- The unit rule is the whole of the care here. 728 published variants give a
-- size in centimetres and 266 in millimetres, both explicitly. 328 give a bare
-- number — "306X 306X6". Read as millimetres that is an ordinary 306mm tile,
-- and read as centimetres it is absurd, so mm is almost certainly right. Almost
-- certainly is a guess, and a guessed millimetre is indistinguishable from a
-- stated one once it is a number in a column. Those 328 become a review task
-- instead. The same applies to the 26 variants whose source offers more than one
-- size: which one is the product is not ours to pick.
--
-- On a database with no corpus every population statement matches nothing.
--
-- The vocabulary block follows the same convention as
-- …08_reference_vocabulary.sql: on a fresh local reset it is a no-op, because
-- migrations run before seeds and no workspace exists yet, and supabase/seed.sql
-- states the identical vocabulary a moment later. Keep the two in step — if you
-- add a key here, add it there. On a deployed database, whose workspace already
-- exists, this is what fills the gap.

------------------------------------------------------------------------------
-- 1. The vocabulary.
------------------------------------------------------------------------------
insert into merch.attribute_definitions (workspace_id, key, label, data_type, unit, description)
select w.id, d.key, d.label, d.data_type, d.unit, d.description
from core.workspaces w
cross join (values
  ('width_mm',          'Width',                       'dimension', 'mm',    null),
  ('length_mm',         'Length',                      'dimension', 'mm',    null),
  ('thickness_mm',      'Thickness',                   'dimension', 'mm',    null),
  ('depth_mm',          'Depth',                       'dimension', 'mm',    null),
  ('sheet_width_mm',    'Sheet width',                 'dimension', 'mm',    null),
  ('sheet_height_mm',   'Sheet height',                'dimension', 'mm',    null),
  ('chip_width_mm',     'Chip width',                  'dimension', 'mm',    null),
  ('chip_height_mm',    'Chip height',                 'dimension', 'mm',    null),
  ('chip_shape',        'Chip shape',                  'enum',      null,    null),
  ('pieces_per_carton', 'Pieces per carton',           'number',    'pc',    null),
  ('sheets_per_carton', 'Sheets per carton',           'number',    'sheet', null),
  ('sqm_per_carton',    'Coverage per carton',         'number',    'sqm',   null),
  ('series',            'Series / profile',            'text',      null,    null),
  ('clip_system',       'Clip / system',               'text',      null,    null),
  ('edge',              'Edge',                        'enum',      null,    null),
  ('grade',             'Grade',                       'text',      null,    null),
  ('parent_tile',       'Parent / base tile',          'text',      null,    null),
  ('cut_pattern',       'Cut pattern',                 'text',      null,    null),
  ('yield_rule',        'Yield / wastage rule',        'text',      null,    null),
  ('compatible_system', 'Compatible product / system', 'text',      null,    null),
  ('pack_quantity',     'Pack quantity',               'number',    'pc',    null),
  -- Not in the seed. The White Horse price list states it for every row, and
  -- pallet is the unit its prices are quoted in, so it is a commercial fact
  -- rather than a logistics detail.
  ('cartons_per_pallet','Cartons per pallet',          'number',    'ctn',
   'Stated by the supplier price list. Relevant here because pallet is the unit some prices are quoted in.')
) as d(key, label, data_type, unit, description)
on conflict (workspace_id, key) do nothing;

insert into merch.category_attribute_rules (workspace_id, category_id, attribute_definition_id, is_required, position)
select w.id, c.id, a.id, r.required, r.position
from core.workspaces w
cross join (values
  ('mosaic','sheet_width_mm',true,1),('mosaic','sheet_height_mm',true,2),('mosaic','chip_width_mm',false,3),
  ('mosaic','chip_height_mm',false,4),('mosaic','chip_shape',false,5),('mosaic','sheets_per_carton',false,6),
  ('mosaic','sqm_per_carton',false,7),
  ('wall_panel','series',true,1),('wall_panel','width_mm',true,2),('wall_panel','depth_mm',true,3),
  ('wall_panel','length_mm',true,4),('wall_panel','clip_system',false,5),('wall_panel','pieces_per_carton',false,6),
  ('tile','width_mm',true,1),('tile','length_mm',true,2),('tile','thickness_mm',false,3),('tile','edge',false,4),
  ('tile','grade',false,5),('tile','pieces_per_carton',false,6),('tile','sqm_per_carton',false,7),
  ('tile','cartons_per_pallet',false,8),
  ('cut_tile','parent_tile',true,1),('cut_tile','width_mm',true,2),('cut_tile','length_mm',true,3),
  ('cut_tile','cut_pattern',false,4),('cut_tile','yield_rule',false,5),
  ('accessory','compatible_system',false,1),('accessory','pack_quantity',false,2)
) as r(category_key, attribute_key, required, position)
join merch.product_categories c on c.workspace_id = w.id and c.key = r.category_key
join merch.attribute_definitions a on a.workspace_id = w.id and a.key = r.attribute_key
on conflict (category_id, attribute_definition_id) do nothing;

------------------------------------------------------------------------------
-- 2. Resolve each published variant's best dimension evidence.
--
-- 5,126 candidates collapsed into 5,087 variants, so more than one candidate can
-- point at the same variant; distinct on picks one deterministically, preferring
-- a candidate that actually carries a size.
------------------------------------------------------------------------------
create temp table dimension_source on commit drop as
select distinct on (vc.published_variant_id)
  vc.id            as variant_candidate_id,
  vc.candidate_key,
  vc.workspace_id,
  vc.published_variant_id,
  vc.source_asset_id,
  vc.dimensions_raw,
  vc.dimensions_raw[1] as raw_text,
  array_length(vc.dimensions_raw, 1) as size_count,
  upper(regexp_replace(vc.dimensions_raw[1], '\s', '', 'g')) as compact
from ingest.variant_candidates vc
where vc.published_variant_id is not null
  and coalesce(array_length(vc.dimensions_raw, 1), 0) > 0
order by vc.published_variant_id, array_length(vc.dimensions_raw, 1), vc.id;

create temp table dimension_parsed on commit drop as
select
  d.*,
  -- The multiplier is derived only from a unit the text actually contains.
  case when d.compact like '%MM%' then 1.0
       when d.compact like '%CM%' then 10.0
  end as to_mm,
  string_to_array(regexp_replace(d.compact, '(MM|CM)', '', 'g'), 'X') as parts
from dimension_source d
where d.size_count = 1;

create temp table dimension_mm on commit drop as
select
  p.workspace_id,
  p.published_variant_id,
  p.raw_text,
  (p.parts[1])::numeric * p.to_mm as width_mm,
  (p.parts[2])::numeric * p.to_mm as length_mm,
  case when array_length(p.parts, 1) = 3 then (p.parts[3])::numeric * p.to_mm end as thickness_mm
from dimension_parsed p
where p.to_mm is not null
  and array_length(p.parts, 1) in (2, 3)
  and (select count(*) from unnest(p.parts) v where v ~ '^[0-9]+(\.[0-9]+)?$') = array_length(p.parts, 1);

------------------------------------------------------------------------------
-- 3. Dimensions become attribute values on the variant that carries them.
------------------------------------------------------------------------------
insert into merch.product_attribute_values (
  workspace_id, product_id, variant_id, attribute_definition_id, value, source_ref, confidence
)
select
  m.workspace_id, v.product_id, m.published_variant_id, a.id,
  to_jsonb(x.mm),
  'Discovery corpus 2026-08-21; size stated by the source as "' || m.raw_text || '"',
  1.000
from dimension_mm m
join merch.product_variants v on v.id = m.published_variant_id
cross join lateral (values
  ('width_mm', m.width_mm), ('length_mm', m.length_mm), ('thickness_mm', m.thickness_mm)
) as x(key, mm)
join merch.attribute_definitions a on a.workspace_id = m.workspace_id and a.key = x.key
where x.mm is not null
on conflict (product_id, variant_id, attribute_definition_id) do nothing;

------------------------------------------------------------------------------
-- 4. Packaging.
--
-- Two source shapes, both explicit: White Horse states pieces_per_carton and
-- cartons_per_pallet as numbers; Belleza states one sentence, "1 plt X 40 ctns X
-- 4 pcs". A carton count is only read as cartons-per-pallet when the sentence
-- actually mentions a pallet — "1 ctn X 1 pc" states a carton and nothing about
-- how cartons are palletised.
------------------------------------------------------------------------------
create temp table packaging_source on commit drop as
select distinct on (vc.published_variant_id)
  vc.workspace_id,
  vc.published_variant_id,
  vc.package_raw::jsonb as pkg
from ingest.variant_candidates vc
where vc.published_variant_id is not null
  and nullif(vc.package_raw, '') is not null
order by vc.published_variant_id, vc.id;

create temp table packaging_parsed on commit drop as
select
  s.workspace_id,
  s.published_variant_id,
  coalesce(
    nullif(s.pkg->>'pieces_per_carton', ''),
    substring(s.pkg->>'packing_details' from '([0-9]+(?:\.[0-9]+)?)\s*[Pp][Cc][Ss]?')
  )::numeric as pieces_per_carton,
  case when s.pkg->>'packing_details' is null or s.pkg->>'packing_details' ~* 'plt'
    then coalesce(
      nullif(s.pkg->>'cartons_per_pallet', ''),
      substring(s.pkg->>'packing_details' from '([0-9]+)\s*[Cc][Tt][Nn][Ss]?')
    )::numeric
  end as cartons_per_pallet,
  coalesce(s.pkg->>'packing_details',
           'pieces_per_carton=' || coalesce(s.pkg->>'pieces_per_carton', '?') ||
           ', cartons_per_pallet=' || coalesce(s.pkg->>'cartons_per_pallet', '?')) as stated_as
from packaging_source s;

-- One row per pack level, so a carton and a pallet are separate configurations
-- rather than two numbers crammed into one.
create unique index if not exists packaging_variant_label_idx
  on merch.packaging_configurations (variant_id, pack_label);

insert into merch.packaging_configurations (
  workspace_id, variant_id, pack_unit_id, pack_label, quantity_per_pack, inner_unit_id
)
select p.workspace_id, p.published_variant_id, pack.id, 'carton', p.pieces_per_carton, inner_u.id
from packaging_parsed p
join merch.units_of_measure pack    on pack.workspace_id = p.workspace_id and pack.code = 'ctn'
join merch.units_of_measure inner_u on inner_u.workspace_id = p.workspace_id and inner_u.code = 'pc'
where p.pieces_per_carton is not null and p.pieces_per_carton > 0
on conflict (variant_id, pack_label) do nothing;

insert into merch.packaging_configurations (
  workspace_id, variant_id, pack_unit_id, pack_label, quantity_per_pack, inner_unit_id
)
select p.workspace_id, p.published_variant_id, pack.id, 'pallet', p.cartons_per_pallet, inner_u.id
from packaging_parsed p
join merch.units_of_measure pack    on pack.workspace_id = p.workspace_id and pack.code = 'pallet'
join merch.units_of_measure inner_u on inner_u.workspace_id = p.workspace_id and inner_u.code = 'ctn'
where p.cartons_per_pallet is not null and p.cartons_per_pallet > 0
on conflict (variant_id, pack_label) do nothing;

-- The same facts, restated as attributes, so a category rule that asks for
-- pieces_per_carton is answered by the catalog and not only by the pack table.
insert into merch.product_attribute_values (
  workspace_id, product_id, variant_id, attribute_definition_id, value, source_ref, confidence
)
select p.workspace_id, v.product_id, p.published_variant_id, a.id, to_jsonb(x.qty),
       'Discovery corpus 2026-08-21; packaging stated by the source as "' || p.stated_as || '"',
       1.000
from packaging_parsed p
join merch.product_variants v on v.id = p.published_variant_id
cross join lateral (values
  ('pieces_per_carton', p.pieces_per_carton), ('cartons_per_pallet', p.cartons_per_pallet)
) as x(key, qty)
join merch.attribute_definitions a on a.workspace_id = p.workspace_id and a.key = x.key
where x.qty is not null and x.qty > 0
on conflict (product_id, variant_id, attribute_definition_id) do nothing;

------------------------------------------------------------------------------
-- 5. What was not decided, said out loud.
--
-- A bare "306X 306X6" and a source offering three different sizes are different
-- problems with the same answer: a person, not a default.
------------------------------------------------------------------------------
insert into ingest.review_items (
  workspace_id, item_type, task_type, external_key, source_asset_id,
  review_target_type, review_target_id, review_target_key, priority, proposed, conflicts
)
select
  d.workspace_id, 'dimension_unit_unstated', 'dimension_unit_unstated',
  'dimension_unit:' || d.candidate_key,
  d.source_asset_id,
  'variant_candidate', d.variant_candidate_id, d.candidate_key,
  3,
  jsonb_build_object(
    'stated_size', d.dimensions_raw,
    'published_variant_id', d.published_variant_id,
    'question', case when d.size_count > 1
      then 'The source lists more than one size for this product. Which one is the product?'
      else 'The source states a size with no unit. Confirm whether these are millimetres.'
    end
  ),
  case when d.size_count > 1
    then '["ambiguous_size"]'::jsonb
    else '["unit_not_stated"]'::jsonb
  end
from dimension_source d
where d.size_count > 1
   or not exists (select 1 from dimension_mm m where m.published_variant_id = d.published_variant_id)
on conflict do nothing;
