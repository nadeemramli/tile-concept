-- TILE-7 forecast review: Kuala Lumpur week boundaries, active-forecast
-- inclusion/exclusion, unknowns kept unknown, exception queues, append-only
-- history with corrections, a population above the old 2,000-row list limit
-- and role visibility. Synthetic records only; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(u text) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); $$;

-- Two synthetic salespeople so the counts below are isolated from seed data.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
select '00000000-0000-0000-0000-000000000000',u::uuid,'authenticated','authenticated',e,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false
from (values('dddddddd-0700-0000-0000-000000000001','synthetic.forecast.rep@tileconcept.test'),('dddddddd-0700-0000-0000-000000000002','synthetic.forecast.scale@tileconcept.test')) v(u,e);
insert into core.memberships(workspace_id,user_id,role_key) values
('11111111-1111-1111-1111-111111111111','dddddddd-0700-0000-0000-000000000001','sales_rep'),
('11111111-1111-1111-1111-111111111111','dddddddd-0700-0000-0000-000000000002','sales_rep');
insert into identity.accounts(id,workspace_id,name) values('aaaaaaaa-0700-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic forecast company');

-- Fixture week: Monday 2 Nov 2026 to Sunday 8 Nov 2026 (Kuala Lumpur).
insert into sales.opportunities(id,workspace_id,name,account_id,owner_id,stage_key,status,expected_close_date,probability_band,estimated_value,currency,next_action,next_action_due_at,created_at,archived_at) values
('eeeeeeee-0700-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic old pursuit closing this week','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','quote_sent','open','2026-11-06','high',1000,'MYR','Call',now()+interval '1 day','2025-01-15',null),
('eeeeeeee-0700-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Synthetic Sunday close, value unknown','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','negotiation','open','2026-11-08','medium',null,'MYR','Call',now()+interval '1 day',now(),null),
('eeeeeeee-0700-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Synthetic next Monday close','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','quote_sent','open','2026-11-09','high',700,'MYR','Call',now()+interval '1 day','2026-10-01',null),
('eeeeeeee-0700-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Synthetic won pursuit','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','won','won','2026-11-04','high',900,'MYR',null,null,now(),null),
('eeeeeeee-0700-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Synthetic lost pursuit','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','lost','lost','2026-11-04','high',900,'MYR',null,null,now(),null),
('eeeeeeee-0700-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Synthetic deferred pursuit','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','deferred','deferred','2026-11-04','high',900,'MYR',null,null,now(),null),
('eeeeeeee-0700-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','Synthetic archived pursuit','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','quote_sent','open','2026-11-04','high',900,'MYR','Call',now()+interval '1 day',now(),now()),
('eeeeeeee-0700-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','Synthetic foreign currency close','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','quote_sent','open','2026-11-03','low',500,'USD','Call',now()+interval '1 day',now(),null),
('eeeeeeee-0700-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','Synthetic unforecast legacy pursuit','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','qualified','open',null,null,null,'MYR','Call',now()+interval '1 day','2025-03-01',null),
('eeeeeeee-0700-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','Synthetic passed close date','aaaaaaaa-0700-0000-0000-000000000001','dddddddd-0700-0000-0000-000000000001','quote_sent','open','2026-10-20','medium',300,'MYR','Call',now()+interval '1 day',now(),null);

create temp table wk as select api.forecast_week(p_week_start=>'2026-11-02',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z') j limit 0;
grant all on wk to authenticated;
create temp table memo(k text primary key, t timestamptz, v jsonb); grant all on memo to authenticated;

set local role authenticated;
select pg_temp.act_as('dddddddd-0700-0000-0000-000000000001');

-- Week boundaries in Asia/Kuala_Lumpur.
select is((select week_start from api.forecast_window(p_as_of=>'2026-11-01T15:59:59Z')),'2026-10-26'::date,'Sunday 23:59:59 local time is still the previous week');
select is((select week_start from api.forecast_window(p_as_of=>'2026-11-01T16:00:00Z')),'2026-11-02'::date,'Monday 00:00 local time (Sunday 16:00 UTC) starts the new week');
select is((select week_end from api.forecast_window(p_week_start=>'2026-11-02')),'2026-11-08'::date,'week ends on Sunday');
select is((select week_end_at from api.forecast_window(p_week_start=>'2026-11-02')),'2026-11-08T16:00:00Z'::timestamptz,'week ends at Monday 00:00 local time');
select throws_ok($$select api.forecast_week(p_week_start=>'2026-11-03')$$,'23514','Choose a week that starts on a Monday (Asia/Kuala_Lumpur)','non-Monday week refused');
select throws_ok($$select api.forecast_week(p_mode=>'weighted')$$,'23514','Forecast mode must be current or recorded','unknown mode refused');

insert into wk select api.forecast_week(p_week_start=>'2026-11-02',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z');
select is((select (j->>'week_count')::int from wk),3,'three active pursuits expected to close in the selected week');
select ok(exists(select 1 from api.forecast_queue('week','2026-11-02','current','dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z') where id='eeeeeeee-0700-0000-0000-000000000001'),'a pursuit created long ago appears when it is expected to close this week');
select ok(exists(select 1 from api.forecast_queue('week','2026-11-02','current','dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z') where id='eeeeeeee-0700-0000-0000-000000000002'),'Sunday close is inside the week');
select ok(not exists(select 1 from api.forecast_queue('week','2026-11-02','current','dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z') where id='eeeeeeee-0700-0000-0000-000000000003'),'next Monday close is outside the week');
select ok(not exists(select 1 from api.forecast_queue('week','2026-11-02','current','dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z')
  where id in ('eeeeeeee-0700-0000-0000-000000000004','eeeeeeee-0700-0000-0000-000000000005','eeeeeeee-0700-0000-0000-000000000006','eeeeeeee-0700-0000-0000-000000000007')),'won, lost, deferred and archived work is not in the active forecast');
select is((select j->'excluded' from wk),'{"won":1,"lost":1,"deferred":1,"archived":1}'::jsonb,'excluded work is counted separately, by reason');
select is((select j->'bands' from wk),
  '[{"band":"high","count":1,"value":1000.00,"currency":"MYR","value_unknown":0},{"band":"medium","count":1,"value":null,"currency":"MYR","value_unknown":1},{"band":"low","count":1,"value":500.00,"currency":"USD","value_unknown":0}]'::jsonb,
  'bands carry unweighted sums per currency, and an unknown value is counted, not summed as zero');
select ok(not (select j::text ~* 'weight|probab' from wk),'no probability weight or weighted value is produced');
select is((select j->'confirmed_sales' from wk),'[]'::jsonb,'forecast bands are not confirmed sales');
select is((select j->'queues' from wk),'{"missing_band":1,"missing_date":1,"overdue_date":1,"stale_review":0,"missing_value":2,"never_reviewed":6}'::jsonb,'exception queues count the whole active scope');
select is((select j->'next_four_weeks'->3 from wk),'{"band":"high","count":1,"value":700.00,"currency":"MYR","week_start":"2026-11-09","value_unknown":0}'::jsonb,'next-four-weeks alternative is a separate, dated breakdown');
select ok(exists(select 1 from api.forecast_queue('overdue_date',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z') where id='eeeeeeee-0700-0000-0000-000000000010' and expected_close_date='2026-10-20'),'passed close date is queued with its original date');
select ok(exists(select 1 from api.forecast_queue('missing_date',p_owner_id=>'dddddddd-0700-0000-0000-000000000001') where id='eeeeeeee-0700-0000-0000-000000000009' and probability_band is null and estimated_value is null),'unforecast legacy work is queued, not dropped or filled in');
select is((select expected_close_date from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000010'),'2026-10-20'::date,'reading the forecast never rolls a date forward');
select throws_ok($$select * from api.forecast_queue('everything')$$,'23514','Unknown forecast list','unknown list refused');
select throws_ok($$select * from api.forecast_queue('week',p_limit=>500)$$,'23514','Page must be 1 to 200 rows from a non-negative offset','page size is bounded');

-- No stage requires a forecast: unforecast work can reach a quotation stage and be quoted.
select lives_ok($$select api.change_opportunity_stage('eeeeeeee-0700-0000-0000-000000000009','quote_sent','Quotation sent to customer','Follow up quotation',now()+interval '2 days')$$,'a quotation stage can be entered without a forecast');
select lives_ok($$insert into api.quotes(workspace_id,opportunity_id,quote_number,status) values('11111111-1111-1111-1111-111111111111','eeeeeeee-0700-0000-0000-000000000009','SYNTHETIC-FORECAST-QUOTE','issued')$$,'a sent quotation is recorded without a forecast');
select ok(exists(select 1 from api.forecast_queue('missing_date',p_owner_id=>'dddddddd-0700-0000-0000-000000000001') where id='eeeeeeee-0700-0000-0000-000000000009' and stage_key='quote_sent'),'quoted but unforecast work stays in the review queue');

-- Review: date, likelihood, value, evidence and next step, with actor and time.
insert into memo(k,v) select 'version',to_jsonb(version) from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009';
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select v from memo where k='version'),'expected_close_date','2026-01-05'),gen_random_uuid())$$,
  '23514','Expected close date has passed. Choose a new date or leave it unknown.','a passed date cannot be stated');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select v from memo where k='version'),'probability_band','certain'),gen_random_uuid())$$,
  '23514','Likelihood must be low, medium, high or unknown','likelihood must be a defined band');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select v from memo where k='version'),'next_action',''),gen_random_uuid())$$,
  '23514','Enter a next action and due date','a review cannot clear the next step');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',1),gen_random_uuid())$$,
  '40001','Opportunity changed. Refresh and try again.','stale review cannot overwrite');
select lives_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select v from memo where k='version'),
  'expected_close_date',(now() at time zone 'Asia/Kuala_Lumpur')::date+400,'probability_band','medium','estimated_value',2500,'currency','MYR',
  'evidence','Synthetic: customer confirmed budget at site visit','next_action','Confirm delivery window','next_action_due_at',now()+interval '3 days'),'dddddddd-0700-0000-0000-00000000aa01')$$,'owner reviews the forecast');
select is((select row(expected_close_date,probability_band,estimated_value,forecast_evidence,next_action)::text from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009'),
  row((now() at time zone 'Asia/Kuala_Lumpur')::date+400,'medium',2500.00::numeric(14,2),'Synthetic: customer confirmed budget at site visit','Confirm delivery window')::text,'reviewed fields persist');
select is((select forecast_reviewed_by from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009'),'dddddddd-0700-0000-0000-000000000001'::uuid,'review actor persists');
select ok((select forecast_reviewed_at is not null from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009'),'review time persists');
select is((select row(kind,review_context,actor_id)::text from api.opportunity_forecast_history where opportunity_id='eeeeeeee-0700-0000-0000-000000000009' order by recorded_at desc,seq desc limit 1),
  row('review','review','dddddddd-0700-0000-0000-000000000001'::uuid)::text,'review is recorded in history');
select is((select count(*) from api.activities where opportunity_id='eeeeeeee-0700-0000-0000-000000000009' and subject='Forecast reviewed'),1::bigint,'review appears on the timeline');
select is((api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select v from memo where k='version'),
  'expected_close_date',(now() at time zone 'Asia/Kuala_Lumpur')::date+400,'probability_band','medium','estimated_value',2500,'currency','MYR',
  'evidence','Synthetic: customer confirmed budget at site visit','next_action','Confirm delivery window','next_action_due_at',now()+interval '3 days'),'dddddddd-0700-0000-0000-00000000aa01')->>'opportunity_id')::uuid,
  'eeeeeeee-0700-0000-0000-000000000009'::uuid,'a retried review is idempotent');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select v from memo where k='version'),'probability_band','high'),'dddddddd-0700-0000-0000-00000000aa01')$$,
  '23514','Retry differs from original command','a changed retry is refused');
select is((select count(*) from api.opportunity_forecast_history where opportunity_id='eeeeeeee-0700-0000-0000-000000000009' and kind='review'),1::bigint,'a retry does not add history');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000004',jsonb_build_object('version',(select version from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000004')),gen_random_uuid())$$,
  '23514','Only open opportunities carry a forecast','closed work is not forecast');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000007',jsonb_build_object('version',(select version from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000007')),gen_random_uuid())$$,
  '23514','Restore the opportunity before changing it','archived work is not forecast');

-- Correction and reload: the current view changes, what was recorded earlier does not.
insert into memo(k,t) values('before_correction',clock_timestamp());
select lives_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select version from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009'),
  'probability_band','high','evidence','Synthetic correction: purchase order expected'),gen_random_uuid())$$,'a forecast can be corrected');
select is((select probability_band from api.forecast_rows('current',null,'dddddddd-0700-0000-0000-000000000001') where id='eeeeeeee-0700-0000-0000-000000000009'),'high','current view shows the correction');
select is((select probability_band from api.forecast_rows('recorded',(select t from memo where k='before_correction'),'dddddddd-0700-0000-0000-000000000001') where id='eeeeeeee-0700-0000-0000-000000000009'),'medium','recorded view keeps what was known before the correction');
select is((select estimated_value from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009'),2500.00::numeric(14,2),'fields absent from a correction are unchanged');
select lives_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000009',jsonb_build_object('version',(select version from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009'),
  'probability_band',null),gen_random_uuid())$$,'likelihood can be stated as unknown');
select is((select probability_band from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000009'),null,'unknown likelihood stays unknown');
select is((select count(*) from api.opportunity_forecast_history where opportunity_id='eeeeeeee-0700-0000-0000-000000000009' and kind='review'),3::bigint,'each review appends history');
select ok((select count(*) from api.opportunity_forecast_history where opportunity_id='eeeeeeee-0700-0000-0000-000000000009' and kind='change' and stage_key='quote_sent')>=1,'a stage change made elsewhere is captured too');
select lives_ok($$select api.opportunity_command('edit',jsonb_build_object('id',id,'version',version,'name',name,'probability_band','low','expected_close_date','2026-11-09','estimated_value',700,'next_action','Call','next_action_due_at',now()+interval '1 day','currency','MYR'),gen_random_uuid())
  from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000003'$$,'the edit dialog can still change a forecast field');
select is((select kind||':'||probability_band from api.opportunity_forecast_history where opportunity_id='eeeeeeee-0700-0000-0000-000000000003' order by recorded_at desc,seq desc limit 1),'change:low','an edit outside review is history, not a review');
select is((select forecast_reviewed_at from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000003'),null,'an edit does not mark the forecast reviewed');

-- Recorded week: rebuilt from history at the end of the week.
reset role;
insert into sales.opportunity_forecast_history(workspace_id,opportunity_id,recorded_at,kind,status,stage_key,archived,owner_id,expected_close_date,probability_band,estimated_value,currency)
values('11111111-1111-1111-1111-111111111111','eeeeeeee-0700-0000-0000-000000000003','2026-10-20T02:00:00Z','change','open','quote_sent',false,'dddddddd-0700-0000-0000-000000000001','2026-10-22','high',700,'MYR'),
      ('11111111-1111-1111-1111-111111111111','eeeeeeee-0700-0000-0000-000000000003','2026-10-25T15:59:00Z','change','open','quote_sent',false,'dddddddd-0700-0000-0000-000000000001','2026-10-23','medium',650,'MYR');
select throws_ok($$update sales.opportunity_forecast_history set probability_band='high' where opportunity_id='eeeeeeee-0700-0000-0000-000000000003'$$,'42501','Forecast history is append-only; record a new review instead','history cannot be edited');
select throws_ok($$delete from sales.opportunity_forecast_history where opportunity_id='eeeeeeee-0700-0000-0000-000000000003'$$,'42501','Forecast history is append-only; record a new review instead','history cannot be deleted while the opportunity exists');
-- A stale review: reviewed three weeks before the fixture instant.
update sales.opportunities set forecast_reviewed_at='2026-10-12T02:00:00Z',forecast_reviewed_by='dddddddd-0700-0000-0000-000000000001' where id='eeeeeeee-0700-0000-0000-000000000008';
set local role authenticated;
select pg_temp.act_as('dddddddd-0700-0000-0000-000000000001');
select is((select (api.forecast_week('2026-10-19','recorded','dddddddd-0700-0000-0000-000000000001')->>'week_count')::int),1,'recorded week rebuilds the forecast at week end');
select is((select probability_band||':'||estimated_value from api.forecast_queue('week','2026-10-19','recorded','dddddddd-0700-0000-0000-000000000001')),'medium:650.00','recorded week shows the last state before week end, Sunday 23:59 local');
select is((select (api.forecast_week('2026-10-19','recorded','dddddddd-0700-0000-0000-000000000001')->>'not_recorded')::int),2,'pursuits with no history then are reported as not recorded');
select is((select count(*) from api.forecast_queue('not_recorded','2026-10-19','recorded','dddddddd-0700-0000-0000-000000000001') where recorded),0::bigint,'not-recorded rows carry no invented state');
select is((select string_agg(id::text,',') from api.forecast_queue('week','2026-10-19','current','dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-10-20T00:00:00Z')),'eeeeeeee-0700-0000-0000-000000000010','current view applies today''s state to any selected week');
select is((select count(*) from api.forecast_queue('stale_review',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_stale_days=>14,p_as_of=>'2026-11-02T01:00:00Z')),1::bigint,'a review older than the threshold is stale');
select is((select count(*) from api.forecast_queue('stale_review',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_stale_days=>30,p_as_of=>'2026-11-02T01:00:00Z')),0::bigint,'the stale threshold is a stated parameter');

-- Confirmed sales are reported beside the forecast, never inside it.
reset role;
insert into sales.purchases(id,workspace_id,account_id,amount,currency,salesperson_id,status,financial_state,purchased_at,net_sale_amount,confirmed_at)
values('eeeeeeee-0700-0000-0000-0000000000f1','11111111-1111-1111-1111-111111111111','aaaaaaaa-0700-0000-0000-000000000001',770,'MYR','dddddddd-0700-0000-0000-000000000001','recorded','confirmed','2026-11-03T02:00:00Z',700,'2026-11-03T02:00:00Z');
insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,net_delta,tax_delta,reason,actor_id)
values('11111111-1111-1111-1111-111111111111','eeeeeeee-0700-0000-0000-0000000000f1','confirmed','2026-11-03T02:00:00Z',700,70,'Synthetic documented sale','dddddddd-0700-0000-0000-000000000001');
set local role authenticated;
select pg_temp.act_as('dddddddd-0700-0000-0000-000000000001');
select is(api.forecast_week('2026-11-02',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-05T01:00:00Z')->'confirmed_sales','[{"net":700.00,"events":1,"currency":"MYR"}]'::jsonb,'confirmed net sales are listed separately');
select is(api.forecast_week('2026-11-02',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-05T01:00:00Z')->'bands'->0->'value','1000.00'::jsonb,'a confirmed sale does not change forecast values');

-- More than 2,000 opportunities: counts and pages cover the whole scope.
reset role;
insert into sales.opportunities(workspace_id,name,owner_id,stage_key,status,expected_close_date,probability_band,estimated_value,currency,next_action,next_action_due_at)
select '11111111-1111-1111-1111-111111111111','Synthetic scale pursuit '||g,'dddddddd-0700-0000-0000-000000000002','quote_sent','open','2026-11-02'::date+(g%7),
  (array['low','medium','high',null])[1+g%4],case when g%5=0 then null else 10 end,'MYR','Call',now()+interval '1 day'
from generate_series(1,2105) g;
set local role authenticated;
select pg_temp.act_as('dddddddd-0700-0000-0000-000000000001');
insert into memo(k,v) select 'scale',api.forecast_week('2026-11-02',p_owner_id=>'dddddddd-0700-0000-0000-000000000002',p_as_of=>'2026-11-02T01:00:00Z');
select is((select (v->>'week_count')::int from memo where k='scale'),2105,'every one of 2,105 pursuits is counted');
select is((select sum((b->>'count')::int) from memo, jsonb_array_elements(v->'bands') b where k='scale'),2105::bigint,'band counts add up to the whole week');
select is((select (b->>'count')::int from memo, jsonb_array_elements(v->'bands') b where k='scale' and b->>'band'='unknown'),526,'pursuits without a band are shown as unknown, not spread over bands');
select is((select sum((b->>'value')::numeric) from memo, jsonb_array_elements(v->'bands') b where k='scale'),16840::numeric,'value is the plain sum of known values');
select is((select sum((b->>'value_unknown')::int) from memo, jsonb_array_elements(v->'bands') b where k='scale'),421::bigint,'unknown values are counted');
select is((select count(*) from api.forecast_queue('week','2026-11-02','current','dddddddd-0700-0000-0000-000000000002',p_limit=>200,p_offset=>2000,p_as_of=>'2026-11-02T01:00:00Z')),105::bigint,'the last page reaches row 2,105');
select is((select distinct total_count from api.forecast_queue('week','2026-11-02','current','dddddddd-0700-0000-0000-000000000002',p_limit=>200,p_as_of=>'2026-11-02T01:00:00Z')),2105::bigint,'each page reports the complete total');
select is((select count(distinct q.id) from generate_series(0,2100,200) pg(off) cross join lateral api.forecast_queue('week','2026-11-02','current','dddddddd-0700-0000-0000-000000000002',p_limit=>200,p_offset=>pg.off,p_as_of=>'2026-11-02T01:00:00Z') q),2105::bigint,'paging is stable and complete');
select is((select (v->'queues'->>'missing_band')::int from memo where k='scale'),526,'queue counts cover the whole scope');

-- Role visibility.
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
select is((select (api.forecast_week('2026-11-02',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z')->>'week_count')::int),0,'showroom staff without sales.read_all do not see another salesperson''s forecast');
select is((select count(*) from api.opportunity_forecast_history where opportunity_id='eeeeeeee-0700-0000-0000-000000000001'),0::bigint,'or its history');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000002','{"version":1}',gen_random_uuid())$$,
  '42501','Only the owner or a sales manager can review this forecast','showroom staff cannot review another salesperson''s forecast');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');
select throws_ok($$select api.forecast_week()$$,'42501','permission denied: sales.read','roles without sales.read cannot open the forecast');
select throws_ok($$select * from api.forecast_queue('week')$$,'42501','permission denied: sales.read','or its queues');
select throws_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000002','{"version":1}',gen_random_uuid())$$,'42501','permission denied: sales.write','or review it');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select is((select (api.forecast_week('2026-11-02',p_owner_id=>'dddddddd-0700-0000-0000-000000000001',p_as_of=>'2026-11-02T01:00:00Z')->>'week_count')::int),3,'a sales manager sees the salesperson''s forecast');
select lives_ok($$select api.review_opportunity_forecast('eeeeeeee-0700-0000-0000-000000000002',jsonb_build_object('version',(select version from api.opportunities where id='eeeeeeee-0700-0000-0000-000000000002'),'estimated_value',1200),gen_random_uuid())$$,'a sales manager can review it');
select throws_ok($$update api.opportunities set probability_band='high' where id='eeeeeeee-0700-0000-0000-000000000002'$$,'42501',null,'forecast fields cannot be written around the command');
select throws_ok($$insert into api.opportunity_forecast_history(workspace_id,opportunity_id,kind,status,stage_key,archived,currency) values('11111111-1111-1111-1111-111111111111','eeeeeeee-0700-0000-0000-000000000002','review','open','new',false,'MYR')$$,'42501',null,'history cannot be written directly');
reset role;
select ok(not has_function_privilege('anon','api.forecast_week(date,text,uuid,integer,timestamptz)','execute'),'anonymous callers cannot read the forecast');
select ok(not has_function_privilege('anon','api.review_opportunity_forecast(uuid,jsonb,uuid)','execute'),'anonymous callers cannot review');

-- Deleting a workspace still cascades through append-only history.
insert into core.workspaces(id,slug,name) values('99999999-0700-0000-0000-000000000001','synthetic-forecast-cascade','Synthetic cascade workspace');
insert into sales.opportunities(workspace_id,name,stage_key) values('99999999-0700-0000-0000-000000000001','Synthetic cascade pursuit','new');
select lives_ok($$delete from core.workspaces where id='99999999-0700-0000-0000-000000000001'$$,'workspace deletion cascades through forecast history');
select lives_ok($$delete from sales.opportunities where id='eeeeeeee-0700-0000-0000-000000000005'$$,'an opportunity delete removes its history');

select * from finish();
rollback;
