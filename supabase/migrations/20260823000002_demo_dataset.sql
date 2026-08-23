-- The demo workspace's contents, and the reset that restores them.
--
-- Guest mode gave a visitor a real session in an empty workspace. This fills it.
--
-- Two functions, and the important thing is that there is only one description of
-- the dataset: core.build_demo_dataset() is used both to create it the first time
-- and to restore it every week, so the demo cannot drift away from what the reset
-- would produce. A separate "seed once, clean up later" pair would.
--
-- Everything here is invented. The brands, suppliers, people and prices do not
-- correspond to anything real, and none of the discovery corpus is reachable from
-- this workspace — it belongs to another one, and RLS is what keeps them apart.
-- The numbers are internally coherent rather than arbitrary: every price states
-- its currency, unit basis, tax basis, market and validity, because a demo that
-- showed prices without those would be teaching the wrong thing about this system.
--
-- The reset works by deleting the workspace row. All 97 foreign keys into
-- core.workspaces are ON DELETE CASCADE, so that removes every dependent row in
-- one statement with no ordering to get wrong and no possibility of leaving half
-- a workspace behind. core.demo_workspace_id() resolves by slug, so the new id
-- costs nothing.

------------------------------------------------------------------------------
-- 1. The dataset.
------------------------------------------------------------------------------
create or replace function core.build_demo_dataset(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner       uuid;
  loc_showroom  uuid;
  loc_warehouse uuid;
  u_pc uuid; u_sheet uuid; u_ctn uuid; u_sqm uuid; u_m uuid; u_set uuid;
  cat_tile uuid; cat_mosaic uuid; cat_panel uuid; cat_cut uuid; cat_finish uuid; cat_acc uuid;
  pl_retail uuid; pl_showroom uuid; pl_project uuid;
  sup_a uuid; sup_b uuid;
  b_terra uuid; b_casa uuid; b_lumen uuid;
  src_sql uuid; inv_loc uuid;
  prod record; prod_id uuid; var_id uuid;
  c_id uuid; a_id uuid; p_id uuid; o_id uuid; v_id uuid; pu_id uuid;
  i int; sk text; area text; fn text; ln text; ctype text; src text;
  contact_ids uuid[] := '{}';
  account_ids uuid[] := '{}';
  project_ids uuid[] := '{}';
  variant_ids uuid[] := '{}';
  first_names text[] := array['Ahmad','Nurul','Wei Jie','Priya','Hafiz','Mei Ling','Daniel','Aisyah','Kumar','Siti','Jason','Farah','Arjun','Nadia','Kevin','Zara'];
  last_names  text[] := array['Abdullah','Tan','Lim','Rahman','Wong','Kumar','Lee','Ismail','Ng','Hassan','Chong','Yusof'];
  areas       text[] := array['Cheras','Puchong','Shah Alam','Subang Jaya','Petaling Jaya','Ampang','Kajang','Klang','Bangsar','Mont Kiara'];
  sources     text[] := array['tiktok','meta','website','whatsapp','referral','walk_in','dm','call'];
  ctypes      text[] := array['homeowner','homeowner','homeowner','contractor','designer','developer','retailer'];
  stage_keys  text[] := array['new_inquiry','contact_attempted','contacted','qualified','consultation','sample_site','quote_preparing','quote_sent','negotiation','verbal_confirmation','won','lost','deferred'];
  stage_labels text[] := array['New inquiry','Contact attempted','Contacted','Qualified','Consultation / requirements','Sample or site activity','Quote preparing','Quote sent','Negotiation / revision','Verbal confirmation / pending document','Won','Lost','Deferred / nurture'];
begin
  -- Whoever is currently a guest here owns the records, so the "assigned to me"
  -- views a visitor meets are not empty.
  select m.user_id into v_owner
  from core.memberships m
  where m.workspace_id = p_workspace and m.role_key = 'guest'
  order by m.created_at limit 1;

  --------------------------------------------------------------- organisation
  insert into core.business_locations (workspace_id, code, name, kind, address) values
    (p_workspace, 'SHOWROOM-DEMO', 'Demo Showroom', 'showroom', '{"city":"Kuala Lumpur","state":"WP","country":"MY"}'),
    (p_workspace, 'WAREHOUSE-DEMO', 'Demo Warehouse', 'warehouse', '{"city":"Shah Alam","state":"Selangor","country":"MY"}');
  select id into loc_showroom from core.business_locations where workspace_id = p_workspace and code = 'SHOWROOM-DEMO';
  select id into loc_warehouse from core.business_locations where workspace_id = p_workspace and code = 'WAREHOUSE-DEMO';

  insert into core.teams (workspace_id, name) values (p_workspace, 'Showroom team'), (p_workspace, 'Projects team');

  for i in 1 .. array_length(stage_keys, 1) loop
    insert into core.opportunity_stages (workspace_id, key, label, position, reporting_group)
    values (p_workspace, stage_keys[i], stage_labels[i], i,
            case stage_keys[i] when 'won' then 'won' when 'lost' then 'lost' when 'deferred' then 'deferred' else 'open' end);
  end loop;

  ------------------------------------------------------- reference vocabulary
  -- The demo workspace was created after the migrations that gave every existing
  -- workspace its units, categories and attributes, so it has none of its own.
  insert into merch.units_of_measure (workspace_id, code, label, kind) values
    (p_workspace,'pc','Piece','count'), (p_workspace,'sheet','Sheet','count'),
    (p_workspace,'set','Set','count'),  (p_workspace,'ctn','Carton','pack'),
    (p_workspace,'sqm','Square metre','area'), (p_workspace,'m','Metre','length'),
    (p_workspace,'pallet','Pallet','pack');
  select id into u_pc    from merch.units_of_measure where workspace_id = p_workspace and code = 'pc';
  select id into u_sheet from merch.units_of_measure where workspace_id = p_workspace and code = 'sheet';
  select id into u_ctn   from merch.units_of_measure where workspace_id = p_workspace and code = 'ctn';
  select id into u_sqm   from merch.units_of_measure where workspace_id = p_workspace and code = 'sqm';
  select id into u_m     from merch.units_of_measure where workspace_id = p_workspace and code = 'm';
  select id into u_set   from merch.units_of_measure where workspace_id = p_workspace and code = 'set';

  insert into merch.product_categories (workspace_id, key, label, position, is_active) values
    (p_workspace,'wall_panel','Wall panel',1,true), (p_workspace,'tile','Tile',2,true),
    (p_workspace,'cut_tile','Cut tile',3,true),     (p_workspace,'mosaic','Mosaic',4,true),
    (p_workspace,'finishing','Finishing product',5,true), (p_workspace,'accessory','Accessory',6,true);
  select id into cat_tile   from merch.product_categories where workspace_id = p_workspace and key = 'tile';
  select id into cat_mosaic from merch.product_categories where workspace_id = p_workspace and key = 'mosaic';
  select id into cat_panel  from merch.product_categories where workspace_id = p_workspace and key = 'wall_panel';
  select id into cat_cut    from merch.product_categories where workspace_id = p_workspace and key = 'cut_tile';
  select id into cat_finish from merch.product_categories where workspace_id = p_workspace and key = 'finishing';
  select id into cat_acc    from merch.product_categories where workspace_id = p_workspace and key = 'accessory';

  insert into merch.attribute_definitions (workspace_id, key, label, data_type, unit)
  select p_workspace, d.key, d.label, d.data_type, d.unit
  from (values
    ('width_mm','Width','dimension','mm'), ('length_mm','Length','dimension','mm'),
    ('thickness_mm','Thickness','dimension','mm'), ('depth_mm','Depth','dimension','mm'),
    ('sheet_width_mm','Sheet width','dimension','mm'), ('sheet_height_mm','Sheet height','dimension','mm'),
    ('chip_width_mm','Chip width','dimension','mm'), ('chip_height_mm','Chip height','dimension','mm'),
    ('chip_shape','Chip shape','enum',null), ('pieces_per_carton','Pieces per carton','number','pc'),
    ('sheets_per_carton','Sheets per carton','number','sheet'), ('sqm_per_carton','Coverage per carton','number','sqm'),
    ('cartons_per_pallet','Cartons per pallet','number','ctn'),
    ('series','Series / profile','text',null), ('clip_system','Clip / system','text',null),
    ('edge','Edge','enum',null), ('grade','Grade','text',null),
    ('parent_tile','Parent / base tile','text',null), ('cut_pattern','Cut pattern','text',null),
    ('yield_rule','Yield / wastage rule','text',null),
    ('compatible_system','Compatible product / system','text',null), ('pack_quantity','Pack quantity','number','pc')
  ) as d(key,label,data_type,unit);

  insert into merch.category_attribute_rules (workspace_id, category_id, attribute_definition_id, is_required, position)
  select p_workspace, c.id, a.id, r.required, r.position
  from (values
    ('tile','width_mm',true,1),('tile','length_mm',true,2),('tile','thickness_mm',false,3),
    ('tile','edge',false,4),('tile','pieces_per_carton',false,5),('tile','sqm_per_carton',false,6),
    ('mosaic','sheet_width_mm',true,1),('mosaic','sheet_height_mm',true,2),('mosaic','chip_width_mm',false,3),
    ('wall_panel','width_mm',true,1),('wall_panel','depth_mm',true,2),('wall_panel','length_mm',true,3),
    ('cut_tile','parent_tile',true,1),('cut_tile','width_mm',true,2),('cut_tile','length_mm',true,3),
    ('accessory','pack_quantity',false,1)
  ) as r(category_key, attribute_key, required, position)
  join merch.product_categories c on c.workspace_id = p_workspace and c.key = r.category_key
  join merch.attribute_definitions a on a.workspace_id = p_workspace and a.key = r.attribute_key;

  ----------------------------------------------------------- supply + brands
  insert into merch.suppliers (workspace_id, name, website) values
    (p_workspace, 'Northwind Ceramics Sdn Bhd', 'https://example.test/northwind'),
    (p_workspace, 'Selat Stone Trading', 'https://example.test/selat');
  select id into sup_a from merch.suppliers where workspace_id = p_workspace and name = 'Northwind Ceramics Sdn Bhd';
  select id into sup_b from merch.suppliers where workspace_id = p_workspace and name = 'Selat Stone Trading';

  insert into merch.brands (workspace_id, name, supplier_id, is_house_brand, review_state) values
    (p_workspace, 'Terramoda', sup_a, false, 'reviewed'),
    (p_workspace, 'Casalina',  sup_b, false, 'reviewed'),
    (p_workspace, 'Lumen',     null,  true,  'reviewed');
  select id into b_terra from merch.brands where workspace_id = p_workspace and name = 'Terramoda';
  select id into b_casa  from merch.brands where workspace_id = p_workspace and name = 'Casalina';
  select id into b_lumen from merch.brands where workspace_id = p_workspace and name = 'Lumen';

  -- Three programmes, each stating its own commercial semantics.
  insert into merch.price_lists (workspace_id, name, price_type, currency, market, tax_inclusive, status, source_ref, notes) values
    (p_workspace, 'Retail 2026',   'retail',  'MYR', 'MY', false, 'active', 'Demo retail list',   'Synthetic. Prices are per the selling unit named on each row, tax exclusive.'),
    (p_workspace, 'Showroom 2026', 'member',  'MYR', 'MY', false, 'active', 'Demo showroom list', 'Synthetic walk-in showroom tier.'),
    (p_workspace, 'Project 2026',  'project', 'MYR', 'MY', false, 'active', 'Demo project list',  'Synthetic contract tier for named projects.');
  select id into pl_retail   from merch.price_lists where workspace_id = p_workspace and name = 'Retail 2026';
  select id into pl_showroom from merch.price_lists where workspace_id = p_workspace and name = 'Showroom 2026';
  select id into pl_project  from merch.price_lists where workspace_id = p_workspace and name = 'Project 2026';

  ------------------------------------------------------------------- products
  for prod in select * from (values
    ('TM-6060-GRY','Porcelain Tile Storm Grey 600x600', b_terra, cat_tile,  'Grey',   'Matte',  'Porcelain','sqm',  68.00, 8,  600, 600,  9),
    ('TM-6012-OAK','Wood-look Tile Oak 600x1200',       b_terra, cat_tile,  'Oak',    'Matte',  'Porcelain','sqm',  95.00, 4,  600, 1200, 10),
    ('TM-3060-BGE','Ceramic Wall Tile Sand 300x600',    b_terra, cat_tile,  'Beige',  'Glossy', 'Ceramic',  'sqm',  42.00, 10, 300, 600,  8),
    ('TM-8080-IVR','Polished Tile Ivory 800x800',       b_terra, cat_tile,  'Ivory',  'Gloss',  'Porcelain','sqm', 112.00, 3,  800, 800,  10),
    ('CS-6060-CHR','Charcoal Matt Tile 600x600',        b_casa,  cat_tile,  'Charcoal','Matte', 'Porcelain','sqm',  74.00, 8,  600, 600,  9),
    ('CS-1560-TER','Terrazzo Look Tile 150x600',        b_casa,  cat_tile,  'Speckle','Matte',  'Porcelain','sqm',  88.00, 12, 150, 600,  9),
    ('CS-HEX-WHT','Hexagon Mosaic White',               b_casa,  cat_mosaic,'White',  'Matte',  'Porcelain','sheet',18.50, 11, 300, 300,  6),
    ('CS-PEN-BLK','Penny Round Mosaic Black',           b_casa,  cat_mosaic,'Black',  'Matte',  'Porcelain','sheet',24.00, 11, 300, 300,  6),
    ('LM-OAK-160','Fluted Wall Panel Oak 160',          b_lumen, cat_panel, 'Oak',    'Matte',  'WPC',      'pc',   48.00, 4,  160, 2900, 24),
    ('LM-WHT-195','Slat Wall Panel White 195',          b_lumen, cat_panel, 'White',  'Satin',  'WPC',      'pc',   55.00, 4,  195, 2900, 12),
    ('LM-SKT-GRY','Skirting cut from Storm Grey',       b_lumen, cat_cut,   'Grey',   'Matte',  'Porcelain','pc',    9.50, 20, 100, 600,  9),
    ('LM-CLIP-50','Wall Panel Clip Set (50)',           b_lumen, cat_acc,   null,     null,     'Steel',    'set',  25.00, 1,  null,null, null)
  ) as t(code, name, brand_id, category_id, color, finish, material, unit_code, retail, per_carton, w, l, th)
  loop
    insert into merch.products (workspace_id, brand_id, supplier_id, category_id, name, code, color, finish, material,
                               status, review_state, reviewed_at, source_ref)
    values (p_workspace, prod.brand_id,
            (select b.supplier_id from merch.brands b where b.id = prod.brand_id),
            prod.category_id, prod.name, prod.code, prod.color, prod.finish, prod.material,
            'active', 'reviewed', now() - interval '20 days', 'Demo catalog (synthetic)')
    returning id into prod_id;

    insert into merch.product_variants (workspace_id, product_id, sku, supplier_code, name, selling_unit_id, is_default, status)
    values (p_workspace, prod_id, prod.code, prod.code, 'Standard',
            (select uom.id from merch.units_of_measure uom where uom.workspace_id = p_workspace and uom.code = prod.unit_code),
            true, 'active')
    returning id into var_id;
    variant_ids := variant_ids || var_id;

    -- Attributes, so a product can say what it is rather than only what it costs.
    insert into merch.product_attribute_values (workspace_id, product_id, variant_id, attribute_definition_id, value, source_ref, confidence)
    select p_workspace, prod_id, var_id, a.id, x.val, 'Demo catalog (synthetic)', 1.000
    from (values
      (case when prod.category_id = cat_mosaic then 'sheet_width_mm'  else 'width_mm'  end, to_jsonb(prod.w)),
      (case when prod.category_id = cat_mosaic then 'sheet_height_mm' else 'length_mm' end, to_jsonb(prod.l)),
      ('thickness_mm', to_jsonb(prod.th)),
      ('pieces_per_carton', to_jsonb(prod.per_carton))
    ) as x(key, val)
    join merch.attribute_definitions a on a.workspace_id = p_workspace and a.key = x.key
    where x.val is not null and x.val <> 'null'::jsonb;

    if prod.per_carton is not null and prod.unit_code <> 'set' then
      insert into merch.packaging_configurations (workspace_id, variant_id, pack_unit_id, pack_label, quantity_per_pack, inner_unit_id, moq)
      values (p_workspace, var_id, u_ctn, 'carton', prod.per_carton,
              (select uom.id from merch.units_of_measure uom where uom.workspace_id = p_workspace and uom.code = prod.unit_code), 1);
    end if;

    -- Every price states currency, unit, tax basis, market, validity and minimum.
    insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, min_quantity,
                                      valid_from, tax_basis, price_type, market, state, review_state, approved_at, source_ref)
    select p_workspace, l.list_id, var_id, round(prod.retail * l.factor, 2), 'MYR',
           (select uom.id from merch.units_of_measure uom where uom.workspace_id = p_workspace and uom.code = prod.unit_code),
           1, current_date - 60, 'exclusive', l.ptype, 'MY', 'current', 'reviewed', now() - interval '60 days',
           'Demo price list (synthetic)'
    from (values (pl_retail, 1.00, 'retail'), (pl_showroom, 0.92, 'member'), (pl_project, 0.86, 'project'))
         as l(list_id, factor, ptype);

    -- One superseded row per product, so price history is not an empty tab.
    insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, min_quantity,
                                      valid_from, valid_to, tax_basis, price_type, market, state, review_state, approved_at, source_ref)
    values (p_workspace, pl_retail, var_id, round(prod.retail * 0.94, 2), 'MYR',
            (select uom.id from merch.units_of_measure uom where uom.workspace_id = p_workspace and uom.code = prod.unit_code),
            1, current_date - 400, current_date - 61, 'exclusive', 'retail', 'MY', 'superseded', 'reviewed',
            now() - interval '400 days', 'Demo price list 2025 (synthetic)');
  end loop;

  -- Colourways, so the catalog is worth filtering and paging through rather than
  -- being a dozen rows. Each is a real product with its own code, attributes,
  -- packaging and three price tiers — the same shape as the ones above, not a
  -- shallow copy that would make the table lie about what the catalog holds.
  for prod in
    select p.id, p.code, p.name, p.brand_id, p.supplier_id, p.category_id, p.finish, p.material,
           v.selling_unit_id, vp.amount as retail, pc.quantity_per_pack as per_carton
    from merch.products p
    join merch.product_variants v on v.product_id = p.id
    join merch.variant_prices vp on vp.variant_id = v.id and vp.price_list_id = pl_retail and vp.state = 'current'
    left join merch.packaging_configurations pc on pc.variant_id = v.id
    where p.workspace_id = p_workspace and p.category_id in (cat_tile, cat_mosaic)
  loop
    for i in 1 .. 4 loop
      insert into merch.products (workspace_id, brand_id, supplier_id, category_id, name, code, color, finish, material,
                                  status, review_state, reviewed_at, source_ref)
      values (p_workspace, prod.brand_id, prod.supplier_id, prod.category_id,
              -- Kept deliberately simple: any expression clever enough to splice
              -- the colour into the middle of the name has to cope with names
              -- that have no size, no colour, or neither, and a single null in a
              -- concatenation makes the whole name null.
              prod.name || ' — ' || (array['Sand','Slate','Umber','Pearl'])[i],
              prod.code || '-' || (array['SND','SLT','UMB','PRL'])[i],
              (array['Sand','Slate','Umber','Pearl'])[i], prod.finish, prod.material,
              'active', case when i = 4 then 'unreviewed' else 'reviewed' end,
              now() - (i * 4 || ' days')::interval, 'Demo catalog (synthetic)')
      returning id into prod_id;

      insert into merch.product_variants (workspace_id, product_id, sku, supplier_code, name, selling_unit_id, is_default, status)
      values (p_workspace, prod_id, prod.code || '-' || (array['SND','SLT','UMB','PRL'])[i],
              prod.code || '-' || (array['SND','SLT','UMB','PRL'])[i], 'Standard', prod.selling_unit_id, true, 'active')
      returning id into var_id;

      insert into merch.product_attribute_values (workspace_id, product_id, variant_id, attribute_definition_id, value, source_ref, confidence)
      select p_workspace, prod_id, var_id, a.attribute_definition_id, a.value, 'Demo catalog (synthetic)', 1.000
      from merch.product_attribute_values a
      where a.product_id = prod.id;

      if prod.per_carton is not null then
        insert into merch.packaging_configurations (workspace_id, variant_id, pack_unit_id, pack_label, quantity_per_pack, inner_unit_id, moq)
        values (p_workspace, var_id, u_ctn, 'carton', prod.per_carton, prod.selling_unit_id, 1);
      end if;

      insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, min_quantity,
                                        valid_from, tax_basis, price_type, market, state, review_state, approved_at, source_ref)
      select p_workspace, l.list_id, var_id, round((prod.retail + i * 2.5) * l.factor, 2), 'MYR', prod.selling_unit_id,
             1, current_date - 60, 'exclusive', l.ptype, 'MY', 'current', 'reviewed', now() - interval '60 days',
             'Demo price list (synthetic)'
      from (values (pl_retail, 1.00, 'retail'), (pl_showroom, 0.92, 'member'), (pl_project, 0.86, 'project'))
           as l(list_id, factor, ptype);
    end loop;
  end loop;

  -- A draft price awaiting publication, so the pricing review path has something in it.
  insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, min_quantity,
                                    valid_from, tax_basis, price_type, market, state, review_state, source_ref)
  values (p_workspace, pl_retail, variant_ids[1], 72.00, 'MYR', u_sqm, 1, current_date + 14,
          'exclusive', 'retail', 'MY', 'draft', 'unreviewed', 'Demo supplier update (synthetic)');

  ------------------------------------------------------------------- accounts
  for i in 1 .. 10 loop
    insert into identity.accounts (workspace_id, name, account_type, owner_id, lifecycle_state,
                                   original_acquisition_source, original_acquisition_at, address)
    values (p_workspace,
      (array['Reno Masters','Urban Build Contractors','Casa Interior Design','Greenfield Developers','Bright Homes Renovation',
             'Prime Tile Retail','Skyline Projects','Harmony Interiors','Nusa Property','Artisan Builders'])[i] || ' Sdn Bhd',
      (array['contractor','contractor','designer','developer','contractor','retailer','developer','designer','developer','contractor'])[i],
      v_owner, (array['new','active','repeat','active','new','repeat','active','new','active','repeat'])[i],
      sources[1 + (i % 8)], now() - (i * 23 || ' days')::interval,
      jsonb_build_object('city', areas[1 + (i % 10)], 'state', 'Selangor', 'country', 'MY'))
    returning id into a_id;
    account_ids := account_ids || a_id;
  end loop;

  ------------------------------------------------------------------- contacts
  for i in 1 .. 36 loop
    fn := first_names[1 + (i % array_length(first_names, 1))];
    ln := last_names[1 + ((i * 7) % array_length(last_names, 1))];
    src := sources[1 + (i % 8)];
    ctype := ctypes[1 + (i % 7)];

    insert into identity.contacts (workspace_id, display_name, given_name, family_name, customer_type, lifecycle_state,
                                   original_acquisition_source, original_acquisition_at, created_at)
    values (p_workspace, fn || ' ' || ln, fn, ln, ctype,
            (array['new','active','repeat','lapsed'])[1 + (i % 4)],
            src, now() - (i * 9 || ' days')::interval, now() - (i * 9 || ' days')::interval)
    returning id into c_id;
    contact_ids := contact_ids || c_id;

    insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
    values (p_workspace, c_id, 'phone',
            '012-' || lpad((3000000 + i * 1357)::text, 7, '0'),
            '+6012' || lpad((3000000 + i * 1357)::text, 7, '0'), true, src);

    if i % 3 = 0 then
      insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
      values (p_workspace, c_id, 'email',
              lower(replace(fn, ' ', '.')) || '.' || lower(ln) || i || '@example.test',
              lower(replace(fn, ' ', '.')) || '.' || lower(ln) || i || '@example.test', false, src);
    end if;

    if ctype <> 'homeowner' then
      insert into identity.account_contact_relationships (workspace_id, account_id, contact_id, role, is_primary)
      values (p_workspace, account_ids[1 + (i % 10)], c_id,
              case when i % 2 = 0 then 'Project manager' else 'Director' end, true)
      on conflict do nothing;
    end if;
  end loop;

  --------------------------------------------------- projects + opportunities
  for i in 1 .. 22 loop
    c_id := contact_ids[1 + (i % 36)];
    a_id := case when i % 3 = 0 then account_ids[1 + (i % 10)] else null end;
    area := areas[1 + (i % 10)];

    insert into identity.projects (workspace_id, name, account_id, primary_contact_id, project_type, status, area, owner_id, created_at)
    values (p_workspace,
      (array['Condo renovation','Terrace house kitchen','Bungalow feature wall','Café fit-out','Office reception',
             'Bathroom remodel','Show unit','Retail outlet','Master bedroom','Living room panels'])[1 + (i % 10)] || ' — ' || area,
      a_id, c_id, (array['renovation','residential','commercial','new_build'])[1 + (i % 4)], 'active', area, v_owner,
      now() - (i * 5 || ' days')::interval)
    returning id into p_id;
    project_ids := project_ids || p_id;

    insert into identity.project_sites (workspace_id, project_id, label, address)
    values (p_workspace, p_id, 'Site', jsonb_build_object('city', area, 'state', 'Selangor'));

    sk := stage_keys[1 + (i % 13)];
    insert into sales.opportunities (workspace_id, name, account_id, contact_id, project_id, stage_key, status, owner_id,
                                     source_channel, estimated_value, probability_band, segment, expected_close_date,
                                     next_action, next_action_due_at, won_at, lost_at, outcome_reason, created_at)
    values (p_workspace, (select pr.name from identity.projects pr where pr.id = p_id), a_id, c_id, p_id, sk,
      case sk when 'won' then 'won' when 'lost' then 'lost' when 'deferred' then 'deferred' else 'open' end,
      v_owner, sources[1 + (i % 8)], 2500 + (i * 1375 % 40000),
      (array['low','medium','high'])[1 + (i % 3)],
      (array['residential','commercial','hospitality','fnb','institutional'])[1 + (i % 5)],
      current_date + (10 + i * 3),
      (array['Call customer','Send revised quote','Arrange site visit','Share samples','Confirm measurements'])[1 + (i % 5)],
      now() + ((i % 9) - 4 || ' days')::interval,
      case when sk = 'won' then now() - (i || ' days')::interval end,
      case when sk = 'lost' then now() - (i || ' days')::interval end,
      case when sk = 'lost' then 'Price' when sk = 'deferred' then 'Timing' end,
      now() - (i * 5 || ' days')::interval)
    returning id into o_id;

    insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, is_backward, reason, actor_id, occurred_at)
    values (p_workspace, o_id, null, 'new_inquiry', false, 'Created', v_owner, now() - (i * 5 || ' days')::interval),
           (p_workspace, o_id, 'new_inquiry', sk, false, 'Demo progression', v_owner, now() - (i * 2 || ' days')::interval);
  end loop;

  --------------------------------------------------------- leads, visits, tasks
  for i in 1 .. 14 loop
    insert into sales.leads (workspace_id, status, source_channel, source_detail, contact_id, raw_name, raw_phone,
                             raw_phone_normalized, interest, owner_id, location_id, contact_attempts, created_at)
    values (p_workspace,
      (array['new','contact_attempted','contacted','qualified','converted'])[1 + (i % 5)],
      sources[1 + (i % 8)], 'Demo campaign', contact_ids[1 + (i % 36)],
      (select ct.display_name from identity.contacts ct where ct.id = contact_ids[1 + (i % 36)]),
      '012-' || lpad((4000000 + i * 911)::text, 7, '0'),
      '+6012' || lpad((4000000 + i * 911)::text, 7, '0'),
      (array['600x600 grey tiles','wall panels for living room','mosaic for bathroom','wood-look flooring'])[1 + (i % 4)],
      v_owner, loc_showroom, i % 3, now() - (i * 2 || ' days')::interval);
  end loop;

  for i in 1 .. 30 loop
    insert into sales.visits (workspace_id, occurred_at, location_id, contact_id, customer_type, origin_area,
                              inquiry_source, purpose, is_new_customer, notes, renovation_area, quotation_amount, created_at)
    values (p_workspace, now() - (i * 2 || ' days')::interval, loc_showroom, contact_ids[1 + (i % 36)],
            ctypes[1 + (i % 7)], areas[1 + (i % 10)], sources[1 + (i % 8)],
            (array['browse','consultation','sample','purchase','follow_up'])[1 + (i % 5)],
            (i % 4 = 0), 'Synthetic walk-in record',
            (array['Kitchen','Bathroom','Living room','Whole house'])[1 + (i % 4)],
            case when i % 3 = 0 then 1500 + (i * 275 % 20000) end,
            now() - (i * 2 || ' days')::interval)
    returning id into v_id;

    if i % 4 = 0 then
      insert into sales.purchases (workspace_id, contact_id, visit_id, purchased_at, amount, currency,
                                   purchase_source, location_id, salesperson_id, is_repeat, status, recorded_by, created_at)
      values (p_workspace, contact_ids[1 + (i % 36)], v_id, now() - (i * 2 || ' days')::interval,
              1800 + (i * 431 % 25000), 'MYR', 'showroom', loc_showroom, v_owner, (i % 8 = 0), 'recorded', v_owner,
              now() - (i * 2 || ' days')::interval)
      returning id into pu_id;

      insert into sales.purchase_items (purchase_id, product_variant_id, description, quantity, unit, unit_price, line_total, position)
      values (pu_id, variant_ids[1 + (i % 12)], 'Demo line item', 12, 'sqm', 68.00, 816.00, 1);
    end if;
  end loop;

  for i in 1 .. 10 loop
    insert into sales.tasks (workspace_id, title, description, status, priority, due_at, assignee_id, contact_id, created_at)
    values (p_workspace,
      (array['Follow up on quote','Call back customer','Arrange site measurement','Send sample box','Check stock for project'])[1 + (i % 5)],
      'Synthetic task', (array['open','open','done'])[1 + (i % 3)],
      (array['low','normal','high','urgent'])[1 + (i % 4)],
      now() + ((i % 7) - 2 || ' days')::interval, v_owner, contact_ids[1 + (i % 36)],
      now() - (i || ' days')::interval);
  end loop;

  insert into sales.activities (workspace_id, kind, channel, subject, body, occurred_at, actor_id, contact_id)
  select p_workspace, (array['call','message','meeting','note','sample'])[1 + (g % 5)],
         (array['whatsapp','phone','in_person'])[1 + (g % 3)],
         'Demo activity ' || g, 'Synthetic activity record.',
         now() - (g || ' days')::interval, v_owner, contact_ids[1 + (g % 36)]
  from generate_series(1, 24) as g;

  insert into sales.sales_targets (workspace_id, year, target_amount, currency, notes)
  values (p_workspace, extract(year from current_date)::int, 1800000, 'MYR', 'Synthetic annual target');

  ---------------------------------------------------------------------- stock
  insert into stock.inventory_sources (workspace_id, key, name, kind, is_authoritative, freshness_sla_minutes)
  values (p_workspace, 'demo_wms', 'Demo warehouse system', 'manual', true, 1440)
  returning id into src_sql;

  insert into stock.inventory_locations (workspace_id, source_id, external_code, name, business_location_id)
  values (p_workspace, src_sql, 'WH-01', 'Demo Warehouse', loc_warehouse)
  returning id into inv_loc;

  insert into stock.inventory_snapshots (workspace_id, source_id, location_id, variant_id, external_item_code,
                                         on_hand, allocated, available, unit_id, source_timestamp, captured_at)
  select p_workspace, src_sql, inv_loc, variant_ids[g], 'ITEM-' || lpad(g::text, 3, '0'),
         120 + (g * 37 % 400), (g * 11 % 40), 120 + (g * 37 % 400) - (g * 11 % 40),
         u_sqm, now() - interval '2 hours', now() - interval '2 hours'
  from generate_series(1, 12) as g;

  ------------------------------------------------------------------ marketing
  insert into marketing.content_opportunities (workspace_id, project_id, contact_id, status, story_angle,
                                               nomination_reason, content_types, readiness_state, priority)
  select p_workspace, project_ids[g], contact_ids[1 + (g % 36)], 'nominated',
         (array['Before and after','Designer feature','Material story'])[1 + (g % 3)],
         'Synthetic nomination', array['photo','video'],
         (array['in_progress','substantially_complete','ready','delayed'])[1 + (g % 4)],
         (array['low','normal','high'])[1 + (g % 3)]
  from generate_series(1, 4) as g;
end $fn$;

revoke all on function core.build_demo_dataset(uuid) from public;
comment on function core.build_demo_dataset(uuid) is
  'Fills a workspace with synthetic demo content. Used by core.reset_demo_workspace() for both the first build and every restore, so the two cannot drift.';

------------------------------------------------------------------------------
-- 2. The reset.
--
-- Deleting the workspace row is the whole cleanup: every foreign key into
-- core.workspaces cascades, so nothing survives and nothing needs deleting in a
-- particular order. Guest memberships are captured first and re-granted, because
-- they cascade away with the workspace and the accounts themselves are not
-- workspace-scoped.
------------------------------------------------------------------------------
create or replace function core.reset_demo_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_guests uuid[];
  v_old    uuid;
  v_new    uuid;
begin
  v_old := core.demo_workspace_id();

  select coalesce(array_agg(m.user_id), '{}')
  into v_guests
  from core.memberships m
  where m.workspace_id = v_old and m.role_key = 'guest';

  -- Audit events carry a workspace_id but no foreign key, so they are the one
  -- thing the cascade would leave behind.
  if v_old is not null then
    delete from audit.audit_events where workspace_id = v_old;
    delete from core.workspaces where id = v_old;
  end if;

  insert into core.workspaces (slug, name, timezone, default_currency, settings)
  values ('demo', 'Tile Concept (demo)', 'Asia/Kuala_Lumpur', 'MYR', jsonb_build_object('is_demo', true))
  returning id into v_new;

  -- Re-grant before building, so the dataset can be owned by a guest and the
  -- "assigned to me" views are not empty.
  insert into core.memberships (workspace_id, user_id, role_key)
  select v_new, u, 'guest' from unnest(v_guests) as u
  on conflict (workspace_id, user_id) do nothing;

  perform core.build_demo_dataset(v_new);
  return v_new;
end $fn$;

revoke all on function core.reset_demo_workspace() from public;
-- Deliberately NOT granted to `authenticated`: a guest must not be able to wipe
-- the workspace they are sitting in. The scheduler runs as the table owner.
grant execute on function core.reset_demo_workspace() to service_role;

comment on function core.reset_demo_workspace() is
  'Drops and rebuilds the demo workspace from core.build_demo_dataset(). Scheduled weekly; never callable by a guest.';

------------------------------------------------------------------------------
-- 3. Build it now.
--
-- On a database where guest mode has not been applied there is no demo workspace
-- and demo_workspace_id() is null, so this creates one and fills it either way.
------------------------------------------------------------------------------
select core.reset_demo_workspace();
