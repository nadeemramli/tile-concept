-- Walk-in collections by person and by period. Synthetic fixtures only; the
-- transaction rolls everything back. Dates sit in March 2026 so the seed's
-- now()-relative walk-ins never fall inside the windows asserted here.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;

insert into identity.contacts(id,workspace_id,display_name) values('bbbbbbbb-4a01-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic collection customer');

-- Visits. V4 is 17:00 UTC on Sunday 8 March, which is 01:00 on Monday 9 March
-- in Kuala Lumpur: it must land on the 9th and in the week that starts there.
insert into sales.visits(id,workspace_id,contact_id,staff_user_id,occurred_at,is_new_customer) values
('dddddddd-4a01-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000005','2026-03-09T02:00:00Z',true),
('dddddddd-4a01-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003','2026-03-09T03:00:00Z',false),
('dddddddd-4a01-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000005','2026-03-11T02:00:00Z',true),
('dddddddd-4a01-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001',null,'2026-03-08T17:00:00Z',true);

-- Sales. P1: Raj served the visit, Aiman closed the sale. P2: a legacy payment
-- without paid_at. P3: not a walk-in. P4: voided, so never a sale.
insert into sales.purchases(id,workspace_id,contact_id,visit_id,purchased_at,amount,purchase_source,salesperson_id,status,external_ref) values
('ffffffff-4a01-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001','dddddddd-4a01-0000-0000-000000000001','2026-03-09T02:30:00Z',1000,'walk_in','aaaaaaaa-0000-0000-0000-000000000003','recorded','SYNTH-WC-1'),
('ffffffff-4a01-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001','dddddddd-4a01-0000-0000-000000000003','2026-03-11T02:00:00Z',500,'walk_in','aaaaaaaa-0000-0000-0000-000000000004','recorded','SYNTH-WC-2'),
('ffffffff-4a01-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001',null,'2026-03-10T02:00:00Z',999,'online','aaaaaaaa-0000-0000-0000-000000000003','recorded','SYNTH-WC-3'),
('ffffffff-4a01-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','bbbbbbbb-4a01-0000-0000-000000000001','dddddddd-4a01-0000-0000-000000000002','2026-03-09T03:30:00Z',777,'walk_in','aaaaaaaa-0000-0000-0000-000000000003','voided','SYNTH-WC-4');

insert into sales.purchase_payments(purchase_id,method,amount,paid_at,review_state,direction) values
('ffffffff-4a01-0000-0000-000000000001','cash',600,'2026-03-09T02:30:00Z','confirmed','collection'),
('ffffffff-4a01-0000-0000-000000000001','cash',100,'2026-03-09T04:00:00Z','confirmed','refund'),
('ffffffff-4a01-0000-0000-000000000001','card',50,'2026-03-09T05:00:00Z','legacy_unclassified','collection'),
('ffffffff-4a01-0000-0000-000000000001','bank_transfer',400,'2026-03-16T02:00:00Z','confirmed','collection'),
('ffffffff-4a01-0000-0000-000000000002','cash',500,null,'confirmed','collection'),
('ffffffff-4a01-0000-0000-000000000003','card',999,'2026-03-10T02:00:00Z','confirmed','collection');

set local role authenticated;

-- Gates.
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
select throws_ok($$select * from api.report_walkin_collections('2026-03-01','2026-03-31')$$,'42501',null,'showroom role lacks report.read');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select throws_ok($$select * from api.report_walkin_collections('2026-03-01','2026-03-31','fortnight')$$,'23514',null,'unknown grain refused');
select throws_ok($$select * from api.report_walkin_collections('2026-03-31','2026-03-01')$$,'23514',null,'reversed period refused');

-- Daily, by person.
create temp table by_person as select * from api.report_walkin_collections('2026-03-01','2026-03-31','day',true);
select is((select count(*) from by_person where period_start='2026-03-09'),3::bigint,'three people on 9 March: Aiman, Raj and Unassigned');
select is((select person from by_person where period_start='2026-03-09' and person_id is null),'Unassigned','missing person is named Unassigned, never inferred');
select is((select visits from by_person where period_start='2026-03-09' and person_id is null),1::bigint,'Sunday 17:00 UTC visit lands on Monday in Kuala Lumpur');
select is((select visits from by_person where period_start='2026-03-09' and person_id='aaaaaaaa-0000-0000-0000-000000000005'),1::bigint,'Raj served one visit on the 9th');
select is((select purchases from by_person where period_start='2026-03-09' and person_id='aaaaaaaa-0000-0000-0000-000000000005'),0::bigint,'serving the visit does not make it your sale');
select is((select purchases from by_person where period_start='2026-03-09' and person_id='aaaaaaaa-0000-0000-0000-000000000003'),1::bigint,'Aiman closed the sale; the voided document is not a sale');
select is((select amount from by_person where period_start='2026-03-09' and person_id='aaaaaaaa-0000-0000-0000-000000000003'),1000::numeric,'document total follows the closer');
select is((select collections from by_person where period_start='2026-03-09' and person_id='aaaaaaaa-0000-0000-0000-000000000003'),500::numeric,'collections are confirmed payments net of the cash refund');
select is((select unreviewed_payments from by_person where period_start='2026-03-09' and person_id='aaaaaaaa-0000-0000-0000-000000000003'),1::bigint,'unreviewed payment is counted, not summed');
select is((select collections from by_person where period_start='2026-03-16' and person_id='aaaaaaaa-0000-0000-0000-000000000003'),400::numeric,'a later payment is collected on the day it was paid');
select is((select purchases from by_person where period_start='2026-03-16' and person_id='aaaaaaaa-0000-0000-0000-000000000003'),0::bigint,'a later payment is not a second sale');
select is((select collections from by_person where period_start='2026-03-11' and person_id='aaaaaaaa-0000-0000-0000-000000000004'),500::numeric,'payment without paid_at falls back to the purchase date');
select is((select count(*) from by_person where period_start='2026-03-10'),0::bigint,'a non-walk-in sale is out of scope');
select is((select person_id from by_person where period_start='2026-03-09' order by person nulls last limit 1),'aaaaaaaa-0000-0000-0000-000000000003'::uuid,'people sort by name within a period');

-- Weekly, workspace total.
create temp table by_week as select * from api.report_walkin_collections('2026-03-01','2026-03-31','week');
select is((select count(*) from by_week),2::bigint,'two weeks carry walk-in activity');
select is((select person from by_week limit 1),null::text,'period report carries no person');
select is((select period_end from by_week where period_start='2026-03-09'),'2026-03-15'::date,'week runs Monday to Sunday');
select is((select visits from by_week where period_start='2026-03-09'),4::bigint,'week of 9 March counts all four visits');
select is((select new_customers from by_week where period_start='2026-03-09'),3::bigint,'new-customer subset');
select is((select purchases from by_week where period_start='2026-03-09'),2::bigint,'two walk-in sales in the week');
select is((select amount from by_week where period_start='2026-03-09'),1500::numeric,'document totals for the week');
select is((select collections from by_week where period_start='2026-03-09'),1000::numeric,'collections for the week');
select is((select collections from by_week where period_start='2026-03-16'),400::numeric,'later collection sits in its own week');
select is((select visits from by_week where period_start='2026-03-16'),0::bigint,'a week with collections but no visits still shows');

-- Monthly.
select is((select collections from api.report_walkin_collections('2026-03-01','2026-03-31','month')),1400::numeric,'month total collections');
select is((select period_end from api.report_walkin_collections('2026-03-01','2026-03-31','month')),'2026-03-31'::date,'month ends on its last day');

-- Range boundaries are Kuala Lumpur days.
select is((select count(*) from api.report_walkin_collections('2026-03-10','2026-03-12','day')),1::bigint,'only the 11th falls in a 10-12 March window');
select is((select collections from api.report_walkin_collections('2026-03-10','2026-03-12','day')),500::numeric,'window collections');
select is((select visits from api.report_walkin_collections('2026-03-09','2026-03-09','day')),3::bigint,'a single Kuala Lumpur day includes the Sunday-UTC visit');

select * from finish();
rollback;
