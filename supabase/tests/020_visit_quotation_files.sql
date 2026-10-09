begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into sales.visits(id,workspace_id,purpose) values
 ('bbbbbbbb-3420-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','browse');
insert into core.workspaces(id,slug,name) values ('99999999-3420-0000-0000-000000000099','quotation-isolation','Synthetic quotation workspace');
insert into sales.visits(id,workspace_id,purpose) values ('bbbbbbbb-3420-0000-0000-000000000099','99999999-3420-0000-0000-000000000099','browse');
insert into sales.visit_quotation_files(id,workspace_id,visit_id,object_path,file_name,content_type,file_size,created_by,uploaded_at)
values('cccccccc-3420-0000-0000-000000000099','99999999-3420-0000-0000-000000000099','bbbbbbbb-3420-0000-0000-000000000099','99999999-3420-0000-0000-000000000099/foreign.pdf','Foreign.pdf','application/pdf',123,'aaaaaaaa-0000-0000-0000-000000000003',now());
insert into storage.objects(bucket_id,name,metadata) values('visit-quotations','99999999-3420-0000-0000-000000000099/foreign.pdf','{"size":123,"mimetype":"application/pdf"}');
create function pg_temp.file_input(extra jsonb default '{}') returns jsonb language sql as $$
 select '{"file_name":"Synthetic quotation.xlsx","file_size":123,"content_type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}'::jsonb || extra
$$;
create function pg_temp.prepare(extra jsonb default '{}', fid uuid default 'cccccccc-3420-0000-0000-000000000001') returns text language sql as $$
 select api.visit_quotation_command('prepare','bbbbbbbb-3420-0000-0000-000000000001',fid,pg_temp.file_input(extra))
$$;
create function pg_temp.finish() returns text language sql as $$
 select api.visit_quotation_command('finish','bbbbbbbb-3420-0000-0000-000000000001','cccccccc-3420-0000-0000-000000000001')
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select api.visit_quotation_command('prepare','bbbbbbbb-3420-0000-0000-000000000099',gen_random_uuid(),pg_temp.file_input())$$,'42501','Visit not found','unavailable visits cannot accept uploads');
select is((select count(*) from api.visit_quotation_files where id='cccccccc-3420-0000-0000-000000000099'),0::bigint,'cross-workspace attachment metadata is hidden even for uploader');
select is((select count(*) from storage.objects where bucket_id='visit-quotations' and name='99999999-3420-0000-0000-000000000099/foreign.pdf'),0::bigint,'cross-workspace storage is hidden');
select lives_ok($$select pg_temp.prepare()$$,'sales staff can reserve a quotation');
select is(pg_temp.prepare(), '11111111-1111-1111-1111-111111111111/bbbbbbbb-3420-0000-0000-000000000001/cccccccc-3420-0000-0000-000000000001.xlsx','retry returns the same immutable path');
select throws_ok($$select pg_temp.prepare('{"file_size":124}')$$,'23514','Retry differs from original file','changed retry is rejected');
select throws_ok($$select pg_temp.prepare('{"file_size":10485761}',gen_random_uuid())$$,'23514',null,'oversized files rejected');
select throws_ok($$select pg_temp.prepare('{"file_size":0}',gen_random_uuid())$$,'23514',null,'empty files rejected');
select throws_ok($$select pg_temp.prepare('{"file_name":"file.exe"}',gen_random_uuid())$$,'23514',null,'unsupported extensions rejected');
select throws_ok($$select pg_temp.prepare('{"file_name":"../file.xlsx"}',gen_random_uuid())$$,'23514',null,'path traversal filename rejected');
select throws_ok($$select pg_temp.prepare('{"content_type":"application/pdf"}',gen_random_uuid())$$,'23514',null,'MIME mismatch rejected');
select throws_ok($$select pg_temp.finish()$$,'23514','Upload is incomplete. Select the original file to retry','missing bytes cannot be finalized');
select is((select count(*) from api.visit_quotation_files where visit_id='bbbbbbbb-3420-0000-0000-000000000001'),1::bigint,'uploader can recover pending files');
select throws_ok($$update sales.visit_quotation_files set uploaded_at=now()$$,'42501',null,'direct metadata writes are denied');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000004","role":"authenticated"}',true);
select is((select count(*) from api.visit_quotation_files where visit_id='bbbbbbbb-3420-0000-0000-000000000001'),0::bigint,'other staff cannot see unfinished uploads');
select throws_ok($$select pg_temp.finish()$$,'42501','File belongs to another visit or uploader','other staff cannot finalize upload');
select throws_ok($$select pg_temp.prepare()$$,'42501','File belongs to another visit or uploader','other staff cannot reuse reservation');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$insert into storage.objects(bucket_id,name) values('visit-quotations','11111111-1111-1111-1111-111111111111/unreserved.xlsx')$$,'42501',null,'unreserved storage writes denied');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata) values('visit-quotations',pg_temp.prepare(),'{"size":122,"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}')$$,'uploader can write reserved storage path');
select throws_ok($$select pg_temp.finish()$$,'23514',null,'wrong stored size rejected');
reset role;
update storage.objects set metadata='{"size":123,"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}' where bucket_id='visit-quotations' and name like '%cccccccc-3420%' and name like '%cccccccc-3420%';
set local role authenticated;
select lives_ok($$select pg_temp.finish()$$,'matching uploaded file can be finalized');
select lives_ok($$select pg_temp.finish()$$,'finalization retry is idempotent');
select is((select count(*) from api.visit_quotation_files where uploaded_at is not null and visit_id='bbbbbbbb-3420-0000-0000-000000000001'),1::bigint,'one completed attachment');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000004","role":"authenticated"}',true);
select is((select count(*) from api.visit_quotation_files where visit_id='bbbbbbbb-3420-0000-0000-000000000001'),1::bigint,'other workspace sales staff can read completed files');
select is((select count(*) from storage.objects where bucket_id='visit-quotations' and name like '%cccccccc-3420%'),1::bigint,'authorized staff can download original file');
select throws_ok($$select pg_temp.finish()$$,'42501',null,'completed retries still require original uploader');
with changed as (update storage.objects set metadata='{}' where bucket_id='visit-quotations' and name like '%cccccccc-3420%' returning id) select is((select count(*) from changed),0::bigint,'stored files cannot be overwritten');
set local storage.allow_delete_query = true;
with removed as (delete from storage.objects where bucket_id='visit-quotations' and name like '%cccccccc-3420%' returning id) select is((select count(*) from removed),0::bigint,'stored files cannot be deleted');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000007","role":"authenticated"}',true);
select is((select count(*) from api.visit_quotation_files where visit_id='bbbbbbbb-3420-0000-0000-000000000001'),1::bigint,'sales readers can see completed files');
select throws_ok($$select pg_temp.prepare()$$,'42501',null,'read-only staff cannot upload quotations');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}',true);
select is((select count(*) from api.visit_quotation_files),0::bigint,'non-sales staff cannot read quotations');
select is((select count(*) from storage.objects where bucket_id='visit-quotations' and name like '%cccccccc-3420%'),0::bigint,'non-sales staff cannot download quotations');
select throws_ok($$select pg_temp.prepare()$$,'42501',null,'non-sales staff cannot reserve quotations');
reset role;
select ok(not has_function_privilege('anon','api.visit_quotation_command(text,uuid,uuid,jsonb)','EXECUTE'),'anonymous calls denied');
select ok(not (select public from storage.buckets where id='visit-quotations'),'quotation bucket is private');
select * from finish();
rollback;
