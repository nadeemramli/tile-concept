-- TILE-22: OCR-assisted scanned catalogue imports — queue, limits, dedup,
-- leases, retry, manual fallback, permissions and the unchanged publish gate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- Synthetic fixtures only. W = seeded workspace, X = another workspace.
insert into core.workspaces(id, name, slug) values ('0c22a000-0000-4000-8000-00000000000a', 'Synthetic OCR isolation', 'synthetic-ocr-isolation');
insert into auth.users(id, email, aud, role) values ('0c22a000-0000-4000-8000-0000000000ee', 'synthetic-ocr-x@example.test', 'authenticated', 'authenticated');
insert into core.memberships(workspace_id, user_id, role_key) values ('0c22a000-0000-4000-8000-00000000000a', '0c22a000-0000-4000-8000-0000000000ee', 'catalog_pricing');

insert into ingest.source_assets(id, workspace_id, name, kind, storage_bucket, storage_path, checksum, mime_type, size_bytes, page_count) values
  ('0c22a000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Synthetic scan.pdf', 'pdf', 'source-assets', '11111111-1111-1111-1111-111111111111/syn-ocr-scan.pdf', 'syn-ocr-checksum-1', 'application/pdf', 400000, 2),
  ('0c22a000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Synthetic photo.jpg', 'image', 'source-assets', '11111111-1111-1111-1111-111111111111/syn-ocr-photo.jpg', 'syn-ocr-checksum-2', 'image/jpeg', 90000, null),
  ('0c22a000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'Synthetic sheet.xlsx', 'excel', 'source-assets', '11111111-1111-1111-1111-111111111111/syn-ocr.xlsx', 'syn-ocr-checksum-3', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 9000, null),
  ('0c22a000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', 'Synthetic huge.pdf', 'pdf', 'source-assets', '11111111-1111-1111-1111-111111111111/syn-ocr-huge.pdf', 'syn-ocr-checksum-4', 'application/pdf', 40000000, 3),
  ('0c22a000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111', 'Synthetic long.pdf', 'pdf', 'source-assets', '11111111-1111-1111-1111-111111111111/syn-ocr-long.pdf', 'syn-ocr-checksum-5', 'application/pdf', 900000, 64),
  ('0c22a000-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111', 'Synthetic locked.pdf', 'pdf', 'source-assets', '11111111-1111-1111-1111-111111111111/syn-ocr-locked.pdf', 'syn-ocr-checksum-6', 'application/pdf', 90000, 1),
  ('0c22a000-0000-4000-8000-000000000007', '11111111-1111-1111-1111-111111111111', 'Synthetic escaped path.pdf', 'pdf', 'source-assets', '0c22a000-0000-4000-8000-00000000000a/x.pdf', 'syn-ocr-checksum-7', 'application/pdf', 1000, 1),
  ('0c22a000-0000-4000-8000-000000000009', '0c22a000-0000-4000-8000-00000000000a', 'Other workspace scan.pdf', 'pdf', 'source-assets', '0c22a000-0000-4000-8000-00000000000a/x.pdf', 'syn-ocr-checksum-9', 'application/pdf', 1000, 1);
insert into ingest.source_asset_versions(source_asset_id, version_no, checksum, storage_path)
select id, 1, checksum, storage_path from ingest.source_assets where id::text like '0c22a000%';

create temp table r(k text primary key, v jsonb);
grant all on r to authenticated, service_role;
insert into r select 'refs', jsonb_build_object(
  'brand_id', (select id from merch.brands where workspace_id = '11111111-1111-1111-1111-111111111111' order by id limit 1),
  'category_id', (select id from merch.product_categories where workspace_id = '11111111-1111-1111-1111-111111111111' order by id limit 1),
  'unit_id', (select id from merch.units_of_measure where workspace_id = '11111111-1111-1111-1111-111111111111' order by id limit 1));

-- Park any OCR work already in this database so the claims below are ours.
update ingest.ingestion_jobs set next_attempt_at = now() + interval '1 day' where job_type = 'ocr' and status = 'queued';

------------------------------------------------------------------------------
-- Requesting OCR (catalogue operator, source.import)
------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);

insert into r values ('scan', api.request_ocr('0c22a000-0000-4000-8000-000000000001', array[2, 1, 2]));
select is(r.v->>'status', 'queued', 'a scanned PDF is queued for OCR') from r where k = 'scan';
select is((api.request_ocr('0c22a000-0000-4000-8000-000000000001', array[1, 2]))->>'job_id', (select v->>'job_id' from r where k = 'scan'),
  'the same pages of the same version return the same job (dedup)');
select is((select requested_pages from api.ingestion_jobs where id = (select (v->>'job_id')::uuid from r where k = 'scan')), array[1, 2],
  'page list is de-duplicated and ordered');
select is((select count(*) from api.ocr_jobs where source_asset_id = '0c22a000-0000-4000-8000-000000000001'), 1::bigint, 'exactly one OCR job exists for it');
insert into r values ('photo', api.request_ocr('0c22a000-0000-4000-8000-000000000002'));
insert into r values ('escaped', api.request_ocr('0c22a000-0000-4000-8000-000000000007'));
select is((select requested_pages from api.ingestion_jobs where id = (select (v->>'job_id')::uuid from r where k = 'photo')), array[1], 'an image is one page');

select throws_ok($$select api.request_ocr('0c22a000-0000-4000-8000-000000000003')$$, '22023', null, 'a spreadsheet is refused: OCR reads scans and images only');
select throws_like($$select api.request_ocr('0c22a000-0000-4000-8000-000000000004')$$, '%at most 25 MB%', 'an oversize file is refused before any work');
select throws_like($$select api.request_ocr('0c22a000-0000-4000-8000-000000000005')$$, '%at most 20 pages%', 'a long document must choose its pages');
select lives_ok($$select api.request_ocr('0c22a000-0000-4000-8000-000000000005', array[3, 4])$$, '...and can read the pages it chooses');
select throws_like($$select api.request_ocr('0c22a000-0000-4000-8000-000000000001', array[3])$$, '%between 1 and 2%', 'a page outside the document is refused');
select throws_ok($$select api.request_ocr('0c22a000-0000-4000-8000-000000000009')$$, '42501', null, 'another workspace''s source is refused');
select is((select count(*) from api.ocr_jobs where source_asset_id = '0c22a000-0000-4000-8000-000000000009'), 0::bigint, 'and is not visible');

-- The worker interface is not callable by a member.
select throws_ok($$select api.ocr_claim_job('member', 60)$$, '42501', null, 'a member cannot claim OCR work');
select throws_ok($$select api.ocr_complete_job(gen_random_uuid(), gen_random_uuid(), '[]', '[]')$$, '42501', null, 'a member cannot complete OCR work');
select throws_ok($$select api.ocr_fail_job(gen_random_uuid(), gen_random_uuid(), 'x')$$, '42501', null, 'a member cannot fail OCR work');

-- Sales has review.approve but not source.import.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select api.request_ocr('0c22a000-0000-4000-8000-000000000001')$$, '42501', null, 'sales cannot request OCR');
select throws_ok($$select api.add_manual_review_item('0c22a000-0000-4000-8000-000000000001', 1)$$, '42501', null, 'sales cannot add manual rows');
select is((select count(*) from api.ocr_page_results), 0::bigint, 'sales reads no OCR page evidence');

------------------------------------------------------------------------------
-- Worker: claim, stale completion, completion, idempotency
------------------------------------------------------------------------------
reset role;
-- now() is constant inside one transaction, so give the queue a real order.
update ingest.ingestion_jobs set created_at = now() - interval '4 minutes' where id = (select (v->>'job_id')::uuid from r where k = 'escaped');
update ingest.ingestion_jobs set created_at = now() - interval '3 minutes' where id = (select (v->>'job_id')::uuid from r where k = 'scan');
update ingest.ingestion_jobs set created_at = now() - interval '2 minutes' where id = (select (v->>'job_id')::uuid from r where k = 'photo');
update ingest.ingestion_jobs set next_attempt_at = now() + interval '1 day' where source_asset_id = '0c22a000-0000-4000-8000-000000000005';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into r values ('c1', api.ocr_claim_job('pgtap-worker', 60));
select is((select v->>'job_id' from r where k = 'c1'), (select v->>'job_id' from r where k = 'scan'), 'the oldest due job is leased first');
select is((select status || '|' || failure_kind from ingest.ingestion_jobs where id = (select (v->>'job_id')::uuid from r where k = 'escaped')), 'failed|source_missing',
  'a job whose stored path leaves its workspace folder is never handed to the service-role worker');
select is((select count(*) from ingest.review_items where job_id = (select (v->>'job_id')::uuid from r where k = 'escaped') and status = 'pending'), 1::bigint,
  '...and its page becomes a manual-entry row instead');
select is((select v->>'storage_path' from r where k = 'c1'), '11111111-1111-1111-1111-111111111111/syn-ocr-scan.pdf', 'the lease names the exact version to read');
select is((select status from ingest.ingestion_jobs where id = (select (v->>'job_id')::uuid from r where k = 'c1')), 'running', 'the leased job is running');

select throws_ok(format($$select api.ocr_complete_job(%L, gen_random_uuid(), '[]', '[]')$$, (select v->>'job_id' from r where k = 'c1')), '40001', null,
  'a completion with someone else''s lease is refused');

insert into r select 'done', api.ocr_complete_job(
  (select (v->>'job_id')::uuid from r where k = 'c1'), (select (v->>'lease_token')::uuid from r where k = 'c1'),
  jsonb_build_array(
    jsonb_build_object('row_no', 1, 'page_no', 1, 'raw', jsonb_build_object('lines', 'Code: SYN-OCR-001 Price: RM 12.50 per m2'),
      'normalized', jsonb_build_object('code', 'SYN-OCR-001', 'amount', '12.50', 'currency', 'MYR', 'source_page_or_row', 'page 1, line 3'),
      'confidence', 0.61, 'item_type', 'price', 'issues', jsonb_build_array(jsonb_build_object('code', 'low_confidence', 'detail', 'Read by OCR')),
      'fields', jsonb_build_array(jsonb_build_object('key', 'code', 'value', 'SYN-OCR-001', 'confidence', 0.7, 'source_text', 'Code: SYN-OCR-001',
        'region', jsonb_build_object('page', 1, 'x', 90, 'y', 200, 'w', 400, 'h', 30, 'page_w', 1600, 'page_h', 2263, 'ocr_conf', 88)))),
    jsonb_build_object('row_no', 2, 'page_no', 2, 'raw', '{}'::jsonb, 'normalized', '{}'::jsonb, 'confidence', 0, 'item_type', 'product',
      'issues', jsonb_build_array(jsonb_build_object('code', 'needs_manual', 'detail', 'too poor to read')), 'fields', '[]'::jsonb)),
  jsonb_build_array(
    jsonb_build_object('page_no', 1, 'outcome', 'read', 'word_count', 40, 'mean_confidence', 88.5, 'width_px', 1600, 'height_px', 2263, 'image_path', '11111111-1111-1111-1111-111111111111/ocr/x/page-1.png'),
    jsonb_build_object('page_no', 2, 'outcome', 'unreadable', 'word_count', 0, 'detail', 'too poor to read')),
  '{"mean_confidence": 88.5}'::jsonb, 'tesseract', '4.1.1');
select is((select v->>'records' from r where k = 'done'), '2', 'both pages are staged: one proposal, one manual-entry row');
select is((select v->>'pages_unreadable' from r where k = 'done'), '1', 'the unreadable page is counted');

select throws_ok(format($$select api.ocr_complete_job(%L, %L, '[]', '[]')$$, (select v->>'job_id' from r where k = 'c1'), (select v->>'lease_token' from r where k = 'c1')), '40001', null,
  'a repeated completion is refused...');
select is((select count(*) from ingest.review_items where job_id = (select (v->>'job_id')::uuid from r where k = 'c1')), 2::bigint, '...and adds no second copy');
select is((select count(*) from ingest.review_items where job_id = (select (v->>'job_id')::uuid from r where k = 'c1') and status = 'pending'), 2::bigint,
  'OCR output is staged as pending, never approved');
select is((select count(*) from merch.products where code = 'SYN-OCR-001'), 0::bigint, 'completing OCR publishes nothing');
select is((select count(*) from ingest.data_quality_issues where object_id = (select (v->>'job_id')::uuid from r where k = 'c1')), 1::bigint, 'the unreadable page is a visible data-quality issue');

-- Transient failure retries with backoff, then dead-letters to manual entry.
insert into r values ('c2', api.ocr_claim_job('pgtap-worker', 60));
select is((select v->>'job_id' from r where k = 'c2'), (select v->>'job_id' from r where k = 'photo'), 'the next job is the image');
select is((api.ocr_fail_job((select (v->>'job_id')::uuid from r where k = 'c2'), (select (v->>'lease_token')::uuid from r where k = 'c2'), 'engine crashed', 'transient'))->>'retry', 'true',
  'a transient error is retried');
select ok((select next_attempt_at > now() from ingest.ingestion_jobs where id = (select (v->>'job_id')::uuid from r where k = 'c2')), 'with backoff');
update ingest.ingestion_jobs set next_attempt_at = null, attempts = max_attempts - 1 where id = (select (v->>'job_id')::uuid from r where k = 'c2');
insert into r values ('c3', api.ocr_claim_job('pgtap-worker', 60));
select is((api.ocr_fail_job((select (v->>'job_id')::uuid from r where k = 'c3'), (select (v->>'lease_token')::uuid from r where k = 'c3'), 'engine crashed', 'transient'))->>'status', 'dead_letter',
  'the last attempt dead-letters the job');
select is((select count(*) from ingest.review_items ri join ingest.ingestion_records rr on rr.id = ri.record_id
           where ri.job_id = (select (v->>'job_id')::uuid from r where k = 'c3') and rr.issues @> '[{"code":"needs_manual"}]'), 1::bigint,
  'every page of a dead-lettered job becomes a manual-entry row');

------------------------------------------------------------------------------
-- Terminal input failure (encrypted) and retry rules
------------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
insert into r values ('locked', api.request_ocr('0c22a000-0000-4000-8000-000000000006'));
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into r values ('c4', api.ocr_claim_job('pgtap-worker', 60));
select is((api.ocr_fail_job((select (v->>'job_id')::uuid from r where k = 'c4'), (select (v->>'lease_token')::uuid from r where k = 'c4'), 'The PDF is password-protected', 'encrypted'))->>'status', 'failed',
  'an encrypted PDF fails at once, without retries');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_like(format($$select api.retry_ocr_job(%L)$$, (select v->>'job_id' from r where k = 'locked')), '%would fail the same way%', 'retrying an encrypted PDF is refused');
select is((api.retry_ocr_job((select (v->>'job_id')::uuid from r where k = 'photo')))->>'status', 'queued', 'a dead-lettered job can be retried by an operator');
select is((select max_attempts - attempts from api.ingestion_jobs where id = (select (v->>'job_id')::uuid from r where k = 'photo')), 3, 'with a fresh attempt budget');
select is((api.request_ocr('0c22a000-0000-4000-8000-000000000002'))->>'reused', 'true', 'asking again for a queued job returns it');
select throws_like(format($$select api.retry_ocr_job(%L)$$, (select v->>'job_id' from r where k = 'photo')), '%only a failed OCR job%', 'a queued job is not retried twice');

-- The retried job now reads its page: the earlier placeholder is closed.
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into r values ('c5', api.ocr_claim_job('pgtap-worker', 60));
select is((select v->>'job_id' from r where k = 'c5'), (select v->>'job_id' from r where k = 'photo'), 'the retried job is leased again');
select lives_ok(format($$select api.ocr_complete_job(%L, %L, '[]', '[{"page_no":1,"outcome":"read","word_count":12,"mean_confidence":91}]')$$,
  (select v->>'job_id' from r where k = 'c5'), (select v->>'lease_token' from r where k = 'c5')), 'and completes');
select is((select ri.status || ':' || left(ri.decision_note, 10) from ingest.review_items ri where ri.job_id = (select (v->>'job_id')::uuid from r where k = 'c5')),
  'rejected:Superseded', 'its earlier manual-entry placeholder is closed as superseded, so the queue does not ask twice');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);

------------------------------------------------------------------------------
-- Manual fallback and the unchanged publish gate
------------------------------------------------------------------------------
insert into r values ('manual', to_jsonb(api.add_manual_review_item('0c22a000-0000-4000-8000-000000000001', 2, 'product', 'from the printed page')));
select is((select page_no from api.review_queue where id = (select (v#>>'{}')::uuid from r where k = 'manual')), 2, 'a manual row keeps its page of the original');
select throws_like($$select api.add_manual_review_item('0c22a000-0000-4000-8000-000000000001', 9)$$, '%between 1 and 2%', 'a manual row cannot point outside the document');

select throws_like(format($$select api.approve_review_item(%L)$$, (select ri.id from api.review_items ri where ri.job_id = (select (v->>'job_id')::uuid from r where k = 'c1') and ri.item_type = 'price')),
  '%cannot approve%', 'an OCR price proposal cannot be approved on what OCR read alone');
select isnt((api.approve_review_item((select (v#>>'{}')::uuid from r where k = 'manual'),
    jsonb_build_object('code', 'SYN-OCR-MANUAL-1', 'name', 'Synthetic manual entry') || (select v from r where k = 'refs'),
'typed from page 2'))->>'product_id',
  null,
  'a manual row publishes only through the same explicit approval');
select is((select decision_corrections->>'code' from api.review_queue where id = (select (v#>>'{}')::uuid from r where k = 'manual')), 'SYN-OCR-MANUAL-1',
  'the review queue carries the reviewer''s correction, so a decided row shows what was published');
reset role;
select is((select source_asset_id from merch.products where code = 'SYN-OCR-MANUAL-1'), '0c22a000-0000-4000-8000-000000000001'::uuid, 'and keeps the source it was typed from');

select * from finish();
rollback;
