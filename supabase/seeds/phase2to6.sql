-- Synthetic fixtures for the Phase 2-6 modules. No real customer, supplier,
-- price, stock or credential data. Loaded after seed.sql.
set search_path = '';

do $$
declare
  ws uuid := '11111111-1111-1111-1111-111111111111';
  u_marketing uuid := 'aaaaaaaa-0000-0000-0000-000000000007';
  u_rep1 uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  u_rep2 uuid := 'aaaaaaaa-0000-0000-0000-000000000004';
  u_catalog uuid := 'aaaaaaaa-0000-0000-0000-000000000006';
  u_admin uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  proj record; co_id uuid; perm_id uuid; b_id uuid; i int := 0;
  sup_mosaic uuid := '34343434-0000-0000-0000-000000000001';
  sup_tile uuid := '34343434-0000-0000-0000-000000000002';
  asset_id uuid; job_id uuid; rec_id uuid;
  src_sql uuid; v record; loc_id uuid;
  statuses text[] := array['nominated','under_review','accepted','scheduled','completed','declined'];
  perms text[] := array['not_requested','requested','verbal_pending_written','approved','approved_with_restrictions','declined'];
begin
  ------------------------------------------------------------------ Phase 2
  for proj in
    select p.*, c.id as contact_id from identity.projects p
    left join identity.contacts c on c.id = p.primary_contact_id
    where p.workspace_id = ws order by p.created_at limit 6
  loop
    i := i + 1;
    insert into marketing.content_opportunities (
      workspace_id, project_id, contact_id, account_id, nominated_by, customer_owner_id, marketing_owner_id,
      status, story_angle, nomination_reason, content_types, readiness_state,
      target_window_start, target_window_end, priority, products_used, site_notes, special_requirements)
    values (ws, proj.id, proj.contact_id, proj.account_id, case when i % 2 = 0 then u_rep1 else u_rep2 end, proj.owner_id, u_marketing,
      statuses[1 + (i % 6)],
      (array['Before and after of the feature wall','Customer talks through the renovation','Installation process time-lapse','Completed café walkthrough','Material close-ups for social','Owner interview on choosing the panels'])[i],
      'Customer is happy with the result and open to being featured',
      case when i % 3 = 0 then array['before_after','testimonial'] when i % 3 = 1 then array['walkthrough','short_form'] else array['process','showcase'] end,
      (array['ready','substantially_complete','ready','in_progress','completed','delayed'])[i],
      current_date + (i * 4), current_date + (i * 4) + 6,
      (array['high','normal','normal','low','high','normal'])[i],
      case when i % 2 = 0 then array['wall_panel'] else array['tile','mosaic'] end,
      'Lift access; parking at the back. Ask for the site supervisor.',
      case when i = 1 then 'Customer prefers weekday mornings' else null end)
    returning id into co_id;

    insert into marketing.content_opportunity_status_events (content_opportunity_id, from_status, to_status, reason, actor_id)
    values (co_id, null, 'nominated', 'Seed nomination', u_rep1);

    insert into marketing.media_permission_records (
      workspace_id, content_opportunity_id, contact_id, account_id, status, granted_by_name, granted_at,
      permitted_capture, permitted_uses, restrictions, expires_at, recorded_by)
    values (ws, co_id, proj.contact_id, proj.account_id, perms[1 + (i % 6)],
      case when i % 6 in (3,4) then 'Property owner' end,
      case when i % 6 in (3,4) then now() - (i || ' days')::interval end,
      case when i % 6 in (3,4) then array['photo','video'] else '{}' end,
      case when i % 6 in (3,4) then array['website','social'] else '{}' end,
      case when i % 6 = 4 then 'No exterior shots showing the house number' end,
      case when i % 6 = 3 then current_date + 365 end,
      u_marketing)
    returning id into perm_id;

    -- a booking for the scheduled/completed ones
    if statuses[1 + (i % 6)] in ('scheduled','completed','accepted') then
      insert into marketing.shoot_bookings (workspace_id, content_opportunity_id, status, starts_at, ends_at, title, coordinator_id, notes, created_by)
      values (ws, co_id,
        case when statuses[1 + (i % 6)] = 'completed' then 'completed' when i % 2 = 0 then 'confirmed' else 'tentative' end,
        date_trunc('hour', now()) + ((i * 2 - 3) || ' days')::interval + interval '10 hours',
        date_trunc('hour', now()) + ((i * 2 - 3) || ' days')::interval + interval '13 hours',
        (array['Feature wall shoot','Customer interview','Process footage','Café walkthrough','Material close-ups','Owner interview'])[i],
        u_marketing, 'Bring the wide lens and the tripod.', u_marketing)
      returning id into b_id;

      insert into marketing.shoot_participants (shoot_booking_id, user_id, role, status) values
        (b_id, u_marketing, 'coordinator', 'accepted'),
        (b_id, case when i % 2 = 0 then u_rep1 else u_rep2 end, 'salesperson', 'assigned');
      if i % 3 = 0 then
        insert into marketing.shoot_participants (shoot_booking_id, external_name, role, status)
        values (b_id, 'Freelance videographer', 'standby', 'standby');
      end if;

      insert into marketing.shoot_locations (shoot_booking_id, project_site_id, sequence, travel_buffer_minutes, notes)
      select b_id, s.id, 1, 45, 'Main site' from identity.project_sites s where s.project_id = proj.id limit 1;

      insert into marketing.shoot_checklists (shoot_booking_id, item, is_done) values
        (b_id, 'Confirm customer availability the day before', i % 2 = 0),
        (b_id, 'Media permission signed and on file', i % 6 in (3,4)),
        (b_id, 'Equipment charged and packed', false),
        (b_id, 'Interview questions prepared', i % 3 = 0);

      insert into marketing.shoot_booking_status_events (shoot_booking_id, from_status, to_status, reason, actor_id)
      values (b_id, null, 'tentative', 'Seed hold', u_marketing);

      if statuses[1 + (i % 6)] = 'completed' then
        update marketing.shoot_bookings set outcome = 'completed', status = 'completed' where id = b_id;
        insert into marketing.shoot_outputs (workspace_id, shoot_booking_id, content_opportunity_id, kind, storage_path, state, caption, captured_at, uploaded_by)
        values
          (ws, b_id, co_id, 'photo', ws || '/' || co_id || '/after-01.jpg', case when perms[1 + (i % 6)] in ('approved','approved_with_restrictions') then 'usable' else 'reviewing' end, 'Completed feature wall', now() - interval '2 days', u_marketing),
          (ws, b_id, co_id, 'photo', ws || '/' || co_id || '/after-02.jpg', 'reviewing', 'Detail of the panel joint', now() - interval '2 days', u_marketing),
          (ws, b_id, co_id, 'interview_notes', ws || '/' || co_id || '/notes.pdf', 'uploaded', 'Interview notes', now() - interval '2 days', u_marketing);
      end if;
    end if;
  end loop;

  ------------------------------------------------------------------ Phase 4
  insert into ingest.source_assets (workspace_id, name, kind, supplier_id, storage_bucket, storage_path, checksum, mime_type, size_bytes, page_count, uploaded_by, status)
  values
    (ws, 'Demo mosaic price list 2026.pdf', 'pdf', sup_mosaic, 'source-assets', ws || '/demo-mosaic-2026.pdf', 'seedchecksum-mosaic-2026', 'application/pdf', 384000, 4, u_catalog, 'processed'),
    (ws, 'Demo tile catalogue extract.xlsx', 'excel', sup_tile, 'source-assets', ws || '/demo-tile-extract.xlsx', 'seedchecksum-tile-xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 91000, null, u_catalog, 'processed'),
    (ws, 'Supplier stock note (photo).jpg', 'image', sup_mosaic, 'source-assets', ws || '/stock-note.jpg', 'seedchecksum-stock-photo', 'image/jpeg', 220000, 1, u_catalog, 'uploaded');

  select id into asset_id from ingest.source_assets where workspace_id = ws and checksum = 'seedchecksum-mosaic-2026';
  insert into ingest.source_asset_versions (source_asset_id, version_no, checksum, storage_path)
  values (asset_id, 1, 'seedchecksum-mosaic-2026', ws || '/demo-mosaic-2026.pdf');

  insert into ingest.ingestion_jobs (workspace_id, source_asset_id, job_type, status, parser_version, started_at, finished_at, stats, created_by)
  values (ws, asset_id, 'parse_pdf', 'succeeded', 'pdf-text@1', now() - interval '2 hours', now() - interval '2 hours' + interval '40 seconds',
          '{"records": 4, "review_items": 4, "duplicates": 1, "pages": 4, "ocr_pages": 1}', u_catalog)
  returning id into job_id;

  for i in 1..4 loop
    insert into ingest.ingestion_records (job_id, row_no, page_no, raw, normalized, confidence, status, issues)
    values (job_id, i, 1 + (i / 3),
      jsonb_build_object('description', (array['HEXAGON MOSAIC WHITE 300X300','SUBWAY MOSAIC GREEN 25X75','PENNY ROUND BLACK 19MM','FISHSCALE MOSAIC BLUE 300X300'])[i],
                         'code', (array['MW-HEX-WHT','MW-SUB-GRN','MW-PEN-BLK','MW-FSH-BLU'])[i],
                         'price', (array['18.50','22.00','24.00','26.50'])[i], 'sheet', '300 x 300'),
      jsonb_build_object('name', (array['Hexagon Mosaic White','Subway Mosaic Green','Penny Round Mosaic Black','Fishscale Mosaic Blue'])[i],
                         'code', (array['MW-HEX-WHT','MW-SUB-GRN','MW-PEN-BLK','MW-FSH-BLU'])[i],
                         'amount', (array['18.50','22.00','24.00','26.50'])[i], 'currency', 'MYR',
                         'color', (array['White','Green','Black','Blue'])[i],
                         'dimensions', jsonb_build_object('sheet_width_mm', 300, 'sheet_height_mm', 300)),
      (array[0.97, 0.94, 0.91, 0.72])[i],
      case when i <= 3 then 'duplicate' else 'valid' end,
      case when i = 4 then '[{"code":"low_confidence","detail":"Chip size could not be read from the scan"}]'::jsonb else '[]'::jsonb end)
    returning id into rec_id;

    insert into ingest.extracted_fields (record_id, field_key, value, confidence, region, source_text) values
      (rec_id, 'code', (array['MW-HEX-WHT','MW-SUB-GRN','MW-PEN-BLK','MW-FSH-BLU'])[i], (array[0.99,0.98,0.95,0.88])[i],
       jsonb_build_object('page', 1, 'x', 62, 'y', 180 + i * 28, 'w', 120, 'h', 18), (array['MW-HEX-WHT','MW-SUB-GRN','MW-PEN-BLK','MW-FSH-BLU'])[i]),
      (rec_id, 'amount', (array['18.50','22.00','24.00','26.50'])[i], (array[0.96,0.93,0.90,0.64])[i],
       jsonb_build_object('page', 1, 'x', 420, 'y', 180 + i * 28, 'w', 70, 'h', 18), 'RM ' || (array['18.50','22.00','24.00','26.50'])[i]);

    insert into ingest.review_items (workspace_id, job_id, record_id, item_type, proposed, conflicts, status, confidence)
    values (ws, job_id, rec_id, 'price',
      jsonb_build_object('name', (array['Hexagon Mosaic White','Subway Mosaic Green','Penny Round Mosaic Black','Fishscale Mosaic Blue'])[i],
                         'code', (array['MW-HEX-WHT','MW-SUB-GRN','MW-PEN-BLK','MW-FSH-BLU'])[i],
                         'amount', (array['18.50','22.00','24.00','26.50'])[i], 'currency', 'MYR', 'source_ref', 'Demo mosaic price list 2026.pdf p.1'),
      case when i <= 3 then '[{"code":"duplicate_product","detail":"A product with this code already exists"}]'::jsonb else '[]'::jsonb end,
      'pending', (array[0.97,0.94,0.91,0.72])[i]);
  end loop;

  ------------------------------------------------------------------ Phase 5
  select id into src_sql from stock.inventory_sources where workspace_id = ws and key = 'sql_account';
  insert into stock.inventory_locations (workspace_id, source_id, external_code, name)
  values (ws, src_sql, 'WH-01', 'Main warehouse'), (ws, src_sql, 'SR-01', 'HQ showroom floor')
  on conflict do nothing;
  select id into loc_id from stock.inventory_locations where source_id = src_sql and external_code = 'WH-01';

  i := 0;
  for v in select pv.id, pv.sku, p.name from merch.product_variants pv join merch.products p on p.id = pv.product_id
           where pv.workspace_id = ws order by p.code limit 8
  loop
    i := i + 1;
    insert into stock.inventory_item_mappings (workspace_id, source_id, external_item_code, variant_id, status)
    values (ws, src_sql, 'SQL-' || v.sku, case when i <= 6 then v.id end, case when i <= 6 then 'mapped' else 'unmapped' end)
    on conflict do nothing;

    if i <= 6 then
      insert into stock.inventory_snapshots (workspace_id, source_id, location_id, variant_id, external_item_code, on_hand, allocated, available, source_timestamp, checkpoint)
      values (ws, src_sql, loc_id, v.id, 'SQL-' || v.sku,
              (array[120, 48, 0, 640, 15, 220])[i], (array[12, 0, 0, 40, 5, 0])[i],
              (array[108, 48, 0, 600, 10, 220])[i], now() - ((i * 37) || ' minutes')::interval, 'seed-checkpoint-1');
    end if;

    -- supplier availability with a spread of states and ages
    insert into stock.supplier_availability_snapshots (workspace_id, supplier_id, variant_id, availability, quantity, source_channel, submitted_by, captured_at, notes)
    values (ws, case when i % 2 = 0 then sup_mosaic else sup_tile end, v.id,
            (array['available','low','out','made_to_order','ask_supplier','available','low','unknown'])[i],
            case when i in (1,6) then (array[400,0,0,0,0,250,0,0])[i] end,
            (array['call','whatsapp','email','call','portal','whatsapp','call','visit'])[i],
            u_catalog, now() - ((i * 31) || ' hours')::interval,
            case when i = 4 then 'Made to order, 6-8 weeks lead time' when i = 5 then 'Rep will confirm on Monday' end);
  end loop;

  insert into stock.stock_freshness_policies (workspace_id, supplier_id, fresh_hours, aging_hours)
  values (ws, sup_mosaic, 72, 168), (ws, sup_tile, 120, 336) on conflict do nothing;

  insert into stock.stock_reconciliation_cases (workspace_id, variant_id, source_id, expected, observed, status, notes)
  select ws, pv.id, src_sql, 108, 96, 'open', 'Showroom count differs from the SQL Account figure'
  from merch.product_variants pv where pv.workspace_id = ws order by pv.created_at limit 1;

  ------------------------------------------------------------------ Phase 3
  insert into ingest.routing_rules (workspace_id, position, match_source_channel, assign_to) values
    (ws, 10, 'tiktok', u_rep1), (ws, 20, 'meta', u_rep2), (ws, 30, 'website', u_rep1);
  insert into ingest.field_mappings (workspace_id, provider, form_ref, source_field, target_field, created_by) values
    (ws, 'meta', 'Form A', 'full_name', 'name', u_admin),
    (ws, 'meta', 'Form A', 'phone_number', 'phone', u_admin),
    (ws, 'meta', 'Form A', 'email', 'email', u_admin),
    (ws, 'meta', 'Form A', 'what_are_you_looking_for', 'interest', u_admin),
    (ws, 'tiktok', null, 'name', 'name', u_admin),
    (ws, 'tiktok', null, 'phone', 'phone', u_admin),
    (ws, 'website', null, 'message', 'notes', u_admin);
end $$;
