-- TILE-23 release review: legacy link approval, path-only withdrawal, link
-- guard and workspace-scoped storage review access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Synthetic fixtures. W = seeded workspace, X = another workspace.
insert into core.workspaces(id, name, slug) values ('ca7a2700-0000-4000-8000-00000000000a', 'Synthetic hardening other', 'synthetic-hardening-other');
insert into auth.users(id, email, aud, role) values
  ('ca7a2700-0000-4000-8000-0000000000e1', 'synthetic-sales-rep@example.test', 'authenticated', 'authenticated'),
  ('ca7a2700-0000-4000-8000-0000000000e2', 'synthetic-dual@example.test', 'authenticated', 'authenticated');
insert into core.memberships(workspace_id, user_id, role_key, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-0000000000e1', 'sales_rep', now()),
  -- Admin elsewhere, showroom here: no catalog.write in W.
  ('ca7a2700-0000-4000-8000-00000000000a', 'ca7a2700-0000-4000-8000-0000000000e2', 'admin', now()),
  ('11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-0000000000e2', 'showroom', now() + interval '1 minute');

insert into merch.products(id, workspace_id, name, status) values
  ('ca7a2700-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Synthetic hardening product', 'active');
insert into merch.product_variants(id, workspace_id, product_id, sku) values
  ('ca7a2700-0000-4000-8000-000000000011', '11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-000000000001', 'SYN-HARD-A');
insert into ingest.source_assets(id, workspace_id, name, kind) values
  ('ca7a2700-0000-4000-8000-000000000021', '11111111-1111-1111-1111-111111111111', 'Synthetic hardening.pdf', 'pdf');
insert into ingest.media_assets(id, workspace_id, source_asset_id, external_key, asset_kind, storage_bucket, object_path, content_checksum, mime_type, page_number, review_state, usage_rights_state) values
  ('ca7a2700-0000-4000-8000-000000000031', '11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-000000000021', 'syn:hard:ok', 'product_crop', 'product-media', '11111111-1111-1111-1111-111111111111/sources/hard/ok.jpg', repeat('c', 64), 'image/jpeg', 1, 'approved', 'accepted'),
  ('ca7a2700-0000-4000-8000-000000000032', '11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-000000000021', 'syn:hard:rej', 'product_crop', 'product-media', '11111111-1111-1111-1111-111111111111/sources/hard/rej.jpg', repeat('d', 64), 'image/jpeg', 2, 'approved', 'accepted');
insert into ingest.media_asset_variant_links(id, workspace_id, media_asset_id, external_key, product_variant_id, link_basis, review_state) values
  ('ca7a2700-0000-4000-8000-000000000041', '11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-000000000031', 'syn:hard:l-ok', 'ca7a2700-0000-4000-8000-000000000011', 'exact_ocr_code', 'approved'),
  ('ca7a2700-0000-4000-8000-000000000042', '11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-000000000032', 'syn:hard:l-rej', 'ca7a2700-0000-4000-8000-000000000011', 'exact_ocr_code', 'rejected');
insert into storage.objects(bucket_id, name) values
  ('product-media', '11111111-1111-1111-1111-111111111111/sources/hard/ok.jpg'),
  ('product-media', '11111111-1111-1111-1111-111111111111/products/hard/unreviewed.jpg');
insert into merch.product_media(workspace_id, product_id, storage_path, kind, review_state, usage_rights_state) values
  ('11111111-1111-1111-1111-111111111111', 'ca7a2700-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111/products/hard/unreviewed.jpg', 'image', 'unreviewed', 'unreviewed');

create function pg_temp.visible(p text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'product-media' and name = '11111111-1111-1111-1111-111111111111/' || p)
$$;

------------------------------------------------------------------------------
-- 1. Legacy link approval
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ca7a2700-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
select throws_ok($$select api.approve_media_link('ca7a2700-0000-4000-8000-000000000042','ca7a2700-0000-4000-8000-000000000011')$$,
  '42501', null, 'a sales rep cannot approve an imported association through the legacy function');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$select api.approve_media_link('ca7a2700-0000-4000-8000-000000000042','ca7a2700-0000-4000-8000-000000000011')$$,
  '23514', null, 'the legacy function cannot re-approve a rejected association');
reset role;
select is((select review_state from ingest.media_asset_variant_links where id = 'ca7a2700-0000-4000-8000-000000000042'), 'rejected', 'the rejected association stays rejected');

------------------------------------------------------------------------------
-- 3. Guard: a direct insert cannot publish through a rejected association
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$insert into api.product_media(workspace_id, product_id, variant_id, storage_path, kind, review_state, usage_rights_state, media_asset_variant_link_id)
  values ('11111111-1111-1111-1111-111111111111','ca7a2700-0000-4000-8000-000000000001','ca7a2700-0000-4000-8000-000000000011',
          '11111111-1111-1111-1111-111111111111/sources/hard/rej.jpg','image','reviewed','accepted','ca7a2700-0000-4000-8000-000000000042')$$,
  '23514', null, 'publishing through a rejected association is refused');
select throws_ok($$insert into api.product_media(workspace_id, product_id, variant_id, storage_path, kind, review_state, usage_rights_state, media_asset_id, media_asset_variant_link_id)
  values ('11111111-1111-1111-1111-111111111111','ca7a2700-0000-4000-8000-000000000001','ca7a2700-0000-4000-8000-000000000011',
          '11111111-1111-1111-1111-111111111111/sources/hard/rej.jpg','image','reviewed','accepted','ca7a2700-0000-4000-8000-000000000032','ca7a2700-0000-4000-8000-000000000041')$$,
  '23514', null, 'an approved association for a different image cannot be borrowed');

------------------------------------------------------------------------------
-- 2. Withdrawal follows the object path
------------------------------------------------------------------------------
-- A writer attaches the approved import by path only, without the reference.
select lives_ok($$insert into api.product_media(workspace_id, product_id, variant_id, storage_path, kind, review_state, usage_rights_state)
  values ('11111111-1111-1111-1111-111111111111','ca7a2700-0000-4000-8000-000000000001','ca7a2700-0000-4000-8000-000000000011',
          '11111111-1111-1111-1111-111111111111/sources/hard/ok.jpg','image','reviewed','accepted')$$,
  'a path-only copy of an approved, rights-cleared import can be attached');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(pg_temp.visible('sources/hard/ok.jpg'), 'sales can read it while rights are accepted');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$select api.review_media_rights('ca7a2700-0000-4000-8000-000000000031','denied','Synthetic licence withdrawn')$$, 'rights are denied');
reset role;
select is((select count(*) from merch.product_media where storage_path = '11111111-1111-1111-1111-111111111111/sources/hard/ok.jpg' and archived_at is null),
  0::bigint, 'the path-only copy is withdrawn with the asset');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(not pg_temp.visible('sources/hard/ok.jpg'), 'sales can no longer read it by path');

------------------------------------------------------------------------------
-- Storage review access is per workspace
------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"ca7a2700-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
select ok(not pg_temp.visible('products/hard/unreviewed.jpg'), 'catalog.write held in another workspace does not open unreviewed media here');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(pg_temp.visible('products/hard/unreviewed.jpg'), 'the workspace''s own catalogue operator keeps review access');

select * from finish();
rollback;
