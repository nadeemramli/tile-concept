-- TILE-23: imported catalogue media review, rights, storage access and coverage.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- Synthetic fixtures only. W = seeded workspace, X = another workspace.
insert into core.workspaces(id, name, slug) values ('ca7a2000-0000-4000-8000-00000000000a', 'Synthetic review isolation', 'synthetic-review-isolation');
insert into auth.users(id, email, aud, role) values ('ca7a2000-0000-4000-8000-0000000000ee', 'synthetic-x-catalog@example.test', 'authenticated', 'authenticated');
insert into core.memberships(workspace_id, user_id, role_key) values ('ca7a2000-0000-4000-8000-00000000000a', 'ca7a2000-0000-4000-8000-0000000000ee', 'catalog_pricing');

insert into merch.products(id, workspace_id, name, status) values
  ('ca7a2000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Synthetic review product', 'active'),
  ('ca7a2000-0000-4000-8000-000000000002', 'ca7a2000-0000-4000-8000-00000000000a', 'Synthetic other-workspace product', 'active');
insert into merch.product_variants(id, workspace_id, product_id, sku) values
  ('ca7a2000-0000-4000-8000-000000000011', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000001', 'SYN-REV-A'),
  ('ca7a2000-0000-4000-8000-000000000012', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000001', 'SYN-REV-B'),
  ('ca7a2000-0000-4000-8000-000000000013', 'ca7a2000-0000-4000-8000-00000000000a', 'ca7a2000-0000-4000-8000-000000000002', 'SYN-OTHER');
insert into ingest.source_assets(id, workspace_id, name, kind) values
  ('ca7a2000-0000-4000-8000-000000000021', '11111111-1111-1111-1111-111111111111', 'Synthetic brochure.pdf', 'pdf');
insert into ingest.media_assets(id, workspace_id, source_asset_id, external_key, asset_kind, storage_bucket, object_path, content_checksum, mime_type, page_number, source_path) values
  ('ca7a2000-0000-4000-8000-000000000031', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000021', 'syn:page:1', 'pdf_page_render', 'product-media', '11111111-1111-1111-1111-111111111111/sources/syn/pages/page-0001.jpg', repeat('a', 64), 'image/jpeg', 1, 'Synthetic/brochure.pdf'),
  ('ca7a2000-0000-4000-8000-000000000032', '11111111-1111-1111-1111-111111111111', null, 'syn:image:2', 'standalone_image', 'product-media', '11111111-1111-1111-1111-111111111111/sources/syn/images/b.jpg', repeat('b', 64), 'image/jpeg', null, 'Synthetic/b.jpg');
insert into ingest.media_asset_variant_links(id, workspace_id, media_asset_id, external_key, product_variant_id, link_basis, page_number) values
  ('ca7a2000-0000-4000-8000-000000000041', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000031', 'syn:link:doc', null, 'same_source_document', 1),
  ('ca7a2000-0000-4000-8000-000000000042', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000032', 'syn:link:code', 'ca7a2000-0000-4000-8000-000000000011', 'exact_supplier_code', null),
  ('ca7a2000-0000-4000-8000-000000000043', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000032', 'syn:link:reject', 'ca7a2000-0000-4000-8000-000000000012', 'same_catalog_page', null);
-- Direct attachments: approved, archived, and an unreviewed import.
insert into merch.product_media(id, workspace_id, product_id, storage_path, kind, review_state, usage_rights_state, archived_at) values
  ('ca7a2000-0000-4000-8000-000000000051', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111/products/syn/approved.jpg', 'image', 'reviewed', 'accepted', null),
  ('ca7a2000-0000-4000-8000-000000000052', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111/products/syn/archived.jpg', 'image', 'reviewed', 'accepted', now()),
  ('ca7a2000-0000-4000-8000-000000000053', '11111111-1111-1111-1111-111111111111', 'ca7a2000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111/products/syn/unreviewed.jpg', 'image', 'unreviewed', 'unreviewed', null);
insert into storage.objects(bucket_id, name) values
  ('product-media', '11111111-1111-1111-1111-111111111111/products/syn/approved.jpg'),
  ('product-media', '11111111-1111-1111-1111-111111111111/products/syn/archived.jpg'),
  ('product-media', '11111111-1111-1111-1111-111111111111/products/syn/unreviewed.jpg'),
  ('product-media', '11111111-1111-1111-1111-111111111111/products/syn/orphan.jpg'),
  ('product-media', '11111111-1111-1111-1111-111111111111/sources/syn/pages/page-0001.jpg'),
  ('product-media', '11111111-1111-1111-1111-111111111111/sources/syn/images/b.jpg');

create function pg_temp.visible(p text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'product-media' and name = '11111111-1111-1111-1111-111111111111/' || p)
$$;

------------------------------------------------------------------------------
-- Storage SELECT (what signing and download are checked against)
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(pg_temp.visible('products/syn/approved.jpg'), 'sales can read an approved, rights-cleared object');
select ok(not pg_temp.visible('products/syn/archived.jpg'), 'sales cannot read an archived object by path');
select ok(not pg_temp.visible('products/syn/unreviewed.jpg'), 'sales cannot read an unreviewed object by path');
select ok(not pg_temp.visible('products/syn/orphan.jpg'), 'sales cannot read an unattached object by path');
select ok(not pg_temp.visible('sources/syn/pages/page-0001.jpg'), 'sales cannot read an imported page render by path');
select is((select count(*) from api.media_review_queue), 0::bigint, 'sales sees no imported review queue');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(pg_temp.visible('products/syn/unreviewed.jpg') and pg_temp.visible('products/syn/archived.jpg') and pg_temp.visible('sources/syn/pages/page-0001.jpg'),
  'catalogue operator keeps review access to every object');
select is((select count(*) from api.media_review_queue where link_id::text like 'ca7a2000%'), 3::bigint, 'operator sees the review queue');

select set_config('request.jwt.claims', '{"sub":"ca7a2000-0000-4000-8000-0000000000ee","role":"authenticated"}', true);
select ok(not pg_temp.visible('products/syn/approved.jpg') and not pg_temp.visible('products/syn/unreviewed.jpg'), 'another workspace''s operator reads nothing here');
select is((select count(*) from api.media_review_queue where link_id::text like 'ca7a2000%'), 0::bigint, 'another workspace sees no queue rows');
select throws_ok($$select api.confirm_media_association('ca7a2000-0000-4000-8000-000000000042','ca7a2000-0000-4000-8000-000000000011')$$, '42501', 'workspace access denied', 'cross-workspace confirmation refused');
select throws_ok($$select api.review_media_rights('ca7a2000-0000-4000-8000-000000000032','accepted','x')$$, '42501', 'workspace access denied', 'cross-workspace rights decision refused');

------------------------------------------------------------------------------
-- Permission denial and direct-write lockdown
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select api.confirm_media_association('ca7a2000-0000-4000-8000-000000000042','ca7a2000-0000-4000-8000-000000000011')$$, '42501', 'permission denied: catalog.write', 'sales cannot confirm an association');
select throws_ok($$select api.review_media_rights('ca7a2000-0000-4000-8000-000000000032','accepted','basis')$$, '42501', 'permission denied: catalog.write', 'sales cannot record rights');
select throws_ok($$select api.catalog_media_coverage()$$, '42501', 'permission denied: catalog.write', 'sales cannot read the coverage audit');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$update api.media_assets set usage_rights_state = 'accepted' where id = 'ca7a2000-0000-4000-8000-000000000032'$$, '42501', null, 'rights cannot be set by a direct update');
select throws_ok($$update api.media_asset_variant_links set review_state = 'approved' where id = 'ca7a2000-0000-4000-8000-000000000042'$$, '42501', null, 'an association cannot be approved by a direct update');
select throws_ok($$insert into api.product_media(workspace_id, product_id, storage_bucket, storage_path, kind, review_state, usage_rights_state)
  values ('11111111-1111-1111-1111-111111111111','ca7a2000-0000-4000-8000-000000000001','product-media','11111111-1111-1111-1111-111111111111/sources/syn/images/b.jpg','image','reviewed','accepted')$$,
  '23514', null, 'an unlicensed import cannot be attached as reviewed media by path');
select throws_ok($$update api.product_media set is_primary = true where id = 'ca7a2000-0000-4000-8000-000000000053'$$, '23514', null, 'an unreviewed attachment cannot become primary');

------------------------------------------------------------------------------
-- Association review
------------------------------------------------------------------------------
select throws_ok($$select api.confirm_media_association('ca7a2000-0000-4000-8000-000000000042','ca7a2000-0000-4000-8000-000000000013')$$, 'P0002', 'product variant not found in this workspace', 'variant from another workspace refused');
select lives_ok($$select api.confirm_media_association('ca7a2000-0000-4000-8000-000000000042','ca7a2000-0000-4000-8000-000000000012','Code matches B, not A')$$, 'operator corrects the proposed variant');
select is((select product_variant_id from api.media_asset_variant_links where id = 'ca7a2000-0000-4000-8000-000000000042'), 'ca7a2000-0000-4000-8000-000000000012'::uuid, 'corrected variant persisted');
select is((select decision from api.review_decisions where review_target_id = 'ca7a2000-0000-4000-8000-000000000042' order by reviewed_at desc limit 1), 'corrected', 'correction recorded as a decision');

select lives_ok($$select api.confirm_media_association('ca7a2000-0000-4000-8000-000000000041','ca7a2000-0000-4000-8000-000000000011','Page 1 shows A')$$, 'same-document context confirmed as a human match');
select is((select review_state from api.media_asset_variant_links where id = 'ca7a2000-0000-4000-8000-000000000041'), 'superseded', 'the same-document link is superseded, not approved');
select is((select count(*) from api.media_asset_variant_links where media_asset_id = 'ca7a2000-0000-4000-8000-000000000031' and link_basis = 'manual_match' and review_state = 'approved'), 1::bigint, 'a human manual_match link replaces it');

select throws_ok($$select api.reject_media_association('ca7a2000-0000-4000-8000-000000000043', ' ')$$, '23514', 'a reason is required to reject an association', 'rejection needs a reason');
select lives_ok($$select api.reject_media_association('ca7a2000-0000-4000-8000-000000000043', 'Different series')$$, 'operator rejects an association');
select throws_ok($$select api.confirm_media_association('ca7a2000-0000-4000-8000-000000000043','ca7a2000-0000-4000-8000-000000000011')$$, '23514', null, 'a rejected association cannot be confirmed');

------------------------------------------------------------------------------
-- Rights, evidence review and publication
------------------------------------------------------------------------------
select throws_ok($$select api.publish_product_media('ca7a2000-0000-4000-8000-000000000042')$$, '23514', null, 'unreviewed rights block publication');
select throws_ok($$select api.review_media_rights('ca7a2000-0000-4000-8000-000000000032','accepted','')$$, '23514', 'state the basis for this usage-rights decision', 'rights need a stated basis');
select throws_ok($$select api.review_media_rights('ca7a2000-0000-4000-8000-000000000032','unreviewed','x')$$, '22023', null, 'rights cannot be reset to unreviewed');
select lives_ok($$select api.review_media_rights('ca7a2000-0000-4000-8000-000000000032','accepted','Supplier licence 2026 (synthetic)')$$, 'operator records accepted rights');
select throws_ok($$select api.publish_product_media('ca7a2000-0000-4000-8000-000000000042')$$, '23514', 'the media asset itself has not been reviewed', 'unreviewed evidence still blocks publication');
select lives_ok($$select api.review_media_asset('ca7a2000-0000-4000-8000-000000000032','approved')$$, 'operator approves the evidence');
select lives_ok($$select api.publish_product_media('ca7a2000-0000-4000-8000-000000000042','Synthetic B face',0,true)$$, 'operator publishes as primary');
select throws_ok($$select api.publish_product_media('ca7a2000-0000-4000-8000-000000000042')$$, '23505', null, 'the same association cannot be published twice');
select is((select count(*) from api.product_media where product_id = 'ca7a2000-0000-4000-8000-000000000001' and is_primary), 1::bigint, 'exactly one primary image');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(pg_temp.visible('sources/syn/images/b.jpg'), 'sales can read the image once it is published');
select is((select variant_id from api.product_media where media_asset_id = 'ca7a2000-0000-4000-8000-000000000032'), 'ca7a2000-0000-4000-8000-000000000012'::uuid, 'sales sees it on the corrected variant');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select api.review_media_rights('ca7a2000-0000-4000-8000-000000000032','denied','Supplier withdrew permission (synthetic)')), 1, 'denying rights withdraws the published image');
select ok((select archived_at is not null and not is_primary and usage_rights_state = 'denied' from api.product_media where media_asset_id = 'ca7a2000-0000-4000-8000-000000000032'), 'withdrawn row is archived, retained and marked denied');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not pg_temp.visible('sources/syn/images/b.jpg'), 'sales loses object access when rights are withdrawn');

------------------------------------------------------------------------------
-- Coverage, decisions and audit
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok((select (c->'media_assets'->'by_rights_state'->>'unreviewed')::int >= 1 and c ? 'generated_at' and c ? 'source'
  and (c->'catalogue_media'->>'archived')::int >= 2 from api.catalog_media_coverage() c), 'coverage reports live counts with time, source and unknown rights');
select is((select count(*) from api.review_decisions where workspace_id = '11111111-1111-1111-1111-111111111111'
  and review_target_type in ('media_asset','media_asset_usage_rights','media_asset_variant_link')
  and reviewed_by is distinct from 'aaaaaaaa-0000-0000-0000-000000000006'), 0::bigint, 'every media decision is attributed to the reviewer');
reset role;
select ok((select count(*) >= 6 from ingest.review_decisions where review_target_id::text like 'ca7a2000%'), 'decisions persisted append-only');
select ok((select count(*) >= 5 from audit.audit_events where action in ('media_link.corrected','media_link.rejected','media_asset.rights_reviewed','media_asset.reviewed','product_media.published')
  and (object_id::text like 'ca7a2000%' or object_id in (select id from merch.product_media where media_asset_id = 'ca7a2000-0000-4000-8000-000000000032'))), 'review actions are audited');
select * from finish();
rollback;
