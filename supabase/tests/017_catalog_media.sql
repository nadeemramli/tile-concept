begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select is((select public from storage.buckets where id = 'product-media'), false, 'catalogue media stays private');
select ok((select allowed_mime_types @> array['video/mp4','video/webm','application/pdf'] from storage.buckets where id = 'product-media'), 'video and PDF types supported');
select is((select prosecdef from pg_proc where oid = 'api.set_primary_catalog_media(uuid,uuid)'::regprocedure), false, 'primary-image function applies user RLS');
select is(has_function_privilege('anon', 'api.set_primary_catalog_media(uuid,uuid)', 'execute'), false, 'anonymous primary mutation denied');

insert into core.workspaces(id, name, slug) values ('ca7a1000-0000-4000-8000-000000000001', 'Synthetic catalogue isolation', 'synthetic-catalogue-isolation');
insert into merch.products(id,workspace_id,name) values
('ca7a1000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Synthetic media test product'),
('ca7a1000-0000-4000-8000-000000000003', 'ca7a1000-0000-4000-8000-000000000001', 'Synthetic other-workspace product');
insert into merch.product_media(id,workspace_id,product_id,storage_path,kind,review_state,usage_rights_state) values
('ca7a1000-0000-4000-8000-000000000010','11111111-1111-1111-1111-111111111111','ca7a1000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111/test/a.jpg','image','reviewed','accepted'),
('ca7a1000-0000-4000-8000-000000000011','11111111-1111-1111-1111-111111111111','ca7a1000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111/test/b.jpg','image','reviewed','accepted'),
('ca7a1000-0000-4000-8000-000000000012','11111111-1111-1111-1111-111111111111','ca7a1000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111/test/c.jpg','image','unreviewed','unreviewed'),
('ca7a1000-0000-4000-8000-000000000013','11111111-1111-1111-1111-111111111111','ca7a1000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111/test/d.pdf','pdf','reviewed','accepted'),
('ca7a1000-0000-4000-8000-000000000014','11111111-1111-1111-1111-111111111111','ca7a1000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111/test/e.jpg','image','reviewed','accepted');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$select api.set_primary_catalog_media('ca7a1000-0000-4000-8000-000000000010','ca7a1000-0000-4000-8000-000000000002')$$,'catalogue operator selects reviewed image');
select lives_ok($$select api.set_primary_catalog_media('ca7a1000-0000-4000-8000-000000000011','ca7a1000-0000-4000-8000-000000000002')$$,'primary image can be replaced atomically');
select is((select count(*) from api.product_media where product_id='ca7a1000-0000-4000-8000-000000000002' and is_primary),1::bigint,'only one primary after replacement');
select throws_ok($$select api.set_primary_catalog_media('ca7a1000-0000-4000-8000-000000000012','ca7a1000-0000-4000-8000-000000000002')$$,'P0001','primary image must be an active, reviewed, rights-cleared image for this product','unreviewed image rejected');
select throws_ok($$select api.set_primary_catalog_media('ca7a1000-0000-4000-8000-000000000013','ca7a1000-0000-4000-8000-000000000002')$$,'P0001','primary image must be an active, reviewed, rights-cleared image for this product','PDF cannot become primary image');
select throws_ok($$select api.set_primary_catalog_media('ca7a1000-0000-4000-8000-000000000010','ca7a1000-0000-4000-8000-000000000003')$$,'P0001','product not found','cross-workspace product denied');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$select api.set_primary_catalog_media('ca7a1000-0000-4000-8000-000000000010','ca7a1000-0000-4000-8000-000000000002')$$,null::text,null::text,'sales rep cannot mutate primary image');
select is((select count(*) from api.product_media where product_id='ca7a1000-0000-4000-8000-000000000002'),4::bigint,'sales sees approved media only, not unreviewed');
select throws_ok($$select api.replace_catalog_media('ca7a1000-0000-4000-8000-000000000011','ca7a1000-0000-4000-8000-000000000014')$$,null::text,null::text,'sales rep cannot replace media');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values ('product-media','11111111-1111-1111-1111-111111111111/products/x/y.png','aaaaaaaa-0000-0000-0000-000000000003')$$,'42501',null::text,'sales rep cannot write catalogue media objects');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}', true);
update api.product_media set caption = 'Old caption' where id = 'ca7a1000-0000-4000-8000-000000000011';
select lives_ok($$select api.replace_catalog_media('ca7a1000-0000-4000-8000-000000000011','ca7a1000-0000-4000-8000-000000000014')$$,'operator replaces the primary image');
select is((select id from api.product_media where product_id='ca7a1000-0000-4000-8000-000000000002' and is_primary),'ca7a1000-0000-4000-8000-000000000014'::uuid,'replacement inherits primary role');
select ok((select archived_at is not null and not is_primary from api.product_media where id='ca7a1000-0000-4000-8000-000000000011'),'replaced file archived, not deleted');
select is((select caption from api.product_media where id='ca7a1000-0000-4000-8000-000000000014'),'Old caption','replacement inherits blank caption');
select throws_ok($$select api.replace_catalog_media('ca7a1000-0000-4000-8000-000000000011','ca7a1000-0000-4000-8000-000000000010')$$,'P0001','media to replace is not active','archived media cannot be replaced again');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*) from api.product_media where product_id='ca7a1000-0000-4000-8000-000000000002'),3::bigint,'archived media hidden from sales after reload');
reset role;
select ok(exists(select 1 from audit.audit_events where object_id='ca7a1000-0000-4000-8000-000000000011'),'media changes retain audit evidence');
select * from finish();
rollback;
