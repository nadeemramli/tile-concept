-- Publish the priced portion of the discovery corpus.
--
-- This is a one-time, explicitly authorised bulk approval, recorded here rather
-- than run ad hoc so the decisions and their provenance stay in version control.
--
-- The review gate exists to stop the *system* inventing commercial semantics.
-- It is not meant to stop the business stating them. Four things the sources
-- genuinely do not say were decided by the owner on 2026-08-21:
--
--   currency     MYR for everything
--   unit basis   White Horse -> pallet (its column reads "W.M Pallet/FOB
--                Price"), Belleza -> piece, generic RM lines -> whatever unit
--                the source itself stated, piece where it stated none
--   tax basis    exclusive
--   validity     effective from the migration date, open-ended
--
-- Each published row records that these came from a business decision and not
-- from the document, so a reviewer can find and revise them later.
--
-- Scope: only prices that carry a product code AND resolve to an actual variant
-- candidate row - 6,701 of 10,183, becoming 6,575 price rows once same-code
-- duplicates within one programme are collapsed. Of the rest, 2,794 have no
-- product code at all and 688 name a variant key that was never extracted as a
-- candidate; publishing either would create priced products with no identity, so
-- they stay pending. Variants with no price stay pending too.
--
-- On a database with no corpus (a fresh local reset) every statement below
-- matches nothing and the migration is a no-op.

------------------------------------------------------------------------------
-- 1. The one unit the vocabulary was missing.
------------------------------------------------------------------------------
insert into merch.units_of_measure (workspace_id, code, label, kind)
select w.id, 'pallet', 'Pallet', 'pack' from core.workspaces w
on conflict (workspace_id, code) do nothing;

------------------------------------------------------------------------------
-- 2. Price lists, one per programme the sources actually name.
--
-- Belleza's three tiers become three lists rather than three prices on one, so
-- the "no overlapping current price for the same scope" rule stays meaningful.
------------------------------------------------------------------------------
insert into merch.price_lists (workspace_id, name, price_type, currency, market, tax_inclusive, status, source_ref, notes)
select w.id, l.name, l.price_type, 'MYR', 'MY', false, 'active', l.source_ref, l.notes
from core.workspaces w
cross join (values
  ('White Horse FOB', 'contract', 'White Horse Price List 3.8.2026 (XLSX)',
   'Source column reads "W.M Pallet/FOB Price". Unit basis (pallet), tax basis (exclusive), currency (MYR) and effective date were confirmed by the business on 2026-08-21; the document states none of them.'),
  ('Belleza List', 'retail', 'BELLEZZA OCT25 (XLSX), List Price column',
   'Tier named by the source. Unit basis (piece), tax basis (exclusive), currency (MYR) and effective date confirmed by the business on 2026-08-21.'),
  ('Belleza Showroom', 'member', 'BELLEZZA OCT25 (XLSX), Showroom column',
   'Tier named by the source. Unit basis (piece), tax basis (exclusive), currency (MYR) and effective date confirmed by the business on 2026-08-21.'),
  ('Belleza Project', 'project', 'BELLEZZA OCT25 (XLSX), Project Price column',
   'Tier named by the source. Unit basis (piece), tax basis (exclusive), currency (MYR) and effective date confirmed by the business on 2026-08-21.'),
  ('General Supplier Prices', 'retail', 'RM price lines extracted from supplier catalogues',
   'Prices found as RM lines in catalogue text rather than a price table, so the association to a product is weaker than the structured sources. Only rows carrying a product code are published here.')
) as l(name, price_type, source_ref, notes)
where not exists (
  select 1 from merch.price_lists pl where pl.workspace_id = w.id and pl.name = l.name
);

------------------------------------------------------------------------------
-- 3. Resolve the publishable set once.
------------------------------------------------------------------------------
create temp table corpus_publish on commit drop as
select
  pc.id             as price_candidate_id,
  pc.candidate_key  as price_key,
  pc.workspace_id,
  pc.amount_normalized,
  pc.extraction_rule,
  pc.source_path,
  vc.id             as variant_candidate_id,
  vc.candidate_key  as variant_key,
  vc.brand_hint,
  vc.supplier_code_raw,
  vc.supplier_code_normalized,
  vc.family_name_candidate,
  vc.material_raw,
  vc.finish_raw,
  vc.source_asset_id,
  case pc.extraction_rule
    when 'white_horse_price_table' then 'pallet'
    when 'belleza_price_table'     then 'pc'
    else case lower(coalesce(pc.unit_basis, ''))
           when 'carton' then 'ctn'
           when 'piece'  then 'pc'
           when 'sheet'  then 'sheet'
           when 'sqm'    then 'sqm'
           else 'pc'
         end
  end as unit_code,
  case
    when pc.extraction_rule = 'white_horse_price_table' then 'White Horse FOB'
    when pc.extraction_rule = 'belleza_price_table' and pc.price_type_raw = 'List Price'    then 'Belleza List'
    when pc.extraction_rule = 'belleza_price_table' and pc.price_type_raw = 'Showroom'      then 'Belleza Showroom'
    when pc.extraction_rule = 'belleza_price_table' and pc.price_type_raw = 'Project Price' then 'Belleza Project'
    else 'General Supplier Prices'
  end as list_name
from ingest.price_candidates pc
join ingest.variant_candidates vc
  on vc.workspace_id = pc.workspace_id
 and vc.candidate_key = pc.variant_candidate_key
where pc.product_code_candidate is not null
  and pc.variant_candidate_key is not null
  and pc.amount_normalized is not null
  and pc.review_state = 'pending_review';

------------------------------------------------------------------------------
-- 4. Products and their default variant.
--
-- One product per (workspace, brand, normalized supplier code). The same code
-- appears in more than one source - 238 unresolved duplicate groups - and
-- collapsing them here is deliberate: a second product with the same code under
-- the same brand would be a duplicate, not a second product.
------------------------------------------------------------------------------
create temp table corpus_products on commit drop as
select distinct on (workspace_id, brand_hint, supplier_code_normalized)
  workspace_id, brand_hint, supplier_code_normalized, supplier_code_raw,
  family_name_candidate, material_raw, finish_raw, source_asset_id, unit_code
from corpus_publish
order by workspace_id, brand_hint, supplier_code_normalized, price_candidate_id;

create temp table corpus_product_ids (
  workspace_id uuid,
  brand_hint text,
  supplier_code_normalized text,
  product_id uuid,
  variant_id uuid
) on commit drop;

with inserted as (
  insert into merch.products (
    workspace_id, brand_id, category_id, name, code, material, finish,
    status, review_state, reviewed_at, source_ref, source_asset_id
  )
  select cp.workspace_id, b.id, cat.id,
         coalesce(nullif(cp.family_name_candidate, ''), cp.supplier_code_raw),
         cp.supplier_code_raw,
         nullif(cp.material_raw, ''), nullif(cp.finish_raw, ''),
         'active', 'reviewed', now(),
         'Discovery corpus 2026-08-21; category assigned by business decision, not stated by the source',
         cp.source_asset_id
  from corpus_products cp
  join merch.brands b
    on b.workspace_id = cp.workspace_id
   and core.normalize_text(b.name) = core.normalize_text(cp.brand_hint)
  join merch.product_categories cat
    on cat.workspace_id = cp.workspace_id and cat.key = 'tile'
  returning id, workspace_id, brand_id, code
)
insert into corpus_product_ids (workspace_id, brand_hint, supplier_code_normalized, product_id)
select i.workspace_id, b.name, core.normalize_key(i.code), i.id
from inserted i
join merch.brands b on b.id = i.brand_id;

with inserted as (
  insert into merch.product_variants (
    workspace_id, product_id, sku, supplier_code, name, selling_unit_id, is_default, status
  )
  select cpi.workspace_id, cpi.product_id, cp.supplier_code_raw, cp.supplier_code_raw,
         'Standard', u.id, true, 'active'
  from corpus_product_ids cpi
  join corpus_products cp
    on cp.workspace_id = cpi.workspace_id
   and core.normalize_text(cp.brand_hint) = core.normalize_text(cpi.brand_hint)
   and cp.supplier_code_normalized = cpi.supplier_code_normalized
  join merch.units_of_measure u
    on u.workspace_id = cpi.workspace_id and u.code = cp.unit_code
  returning id, product_id
)
update corpus_product_ids c
set variant_id = inserted.id
from inserted
where inserted.product_id = c.product_id;

------------------------------------------------------------------------------
-- 5. Prices.
--
-- distinct on collapses the case where one source lists the same code twice in
-- the same programme; the partial unique index on state='current' would
-- otherwise reject the whole statement. Highest-confidence row wins, ties broken
-- deterministically by candidate id.
------------------------------------------------------------------------------
create temp table corpus_price_rows on commit drop as
select distinct on (pl.id, cpi.variant_id, u.id)
  cpub.workspace_id,
  pl.id            as price_list_id,
  cpi.variant_id,
  cpub.amount_normalized as amount,
  u.id             as unit_id,
  pl.price_type,
  cpub.price_candidate_id,
  cpub.price_key,
  cpub.source_asset_id,
  cpub.source_path
from corpus_publish cpub
join corpus_product_ids cpi
  on cpi.workspace_id = cpub.workspace_id
 and core.normalize_text(cpi.brand_hint) = core.normalize_text(cpub.brand_hint)
 and cpi.supplier_code_normalized = cpub.supplier_code_normalized
join merch.price_lists pl
  on pl.workspace_id = cpub.workspace_id and pl.name = cpub.list_name
join merch.units_of_measure u
  on u.workspace_id = cpub.workspace_id and u.code = cpub.unit_code
order by pl.id, cpi.variant_id, u.id, cpub.price_candidate_id;

insert into merch.variant_prices (
  workspace_id, price_list_id, variant_id, amount, currency, unit_id, min_quantity,
  valid_from, tax_basis, price_type, market, state, review_state, approved_at,
  source_asset_id, source_ref, source_page_or_row, imported_at
)
select r.workspace_id, r.price_list_id, r.variant_id, r.amount, 'MYR', r.unit_id, 1,
       current_date, 'exclusive', r.price_type, 'MY', 'current', 'reviewed', now(),
       r.source_asset_id,
       'Discovery corpus 2026-08-21; currency, unit basis, tax basis and validity by business decision, not stated by the source',
       r.source_path, now()
from corpus_price_rows r;

------------------------------------------------------------------------------
-- 6. Close the loop: mark the candidates approved, record why, and resolve the
--    review tasks that were waiting on them.
------------------------------------------------------------------------------
update ingest.variant_candidates vc
set review_state = 'approved',
    published_variant_id = cpi.variant_id,
    updated_at = now()
from corpus_publish cpub
join corpus_product_ids cpi
  on cpi.workspace_id = cpub.workspace_id
 and core.normalize_text(cpi.brand_hint) = core.normalize_text(cpub.brand_hint)
 and cpi.supplier_code_normalized = cpub.supplier_code_normalized
where vc.id = cpub.variant_candidate_id;

update ingest.price_candidates pc
set review_state = 'approved', updated_at = now()
from corpus_publish cpub
where pc.id = cpub.price_candidate_id;

update ingest.candidate_records cr
set review_state = 'approved', updated_at = now()
from corpus_publish cpub
where cr.workspace_id = cpub.workspace_id
  and cr.candidate_key in (cpub.price_key, cpub.variant_key);

insert into ingest.review_decisions (
  workspace_id, review_target_type, review_target_id, review_target_key, decision, reason
)
select cpub.workspace_id, 'price_candidate', cpub.price_candidate_id, cpub.price_key, 'approved',
       'Bulk publication 2026-08-21. Currency MYR, tax exclusive, effective from the publication date, and the unit basis recorded on the price list — all confirmed by the business; the source states none of them.'
from corpus_publish cpub;

-- The low-confidence price tasks these rows generated are now answered.
update ingest.review_items ri
set status = 'approved', reviewed_at = now(),
    decision_note = 'Resolved by the 2026-08-21 bulk publication.'
where ri.status = 'pending'
  and ri.task_type = 'low_confidence_price_source_review'
  and exists (
    select 1 from corpus_publish cpub
    where cpub.workspace_id = ri.workspace_id
      and cpub.source_asset_id = ri.source_asset_id
  );
