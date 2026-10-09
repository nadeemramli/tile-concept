begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
create function pg_temp.cost(extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
select '{"incurred_on":"2026-08-10","platform":"tiktok","category":"platform_ads","entry_mode":"daily_total","entry_key":"total","vendor":"Synthetic platform","description":"Synthetic daily spend","reference":"SYNTH-AUG10","before_tax":100,"tax":6,"currency":"MYR"}'::jsonb||extra $$;
create temp table expense(id uuid); grant all on expense to authenticated;
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
insert into expense select api.record_marketing_spend('save',pg_temp.cost(),'eeeeeeee-4400-0000-0000-000000000001');
select is(api.record_marketing_spend('save',pg_temp.cost(),'eeeeeeee-4400-0000-0000-000000000001'),(select id from expense),'creation retry is idempotent');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost('{"tax":7}'),'eeeeeeee-4400-0000-0000-000000000001')$$,'23514','Retry differs from original command','request payload cannot change');
select is((select before_tax+tax from api.spend_entries where id=(select id from expense)),106::numeric,'full invoice cost retains tax');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost('{"entry_mode":"campaign","entry_key":"campaign-a"}'),gen_random_uuid())$$,'23514','Use one platform total or campaign detail for this day, never both','no double count daily total and campaign');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost('{"before_tax":"NaN"}'),gen_random_uuid())$$,'23514',null,'NaN refused');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost('{"tax":null}'),gen_random_uuid())$$,'23514',null,'tax cannot be silently guessed');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost('{"before_tax":1.001}'),gen_random_uuid())$$,'23514',null,'fractional cents refused');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost('{"original_currency":"USD","original_amount":30}'),gen_random_uuid())$$,'23514',null,'foreign conversion evidence required');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost('{"original_amount":30,"conversion_note":"Synthetic conversion"}'),gen_random_uuid())$$,'23514',null,'conversion cannot omit its original currency');
select throws_ok($$update api.spend_entries set tax=0 where id=(select id from expense)$$,'42501',null,'direct updates denied');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'spend')::numeric,106::numeric,'period denominator includes tax');
select ok(api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'mer' is null,'incomplete coverage means no MER');
select throws_ok($$select api.record_marketing_spend('coverage','{"platform":"tiktok","date_from":"2026-08-01","date_to":"2026-08-31","reason":"Synthetic check","complete":null}',gen_random_uuid())$$,'23514',null,'coverage needs explicit confirmation');
select api.record_marketing_spend('coverage',jsonb_build_object('platform',p,'date_from','2026-08-01','date_to','2026-08-31','reason','Synthetic platform statements checked, including zero days','complete',true),gen_random_uuid()) from unnest(array['tiktok','meta','google_ads','shared']) p;
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'spend_complete')::boolean,true,'all four cost groups reconciled');
select lives_ok($$select api.record_marketing_spend('credit',pg_temp.cost()||jsonb_build_object('id',e.id,'version',1,'before_tax',20,'tax',1.2,'incurred_on','2026-08-12','entry_key','credit-one','reference','CREDIT-ONE','reason','Synthetic vendor credit'),gen_random_uuid()) from expense e$$,'dated vendor credit accepted');
select throws_ok($$select api.record_marketing_spend('credit',pg_temp.cost()||jsonb_build_object('id',e.id,'version',1,'before_tax',20,'tax',1.2,'incurred_on','2026-08-13','entry_key','credit-duplicate','reference','credit-one','reason','Synthetic duplicate credit'),gen_random_uuid()) from expense e$$,'23505',null,'same vendor credit cannot be counted again under a different date and key');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'spend')::numeric,84.8::numeric,'credit reduces incurred expense in its own period');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'spend_complete')::boolean,false,'new cost invalidates reconciliation');
select throws_ok($$select api.record_marketing_spend('credit',pg_temp.cost()||jsonb_build_object('id',e.id,'version',1,'before_tax',81,'tax',0,'entry_key','too-much','reason','Synthetic excess credit'),gen_random_uuid()) from expense e$$,'23514','Credit exceeds the original cost or predates it','cannot overcredit original cost');
select throws_ok($$select api.record_marketing_spend('void',jsonb_build_object('id',e.id,'version',1,'reason','Synthetic void reason'),gen_random_uuid()) from expense e$$,'23514','Void the linked credits before voiding the original cost','original and credit cannot double reverse');
select api.record_marketing_spend('coverage','{"platform":"tiktok","date_from":"2026-08-01","date_to":"2026-08-31","reason":"Synthetic corrected statement checked","complete":true}',gen_random_uuid());
create temp table baseline as select (api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'identified_visitors')::int visitors;
reset role;
insert into identity.contacts(id,workspace_id,display_name) values('bbbbbbbb-4400-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic funnel customer');
insert into sales.leads(id,workspace_id,source_channel,contact_id,owner_id,created_at,first_whatsapp_sent_at,first_whatsapp_reply_at) values
('cccccccc-4400-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','tiktok','bbbbbbbb-4400-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003','2026-08-10T03:00:00Z','2026-08-10T04:00:00Z','2026-08-10T05:00:00Z'),
('cccccccc-4400-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','website','bbbbbbbb-4400-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003','2026-07-01T03:00:00Z',null,null);
insert into sales.visits(id,workspace_id,contact_id,lead_id,staff_user_id,occurred_at) values
('dddddddd-4400-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','bbbbbbbb-4400-0000-0000-000000000001','cccccccc-4400-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000005','2026-08-20T03:00:00Z');
insert into sales.purchases(id,workspace_id,contact_id,lead_id,visit_id,purchased_at,amount,financial_state,external_ref) values
('ffffffff-4400-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','bbbbbbbb-4400-0000-0000-000000000001','cccccccc-4400-0000-0000-000000000001','dddddddd-4400-0000-0000-000000000001','2026-09-01T03:00:00Z',954,'confirmed','SYNTH-LATER'),
('ffffffff-4400-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','bbbbbbbb-4400-0000-0000-000000000001','cccccccc-4400-0000-0000-000000000002',null,'2026-08-15T03:00:00Z',1272,'confirmed','SYNTH-PRIOR');
insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,net_delta,tax_delta,reason,actor_id) values
('11111111-1111-1111-1111-111111111111','ffffffff-4400-0000-0000-000000000001','confirmed','2026-09-01T03:00:00Z',900,54,'Synthetic confirmation','aaaaaaaa-0000-0000-0000-000000000002'),
('11111111-1111-1111-1111-111111111111','ffffffff-4400-0000-0000-000000000002','confirmed','2026-08-15T03:00:00Z',1200,72,'Synthetic confirmation','aaaaaaaa-0000-0000-0000-000000000002');
insert into sales.purchase_payments(purchase_id,method,amount,paid_at,review_state) values('ffffffff-4400-0000-0000-000000000002','cash',200,'2026-08-15T03:00:00Z','confirmed');
set local role authenticated;
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'revenue')::numeric,1200::numeric,'period revenue excludes tax and later sale');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'collections')::numeric,200::numeric,'collections are separate actual payment amount');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-08-31')->'summary'->>'closed_leads')::int,0,'earlier as-of excludes later conversion');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'closed_leads')::int,1,'cohort includes later conversion, not old lead');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'converted_visits')::int,1,'linked visit converts with later sale');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'identified_visitors')::int,(select visitors+1 from baseline),'customer distinct from visits');
select is(round((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'mer')::numeric,2),14.15::numeric,'MER uses full cost denominator');
select is((api.funnel_history('2026-08-01','2026-08-31','2026-09-21',p_contact=>'bbbbbbbb-4400-0000-0000-000000000001')->'rows'->0->>'net_sales')::numeric,900::numeric,'visit drilldown linked sales only');
select is((api.funnel_history('2026-08-01','2026-08-31','2026-09-21','sales',p_contact=>'bbbbbbbb-4400-0000-0000-000000000001')->>'total')::int,1,'sales history date grain is purchase date');
select throws_ok($$select api.funnel_dashboard('2026-09-01','2026-08-01','2026-09-21')$$,'23514',null,'reversed period rejected');
select throws_ok($$select api.funnel_dashboard('2026-08-01','2026-08-31','2026-08-15')$$,'23514',null,'as-of before cohort end rejected');
select throws_ok($$select api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21','99999999-4400-0000-0000-000000000099')$$,'42501','Location not found','foreign location rejected');
reset role;
insert into core.workspaces(id,slug,name) values('99999999-4400-0000-0000-000000000099','f4-isolation','Synthetic foreign workspace');
insert into marketing.spend_entries(workspace_id,incurred_on,platform,category,entry_mode,entry_key,vendor,description,reference,before_tax,tax,currency,created_by)
values('99999999-4400-0000-0000-000000000099','2026-08-10','shared','event','event','FOREIGN','Synthetic','Synthetic','FOREIGN',9000,0,'MYR','aaaaaaaa-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*) from api.spend_entries where workspace_id='99999999-4400-0000-0000-000000000099'),0::bigint,'other workspace cost hidden');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'spend')::numeric,84.8::numeric,'aggregate excludes other workspace');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_ok($$select api.record_marketing_spend('save',pg_temp.cost(),gen_random_uuid())$$,'42501','Permission denied: marketing.spend.write','sales rep cannot write marketing ledger');
select is((select count(*) from api.spend_entries),0::bigint,'sales rep cannot see cost details');
select lives_ok($$select api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')$$,'sales rep has the deployed report grant');
select lives_ok($$select api.funnel_history('2026-08-01','2026-08-31','2026-09-21')$$,'sales rep can inspect named customer history');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
select throws_ok($$select api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')$$,'42501','Permission denied: report.read','showroom role still cannot read reporting aggregates');
select throws_ok($$select api.funnel_history('2026-08-01','2026-08-31','2026-09-21')$$,'42501',null,'showroom role still cannot read named report history');
reset role;
select ok(not has_function_privilege('anon','api.record_marketing_spend(text,jsonb,uuid)','execute'),'anonymous cost writes blocked');
select ok(not has_function_privilege('anon','api.funnel_dashboard(date,date,date,uuid,text)','execute'),'anonymous aggregates blocked');
select ok(not has_table_privilege('authenticated','marketing.spend_requests','select'),'request ledger private');
select * from finish();
rollback;
