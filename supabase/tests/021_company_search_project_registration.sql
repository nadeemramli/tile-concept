begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into core.workspaces(id,slug,name) values ('99999999-3431-0000-0000-000000000099','crm-test-isolation','Synthetic foreign workspace');
insert into identity.accounts(id,workspace_id,name,telephone) values
 ('aaaaaaaa-3431-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic Helix Build','03-7777 8877'),
 ('aaaaaaaa-3431-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Synthetic Helix Design',null),
 ('aaaaaaaa-3431-0000-0000-000000000099','99999999-3431-0000-0000-000000000099','Synthetic Helix Foreign','03-7777 8877');
insert into identity.contacts(id,workspace_id,display_name) values
 ('bbbbbbbb-3431-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic Aina'),
 ('bbbbbbbb-3431-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Synthetic Ben'),
 ('bbbbbbbb-3431-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Synthetic Unlinked'),
 ('bbbbbbbb-3431-0000-0000-000000000099','99999999-3431-0000-0000-000000000099','Synthetic Foreign PIC');
insert into identity.contact_points(workspace_id,contact_id,kind,raw_value,normalized_value,is_primary) values
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-3431-0000-0000-000000000001','phone','0128877001','+60128877001',true),
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-3431-0000-0000-000000000002','phone','0128877002','+60128877002',true),
 ('99999999-3431-0000-0000-000000000099','bbbbbbbb-3431-0000-0000-000000000099','phone','0128877001','+60128877001',true);
insert into identity.account_contact_relationships(workspace_id,account_id,contact_id,role) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-3431-0000-0000-000000000001','bbbbbbbb-3431-0000-0000-000000000001','Owner'),
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-3431-0000-0000-000000000001','bbbbbbbb-3431-0000-0000-000000000002','Site PIC'),
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-3431-0000-0000-000000000002','bbbbbbbb-3431-0000-0000-000000000001','Designer');
create temp table created(result jsonb);
grant all on created to authenticated;
create function pg_temp.project_input(extra jsonb default '{}') returns jsonb language sql as $$
 select '{"account_id":"aaaaaaaa-3431-0000-0000-000000000001","contact_id":"bbbbbbbb-3431-0000-0000-000000000001","follow_up_contact_id":"bbbbbbbb-3431-0000-0000-000000000002","name":"Synthetic opportunity","project_name":"Synthetic registered project","create_project":true,"next_action":"Send proposal","product_specification":"Matte tile 600 x 600 mm; 80 m2","site_address":"12 Synthetic Road, Selangor 68100"}'::jsonb || extra
$$;
create function pg_temp.hits(q text, aid uuid default null) returns setof jsonb language sql as $$
 select * from jsonb_array_elements(api.showroom_customer_search(q,aid,50))
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select count(*) from pg_temp.hits('Helix Build') h where h->>'entity_type'='contact'),2::bigint,'company name discovers both linked contacts');
select ok(exists(select 1 from pg_temp.hits('03-7777 8877') h where h->>'entity_id'='aaaaaaaa-3431-0000-0000-000000000001'),'company switchboard finds company');
select is((select count(*) from pg_temp.hits('03-7777 8877') h where h->>'entity_type'='contact'),2::bigint,'company switchboard discovers its PICs');
select is((select jsonb_array_length(h->'companies') from pg_temp.hits('012-8877 001') h where h->>'entity_id'='bbbbbbbb-3431-0000-0000-000000000001'),2,'PIC phone reveals both company relationships');
select ok(not exists(select 1 from pg_temp.hits('0128877001') h where h->>'entity_id'='bbbbbbbb-3431-0000-0000-000000000099'),'same phone in another workspace is hidden');
select ok(not exists(select 1 from pg_temp.hits('Helix') h where h->>'entity_id'='aaaaaaaa-3431-0000-0000-000000000099'),'foreign companies are hidden');
select ok(not exists(select 1 from pg_temp.hits('0128877001') h where h->>'masked_phone'='+60128877001'),'discovery does not expose full personal phone');
select is((select count(*) from pg_temp.hits('','aaaaaaaa-3431-0000-0000-000000000001')),2::bigint,'choosing company lists its contacts');
select is((select count(*) from pg_temp.hits('Aina','aaaaaaaa-3431-0000-0000-000000000001')),1::bigint,'PIC selector filters within the company');
select is((select count(*) from pg_temp.hits('Ben','aaaaaaaa-3431-0000-0000-000000000002')),0::bigint,'PIC selector excludes contacts of other companies');
select is(api.showroom_customer_search('x'),'[]'::jsonb,'short global searches return no records');
select throws_ok($$select api.showroom_customer_search('','aaaaaaaa-3431-0000-0000-000000000099')$$,'42501','Company not found','foreign company filter is rejected');
select throws_ok($$insert into api.account_contact_relationships(workspace_id,account_id,contact_id) values('11111111-1111-1111-1111-111111111111','aaaaaaaa-3431-0000-0000-000000000001','bbbbbbbb-3431-0000-0000-000000000099')$$,'23514','Company and contact must belong to the same workspace','cross-workspace relationship rejected');
update api.account_contact_relationships set ended_at=current_date where account_id='aaaaaaaa-3431-0000-0000-000000000002' and contact_id='bbbbbbbb-3431-0000-0000-000000000001';
select is((select count(*) from pg_temp.hits('','aaaaaaaa-3431-0000-0000-000000000002')),0::bigint,'ended company relationships excluded');
select lives_ok($$insert into api.account_contact_relationships(workspace_id,account_id,contact_id,ended_at) values('11111111-1111-1111-1111-111111111111','aaaaaaaa-3431-0000-0000-000000000002','bbbbbbbb-3431-0000-0000-000000000001',null) on conflict(account_id,contact_id) do update set ended_at=null$$,'relinking reactivates the same relationship');
select is((select count(*) from api.account_contact_relationships where account_id='aaaaaaaa-3431-0000-0000-000000000002' and contact_id='bbbbbbbb-3431-0000-0000-000000000001'),1::bigint,'relink does not duplicate relationships');
select lives_ok($$insert into created select api.opportunity_command('create',pg_temp.project_input(),'dddddddd-3431-0000-0000-000000000001')$$,'company project and opportunity register atomically');
select ok((select p.account_id='aaaaaaaa-3431-0000-0000-000000000001' and p.primary_contact_id='bbbbbbbb-3431-0000-0000-000000000001' and p.follow_up_contact_id='bbbbbbbb-3431-0000-0000-000000000002' and p.owner_id='aaaaaaaa-0000-0000-0000-000000000003' from api.projects p join created c on p.id=(c.result->>'project_id')::uuid),'company, customer, customer PIC and internal salesperson stay distinct');
select is((select p.product_specification from api.projects p join created c on p.id=(c.result->>'project_id')::uuid),'Matte tile 600 x 600 mm; 80 m2','proposed product specifications saved');
select is((select s.address->>'line1' from api.project_sites s join created c on s.project_id=(c.result->>'project_id')::uuid),'12 Synthetic Road, Selangor 68100','site address saved with project');
select ok((select o.account_id='aaaaaaaa-3431-0000-0000-000000000001' and o.project_id=(c.result->>'project_id')::uuid from api.opportunities o join created c on o.id=(c.result->>'opportunity_id')::uuid),'opportunity belongs to company and project');
select is(api.opportunity_command('create',pg_temp.project_input(),'dddddddd-3431-0000-0000-000000000001'),(select result from created),'registration retry returns same project and opportunity');
select is((select count(*) from api.project_sites s join created c on s.project_id=(c.result->>'project_id')::uuid),1::bigint,'retry creates no duplicate site');
select throws_ok($$select api.opportunity_command('create',pg_temp.project_input('{"follow_up_contact_id":"bbbbbbbb-3431-0000-0000-000000000003"}'),gen_random_uuid())$$,'23514','Link the follow-up PIC to this company first','unlinked company PIC rejected');
select throws_ok($$select api.opportunity_command('create',pg_temp.project_input('{"follow_up_contact_id":"bbbbbbbb-3431-0000-0000-000000000099"}'),gen_random_uuid())$$,'23514','Choose an active customer PIC in this workspace','foreign PIC rejected');
select is((select count(*) from api.projects where name='Synthetic registered project'),1::bigint,'failed registration leaves no partial projects');
select throws_ok($$update api.projects set follow_up_contact_id='bbbbbbbb-3431-0000-0000-000000000003' where id=(select (result->>'project_id')::uuid from created)$$,'42501',null,'direct project edits are blocked; the versioned project command is required');
select lives_ok($$select api.opportunity_command('create',pg_temp.project_input('{"account_id":null,"create_opportunity":false,"follow_up_contact_id":"bbbbbbbb-3431-0000-0000-000000000003"}'),gen_random_uuid())$$,'personal project can have customer PIC without a company');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select api.merge_contacts('bbbbbbbb-3431-0000-0000-000000000001','bbbbbbbb-3431-0000-0000-000000000002','Synthetic duplicate PIC test')$$,'approved contact merge preserves project registration');
select is((select p.follow_up_contact_id from api.projects p join created c on p.id=(c.result->>'project_id')::uuid),'bbbbbbbb-3431-0000-0000-000000000001'::uuid,'project PIC follows surviving contact');
select is((select count(*) from pg_temp.hits('','aaaaaaaa-3431-0000-0000-000000000001')),1::bigint,'merged contacts no longer appear twice under company');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000006","role":"authenticated"}',true);
select throws_ok($$select api.showroom_customer_search('Helix')$$,'42501',null,'non-sales staff cannot use showroom discovery');
reset role;
select ok(not has_function_privilege('anon','api.showroom_customer_search(text,uuid,integer)','EXECUTE'),'anonymous discovery denied');
select ok(not has_function_privilege('authenticated','identity.guard_project_registration()','EXECUTE'),'trigger definer cannot be invoked directly');
select * from finish();
rollback;
