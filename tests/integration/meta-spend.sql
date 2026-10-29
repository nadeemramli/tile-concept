-- LOCAL ONLY. All fixtures and schema changes roll back. Never reset the local DB.
\set ON_ERROR_STOP on
begin;
select not exists(select 1 from information_schema.columns where table_schema='marketing' and table_name='spend_entries' and column_name='tax_status') as needs_tax \gset
\if :needs_tax
\ir ../../supabase/migrations/20261004000002_marketing_spend_batch_import.sql
\endif
select to_regclass('sales.lead_routing_assignments') is null as needs_routing \gset
\if :needs_routing
\ir ../../supabase/migrations/20261015200520_configurable_lead_routing_telegram.sql
\endif
\ir ../../supabase/migrations/20261029115537_meta_reporting_and_sync.sql
\ir ../../supabase/migrations/20261029115538_meta_daily_sync.sql
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare ws uuid:='11111111-1111-1111-1111-111111111111'; actor uuid:='aaaaaaaa-0000-0000-0000-000000000001';
 d date:='2020-01-05'; result jsonb; eid uuid; denied boolean;
begin
 insert into marketing.spend_entries(workspace_id,incurred_on,platform,category,entry_mode,entry_key,vendor,description,reference,before_tax,tax,currency,created_by)
 values(ws,d,'meta','platform_ads','daily_total','daily-total','Meta Platforms','Synthetic pre-existing import','META-123456789-2020-01-05',50,null,'MYR',actor) returning id into eid;
 result:=api.sync_meta_spend(ws,actor,'123456789','[{"day":"2020-01-05","amount":"50.00"},{"day":"2020-01-06","amount":"20.00"},{"day":"2020-01-07","amount":"0.00"}]');
 assert (result->>'adopted')::int=1 and (result->>'inserted')::int=1,'Adoption and initial insertion';
 result:=api.sync_meta_spend(ws,actor,'123456789','[{"day":"2020-01-05","amount":"50.00"},{"day":"2020-01-06","amount":"20.00"},{"day":"2020-01-07","amount":"0.00"}]');
 assert (result->>'inserted')::int=0 and (result->>'changed')::int=0,'Retry must be idempotent';
 assert (select count(*) from marketing.spend_entries where workspace_id=ws and incurred_on between d and d+2)=2,'No duplicate or fake zero ledger entries';
 result:=api.sync_meta_spend(ws,actor,'123456789','[{"day":"2020-01-05","amount":"51.25"}]');
 assert (result->>'changed')::int=1 and (select before_tax=51.25 and tax is null from marketing.spend_entries where id=eid),'Restatement preserves unknown tax';
 update marketing.spend_entries set before_tax=60,version=version+1 where id=eid;
 denied:=false;
 begin perform api.sync_meta_spend(ws,actor,'123456789','[{"day":"2020-01-05","amount":"52.00"}]');exception when check_violation then denied:=true;end;
 assert denied,'Manual changes must stop the sync';
 denied:=false;
 begin perform api.sync_meta_spend(gen_random_uuid(),actor,'123456789','[{"day":"2020-01-05","amount":"52.00"}]');exception when insufficient_privilege then denied:=true;end;
 assert denied,'Cross-workspace actor must be rejected';
 denied:=false;
 begin perform api.sync_meta_spend(ws,actor,'123456789','[{"day":"2020-01-08","amount":"1"},{"day":"2020-01-08","amount":"1"}]');exception when check_violation then denied:=true;end;
 assert denied,'Duplicate source dates must be rejected';
end $$;
do $$
declare ws uuid:='11111111-1111-1111-1111-111111111111'; actor uuid:='aaaaaaaa-0000-0000-0000-000000000001';
 lead uuid; other_lead uuid; invoice uuid; n integer;
begin
 insert into sales.leads(workspace_id,source_channel,created_at,first_response_at)
 values(ws,'meta','1999-01-01 01:00+08','1999-01-02 01:00+08') returning id into lead;
 insert into sales.leads(workspace_id,source_channel,created_at,first_customer_reply_at)
 values(ws,'meta','1999-01-01 02:00+08','1999-02-01 00:00+08') returning id into other_lead;
 for n in 1..3 loop
 insert into sales.purchases(workspace_id,lead_id,purchased_at,amount,document_type,financial_state)
 values(ws,lead,'1999-01-03 01:00+08',100,case when n=3 then 'receipt' else 'invoice' end,'confirmed') returning id into invoice;
 insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,net_delta,reason,actor_id)
 values(ws,invoice,'confirmed','1999-01-03 01:00+08',100,'Synthetic fixture',actor);
 end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare result jsonb; denied boolean:=false; begin
 result:=api.marketing_journey('2020-01-01','2020-01-31','2020-01-31');
 assert jsonb_typeof(result->'groups')='array' and jsonb_array_length(result->'days')=31,'Report executes with scoped auth';
 result:=api.marketing_journey('1999-01-01','1999-01-31','1999-01-31');
 assert (result->'groups'->0->>'leads')::int=2,'Same creation cohort';
 assert (result->'groups'->0->>'contacted')::int=1 and (result->'groups'->0->>'replied')::int=0,'Staff contact is not customer reply; later replies excluded';
 assert (result->'groups'->0->>'invoices')::int=2 and (result->'groups'->0->>'converted_leads')::int=1 and (result->'groups'->0->>'invoice_value')::numeric=200,'Two invoices are one converted lead; receipt excluded';
 begin perform api.sync_meta_spend('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','123456789','[]');exception when insufficient_privilege then denied:=true;end;
 assert denied,'Staff JWT cannot call service-only sync';
end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false; begin
 begin perform api.marketing_journey('2020-01-01','2020-01-31','2020-01-31');exception when insufficient_privilege then denied:=true;end;
 assert denied,'Anonymous report access denied';
end $$;
reset role;
select 'adoption, idempotency, restatement, manual conflict, workspace isolation, auth and report tests passed' as result;
rollback;
