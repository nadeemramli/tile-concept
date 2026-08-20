-- pgTAP: the rules the corpus migration exists to enforce.
--
-- Every assertion here is a rule from the Canonical Merchandise Schema or the
-- ingestion architecture that would otherwise only be a sentence in a document:
-- unreviewed candidates stay unpublished, a folder does not establish a
-- certificate scope, pixels do not become dimensions, a same-document image
-- association is not a product image, and re-importing an unchanged corpus
-- changes nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

create or replace function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;

------------------------------------------------------------------------------
-- Fixtures, created as the migration owner before any role switch.
------------------------------------------------------------------------------
create or replace function pg_temp.ws() returns uuid language sql as $$
  select '11111111-1111-1111-1111-111111111111'::uuid
$$;

insert into ingest.source_collections (id, workspace_id, code, name, supply_model, external_folder_id)
values ('cccccccc-0000-0000-0000-000000000001', pg_temp.ws(), 'base_tiles_local', 'Base Tiles (LOCAL)', 'local', 'drive-root-local');

insert into ingest.source_locations (id, workspace_id, source_collection_id, external_id, name, display_path, brand_hint)
values ('cccccccc-0000-0000-0000-000000000002', pg_temp.ws(), 'cccccccc-0000-0000-0000-000000000001',
        'drive-folder-1', 'Catalogue', 'Base Tiles (LOCAL)/Testbrand/Catalogue', 'Testbrand');

insert into ingest.source_assets (id, workspace_id, name, kind, provider, external_id, asset_class,
                                  source_location_id, checksum, storage_bucket, storage_path)
values ('cccccccc-0000-0000-0000-000000000003', pg_temp.ws(), 'Testbrand catalogue.pdf', 'pdf',
        'google_drive', 'drive-file-1', 'catalog', 'cccccccc-0000-0000-0000-000000000002',
        'corpus-test-checksum-1', 'source-assets', pg_temp.ws() || '/drive/base_tiles_local/drive-file-1/abc/cat.pdf');

insert into ingest.source_asset_versions (id, workspace_id, source_asset_id, version_no, checksum, snapshot_state)
values ('cccccccc-0000-0000-0000-000000000004', pg_temp.ws(), 'cccccccc-0000-0000-0000-000000000003',
        1, 'corpus-test-checksum-1', 'uploaded');

insert into ingest.media_assets (id, workspace_id, source_asset_id, source_version_id, external_key,
                                 asset_kind, content_checksum, mime_type, page_number, storage_bucket, object_path)
values ('cccccccc-0000-0000-0000-000000000005', pg_temp.ws(), 'cccccccc-0000-0000-0000-000000000003',
        'cccccccc-0000-0000-0000-000000000004', 'media_test_page_1', 'pdf_page_render',
        'corpus-test-render-1', 'image/jpeg', 1, 'product-media',
        pg_temp.ws() || '/sources/drive-file-1/pages/page-0001.jpg');

insert into ingest.variant_candidates (id, workspace_id, candidate_key, source_asset_id, external_source_id,
                                       brand_hint, supplier_code_raw)
values ('cccccccc-0000-0000-0000-000000000006', pg_temp.ws(), 'variant_corpus_test_1',
        'cccccccc-0000-0000-0000-000000000003', 'drive-file-1', 'Testbrand', 'TB-0001');

insert into ingest.media_asset_variant_links (id, workspace_id, media_asset_id, external_key,
                                              variant_candidate_key, variant_candidate_id, link_basis, confidence)
values ('cccccccc-0000-0000-0000-000000000007', pg_temp.ws(), 'cccccccc-0000-0000-0000-000000000005',
        'avl_corpus_test_samedoc', 'variant_corpus_test_1', 'cccccccc-0000-0000-0000-000000000006',
        'same_source_document', 0.3);

insert into ingest.certificate_candidates (id, workspace_id, candidate_key, source_asset_id,
                                           external_source_id, title_candidate)
values ('cccccccc-0000-0000-0000-000000000008', pg_temp.ws(), 'certificate_corpus_test_1',
        'cccccccc-0000-0000-0000-000000000003', 'drive-file-1', 'MS ISO 13006 test certificate');

-- A price review item whose source establishes only an amount — the shape the
-- corpus actually produces for 5,936 structured rows.
insert into ingest.ingestion_jobs (id, workspace_id, source_asset_id, job_type, status)
values ('cccccccc-0000-0000-0000-000000000009', pg_temp.ws(), 'cccccccc-0000-0000-0000-000000000003', 'parse_pdf', 'succeeded');

insert into ingest.review_items (id, workspace_id, job_id, item_type, proposed, status, external_key, task_type, priority)
values ('cccccccc-0000-0000-0000-00000000000a', pg_temp.ws(), 'cccccccc-0000-0000-0000-000000000009', 'price',
        '{"code":"TB-0001","name":"Testbrand 600x600","amount":"12.50"}'::jsonb, 'pending',
        'review_corpus_test_1', 'low_confidence_price_source_review', 3);

set local role authenticated;

------------------------------------------------------------------------------
-- 1-2. The api schema is still the only reachable surface.
------------------------------------------------------------------------------
reset role;
set local role anon;
select throws_like($$select count(*) from api.media_assets$$, '%permission denied%',
  'anon cannot read corpus media assets');
select throws_like($$select count(*) from api.price_candidates$$, '%permission denied%',
  'anon cannot read price candidates');
reset role;
set local role authenticated;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');  -- catalog operator

------------------------------------------------------------------------------
-- 3-5. Workspace isolation and permission scoping.
------------------------------------------------------------------------------
select ok((select count(*) from api.media_assets) >= 1, 'a member reads corpus media in their workspace');
select is((select count(*)::int from api.media_assets where workspace_id <> pg_temp.ws()), 0,
  'no rows leak from another workspace');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');  -- sales rep, no source.import
select is((select count(*)::int from api.price_candidates), 0,
  'a sales rep without source.import sees no candidates');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');

------------------------------------------------------------------------------
-- 6-8. Idempotency: an unchanged re-import must add nothing.
------------------------------------------------------------------------------
reset role;
select throws_like(
  $$insert into ingest.source_asset_versions (workspace_id, source_asset_id, version_no, checksum)
    values ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000003', 2, 'corpus-test-checksum-1')$$,
  '%source_asset_versions_checksum_idx%',
  're-registering the same content checksum is rejected by the database, not just by the function');

-- Identity is (document, role, page). Byte-identical boilerplate pages across a
-- brochure series are legitimate and must both survive.
select throws_like(
  $$insert into ingest.media_assets (workspace_id, source_asset_id, external_key, asset_kind, content_checksum, page_number)
    values ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000003',
            'media_test_page_1_again', 'pdf_page_render', 'a-different-checksum', 1)$$,
  '%media_assets_identity_idx%',
  'the same page of the same document cannot be recorded twice');

select throws_like(
  $$insert into ingest.variant_candidates (workspace_id, candidate_key, external_source_id, supplier_code_raw)
    values ('11111111-1111-1111-1111-111111111111', 'variant_corpus_test_1', 'drive-file-1', 'TB-0001')$$,
  '%variant_candidates_workspace_id_candidate_key_key%',
  're-importing the same candidate key is a no-op, not a duplicate row');

------------------------------------------------------------------------------
-- 9-11. Pixels never become product facts.
------------------------------------------------------------------------------
select throws_like(
  $$insert into ingest.visual_observations (workspace_id, media_asset_id, external_key, observation_scope,
      observation_type, observation_basis, physical_size_inferred_from_pixels)
    values ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000005',
            'vo_bad_dimension', 'whole_page', 'dimension', 'pixel_measurement', true)$$,
  '%visual_observations_no_pixel_dimensions%',
  'a dimension inferred from pixel scale cannot be stored at all');

select throws_like(
  $$insert into ingest.visual_observations (workspace_id, media_asset_id, external_key, observation_scope,
      observation_type, observation_basis, review_state)
    values ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000005',
            'vo_bad_approval', 'whole_page', 'color_family', 'pixel_measurement', 'approved')$$,
  '%visual_observations_approval_needs_human%',
  'a pixel measurement cannot carry the approved state');

insert into ingest.visual_observations (workspace_id, media_asset_id, external_key, observation_scope,
    observation_type, observation_basis, observation_basis_raw, value)
values ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000005',
        'vo_palette_1', 'whole_page', 'palette', 'pixel_measurement',
        'pixel_measurement_not_semantic_classification', '{"palette":[]}'::jsonb);
select throws_like(
  $$update ingest.visual_observations set confidence = 1 where external_key = 'vo_palette_1'$$,
  '%append-only%',
  'a visual observation cannot be edited after the fact');

------------------------------------------------------------------------------
-- 12-14. A same-document association is not a product image.
------------------------------------------------------------------------------
select throws_like(
  $$update ingest.media_asset_variant_links set review_state = 'approved',
      product_variant_id = (select id from merch.product_variants limit 1)
    where external_key = 'avl_corpus_test_samedoc'$$,
  '%media_links_same_document_never_approved%',
  'a same-document link cannot be approved even by direct update');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like(
  $$select api.approve_media_link('cccccccc-0000-0000-0000-000000000007', (select id from merch.product_variants limit 1))$$,
  '%same-document link cannot be approved%',
  'approve_media_link explains why a same-document link is refused');

select throws_like(
  $$select api.publish_product_media('cccccccc-0000-0000-0000-000000000007')$$,
  '%not a reviewed match%',
  'an unreviewed link cannot become published product media');

------------------------------------------------------------------------------
-- 15-17. Image rights are a separate gate from image correctness.
------------------------------------------------------------------------------
reset role;
insert into ingest.media_asset_variant_links (id, workspace_id, media_asset_id, external_key,
    variant_candidate_key, link_basis, product_variant_id, review_state, confidence)
values ('cccccccc-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
        'cccccccc-0000-0000-0000-000000000005', 'avl_corpus_test_exact', 'variant_corpus_test_1',
        'exact_ocr_code', (select id from merch.product_variants limit 1), 'approved', 0.9);

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like(
  $$select api.publish_product_media('cccccccc-0000-0000-0000-00000000000b')$$,
  '%usage rights are unreviewed%',
  'a correctly matched image still needs cleared usage rights');

reset role;
update ingest.media_assets set usage_rights_state = 'accepted', review_state = 'approved'
where id = 'cccccccc-0000-0000-0000-000000000005';

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select lives_ok(
  $$select api.publish_product_media('cccccccc-0000-0000-0000-00000000000b', 'Testbrand 600x600 tile')$$,
  'a reviewed, rights-cleared, exactly matched image publishes');

reset role;
select throws_like(
  $$update merch.product_media set usage_rights_state = 'denied' where alt_text = 'Testbrand 600x600 tile'$$,
  '%product_media_publication_gate%',
  'published media cannot have its rights revoked while still marked reviewed');

------------------------------------------------------------------------------
-- 18-20. A folder does not establish a certificate scope.
------------------------------------------------------------------------------
select is(
  (select scope_type from ingest.certificate_candidates where candidate_key = 'certificate_corpus_test_1'),
  'unknown', 'a certificate candidate starts with unknown scope');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_like(
  $$select api.approve_certificate_candidate('cccccccc-0000-0000-0000-000000000008',
      '{"certificate_type":"product_conformity","issuer_unresolved":true}'::jsonb)$$,
  '%scope_type (a folder location does not establish scope)%',
  'approving a certificate without a resolved scope is refused');

select lives_ok(
  $$select api.approve_certificate_candidate('cccccccc-0000-0000-0000-000000000008',
      ('{"certificate_type":"product_conformity","issuer_unresolved":true,"scope_type":"brand","brand_id":"'
       || (select id from merch.brands limit 1) || '","not_dated":true}')::jsonb)$$,
  'a certificate with an explicitly resolved brand scope publishes');

------------------------------------------------------------------------------
-- 21-25. The strict price gate. This is the behaviour change: the previous
-- implementation would have published this row with currency MYR, today's date,
-- min_quantity 1, and a guessed price list.
------------------------------------------------------------------------------
select throws_like(
  $$select api.approve_review_item('cccccccc-0000-0000-0000-00000000000a')$$,
  '%currency%', 'an approval without a currency is refused');
select throws_like(
  $$select api.approve_review_item('cccccccc-0000-0000-0000-00000000000a')$$,
  '%tax_basis%', 'the same refusal names the missing tax basis');
select throws_like(
  $$select api.approve_review_item('cccccccc-0000-0000-0000-00000000000a')$$,
  '%price_list_id%', 'the price list is never auto-selected');
select throws_like(
  $$select api.approve_review_item('cccccccc-0000-0000-0000-00000000000a')$$,
  '%none of these is defaulted%', 'the message says explicitly that nothing is defaulted');

-- 'unknown' is an honest extraction result, not an approvable tax basis.
select throws_like(
  $$select api.approve_review_item('cccccccc-0000-0000-0000-00000000000a',
      ('{"currency":"MYR","tax_basis":"unknown","price_type":"retail","market":"MY","valid_from":"2026-01-01",
         "min_quantity":"1","unit_id":"' || (select id from merch.units_of_measure limit 1) || '",
         "price_list_id":"' || (select id from merch.price_lists limit 1) || '","brand_id":"'
       || (select id from merch.brands limit 1) || '"}')::jsonb)$$,
  '%tax_basis%', 'a tax basis of unknown is still unresolved');

------------------------------------------------------------------------------
-- 26-27. With every semantic explicit, approval works and stops at draft.
------------------------------------------------------------------------------
select lives_ok(
  $$select api.approve_review_item('cccccccc-0000-0000-0000-00000000000a',
      ('{"currency":"MYR","tax_basis":"exclusive","price_type":"retail","market":"MY","valid_from":"2026-01-01",
         "min_quantity":"1","unit_id":"' || (select id from merch.units_of_measure limit 1) || '",
         "price_list_id":"' || (select id from merch.price_lists limit 1) || '","brand_id":"'
       || (select id from merch.brands limit 1) || '"}')::jsonb)$$,
  'approval succeeds once every commercial semantic is explicit');

select is(
  (select state from merch.variant_prices where source_page_or_row is null and price_type = 'retail'
   order by created_at desc limit 1),
  'draft', 'an approved price is still only a draft — publishing is a separate act');

------------------------------------------------------------------------------
-- 28-30. Storage: private buckets, workspace-first object paths.
------------------------------------------------------------------------------
reset role;
select is(
  (select count(*)::int from storage.buckets where public = true), 0,
  'every storage bucket is private');
select ok(
  (select file_size_limit from storage.buckets where id = 'source-assets') >= 382335899,
  'source-assets can hold the largest deferred catalogue if it is ever staged');
select is(
  core.storage_workspace_of('11111111-1111-1111-1111-111111111111/drive/base_tiles_local/f/abc/cat.pdf'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'object paths are resolved workspace-first');

select * from finish();
rollback;
