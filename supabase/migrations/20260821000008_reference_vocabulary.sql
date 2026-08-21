-- Reference vocabulary: units of measure and product categories.
--
-- Without these nothing in the review queue can be approved: the strict gate in
-- api.approve_review_item requires an explicit selling unit and category, and
-- the hosted project had neither - it was never seeded, correctly, because
-- supabase/seed.sql is synthetic sales data.
--
-- Codes match supabase/seed.sql exactly (`pc`, `sheet`, `ctn`, `sqm`, `m`,
-- `set`; `finishing`, not `finishing_product`) so a locally seeded database and
-- the hosted one cannot drift apart. On a fresh local reset this is a no-op:
-- migrations run before seeds, so no workspace exists yet and the seed supplies
-- the same vocabulary a moment later. On a database whose workspace already
-- exists - which is every deployed one - this fills the gap.
--
-- Price lists are deliberately NOT created. Which programmes exist, in which
-- currency and at which tax basis, is a commercial decision; inventing one would
-- be the same mistake as defaulting a currency to MYR.

------------------------------------------------------------------------------
-- Units of measure.
--
-- Conversions between them are variant-specific and belong in
-- merch.unit_conversions / merch.packaging_configurations, never assumed here:
-- one carton of one product does not hold what a carton of another does.
------------------------------------------------------------------------------
insert into merch.units_of_measure (workspace_id, code, label, kind)
select w.id, u.code, u.label, u.kind
from core.workspaces w
cross join (values
  ('pc',    'Piece',        'count'),
  ('sheet', 'Sheet',        'count'),
  ('set',   'Set',          'count'),
  ('ctn',   'Carton',       'pack'),
  ('sqm',   'Square metre', 'area'),
  ('m',     'Metre',        'length')
) as u(code, label, kind)
on conflict (workspace_id, code) do nothing;

------------------------------------------------------------------------------
-- Product categories (PRD §7.5).
--
-- "Base Tiles (LOCAL)" and "Base Tiles (OEM)" are deliberately absent: those
-- describe a supply relationship, not a product category, and live on
-- ingest.source_collections.supply_model instead.
------------------------------------------------------------------------------
insert into merch.product_categories (workspace_id, key, label, position, is_active)
select w.id, c.key, c.label, c.position, true
from core.workspaces w
cross join (values
  ('wall_panel', 'Wall panel',        1),
  ('tile',       'Tile',              2),
  ('cut_tile',   'Cut tile',          3),
  ('mosaic',     'Mosaic',            4),
  ('finishing',  'Finishing product', 5),
  ('accessory',  'Accessory',         6)
) as c(key, label, position)
on conflict (workspace_id, key) do nothing;

------------------------------------------------------------------------------
-- Brands carry a review state.
--
-- Brands created from the discovery corpus come from Drive folder labels, which
-- the Source Register is explicit about: they are provenance hints, not
-- canonical organization identities. The same label can mean the brand, the
-- manufacturer, the supplier, or all three. A brand row therefore has to be able
-- to say "nobody has confirmed this yet".
------------------------------------------------------------------------------
alter table merch.brands
  add column if not exists review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed','reviewed','conflicted','rejected')),
  add column if not exists source_note text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

-- api.brands froze its column list in 20260820000006_rls_api.sql.
create or replace view api.brands with (security_invoker = true) as select * from merch.brands;
grant select, insert, update, delete on api.brands to authenticated;
grant all on api.brands to service_role;
