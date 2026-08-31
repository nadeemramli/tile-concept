-- Browse-first catalog read model.
--
-- Publication controls still decide what becomes a product or current price.
-- Once published, ordinary sales lookup must not require a reviewer or load an
-- arbitrary first 500 rows. This view presents one row per product, selects the
-- most useful current price, and exposes filterable sales-facing fields.

create or replace view api.catalog_finder with (security_invoker = true) as
select
  p.workspace_id,
  p.id as product_id,
  p.code,
  p.name,
  p.brand_id,
  b.name as brand,
  p.category_id,
  c.label as category,
  p.color,
  p.finish,
  p.material,
  p.status,
  p.review_state,
  p.reviewed_by,
  p.reviewed_at,
  p.source_ref,
  p.confidence,
  p.updated_at,
  dv.id as default_variant_id,
  coalesce(dv.dimensions, '{}'::jsonb) || coalesce(av.dimensions, '{}'::jsonb) as dimensions,
  pr.id as price_id,
  pr.amount as price_amount,
  pr.currency as price_currency,
  pr.unit_code as price_unit_code,
  pr.price_list_id,
  pr.price_list_name,
  pr.price_type,
  pr.valid_from as price_valid_from,
  pr.state as price_state,
  lower(concat_ws(' ', p.code, p.name, b.name, c.label, p.color, p.finish, p.material,
    p.family, p.series_name, aliases.alias_text)) as search_text
from merch.products p
left join merch.brands b on b.id = p.brand_id
left join merch.product_categories c on c.id = p.category_id
left join lateral (
  select v.id, v.dimensions
  from merch.product_variants v
  where v.product_id = p.id and v.status <> 'archived'
  order by v.is_default desc, v.created_at, v.id
  limit 1
) dv on true
left join lateral (
  select jsonb_object_agg(ad.key, pav.value) as dimensions
  from merch.product_attribute_values pav
  join merch.attribute_definitions ad on ad.id = pav.attribute_definition_id
  where pav.variant_id = dv.id
    and ad.key in ('width_mm','length_mm','thickness_mm','depth_mm','sheet_width_mm','sheet_height_mm')
) av on true
left join lateral (
  select vp.id, vp.amount, vp.currency, u.code as unit_code, vp.price_list_id,
         pl.name as price_list_name, pl.price_type, vp.valid_from, vp.state
  from merch.variant_prices vp
  join merch.product_variants pv on pv.id = vp.variant_id
  join merch.price_lists pl on pl.id = vp.price_list_id
  left join merch.units_of_measure u on u.id = vp.unit_id
  where pv.product_id = p.id
    and pv.status <> 'archived'
    and vp.state = 'current'
    and vp.review_state = 'reviewed'
    and vp.valid_from <= current_date
    and (vp.valid_to is null or vp.valid_to >= current_date)
  order by
    case pl.price_type
      when 'retail' then 1
      when 'member' then 2
      when 'project' then 3
      when 'contract' then 4
      when 'cost' then 5
      else 6
    end,
    pv.is_default desc,
    vp.valid_from desc,
    vp.created_at desc
  limit 1
) pr on true
left join lateral (
  select string_agg(a.alias, ' ' order by a.alias) as alias_text
  from merch.product_aliases a
  where a.product_id = p.id
) aliases on true;

grant select on api.catalog_finder to authenticated;
grant all on api.catalog_finder to service_role;

create or replace view api.catalog_finder_facets with (security_invoker = true) as
select workspace_id, 'color'::text as facet, lower(trim(color)) as value,
       min(trim(color)) as label, count(*)::bigint as item_count
from api.catalog_finder
where status = 'active' and nullif(trim(color), '') is not null
group by workspace_id, lower(trim(color))
union all
select workspace_id, 'finish'::text, lower(trim(finish)), min(trim(finish)), count(*)::bigint
from api.catalog_finder
where status = 'active' and nullif(trim(finish), '') is not null
group by workspace_id, lower(trim(finish))
union all
select workspace_id, 'material'::text, lower(trim(material)), min(trim(material)), count(*)::bigint
from api.catalog_finder
where status = 'active' and nullif(trim(material), '') is not null
group by workspace_id, lower(trim(material));

grant select on api.catalog_finder_facets to authenticated;
grant all on api.catalog_finder_facets to service_role;
