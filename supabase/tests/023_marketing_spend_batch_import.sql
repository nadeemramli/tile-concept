-- Marketing-cost batch import: reconciliation, duplicate and overlap refusal,
-- permissions, all-or-nothing failure, provenance and correction history.
-- Synthetic amounts and campaign names only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
-- One date of the report: two campaigns summed into a daily total.
create function pg_temp.day(d text,a numeric,b numeric) returns jsonb language sql as $$
  select jsonb_build_object('incurred_on',d,'before_tax',a+b,
    'campaigns',jsonb_build_array(jsonb_build_object('name','Synthetic campaign A','spend',a),jsonb_build_object('name','Synthetic campaign B','spend',b)),
    'source_rows',jsonb_build_array(2,3)) $$;
create function pg_temp.batch(p_sha text,p_entries jsonb,p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'source',jsonb_build_object('format','tiktok_trend_report','name','synthetic-trend.csv','sha256',repeat(p_sha,64),'parser_version','tiktok-trend/1',
      'row_count',2*jsonb_array_length(p_entries),'campaign_count',2,'date_from','2026-08-01','date_to','2026-08-31'),
    'currency','MYR','currency_basis','report_stated','tax_status','unreported',
    'mapping',jsonb_build_object('platform','tiktok','entry_mode','daily_total','category','platform_ads','vendor','TikTok'),
    'entries',p_entries,'excluded_zero_dates','["2026-08-04"]'::jsonb,
    'totals',jsonb_build_object('entry_count',jsonb_array_length(p_entries),
      'before_tax',(select sum((e->>'before_tax')::numeric) from jsonb_array_elements(p_entries) e)))||p_extra $$;
create function pg_temp.three_days() returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.day('2026-08-01',10.10,20.20),pg_temp.day('2026-08-02',5,0),pg_temp.day('2026-08-03',100.05,0.95)) $$;
create function pg_temp.entries() returns bigint language sql as $$ select count(*) from marketing.spend_entries where platform='tiktok' and incurred_on between '2026-08-01' and '2026-08-31' $$;
-- Batches created in this test's transaction (now() is the transaction start), not residue from other runs.
create function pg_temp.batches() returns bigint language sql as $$ select count(*) from marketing.spend_import_batches where imported_at>=now() $$;

-- A read-only analyst of our own.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
values('00000000-0000-0000-0000-000000000000','dddddddd-2300-0000-0000-000000000001','authenticated','authenticated','synthetic.analyst@tileconcept.test',
  '',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false);
insert into core.memberships(workspace_id,user_id,role_key) values('11111111-1111-1111-1111-111111111111','dddddddd-2300-0000-0000-000000000001','analyst');
create temp table ids(name text primary key,id uuid); grant all on ids to authenticated;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;

------------------------------------------------------------------------------
-- Permissions: preview is read-level, import is write-level.
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-2300-0000-0000-000000000001');
select is((api.preview_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()))->>'can_import')::boolean,false,'analyst can preview but is told they cannot import');
select is((api.preview_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()))->>'importable')::boolean,false,'a batch is not importable for a read-only role');
select throws_ok($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()),gen_random_uuid())$$,'42501','Permission denied: marketing.spend.write','analyst cannot import');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_ok($$select api.preview_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()))$$,'42501','Permission denied: marketing.spend.read','sales rep cannot preview marketing costs');
select throws_ok($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()),gen_random_uuid())$$,'42501','Permission denied: marketing.spend.write','sales rep cannot import');

------------------------------------------------------------------------------
-- Failed batches: every refusal names its problems and writes nothing.
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000007');
select is(api.preview_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()))->'issues','[]'::jsonb,'clean synthetic report previews without issues');
select is((api.preview_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()))->>'importable')::boolean,true,'marketing coordinator may import it');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days(),'{"totals":{"entry_count":46,"before_tax":3269.40}}'),gen_random_uuid())$$,
  'The batch cannot be imported: %The batch has 3 dated entries, not the 46 stated%The entries total MYR 136.30, not the MYR 3269.40 stated%','reconciliation names both the count and the total mismatch');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days(),'{"tax_status":"stated"}'),gen_random_uuid())$$,
  'The batch cannot be imported: %does not report tax: import its tax as unreported%','a trend report cannot claim a stated (zero) tax');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days())-'tax_status',gen_random_uuid())$$,
  'The batch cannot be imported: %import its tax as unreported%','tax status cannot be left out');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days(),'{"currency":"USD"}'),gen_random_uuid())$$,
  'The batch cannot be imported: %Only MYR amounts can be imported%','non-MYR batch refused, nothing converted');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days(),'{"mapping":{"platform":"meta","entry_mode":"campaign","category":"platform_ads","vendor":"TikTok"}}'),gen_random_uuid())$$,
  'The batch cannot be imported: %Map the report to TikTok / Platform daily total / Platform advertising%','mapping is fixed to TikTok daily totals');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',jsonb_build_array(pg_temp.day('2026-08-01',10,20)||'{"before_tax":31}')),gen_random_uuid())$$,
  'The batch cannot be imported: %2026-08-01: campaign spend sums to 30, not 31%','a daily total must equal its campaign spend');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',jsonb_build_array(pg_temp.day('2026-08-01',0,0))),gen_random_uuid())$$,
  'The batch cannot be imported: %2026-08-01 needs a positive MYR amount%','zero-spend dates are excluded, not imported');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',jsonb_build_array(pg_temp.day('2026-08-01',1.005,0))),gen_random_uuid())$$,
  'The batch cannot be imported: %needs a positive MYR amount with at most two decimals%','fractional cents refused');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',jsonb_build_array(pg_temp.day('2026-08-01',1,1),pg_temp.day('2026-08-01',2,2))),gen_random_uuid())$$,
  'The batch cannot be imported: %2026-08-01 appears more than once%','one entry per date');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',jsonb_build_array(pg_temp.day('2026-08-04',1,1))),gen_random_uuid())$$,
  'The batch cannot be imported: %2026-08-04 is listed as zero-spend and as an entry%','an excluded zero date cannot also be an entry');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',jsonb_build_array(pg_temp.day('2026-09-02',1,1))),gen_random_uuid())$$,
  'The batch cannot be imported: %2026-09-02 is outside the report''s date range%','entries stay inside the stated report range');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',jsonb_build_array(pg_temp.day('2026-02-30',1,1))),gen_random_uuid())$$,
  'The batch cannot be imported: %Entry 1 has no valid date%','an impossible date is an issue, not an exception');
select is(api.preview_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days(),'{"currency":"USD","tax_status":"stated","mapping":{}}'))->'issues',
  '["Only MYR amounts can be imported; nothing is converted", "A TikTok trend report does not report tax: import its tax as unreported", "Map the report to TikTok / Platform daily total / Platform advertising", "Name the vendor"]'::jsonb,
  'preview lists every issue at once instead of raising');
select is(api.preview_marketing_spend_batch('{"source":{}}')->'issues'->0,'"Only TikTok trend reports can be imported"'::jsonb,'a malformed payload previews as issues');
select is(pg_temp.batches(),0::bigint,'no failed batch left a batch row');
select is(pg_temp.entries(),0::bigint,'no failed batch left a ledger entry');

------------------------------------------------------------------------------
-- A good batch.
------------------------------------------------------------------------------
insert into ids values('request-a','eeeeeeee-2300-0000-0000-00000000000a');
-- Coverage that the import must invalidate.
select api.record_marketing_spend('coverage','{"platform":"tiktok","date_from":"2026-08-01","date_to":"2026-08-31","reason":"Synthetic statement checked","complete":true}',gen_random_uuid());
insert into ids select 'batch-a',api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()),'eeeeeeee-2300-0000-0000-00000000000a');
select is((select entry_count from api.spend_import_batches where id=(select id from ids where name='batch-a')),3,'batch records 3 dated entries');
select is((select total_before_tax from api.spend_import_batches where id=(select id from ids where name='batch-a')),136.30::numeric,'batch total is the sum of campaign spend');
select is((select count(*) from api.spend_entries where import_batch_id=(select id from ids where name='batch-a')),3::bigint,'three ledger entries carry the batch provenance');
select is((select array_agg(before_tax order by incurred_on) from api.spend_entries where import_batch_id=(select id from ids where name='batch-a')),array[30.30,5.00,101.00]::numeric[],'MYR amounts preserved exactly');
select ok((select bool_and(platform='tiktok' and entry_mode='daily_total' and category='platform_ads' and currency='MYR' and entry_key='daily-total')
  from api.spend_entries where import_batch_id=(select id from ids where name='batch-a')),'mapped to TikTok / Platform daily total / Platform advertising');
select ok((select bool_and(tax is null and tax_status='unreported') from api.spend_entries where import_batch_id=(select id from ids where name='batch-a')),'unreported tax stays unreported, never zero');
select ok((select bool_and(reference like 'TikTok trend aaaaaaaaaaaa · 2026-08-0_' and description like '%synthetic-trend.csv (2 campaigns)%Tax not reported%')
  from api.spend_entries where import_batch_id=(select id from ids where name='batch-a')),'reference and description name the source file and campaigns');
select is((select count(*) from api.spend_import_lines where batch_id=(select id from ids where name='batch-a')),3::bigint,'one provenance line per date');
select is((select campaigns->1->>'name' from api.spend_import_lines where batch_id=(select id from ids where name='batch-a') and incurred_on='2026-08-01'),'Synthetic campaign B','campaign breakdown kept per line');
select is((select excluded_zero_dates from api.spend_import_batches where id=(select id from ids where name='batch-a')),array['2026-08-04']::date[],'excluded zero-spend dates recorded');
select is((select count(*) from api.spend_coverage where platform='tiktok' and invalidated_at is null and date_from='2026-08-01'),0::bigint,'import invalidates TikTok coverage for those days');
select is((api.marketing_spend_period('2026-08-01','2026-08-31')->0->>'tax_unreported_entries')::int,3,'period totals count entries whose tax is unreported');
select is((api.marketing_spend_period('2026-08-01','2026-08-31')->0->>'before_tax')::numeric,136.30::numeric,'period totals expose the before-tax sum');

-- Duplicate imports.
select is(api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()),'eeeeeeee-2300-0000-0000-00000000000a'),(select id from ids where name='batch-a'),'retry with the same request is idempotent');
select throws_ok($$select api.import_marketing_spend_batch(pg_temp.batch('b',pg_temp.three_days()),'eeeeeeee-2300-0000-0000-00000000000a')$$,'23514','Retry differs from original command','a reused request id cannot carry another file');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()),gen_random_uuid())$$,'This report was already imported on % (batch %','the same file cannot be imported twice');
select ok(api.preview_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()))->'duplicate_batch'->>'id'=(select id::text from ids where name='batch-a'),'preview names the earlier batch of the same file');
select is(pg_temp.entries(),3::bigint,'duplicate attempts added no entries');

-- Overlap with existing daily totals: a different export covering 2026-08-03..05.
select is(jsonb_array_length(api.preview_marketing_spend_batch(pg_temp.batch('c',jsonb_build_array(pg_temp.day('2026-08-03',100.05,0.95),pg_temp.day('2026-08-05',7,0))))->'conflicts'),1,'preview lists the overlapping date');
select is((api.preview_marketing_spend_batch(pg_temp.batch('c',jsonb_build_array(pg_temp.day('2026-08-03',100.05,0.95),pg_temp.day('2026-08-05',7,0))))->'conflicts'->0->>'same_amount')::boolean,true,'preview says whether the recorded amount matches the report');
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('c',jsonb_build_array(pg_temp.day('2026-08-03',100.05,0.95),pg_temp.day('2026-08-05',7,0))),gen_random_uuid())$$,
  'TikTok costs are already recorded on 2026-08-03.%never both%','overlapping daily total refused');
select is((select count(*) from api.spend_entries where incurred_on='2026-08-05'),0::bigint,'a refused batch imports none of its other dates');

-- Overlap with manual campaign detail: campaign rows and a daily total never share a day.
select api.record_marketing_spend('save','{"incurred_on":"2026-08-06","platform":"tiktok","category":"platform_ads","entry_mode":"campaign","entry_key":"synthetic-campaign","vendor":"TikTok","description":"Synthetic campaign detail","reference":"SYNTH-CAMPAIGN","before_tax":12,"tax":0.96,"currency":"MYR"}',gen_random_uuid());
select throws_like($$select api.import_marketing_spend_batch(pg_temp.batch('d',jsonb_build_array(pg_temp.day('2026-08-06',12,0),pg_temp.day('2026-08-07',3,0))),gen_random_uuid())$$,
  'TikTok costs are already recorded on 2026-08-06.%','batch daily total cannot overlap manual campaign detail');
select is((api.preview_marketing_spend_batch(pg_temp.batch('d',jsonb_build_array(pg_temp.day('2026-08-06',12,0))))->'conflicts'->0->>'entry_mode'),'campaign','preview identifies the campaign entry it overlaps');
select is((select count(*) from api.spend_entries where incurred_on='2026-08-07'),0::bigint,'refused campaign-overlap batch imported nothing');

------------------------------------------------------------------------------
-- Audit and verification.
------------------------------------------------------------------------------
reset role;
select is((select count(*) from audit.audit_events where action='marketing.spend.import' and object_id=(select id from ids where name='batch-a')),1::bigint,'the batch import is audited once');
select is((select count(*) from audit.audit_events a join marketing.spend_entries e on e.id=a.object_id where a.action='marketing.spend.save' and e.import_batch_id=(select id from ids where name='batch-a')
  and a.reason='Imported from marketing cost batch '||(select id from ids where name='batch-a')),3::bigint,'each imported entry has its own audited save naming the batch');
set local role authenticated;
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->>'reconciled')::boolean,true,'fresh batch reconciles');
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->'summary'->>'matching')::int,3,'all lines match the ledger');
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->'summary'->>'tax_unreported')::int,3,'verification counts unreported tax');

-- Funnel: complete coverage is not enough while tax is unreported.
select api.record_marketing_spend('coverage',jsonb_build_object('platform',p,'date_from','2026-08-01','date_to','2026-08-31','reason','Synthetic statements checked, including zero days','complete',true),gen_random_uuid())
  from unnest(array['tiktok','meta','google_ads','shared']) p;
reset role;
insert into sales.purchases(id,workspace_id,contact_id,purchased_at,amount,financial_state,external_ref) values
('ffffffff-2300-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',null,'2026-08-15T03:00:00Z',1000,'confirmed','SYNTH-BATCH-SALE');
insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,net_delta,tax_delta,reason,actor_id) values
('11111111-1111-1111-1111-111111111111','ffffffff-2300-0000-0000-000000000001','confirmed','2026-08-15T03:00:00Z',1000,0,'Synthetic confirmation','aaaaaaaa-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'spend_complete')::boolean,true,'coverage is complete');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'spend_tax_unreported')::int,3,'dashboard reports the unreported-tax entries');
select ok(api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'summary'->>'mer' is null,'MER at the tax-inclusive basis is N/A while tax is unreported');
select ok(api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21',null,'excluding_tax')->'summary'->>'mer' is not null,'MER excluding tax is available');
select is((api.funnel_dashboard('2026-08-01','2026-08-31','2026-09-21')->'channels'->0->>'spend_tax_unreported')::int,3,'TikTok channel row flags its unreported tax');

------------------------------------------------------------------------------
-- Correction history through the popup's command.
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000007');
select throws_like($$select api.record_marketing_spend('credit',jsonb_build_object('id',e.id,'version',1,'incurred_on','2026-08-02','entry_key','synthetic-credit','vendor','TikTok','description','Synthetic credit','reference','SYNTH-CREDIT','before_tax',1,'tax',0,'currency','MYR','reason','Synthetic credit check'),gen_random_uuid())
  from api.spend_entries e where e.import_batch_id=(select id from ids where name='batch-a') and e.incurred_on='2026-08-02'$$,
  'State the original cost''s tax before recording a credit against it','a credit cannot be measured against an unreported tax');
select throws_like($$select api.record_marketing_spend('save','{"incurred_on":"2026-08-20","platform":"tiktok","category":"platform_ads","entry_mode":"daily_total","vendor":"TikTok","description":"Synthetic","reference":"SYNTH-X","before_tax":5,"tax":0.4,"tax_status":"unreported","currency":"MYR"}',gen_random_uuid())$$,
  'Enter a valid incurred date%','an amount cannot be both stated and unreported');
select lives_ok($$select api.record_marketing_spend('save','{"incurred_on":"2026-08-21","platform":"tiktok","category":"platform_ads","entry_mode":"daily_total","vendor":"TikTok","description":"Synthetic manual total","reference":"SYNTH-MANUAL","before_tax":5,"tax_status":"unreported","currency":"MYR"}',gen_random_uuid())$$,
  'the popup can also record an explicitly unreported tax');
-- State the tax once the invoice arrives: amount unchanged, version bumped.
select lives_ok($$select api.record_marketing_spend('save',jsonb_build_object('id',e.id,'version',e.version,'incurred_on',e.incurred_on,'platform','tiktok','category','platform_ads','entry_mode','daily_total',
  'vendor',e.vendor,'description',e.description,'reference',e.reference,'before_tax',e.before_tax,'tax',2.42,'currency','MYR','reason','Synthetic invoice states the tax'),gen_random_uuid())
  from api.spend_entries e where e.import_batch_id=(select id from ids where name='batch-a') and e.incurred_on='2026-08-01'$$,'reviewer states the tax on an imported entry');
select is((select tax_status from api.spend_entries where import_batch_id=(select id from ids where name='batch-a') and incurred_on='2026-08-01'),'stated','tax is now stated');
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->'summary'->>'edited')::int,1,'verification shows the edited line');
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->>'reconciled')::boolean,true,'stating tax keeps the imported amount reconciled');
-- Correct the amount itself: the batch no longer reconciles, and says which line.
select lives_ok($$select api.record_marketing_spend('save',jsonb_build_object('id',e.id,'version',e.version,'incurred_on',e.incurred_on,'platform','tiktok','category','platform_ads','entry_mode','daily_total',
  'vendor',e.vendor,'description',e.description,'reference',e.reference,'before_tax',6,'tax_status','unreported','currency','MYR','reason','Synthetic late spend adjustment'),gen_random_uuid())
  from api.spend_entries e where e.import_batch_id=(select id from ids where name='batch-a') and e.incurred_on='2026-08-02'$$,'reviewer corrects an imported amount');
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->'lines'->1->>'state'),'corrected','verification flags the corrected line');
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->>'reconciled')::boolean,false,'a corrected amount no longer reconciles with the source');
select is((select imported_before_tax from (select (x->>'imported_before_tax')::numeric imported_before_tax from jsonb_array_elements(api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->'lines') x
  where x->>'incurred_on'='2026-08-02') s),5.00::numeric,'the imported line keeps what the source said');
reset role;
select is((select (before_data->>'before_tax')::numeric from audit.audit_events a join marketing.spend_entries e on e.id=a.object_id
  where a.action='marketing.spend.save' and e.incurred_on='2026-08-02' and e.import_batch_id is not null and a.before_data is not null),5.00::numeric,'audit keeps the pre-correction amount');
set local role authenticated;

------------------------------------------------------------------------------
-- Voiding a batch, then importing the corrected file again.
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-2300-0000-0000-000000000001');
select throws_ok($$select api.void_marketing_spend_batch((select id from ids where name='batch-a'),'Synthetic wrong export',gen_random_uuid())$$,'42501','Permission denied: marketing.spend.review','analyst cannot void a batch');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000007');
select throws_ok($$select api.void_marketing_spend_batch((select id from ids where name='batch-a'),'no',gen_random_uuid())$$,'23514','Explain why the batch is being voided','void needs a reason');
select lives_ok($$select api.void_marketing_spend_batch((select id from ids where name='batch-a'),'Synthetic wrong export',gen_random_uuid())$$,'reviewer voids the batch');
select is((select count(*) from api.spend_entries where import_batch_id=(select id from ids where name='batch-a') and status='recorded'),0::bigint,'every batch entry is voided, corrected ones included');
select is((select status from api.spend_import_batches where id=(select id from ids where name='batch-a')),'voided','batch is marked voided');
select is((api.verify_marketing_spend_batch((select id from ids where name='batch-a'))->>'reconciled')::boolean,false,'a voided batch does not reconcile');
select lives_ok($$select api.import_marketing_spend_batch(pg_temp.batch('a',pg_temp.three_days()),gen_random_uuid())$$,'after voiding, the same file can be imported again');
select is((select count(*) from api.spend_import_batches where source_sha256=repeat('a',64)),2::bigint,'both batches of the file stay on record');

------------------------------------------------------------------------------
-- Workspace isolation and grants.
------------------------------------------------------------------------------
reset role;
insert into core.workspaces(id,slug,name) values('99999999-2300-0000-0000-000000000099','f23-isolation','Synthetic foreign workspace');
insert into marketing.spend_import_batches(id,workspace_id,request_id,source_format,parser_version,source_name,source_sha256,source_row_count,campaign_count,report_date_from,report_date_to,
  currency,currency_basis,tax_status,platform,entry_mode,category,vendor,entry_count,total_before_tax,excluded_zero_dates,status,imported_by)
values('99999999-2300-0000-0000-0000000000b1','99999999-2300-0000-0000-000000000099',gen_random_uuid(),'tiktok_trend_report','tiktok-trend/1','foreign.csv',repeat('f',64),1,1,
  '2026-08-01','2026-08-01','MYR','report_stated','unreported','tiktok','daily_total','platform_ads','TikTok',1,1,'{}','imported','aaaaaaaa-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*) from api.spend_import_batches where workspace_id='99999999-2300-0000-0000-000000000099'),0::bigint,'other workspace batches hidden');
select throws_ok($$select api.verify_marketing_spend_batch('99999999-2300-0000-0000-0000000000b1')$$,'42501','Import batch not found','cannot verify another workspace batch');
select ok(api.preview_marketing_spend_batch(pg_temp.batch('f',pg_temp.three_days()))->'duplicate_batch' = 'null'::jsonb,'another workspace''s import of the same file is not a duplicate here');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select is((select count(*) from api.spend_import_batches),0::bigint,'sales rep cannot see import batches');
select is((select count(*) from api.spend_import_lines),0::bigint,'sales rep cannot see import lines');
reset role;
select ok(not has_function_privilege('anon','api.import_marketing_spend_batch(jsonb,uuid)','execute'),'anonymous imports blocked');
select ok(not has_function_privilege('anon','api.preview_marketing_spend_batch(jsonb)','execute'),'anonymous previews blocked');
select ok(not has_function_privilege('authenticated','marketing.spend_batch_issues(jsonb)','execute'),'internal validator not callable');
select ok(not has_table_privilege('authenticated','marketing.spend_import_batches','insert'),'batch rows only through the import command');
-- The weekly demo reset still works after a guest has imported marketing costs.
create temp table demo_ws as select core.demo_workspace_id() id,
  (select user_id from core.memberships where workspace_id=core.demo_workspace_id() and role_key='guest' limit 1) guest;
grant select on demo_ws to authenticated;
set local role authenticated;
select pg_temp.act_as((select guest from demo_ws));
select lives_ok($$select api.import_marketing_spend_batch(pg_temp.batch('e',pg_temp.three_days()),gen_random_uuid())$$,'demo guest imports a batch in the demo workspace');
select lives_ok($$select api.record_marketing_spend('coverage','{"platform":"tiktok","date_from":"2026-08-01","date_to":"2026-08-31","reason":"Synthetic guest check","complete":true}',gen_random_uuid())$$,'demo guest confirms coverage');
reset role;
select lives_ok($$select core.reset_demo_workspace()$$,'weekly demo reset succeeds with marketing costs, coverage and import batches present');
select is((select count(*) from marketing.spend_entries where workspace_id=(select id from demo_ws))+(select count(*) from marketing.spend_import_batches where workspace_id=(select id from demo_ws))
  +(select count(*) from marketing.spend_coverage where workspace_id=(select id from demo_ws)),0::bigint,'the old demo workspace''s marketing-cost rows are gone');
select * from finish();
rollback;
