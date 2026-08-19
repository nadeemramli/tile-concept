-- Tile Concept OS — synthetic demo seed (safe for any environment).
-- No real customer, supplier, price, or credential data. Demo staff users are
-- created with random passwords; supabase/seeds/local-users.sql sets known
-- passwords for LOCAL development only.
-- Fixed ids make the fixtures deterministic.

set search_path = '';

do $$
declare
  ws uuid := '11111111-1111-1111-1111-111111111111';
  loc_main uuid := '22222222-2222-2222-2222-222222222201';
  loc_north uuid := '22222222-2222-2222-2222-222222222202';
  u_admin uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  u_manager uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  u_rep1 uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  u_rep2 uuid := 'aaaaaaaa-0000-0000-0000-000000000004';
  u_showroom uuid := 'aaaaaaaa-0000-0000-0000-000000000005';
  u_catalog uuid := 'aaaaaaaa-0000-0000-0000-000000000006';
  u_marketing uuid := 'aaaaaaaa-0000-0000-0000-000000000007';
  demo_users jsonb := '[
    {"id":"aaaaaaaa-0000-0000-0000-000000000001","email":"demo.admin@tileconcept.test","name":"Demo Admin","role":"admin"},
    {"id":"aaaaaaaa-0000-0000-0000-000000000002","email":"demo.manager@tileconcept.test","name":"Farah Manager","role":"sales_manager"},
    {"id":"aaaaaaaa-0000-0000-0000-000000000003","email":"demo.rep1@tileconcept.test","name":"Aiman Sales","role":"sales_rep"},
    {"id":"aaaaaaaa-0000-0000-0000-000000000004","email":"demo.rep2@tileconcept.test","name":"Mei Ling Sales","role":"sales_rep"},
    {"id":"aaaaaaaa-0000-0000-0000-000000000005","email":"demo.showroom@tileconcept.test","name":"Raj Showroom","role":"showroom"},
    {"id":"aaaaaaaa-0000-0000-0000-000000000006","email":"demo.catalog@tileconcept.test","name":"Siti Catalog","role":"catalog_pricing"},
    {"id":"aaaaaaaa-0000-0000-0000-000000000007","email":"demo.marketing@tileconcept.test","name":"Hafiz Marketing","role":"marketing_coordinator"}
  ]'::jsonb;
  du jsonb;
  i int;
  n_contacts int := 40;
  first_names text[] := array['Ahmad','Nurul','Wei Jie','Priya','Hafiz','Mei Ling','Daniel','Aisyah','Kumar','Siti','Jason','Farah','Arjun','Nadia','Kevin','Zara','Ravi','Amira','Brandon','Hannah','Imran','Li Wen','Suresh','Yasmin','Marcus','Diana','Faisal','Grace','Vikram','Aina'];
  last_names text[] := array['Abdullah','Tan','Lim','Rahman','Wong','Kumar','Lee','Ismail','Ng','Hassan','Chong','Yusof','Pillai','Goh','Zainal','Chen','Raj','Omar','Teo','Hamid'];
  areas text[] := array['Cheras','Puchong','Shah Alam','Subang Jaya','Petaling Jaya','Ampang','Kajang','Klang','Bangsar','Mont Kiara','Setapak','Rawang'];
  sources text[] := array['tiktok','meta','website','whatsapp','referral','walk_in','dm','call'];
  ctypes text[] := array['homeowner','homeowner','homeowner','contractor','designer','developer','retailer'];
  c_id uuid; a_id uuid; p_id uuid; o_id uuid; l_id uuid; v_id uuid; pu_id uuid;
  fn text; ln text; src text; phone text; ctype text; area text;
  stage_keys text[] := array['new_inquiry','contact_attempted','contacted','qualified','consultation','sample_site','quote_preparing','quote_sent','negotiation','verbal_confirmation','won','lost','deferred'];
  stage_labels text[] := array['New inquiry','Contact attempted','Contacted','Qualified','Consultation / requirements','Sample or site activity','Quote preparing','Quote sent','Negotiation / revision','Verbal confirmation / pending document','Won','Lost','Deferred / nurture'];
  sk text;
  brand_house uuid := '33333333-0000-0000-0000-000000000001';
  brand_mosaic uuid := '33333333-0000-0000-0000-000000000002';
  brand_tile uuid := '33333333-0000-0000-0000-000000000003';
  sup_mosaic uuid := '34343434-0000-0000-0000-000000000001';
  sup_tile uuid := '34343434-0000-0000-0000-000000000002';
  cat_panel uuid := '35353535-0000-0000-0000-000000000001';
  cat_tile uuid := '35353535-0000-0000-0000-000000000002';
  cat_cut uuid := '35353535-0000-0000-0000-000000000003';
  cat_mosaic uuid := '35353535-0000-0000-0000-000000000004';
  cat_finish uuid := '35353535-0000-0000-0000-000000000005';
  cat_acc uuid := '35353535-0000-0000-0000-000000000006';
  u_pc uuid := '36363636-0000-0000-0000-000000000001';
  u_sheet uuid := '36363636-0000-0000-0000-000000000002';
  u_ctn uuid := '36363636-0000-0000-0000-000000000003';
  u_sqm uuid := '36363636-0000-0000-0000-000000000004';
  u_m uuid := '36363636-0000-0000-0000-000000000005';
  u_set uuid := '36363636-0000-0000-0000-000000000006';
  pl_retail uuid := '37373737-0000-0000-0000-000000000001';
  pl_member uuid := '37373737-0000-0000-0000-000000000002';
  prod record; var_id uuid; prod_id uuid;
  contact_ids uuid[] := '{}';
  account_ids uuid[] := '{}';
  project_ids uuid[] := '{}';
  opp_ids uuid[] := '{}';
  variant_ids uuid[] := '{}';
  owners uuid[];
  owner uuid;
  day_offset int;
begin
  owners := array[u_rep1, u_rep2, u_manager];

  ------------------------------------------------------------------ workspace
  insert into core.workspaces (id, slug, name) values (ws, 'tile-concept', 'Tile Concept') on conflict (id) do nothing;
  insert into core.business_locations (id, workspace_id, code, name, kind, address) values
    (loc_main, ws, 'SHOWROOM-HQ', 'HQ Showroom', 'showroom', '{"city":"Kuala Lumpur","state":"WP","country":"MY"}'),
    (loc_north, ws, 'SHOWROOM-N', 'North Showroom', 'showroom', '{"city":"Rawang","state":"Selangor","country":"MY"}')
  on conflict (id) do nothing;

  ------------------------------------------------------------------ demo users
  for du in select * from jsonb_array_elements(demo_users) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user)
    values ('00000000-0000-0000-0000-000000000000', (du->>'id')::uuid, 'authenticated', 'authenticated', du->>'email',
      extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', du->>'name'),
      now(), now(), '', '', '', '', '', '', '', '', false)
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), (du->>'id')::uuid, du->>'email', 'email', jsonb_build_object('sub', du->>'id', 'email', du->>'email', 'email_verified', true), now(), now(), now())
    on conflict do nothing;
    -- trigger created the profile; ensure the membership
    insert into core.memberships (workspace_id, user_id, role_key, default_location_id)
    values (ws, (du->>'id')::uuid, du->>'role', loc_main) on conflict (workspace_id, user_id) do nothing;
    update core.profiles set full_name = du->>'name' where user_id = (du->>'id')::uuid;
  end loop;

  -- Real administrator invite: membership is created automatically when this
  -- email accepts the Supabase Auth invitation (core.handle_new_auth_user).
  insert into core.membership_invites (workspace_id, email, role_key, default_location_id, invited_by)
  values (ws, 'm.nadeemramli@gmail.com', 'admin', loc_main, u_admin) on conflict (workspace_id, email) do nothing;

  ------------------------------------------------------------------ stages
  for i in 1..array_length(stage_keys, 1) loop
    insert into core.opportunity_stages (workspace_id, key, label, position, reporting_group, requires_reason, requires_next_action)
    values (ws, stage_keys[i], stage_labels[i], i,
      case when stage_keys[i] = 'won' then 'won' when stage_keys[i] = 'lost' then 'lost' when stage_keys[i] = 'deferred' then 'deferred' else 'open' end,
      stage_keys[i] in ('won','lost','deferred'),
      stage_keys[i] not in ('won','lost','deferred','new_inquiry','contact_attempted','contacted'))
    on conflict (workspace_id, key) do nothing;
  end loop;

  ------------------------------------------------------------------ feature flags
  insert into core.feature_flags (workspace_id, key, enabled) values
    (ws, 'marketing.shoot_calendar', false), (ws, 'merch.ocr_pipeline', false), (ws, 'stock.sql_connector', false), (ws, 'sales.lead_connectors', false)
  on conflict do nothing;

  ------------------------------------------------------------------ saved views
  insert into core.saved_views (workspace_id, user_id, surface, name, filters, position, is_default) values
    (ws, null, 'inbox', 'New', '{"status":["new"]}', 1, true),
    (ws, null, 'inbox', 'Unassigned', '{"owner":"unassigned"}', 2, false),
    (ws, null, 'inbox', 'My leads', '{"owner":"me"}', 3, false),
    (ws, null, 'inbox', 'No response', '{"status":["new"],"first_response":"none"}', 4, false),
    (ws, null, 'inbox', 'Follow-up due', '{"follow_up":"due"}', 5, false),
    (ws, null, 'inbox', 'Duplicate review', '{"duplicates":true}', 6, false),
    (ws, null, 'inbox', 'Qualified', '{"status":["qualified","converted"]}', 7, false),
    (ws, null, 'inbox', 'Disqualified', '{"status":["disqualified"]}', 8, false),
    (ws, null, 'inbox', 'All', '{}', 9, false),
    (ws, null, 'pipeline', 'Open', '{"status":["open"]}', 1, true),
    (ws, null, 'pipeline', 'Overdue next action', '{"overdue":true}', 2, false),
    (ws, null, 'pipeline', 'Won (30d)', '{"status":["won"],"days":30}', 3, false),
    (ws, null, 'catalog', 'Active', '{"status":["active"]}', 1, true),
    (ws, null, 'catalog', 'Missing price', '{"missing_price":true}', 2, false),
    (ws, null, 'catalog', 'Unreviewed', '{"review_state":["unreviewed"]}', 3, false);

  ------------------------------------------------------------------ merch reference
  insert into merch.units_of_measure (id, workspace_id, code, label, kind) values
    (u_pc, ws, 'pc', 'Piece', 'count'), (u_sheet, ws, 'sheet', 'Sheet', 'count'), (u_ctn, ws, 'ctn', 'Carton', 'pack'),
    (u_sqm, ws, 'sqm', 'Square metre', 'area'), (u_m, ws, 'm', 'Metre', 'length'), (u_set, ws, 'set', 'Set', 'count')
  on conflict (id) do nothing;

  insert into merch.product_categories (id, workspace_id, key, label, position) values
    (cat_panel, ws, 'wall_panel', 'Wall panel', 1), (cat_tile, ws, 'tile', 'Tile', 2), (cat_cut, ws, 'cut_tile', 'Cut tile', 3),
    (cat_mosaic, ws, 'mosaic', 'Mosaic', 4), (cat_finish, ws, 'finishing', 'Finishing product', 5), (cat_acc, ws, 'accessory', 'Accessory', 6)
  on conflict (id) do nothing;

  insert into merch.attribute_definitions (workspace_id, key, label, data_type, unit) values
    (ws, 'width_mm', 'Width', 'dimension', 'mm'), (ws, 'length_mm', 'Length', 'dimension', 'mm'), (ws, 'thickness_mm', 'Thickness', 'dimension', 'mm'),
    (ws, 'depth_mm', 'Depth', 'dimension', 'mm'), (ws, 'sheet_width_mm', 'Sheet width', 'dimension', 'mm'), (ws, 'sheet_height_mm', 'Sheet height', 'dimension', 'mm'),
    (ws, 'chip_width_mm', 'Chip width', 'dimension', 'mm'), (ws, 'chip_height_mm', 'Chip height', 'dimension', 'mm'), (ws, 'chip_shape', 'Chip shape', 'enum', null),
    (ws, 'pieces_per_carton', 'Pieces per carton', 'number', 'pc'), (ws, 'sheets_per_carton', 'Sheets per carton', 'number', 'sheet'), (ws, 'sqm_per_carton', 'Coverage per carton', 'number', 'sqm'),
    (ws, 'series', 'Series / profile', 'text', null), (ws, 'clip_system', 'Clip / system', 'text', null), (ws, 'edge', 'Edge', 'enum', null), (ws, 'grade', 'Grade', 'text', null),
    (ws, 'parent_tile', 'Parent / base tile', 'text', null), (ws, 'cut_pattern', 'Cut pattern', 'text', null), (ws, 'yield_rule', 'Yield / wastage rule', 'text', null),
    (ws, 'compatible_system', 'Compatible product / system', 'text', null), (ws, 'pack_quantity', 'Pack quantity', 'number', 'pc')
  on conflict do nothing;

  insert into merch.category_attribute_rules (workspace_id, category_id, attribute_definition_id, is_required, position)
  select ws, c.id, d.id, r.req, r.pos from (values
    ('mosaic','sheet_width_mm',true,1),('mosaic','sheet_height_mm',true,2),('mosaic','chip_width_mm',false,3),('mosaic','chip_height_mm',false,4),('mosaic','chip_shape',false,5),('mosaic','sheets_per_carton',false,6),('mosaic','sqm_per_carton',false,7),
    ('wall_panel','series',true,1),('wall_panel','width_mm',true,2),('wall_panel','depth_mm',true,3),('wall_panel','length_mm',true,4),('wall_panel','clip_system',false,5),('wall_panel','pieces_per_carton',false,6),
    ('tile','width_mm',true,1),('tile','length_mm',true,2),('tile','thickness_mm',false,3),('tile','edge',false,4),('tile','grade',false,5),('tile','pieces_per_carton',false,6),('tile','sqm_per_carton',false,7),
    ('cut_tile','parent_tile',true,1),('cut_tile','width_mm',true,2),('cut_tile','length_mm',true,3),('cut_tile','cut_pattern',false,4),('cut_tile','yield_rule',false,5),
    ('accessory','compatible_system',false,1),('accessory','pack_quantity',false,2)
  ) as r(cat, attr, req, pos)
  join merch.product_categories c on c.workspace_id = ws and c.key = r.cat
  join merch.attribute_definitions d on d.workspace_id = ws and d.key = r.attr
  on conflict do nothing;

  insert into merch.suppliers (id, workspace_id, name, website) values
    (sup_mosaic, ws, 'Demo Mosaic Supplier Sdn Bhd', 'https://example.test/mosaic'),
    (sup_tile, ws, 'Demo Tile Trading', 'https://example.test/tile')
  on conflict (id) do nothing;
  insert into merch.brands (id, workspace_id, name, supplier_id, is_house_brand) values
    (brand_house, ws, 'TC Panel', null, true), (brand_mosaic, ws, 'MosaicWorks', sup_mosaic, false), (brand_tile, ws, 'StoneLine', sup_tile, false)
  on conflict (id) do nothing;

  insert into merch.price_lists (id, workspace_id, name, owner_id, currency, price_type, status, source_ref) values
    (pl_retail, ws, 'Retail 2026', u_catalog, 'MYR', 'retail', 'active', 'Demo retail price list'),
    (pl_member, ws, 'Member 2026', u_catalog, 'MYR', 'member', 'active', 'Demo member price list')
  on conflict (id) do nothing;

  ------------------------------------------------------------------ products
  for prod in select * from (values
    ('WP-OAK-160', 'Fluted Wall Panel Oak 160', brand_house, cat_panel, 'Oak', 'Matte', 'WPC', '{"width_mm":160,"depth_mm":24,"length_mm":2900}', u_pc, 48.00, 42.00, 'pc'),
    ('WP-WAL-160', 'Fluted Wall Panel Walnut 160', brand_house, cat_panel, 'Walnut', 'Matte', 'WPC', '{"width_mm":160,"depth_mm":24,"length_mm":2900}', u_pc, 48.00, 42.00, 'pc'),
    ('WP-WHT-195', 'Slat Wall Panel White 195', brand_house, cat_panel, 'White', 'Satin', 'WPC', '{"width_mm":195,"depth_mm":12,"length_mm":2900}', u_pc, 55.00, 49.00, 'pc'),
    ('MW-HEX-WHT', 'Hexagon Mosaic White', brand_mosaic, cat_mosaic, 'White', 'Matte', 'Porcelain', '{"sheet_width_mm":300,"sheet_height_mm":300,"chip_width_mm":48}', u_sheet, 18.50, 16.00, 'sheet'),
    ('MW-SUB-GRN', 'Subway Mosaic Green', brand_mosaic, cat_mosaic, 'Green', 'Glossy', 'Ceramic', '{"sheet_width_mm":300,"sheet_height_mm":300,"chip_width_mm":25,"chip_height_mm":75}', u_sheet, 22.00, 19.50, 'sheet'),
    ('MW-PEN-BLK', 'Penny Round Mosaic Black', brand_mosaic, cat_mosaic, 'Black', 'Matte', 'Porcelain', '{"sheet_width_mm":300,"sheet_height_mm":300,"chip_width_mm":19}', u_sheet, 24.00, 21.00, 'sheet'),
    ('SL-6060-GRY', 'Porcelain Tile Grey 600x600', brand_tile, cat_tile, 'Grey', 'Matte', 'Porcelain', '{"width_mm":600,"length_mm":600,"thickness_mm":9}', u_sqm, 68.00, 62.00, 'sqm'),
    ('SL-6012-OAK', 'Wood-look Tile Oak 600x1200', brand_tile, cat_tile, 'Oak', 'Matte', 'Porcelain', '{"width_mm":600,"length_mm":1200,"thickness_mm":10}', u_sqm, 95.00, 88.00, 'sqm'),
    ('SL-3060-BGE', 'Ceramic Wall Tile Beige 300x600', brand_tile, cat_tile, 'Beige', 'Glossy', 'Ceramic', '{"width_mm":300,"length_mm":600,"thickness_mm":8}', u_sqm, 42.00, 38.00, 'sqm'),
    ('CT-6060-GRY-SKT', 'Skirting cut from Grey 600x600', brand_tile, cat_cut, 'Grey', 'Matte', 'Porcelain', '{"width_mm":100,"length_mm":600}', u_pc, 9.50, 8.50, 'pc'),
    ('FN-GRT-WHT', 'Tile Grout White 2kg', null, cat_finish, 'White', null, 'Cement', '{}', u_pc, 14.00, 12.50, 'pc'),
    ('AC-CLIP-WP', 'Wall Panel Clip Set (50)', brand_house, cat_acc, null, null, 'Steel', '{}', u_set, 25.00, 22.00, 'set')
  ) as t(code, name, brand_id, category_id, color, finish, material, dims, unit_id, retail, member, unit_code)
  loop
    insert into merch.products (workspace_id, brand_id, supplier_id, category_id, name, code, color, finish, material, status, review_state, reviewed_by, reviewed_at, source_ref, created_by)
    values (ws, prod.brand_id, (select supplier_id from merch.brands where id = prod.brand_id), prod.category_id, prod.name, prod.code, prod.color, prod.finish, prod.material,
            'active', case when prod.code in ('FN-GRT-WHT','SL-3060-BGE') then 'unreviewed' else 'reviewed' end, u_catalog, now() - interval '20 days', 'Demo catalog (synthetic)', u_catalog)
    returning id into prod_id;
    insert into merch.product_variants (workspace_id, product_id, sku, name, dimensions, selling_unit_id, is_default)
    values (ws, prod_id, prod.code, 'Standard', prod.dims::jsonb, prod.unit_id, true) returning id into var_id;
    variant_ids := variant_ids || var_id;
    if prod.code <> 'FN-GRT-WHT' then
      insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, valid_from, state, review_state, source_ref, approved_by, approved_at, created_by)
      values (ws, pl_retail, var_id, prod.retail, 'MYR', prod.unit_id, current_date - 60, 'current', 'reviewed', 'Demo retail list p.1', u_catalog, now() - interval '60 days', u_catalog),
             (ws, pl_member, var_id, prod.member, 'MYR', prod.unit_id, current_date - 60, 'current', 'reviewed', 'Demo member list p.1', u_catalog, now() - interval '60 days', u_catalog);
      -- one superseded historic price to show history
      insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, valid_from, valid_to, state, review_state, source_ref, approved_by, approved_at, created_by)
      values (ws, pl_retail, var_id, round(prod.retail * 0.94, 2), 'MYR', prod.unit_id, current_date - 400, current_date - 61, 'superseded', 'reviewed', 'Demo retail list 2025', u_catalog, now() - interval '400 days', u_catalog);
    end if;
    if prod.code = 'MW-HEX-WHT' then
      insert into merch.product_aliases (workspace_id, product_id, alias, source) values (ws, prod_id, 'HEX-WHITE-48', 'supplier code'), (ws, prod_id, 'Hexagon White Matt', 'old catalog');
      insert into merch.packaging_configurations (workspace_id, variant_id, pack_unit_id, pack_label, quantity_per_pack, inner_unit_id, coverage_per_pack, coverage_unit_id, moq)
      values (ws, var_id, u_ctn, 'Carton', 11, u_sheet, 0.99, u_sqm, 1);
    end if;
    if prod.code like 'WP-%' then
      insert into merch.packaging_configurations (workspace_id, variant_id, pack_unit_id, pack_label, quantity_per_pack, inner_unit_id, moq, order_increment)
      values (ws, var_id, u_ctn, 'Carton', 4, u_pc, 1, 1);
    end if;
  end loop;
  -- a draft price awaiting publication (shows review queue)
  insert into merch.variant_prices (workspace_id, price_list_id, variant_id, amount, currency, unit_id, valid_from, state, review_state, source_ref, created_by)
  values (ws, pl_retail, variant_ids[7], 72.00, 'MYR', u_sqm, current_date + 14, 'draft', 'unreviewed', 'Demo supplier update 2026-08 p.2', u_catalog);

  ------------------------------------------------------------------ accounts
  for i in 1..12 loop
    a_id := gen_random_uuid();
    insert into identity.accounts (id, workspace_id, name, account_type, registration_number, owner_id, original_acquisition_source, original_acquisition_at, address, created_by)
    values (a_id, ws,
      (array['Reno Masters','Urban Build Contractors','Casa Interior Design','Greenfield Developers','Bright Homes Renovation','Prime Tile Retail','Skyline Projects','Harmony Interiors','Nusa Property','Artisan Builders','Metro Decor Works','Vista Construction'])[i] || ' Sdn Bhd',
      (array['contractor','contractor','designer','developer','contractor','retailer','developer','designer','developer','contractor','designer','contractor'])[i],
      format('20%s01%s', lpad(i::text, 2, '0'), lpad((1000 + i * 37)::text, 6, '0')),
      owners[1 + (i % 3)], sources[1 + (i % 8)], now() - (i * 23 || ' days')::interval,
      jsonb_build_object('city', areas[1 + (i % 12)], 'state', 'Selangor', 'country', 'MY'), u_admin);
    account_ids := account_ids || a_id;
  end loop;
  insert into identity.account_aliases (workspace_id, account_id, alias, source) values (ws, account_ids[1], 'Reno Masters', 'short name'), (ws, account_ids[3], 'Casa ID', 'whatsapp');

  ------------------------------------------------------------------ contacts
  for i in 1..n_contacts loop
    fn := first_names[1 + (i % array_length(first_names, 1))];
    ln := last_names[1 + ((i * 7) % array_length(last_names, 1))];
    src := sources[1 + (i % 8)];
    ctype := ctypes[1 + (i % 7)];
    phone := '+6012' || lpad((3000000 + i * 1357)::text, 7, '0');
    c_id := gen_random_uuid();
    insert into identity.contacts (id, workspace_id, display_name, given_name, family_name, customer_type, lifecycle_state, original_acquisition_source, original_acquisition_at, created_by, created_at)
    values (c_id, ws, fn || ' ' || ln, fn, ln, ctype, 'new', src, now() - (i * 9 || ' days')::interval, u_admin, now() - (i * 9 || ' days')::interval);
    insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
    values (ws, c_id, 'phone', replace(phone, '+60', '0'), phone, true, src);
    if i % 3 = 0 then
      insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
      values (ws, c_id, 'email', lower(replace(fn, ' ', '.')) || '.' || lower(ln) || i || '@example.test', lower(replace(fn, ' ', '.')) || '.' || lower(ln) || i || '@example.test', false, src);
    end if;
    if ctype <> 'homeowner' then
      insert into identity.account_contact_relationships (workspace_id, account_id, contact_id, role, is_primary)
      values (ws, account_ids[1 + (i % 12)], c_id, case when i % 2 = 0 then 'Project manager' else 'Director' end, true) on conflict do nothing;
    end if;
    contact_ids := contact_ids || c_id;
  end loop;

  -- a deliberate duplicate pair (same phone, different spelling) to exercise identity review
  c_id := gen_random_uuid();
  insert into identity.contacts (id, workspace_id, display_name, given_name, family_name, customer_type, original_acquisition_source, original_acquisition_at, is_provisional, created_by)
  values (c_id, ws, 'Ahmad bin Abdullah', 'Ahmad', 'Abdullah', 'homeowner', 'walk_in', now() - interval '3 days', true, u_showroom);
  insert into identity.contact_points (workspace_id, contact_id, kind, raw_value, normalized_value, is_primary, source)
  values (ws, c_id, 'phone', '012-3001357', '+60123001357', true, 'walk_in');
  contact_ids := contact_ids || c_id;
  insert into identity.identity_match_candidates (workspace_id, subject_type, subject_id, candidate_id, score, confidence, reasons)
  values (ws, 'contact', c_id, contact_ids[1], 75, 'high', '[{"code":"exact_phone","field":"phone"},{"code":"similar_name","field":"name"}]')
  on conflict do nothing;

  ------------------------------------------------------------------ projects + opportunities
  for i in 1..25 loop
    c_id := contact_ids[1 + (i % n_contacts)];
    a_id := case when i % 3 = 0 then account_ids[1 + (i % 12)] else null end;
    area := areas[1 + (i % 12)];
    owner := owners[1 + (i % 3)];
    p_id := gen_random_uuid();
    insert into identity.projects (id, workspace_id, name, account_id, primary_contact_id, project_type, status, area, owner_id, created_by, created_at)
    values (p_id, ws, (array['Condo renovation','Terrace house kitchen','Bungalow feature wall','Café fit-out','Office reception','Bathroom remodel','Show unit','Retail outlet','Master bedroom','Living room panels'])[1 + (i % 10)] || ' — ' || area,
            a_id, c_id, (array['renovation','residential','commercial','new_build'])[1 + (i % 4)], 'active', area, owner, u_admin, now() - (i * 5 || ' days')::interval);
    insert into identity.project_sites (workspace_id, project_id, label, address) values (ws, p_id, 'Site', jsonb_build_object('city', area, 'state', 'Selangor'));
    project_ids := project_ids || p_id;

    sk := stage_keys[1 + (i % 13)];
    o_id := gen_random_uuid();
    insert into sales.opportunities (id, workspace_id, name, account_id, contact_id, project_id, stage_key, status, owner_id, source_channel, estimated_value, probability_band,
      expected_close_date, next_action, next_action_due_at, product_interest, won_at, lost_at, outcome_reason, created_by, created_at)
    values (o_id, ws, (select name from identity.projects where id = p_id), a_id, c_id, p_id, sk,
      case when sk = 'won' then 'won' when sk = 'lost' then 'lost' when sk = 'deferred' then 'deferred' else 'open' end,
      owner, sources[1 + (i % 8)], 2500 + (i * 1375 % 40000), (array['low','medium','high'])[1 + (i % 3)],
      current_date + (10 + i * 3), (array['Call customer','Send revised quote','Arrange site visit','Share samples','Confirm measurements','Follow up on quote'])[1 + (i % 6)],
      now() + ((i % 9) - 4 || ' days')::interval,
      case when i % 2 = 0 then array['wall_panel'] else array['tile','mosaic'] end,
      case when sk = 'won' then now() - interval '5 days' else null end,
      case when sk = 'lost' then now() - interval '8 days' else null end,
      case when sk = 'lost' then 'Chose competitor on price' when sk = 'won' then 'Confirmed with deposit' when sk = 'deferred' then 'Project delayed to Q4' else null end,
      u_admin, now() - (i * 5 || ' days')::interval);
    insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, actor_id, occurred_at)
    values (ws, o_id, null, 'new_inquiry', owner, now() - (i * 5 || ' days')::interval);
    if sk <> 'new_inquiry' then
      insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, reason, actor_id, occurred_at)
      values (ws, o_id, 'new_inquiry', sk, case when sk in ('won','lost','deferred') then 'Seed outcome' else null end, owner, now() - (i * 2 || ' days')::interval);
    end if;
    insert into sales.activities (workspace_id, kind, channel, subject, body, occurred_at, actor_id, contact_id, account_id, project_id, opportunity_id)
    values (ws, 'call', 'phone', 'Discovery call', 'Discussed requirements and budget range.', now() - (i * 4 || ' days')::interval, owner, c_id, a_id, p_id, o_id),
           (ws, 'note', null, 'Samples shown', 'Customer liked the oak panel and hexagon mosaic.', now() - (i * 3 || ' days')::interval, owner, c_id, a_id, p_id, o_id);
    opp_ids := opp_ids || o_id;

    if sk in ('quote_sent','negotiation','verbal_confirmation','won') then
      declare q_id uuid := gen_random_uuid(); qv_id uuid := gen_random_uuid();
      begin
        insert into sales.quotes (id, workspace_id, opportunity_id, quote_number, status, current_version_no, created_by)
        values (q_id, ws, o_id, 'QT-2026-' || lpad(i::text, 4, '0'), case when sk = 'won' then 'accepted' else 'issued' end, 1, owner);
        insert into sales.quote_versions (id, workspace_id, quote_id, version_no, issued_at, valid_until, total_amount, currency, created_by)
        values (qv_id, ws, q_id, 1, now() - interval '6 days', current_date + (i % 10), 2500 + (i * 1375 % 40000), 'MYR', owner);
        insert into sales.quote_items (quote_version_id, product_variant_id, description, quantity, unit, unit_price, currency, line_total, price_snapshot)
        values (qv_id, variant_ids[1], 'Fluted Wall Panel Oak 160', 40, 'pc', 48.00, 'MYR', 1920.00, '{"price_list":"Retail 2026","amount":48.00,"unit":"pc","valid_from":"2026-06-01"}');
        insert into sales.external_document_links (workspace_id, object_type, object_id, system, document_type, document_number, created_by)
        values (ws, 'quote', q_id, 'sql_account', 'quotation', 'SQ-' || lpad((4000 + i)::text, 5, '0'), owner);
      end;
    end if;
  end loop;

  ------------------------------------------------------------------ leads (inbox)
  for i in 1..30 loop
    src := sources[1 + (i % 8)];
    fn := first_names[1 + ((i * 3) % array_length(first_names, 1))];
    ln := last_names[1 + ((i * 5) % array_length(last_names, 1))];
    l_id := gen_random_uuid();
    insert into sales.leads (id, workspace_id, status, source_channel, source_detail, contact_id, raw_name, raw_phone, raw_phone_normalized, raw_email, interest, product_interest, location_id, owner_id, assigned_at, first_response_due_at, first_response_at, created_by, created_at)
    values (l_id, ws,
      (array['new','new','new','contact_attempted','contacted','qualified','disqualified','new','contacted','new'])[1 + (i % 10)],
      src, case when src in ('tiktok','meta') then 'Campaign ' || chr(65 + (i % 4)) || ' / Form ' || (1 + i % 3) else null end,
      case when i % 4 = 0 then contact_ids[1 + (i % n_contacts)] else null end,
      fn || ' ' || ln, '012' || lpad((5000000 + i * 911)::text, 7, '0'), '+6012' || lpad((5000000 + i * 911)::text, 7, '0'),
      case when i % 3 = 0 then lower(fn) || i || '@example.test' else null end,
      (array['Wall panel for living room','Tiles for 2 bathrooms','Mosaic backsplash','Full condo renovation','Café floor tiles','Feature wall quote'])[1 + (i % 6)],
      case when i % 2 = 0 then array['wall_panel'] else array['tile'] end,
      loc_main,
      case when i % 5 = 0 then null else owners[1 + (i % 3)] end,
      case when i % 5 = 0 then null else now() - (i || ' hours')::interval end,
      now() - (i || ' hours')::interval + interval '4 hours',
      case when i % 10 in (4,5,6,8) then now() - (i || ' hours')::interval + interval '1 hour' else null end,
      u_admin, now() - (i * 7 || ' hours')::interval);
    insert into sales.intake_events (workspace_id, source_channel, provider, external_id, idempotency_key, received_at, payload, status, lead_id, created_by)
    values (ws, src, case when src in ('tiktok','meta','website') then src else 'manual' end, 'ext-' || i, 'seed-' || i, now() - (i * 7 || ' hours')::interval,
            jsonb_build_object('name', fn || ' ' || ln, 'message', 'Hi, I am interested in your products.'), 'processed', l_id, u_admin);
    insert into sales.lead_intake_links (lead_id, intake_event_id) select l_id, id from sales.intake_events where idempotency_key = 'seed-' || i and workspace_id = ws;
  end loop;

  ------------------------------------------------------------------ tasks
  for i in 1..20 loop
    insert into sales.tasks (workspace_id, title, status, priority, due_at, assignee_id, contact_id, opportunity_id, created_by)
    values (ws, (array['Call back about quote','Send sample photos','Confirm site visit time','Prepare revised quotation','Check supplier stock for mosaic','Follow up on deposit'])[1 + (i % 6)],
      case when i % 7 = 0 then 'done' else 'open' end, (array['normal','high','low','urgent'])[1 + (i % 4)],
      now() + ((i % 8) - 3 || ' days')::interval, owners[1 + (i % 3)], contact_ids[1 + (i % n_contacts)], opp_ids[1 + (i % 25)], u_manager);
  end loop;

  ------------------------------------------------------------------ visits + purchases
  for i in 1..25 loop
    c_id := contact_ids[1 + ((i * 3) % n_contacts)];
    v_id := gen_random_uuid();
    insert into sales.visits (id, workspace_id, occurred_at, location_id, staff_user_id, contact_id, customer_type, origin_area, inquiry_source, purpose, is_new_customer, created_by)
    values (v_id, ws, now() - (i * 31 || ' hours')::interval, case when i % 4 = 0 then loc_north else loc_main end, case when i % 2 = 0 then u_showroom else u_rep1 end, c_id,
      ctypes[1 + (i % 7)], areas[1 + (i % 12)], sources[1 + (i % 8)], (array['browse','consultation','purchase','collection','sample'])[1 + (i % 5)], i % 3 <> 0, u_showroom);
    insert into sales.activities (workspace_id, kind, channel, subject, occurred_at, actor_id, contact_id, visit_id)
    values (ws, 'walk_in', 'walk_in', 'Showroom walk-in', now() - (i * 31 || ' hours')::interval, u_showroom, c_id, v_id);
    if i % 5 in (0, 2, 3) then
      pu_id := gen_random_uuid();
      insert into sales.purchases (id, workspace_id, contact_id, visit_id, purchased_at, external_ref, amount, purchase_source, location_id, salesperson_id, is_repeat, recorded_by)
      values (pu_id, ws, c_id, v_id, now() - (i * 31 || ' hours')::interval, 'ORC-' || lpad((10000 + i)::text, 6, '0'), 300 + (i * 173 % 6000), 'walk_in', loc_main, u_rep1, i % 10 = 0, u_showroom);
      insert into sales.purchase_payments (purchase_id, method, amount, paid_at) values (pu_id, (array['cash','card','bank_transfer','ewallet'])[1 + (i % 4)], 300 + (i * 173 % 6000), now() - (i * 31 || ' hours')::interval);
      insert into sales.purchase_items (purchase_id, product_variant_id, description, quantity, unit, unit_price, line_total)
      values (pu_id, variant_ids[1 + (i % 12)], 'Seed item', 1, 'pc', 300 + (i * 173 % 6000), 300 + (i * 173 % 6000));
      insert into sales.activities (workspace_id, kind, subject, occurred_at, actor_id, contact_id, visit_id, purchase_id, metadata)
      values (ws, 'note', 'Purchase recorded · ORC-' || lpad((10000 + i)::text, 6, '0'), now() - (i * 31 || ' hours')::interval, u_showroom, c_id, v_id, pu_id, jsonb_build_object('amount', 300 + (i * 173 % 6000)));
      update identity.contacts set lifecycle_state = case when i % 10 = 0 then 'repeat' else 'active' end where id = c_id;
    end if;
  end loop;

  ------------------------------------------------------------------ data health + integrations
  insert into ingest.integration_connections (workspace_id, provider, name, environment, direction, status, business_purpose) values
    (ws, 'meta', 'Meta lead forms', 'demo', 'webhook', 'not_configured', 'Lead intake from Meta lead ads'),
    (ws, 'tiktok', 'TikTok lead forms', 'demo', 'webhook', 'not_configured', 'Lead intake from TikTok lead generation'),
    (ws, 'website', 'Website inquiry form', 'demo', 'webhook', 'not_configured', 'Signed server-to-server inquiries'),
    (ws, 'sql_account', 'SQL Account (on-prem)', 'demo', 'pull', 'not_configured', 'Read-only in-house stock and customer documents'),
    (ws, 'google_drive', 'Google Drive source folders', 'demo', 'pull', 'not_configured', 'Supplier catalog and price list files'),
    (ws, 'supplier_web', 'Supplier websites (allowlist)', 'demo', 'pull', 'not_configured', 'Allowlisted supplier catalog capture');
  insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary) values
    (ws, 'duplicate_contact', 'medium', 'contact', contact_ids[array_length(contact_ids, 1)], 'Possible duplicate: same phone as an existing contact'),
    (ws, 'unknown_unit', 'low', 'product', null, 'Supplier file uses "box" which is not mapped to a unit'),
    (ws, 'stale_snapshot', 'medium', 'supplier', sup_mosaic, 'No supplier availability update in 14 days');

  ------------------------------------------------------------------ stock reference (placeholder data)
  insert into stock.inventory_sources (workspace_id, key, name, kind, is_authoritative, freshness_sla_minutes) values
    (ws, 'sql_account', 'SQL Account', 'sql_account', true, 240), (ws, 'supplier_manual', 'Supplier updates (manual)', 'supplier', false, 4320);
end $$;
