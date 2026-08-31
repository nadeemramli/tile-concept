-- Keep the sales-facing finder fast as the published corpus grows. These
-- indexes match the lateral lookups performed once per product.
create index if not exists product_variants_catalog_finder_idx
  on merch.product_variants (product_id, is_default desc, created_at, id)
  include (dimensions)
  where status <> 'archived';

create index if not exists variant_prices_catalog_finder_idx
  on merch.variant_prices (variant_id, valid_from desc, created_at desc)
  include (id, amount, currency, unit_id, price_list_id, valid_to)
  where state = 'current' and review_state = 'reviewed';

create index if not exists product_aliases_product_id_idx
  on merch.product_aliases (product_id, alias);

create index if not exists product_attribute_values_variant_id_idx
  on merch.product_attribute_values (variant_id, attribute_definition_id)
  where variant_id is not null;

-- The Data API roles only need to read these views. The views are
-- security-invoker, so underlying RLS continues to scope every row.
revoke all on api.catalog_finder from anon, service_role;
revoke all on api.catalog_finder_facets from anon, service_role;
grant select on api.catalog_finder to authenticated, service_role;
grant select on api.catalog_finder_facets to authenticated, service_role;
