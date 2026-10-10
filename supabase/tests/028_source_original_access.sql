-- TILE-24: source originals (source-assets), OCR artifacts and source rows are
-- reachable only with source.import / catalog.write in the owning workspace.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Synthetic fixtures. W = seeded workspace, X = another workspace.
insert into core.workspaces(id, name, slug) values ('5a240000-0000-4000-8000-00000000000a', 'Synthetic originals other', 'synthetic-originals-other');
insert into auth.users(id, email, aud, role) values
  ('5a240000-0000-4000-8000-0000000000e1', 'synthetic-dual-originals@example.test', 'authenticated', 'authenticated'),
  ('5a240000-0000-4000-8000-0000000000e2', 'synthetic-stock-originals@example.test', 'authenticated', 'authenticated'),
  ('5a240000-0000-4000-8000-0000000000e3', 'synthetic-management-originals@example.test', 'authenticated', 'authenticated');
insert into core.memberships(workspace_id, user_id, role_key, created_at) values
  -- Admin elsewhere, showroom here: privileged only in another workspace.
  ('5a240000-0000-4000-8000-00000000000a', '5a240000-0000-4000-8000-0000000000e1', 'admin', now()),
  ('11111111-1111-1111-1111-111111111111', '5a240000-0000-4000-8000-0000000000e1', 'showroom', now() + interval '1 minute'),
  ('11111111-1111-1111-1111-111111111111', '5a240000-0000-4000-8000-0000000000e2', 'stock_coordinator', now()),
  ('11111111-1111-1111-1111-111111111111', '5a240000-0000-4000-8000-0000000000e3', 'management', now());

insert into storage.objects(bucket_id, name, owner_id) values
  ('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf', 'aaaaaaaa-0000-0000-0000-000000000006'),
  ('source-assets', '5a240000-0000-4000-8000-00000000000a/syn-t24/other.pdf', null),
  ('ingest-artifacts', '11111111-1111-1111-1111-111111111111/ocr/syn-t24/page-1.png', null);
insert into ingest.source_assets(id, workspace_id, name, kind, storage_bucket, storage_path) values
  ('5a240000-0000-4000-8000-000000000021', '11111111-1111-1111-1111-111111111111', 'Synthetic original.pdf', 'pdf', 'source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf');

create function pg_temp.sees(b text, p text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = b and name = p)
$$;
-- Rows an UPDATE touched; RLS filters silently, so 0 means refused.
create function pg_temp.updates(b text, p text) returns integer language plpgsql as $$
declare n integer;
begin
  update storage.objects set metadata = coalesce(metadata, '{}'::jsonb) || '{"t24":"swapped"}' where bucket_id = b and name = p;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.deletes(b text, p text) returns integer language plpgsql as $$
declare n integer;
begin
  delete from storage.objects where bucket_id = b and name = p;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.inserts(b text, p text) returns boolean language plpgsql as $$
begin
  insert into storage.objects(bucket_id, name, owner_id) values (b, p, auth.uid()::text);
  return true;
exception when insufficient_privilege then
  return false;
end $$;
create function pg_temp.row_visible() returns boolean language sql as $$
  select exists (select 1 from api.source_assets where id = '5a240000-0000-4000-8000-000000000021')
$$;
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;

-- The Storage API sets this before its own deletes; without it the statement
-- trigger refuses every direct delete and the policy would never be tested.
select set_config('storage.allow_delete_query', 'true', true);
set local role authenticated;

------------------------------------------------------------------------------
-- Denied in W: sales rep (review.approve), showroom, sales manager, marketing,
-- management, stock coordinator, and the user privileged only elsewhere.
------------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'sales rep cannot read a known-path original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'sales rep cannot overwrite it');
select ok(not pg_temp.inserts('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/rep.pdf'), 'sales rep cannot add an original');
select ok(not pg_temp.row_visible(), 'sales rep does not see the source row');

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000005');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'showroom cannot read a known-path original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'showroom cannot overwrite it');
select ok(not pg_temp.inserts('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/showroom.pdf'), 'showroom cannot add an original');
select ok(not pg_temp.row_visible(), 'showroom does not see the source row');

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'sales manager cannot read a known-path original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'sales manager cannot overwrite it');
select ok(not pg_temp.row_visible(), 'sales manager does not see the source row');

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000007');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'marketing cannot read a known-path original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'marketing cannot overwrite it');
select ok(not pg_temp.row_visible(), 'marketing does not see the source row');

select pg_temp.as_user('5a240000-0000-4000-8000-0000000000e3');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'management cannot read a known-path original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'management cannot overwrite it');

select pg_temp.as_user('5a240000-0000-4000-8000-0000000000e2');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'stock coordinator cannot read a known-path original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'stock coordinator cannot overwrite it');
select ok(not pg_temp.inserts('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/stock.pdf'), 'stock coordinator cannot add an original');
select ok(pg_temp.inserts('source-assets', '11111111-1111-1111-1111-111111111111/supplier-evidence/syn-t24-stock.png'), 'stock coordinator can still attach supplier evidence');
select ok(not pg_temp.inserts('source-assets', '5a240000-0000-4000-8000-00000000000a/supplier-evidence/syn-t24-stock.png'), 'stock coordinator cannot attach evidence in another workspace');

select pg_temp.as_user('5a240000-0000-4000-8000-0000000000e1');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'admin elsewhere + showroom here cannot read the original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'admin elsewhere + showroom here cannot overwrite it');
select ok(not pg_temp.inserts('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/dual.pdf'), 'admin elsewhere + showroom here cannot add an original');
select is(pg_temp.deletes('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'admin elsewhere + showroom here cannot delete it');
select ok(not pg_temp.sees('ingest-artifacts', '11111111-1111-1111-1111-111111111111/ocr/syn-t24/page-1.png'), 'admin elsewhere + showroom here cannot read an OCR page artifact');
select ok(not pg_temp.row_visible(), 'admin elsewhere + showroom here does not see the source row');
select ok(pg_temp.sees('source-assets', '5a240000-0000-4000-8000-00000000000a/syn-t24/other.pdf'), 'the same user still reads originals of the workspace they administer');

------------------------------------------------------------------------------
-- Permitted in W: catalogue operator (source.import + catalog.write), admin.
------------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000006');
select ok(pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'catalogue operator reads the original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 1, 'catalogue operator can replace it (importer upsert)');
select ok(pg_temp.inserts('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/catalog.pdf'), 'catalogue operator can upload an original');
select is(pg_temp.deletes('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/catalog.pdf'), 0, 'catalogue operator cannot delete (settings.manage)');
select ok(pg_temp.sees('ingest-artifacts', '11111111-1111-1111-1111-111111111111/ocr/syn-t24/page-1.png'), 'catalogue operator reads the OCR page artifact');
select ok(pg_temp.row_visible(), 'catalogue operator sees the source row');
select ok(not pg_temp.sees('source-assets', '5a240000-0000-4000-8000-00000000000a/syn-t24/other.pdf'), 'catalogue operator cannot read another workspace''s original');
select ok(not pg_temp.inserts('source-assets', '5a240000-0000-4000-8000-00000000000a/syn-t24/catalog.pdf'), 'catalogue operator cannot upload into another workspace');

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select ok(pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'admin reads the original');
select ok(pg_temp.inserts('source-assets', '11111111-1111-1111-1111-111111111111/supplier-evidence/syn-t24-admin.png'), 'admin can attach supplier evidence');
select is(pg_temp.deletes('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/catalog.pdf'), 1, 'admin can delete an original in their workspace');
select ok(pg_temp.row_visible(), 'admin sees the source row');

------------------------------------------------------------------------------
-- Other workspace's admin: nothing in W.
------------------------------------------------------------------------------
reset role;
insert into auth.users(id, email, aud, role) values ('5a240000-0000-4000-8000-0000000000e4', 'synthetic-other-admin@example.test', 'authenticated', 'authenticated');
insert into core.memberships(workspace_id, user_id, role_key) values ('5a240000-0000-4000-8000-00000000000a', '5a240000-0000-4000-8000-0000000000e4', 'admin');
set local role authenticated;
select pg_temp.as_user('5a240000-0000-4000-8000-0000000000e4');
select ok(not pg_temp.sees('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'another workspace''s admin cannot read the original');
select is(pg_temp.updates('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'another workspace''s admin cannot overwrite it');
select is(pg_temp.deletes('source-assets', '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 0, 'another workspace''s admin cannot delete it');
select ok(not pg_temp.row_visible(), 'another workspace''s admin does not see the source row');

------------------------------------------------------------------------------
-- Persisted state and policy shape.
------------------------------------------------------------------------------
reset role;
select is((select metadata->>'t24' from storage.objects where bucket_id = 'source-assets' and name = '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'),
  'swapped', 'only the permitted update changed the original');
select ok(exists (select 1 from storage.objects where bucket_id = 'source-assets' and name = '11111111-1111-1111-1111-111111111111/syn-t24/original.pdf'), 'the original survived every refused delete');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname in ('tc_read_source_assets','tc_insert_source_assets','tc_update_source_assets','tc_delete_source_assets',
                     'tc_read_ingest_artifacts','tc_insert_ingest_artifacts','tc_update_ingest_artifacts','tc_delete_ingest_artifacts')
  and (coalesce(qual, '') || coalesce(with_check, '')) like '%permitted_workspace_ids%'), 8, 'every source-assets and ingest-artifacts policy is workspace-scoped');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'tc\_%\_source\_assets' and (coalesce(qual, '') || coalesce(with_check, '')) like '%member_workspace_ids%'), 0, 'no source-assets policy grants on membership alone');

select * from finish();
rollback;
