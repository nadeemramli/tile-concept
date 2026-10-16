begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into ingest.telegram_sales_channels values('11111111-1111-1111-1111-111111111111',-700123);
create temporary table card_fixture as
select (api.accept_intake('11111111-1111-1111-1111-111111111111','meta','facebook','sales-card-fixture','sales-card-fixture',
 jsonb_build_object('source','facebook','area','Synthetic project area','message',E'conditional_question_1: Pemilik rumah\nconditional_question_2: Planning a project\nconditional_question_3: Catalogue and prices'),
 jsonb_build_object('name','Synthetic enquiry','phone','+601199988877','email','enquiry@example.test','company','Synthetic Studio','interest','Catalogue and prices'))->>'lead_id')::uuid id;
update sales.leads set owner_id='aaaaaaaa-0000-0000-0000-000000000003' where id=(select id from card_fixture);
update sales.lead_routing_assignments set owner_id='aaaaaaaa-0000-0000-0000-000000000003',slot_name='Naufal' where lead_id=(select id from card_fixture);
create temporary table card_data as select sales.telegram_card_data(id) data from card_fixture;
select is((select data->>'email' from card_data),'enquiry@example.test','card carries customer email');
select is((select data->>'company' from card_data),'Synthetic Studio','card carries company when supplied');
select is((select data->>'interest' from card_data),'Catalogue and prices','card carries actual enquiry');
select ok((select data->>'enquiry_message' like '%Planning a project%' from card_data),'full form answers reach the presenter');
select is((select data->>'area' from card_data),'Synthetic project area','card carries supplied project area');
select is((select data->>'source' from card_data),'facebook','card identifies exact platform');
select is((select data->>'assignee' from card_data),'Naufal','current matching routing slot gives readable salesperson name');
select ok((select data->>'received_at' is not null from card_data),'card includes actual received date');
select ok(not has_function_privilege('authenticated','sales.telegram_card_data(uuid)','execute'),'staff cannot directly call the private card projection');
update sales.leads set owner_id='aaaaaaaa-0000-0000-0000-000000000004' where id=(select id from card_fixture);
select isnt(sales.telegram_card_data((select id from card_fixture))->>'assignee','Naufal','later owner changes never retain the old slot name');
select * from finish();
rollback;
