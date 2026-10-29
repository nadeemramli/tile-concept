-- TILE-8: structured pursuit outcomes. Synthetic fixtures only; rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
$$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;
create function pg_temp.cmd(action text, input jsonb, req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select api.pursuit_outcome_command(action, input, req) $$;
create function pg_temp.lose(extra jsonb) returns jsonb language sql as $$
  select pg_temp.cmd('lose', jsonb_build_object('effective_date', pg_temp.today()) || extra) $$;

insert into core.workspaces(id,slug,name) values ('99999999-2910-0024-0000-000000000001','outcome-isolation','Synthetic outcome isolation workspace');
insert into identity.contacts(id,workspace_id,display_name) values
  ('bbbbbbbb-2910-0024-0000-000000000001','11111111-1111-1111-1111-111111111111','Synthetic outcome contact');
insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id,contact_id,created_at) values
  ('cccccccc-2910-0024-0000-00000000000a','11111111-1111-1111-1111-111111111111','new','tiktok','Outcome fixture A','aaaaaaaa-0000-0000-0000-000000000003',null,now()-interval '3 days'),
  ('cccccccc-2910-0024-0000-00000000000b','11111111-1111-1111-1111-111111111111','converted','meta','Outcome fixture B','aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-2910-0024-0000-000000000001',now()-interval '3 days'),
  ('cccccccc-2910-0024-0000-00000000000d','11111111-1111-1111-1111-111111111111','contact_attempted','tiktok','Outcome fixture D','aaaaaaaa-0000-0000-0000-000000000003',null,now()-interval '3 days'),
  ('cccccccc-2910-0024-0000-00000000000e','11111111-1111-1111-1111-111111111111','new','website','Outcome fixture E','aaaaaaaa-0000-0000-0000-000000000003',null,now()-interval '3 days'),
  ('cccccccc-2910-0024-0000-00000000000f','11111111-1111-1111-1111-111111111111','contacted','whatsapp','Outcome fixture F','aaaaaaaa-0000-0000-0000-000000000003',null,now()-interval '3 days'),
  ('cccccccc-2910-0024-0000-000000000010','11111111-1111-1111-1111-111111111111','new','website','Outcome fixture duplicate','aaaaaaaa-0000-0000-0000-000000000003',null,now()-interval '3 days'),
  ('cccccccc-2910-0024-0000-000000000011','11111111-1111-1111-1111-111111111111','converted','meta','Outcome fixture with opportunity','aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-2910-0024-0000-000000000001',now()-interval '3 days'),
  ('cccccccc-2910-0024-0000-000000000099','99999999-2910-0024-0000-000000000001','new','other','Synthetic foreign outcome inquiry',null,null,now()-interval '3 days');
insert into sales.opportunities(id,workspace_id,name,contact_id,lead_id,owner_id,stage_key,status,estimated_value,next_action,next_action_due_at) values
  ('eeeeeeee-2910-0024-0000-00000000000b','11111111-1111-1111-1111-111111111111','Synthetic linked opportunity','bbbbbbbb-2910-0024-0000-000000000001','cccccccc-2910-0024-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000003','quote_sent','open',25000,'Chase decision',now()+interval '1 day'),
  ('eeeeeeee-2910-0024-0000-00000000000c','11111111-1111-1111-1111-111111111111','Synthetic standalone opportunity','bbbbbbbb-2910-0024-0000-000000000001',null,'aaaaaaaa-0000-0000-0000-000000000003','consultation','open',8000,'Send options',now()+interval '1 day'),
  ('eeeeeeee-2910-0024-0000-000000000011','11111111-1111-1111-1111-111111111111','Synthetic active opportunity','bbbbbbbb-2910-0024-0000-000000000001','cccccccc-2910-0024-0000-000000000011','aaaaaaaa-0000-0000-0000-000000000003','consultation','open',null,'Visit site',now()+interval '1 day'),
  ('eeeeeeee-2910-0024-0000-0000000000d4','11111111-1111-1111-1111-111111111111','Synthetic teammate opportunity','bbbbbbbb-2910-0024-0000-000000000001',null,'aaaaaaaa-0000-0000-0000-000000000004','consultation','open',null,'Visit site',now()+interval '1 day'),
  ('eeeeeeee-2910-0024-0000-000000000099','99999999-2910-0024-0000-000000000001','Synthetic foreign opportunity',null,null,null,'new','open',null,'Visit site',now()+interval '1 day');
update sales.leads set converted_opportunity_id = 'eeeeeeee-2910-0024-0000-00000000000b' where id = 'cccccccc-2910-0024-0000-00000000000b';
insert into sales.quotes(id,workspace_id,opportunity_id,quote_number,status,current_version_no) values
  ('dddddddd-2910-0024-0000-00000000000b','11111111-1111-1111-1111-111111111111','eeeeeeee-2910-0024-0000-00000000000b','SYN-Q-1','revised',2);
insert into sales.quote_versions(workspace_id,quote_id,version_no,issued_at,total_amount,currency) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-2910-0024-0000-00000000000b',1,now()-interval '2 days',21000,'MYR'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-2910-0024-0000-00000000000b',2,now()-interval '1 day',19500,'MYR');
insert into sales.tasks(id,workspace_id,title,due_at,assignee_id,lead_id,opportunity_id,created_by) values
  ('ffffffff-2910-0024-0000-00000000000a','11111111-1111-1111-1111-111111111111','Synthetic follow-up A',now()+interval '1 day','aaaaaaaa-0000-0000-0000-000000000003','cccccccc-2910-0024-0000-00000000000a',null,'aaaaaaaa-0000-0000-0000-000000000003'),
  ('ffffffff-2910-0024-0000-00000000000b','11111111-1111-1111-1111-111111111111','Synthetic lead follow-up B',now()+interval '1 day','aaaaaaaa-0000-0000-0000-000000000003','cccccccc-2910-0024-0000-00000000000b',null,'aaaaaaaa-0000-0000-0000-000000000003'),
  ('ffffffff-2910-0024-0000-0000000000b2','11111111-1111-1111-1111-111111111111','Synthetic opportunity follow-up B',now()+interval '1 day','aaaaaaaa-0000-0000-0000-000000000003',null,'eeeeeeee-2910-0024-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000003');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');

-- Taxonomy: one list for SQL, inbox and pipeline (mirrored in src/lib/domain/outcome-reasons.ts).
select set_eq($$select outcome_type || ':' || key from api.outcome_reasons where is_active$$,
  array['lost:price','lost:competitor','lost:timing','lost:product_fit','lost:project_cancelled','lost:customer_unresponsive','lost:unknown','lost:other',
        'rejected:not_buying','rejected:out_of_scope','rejected:out_of_area','rejected:spam','rejected:test','rejected:duplicate','rejected:unknown','rejected:other',
        'deferred:timing','deferred:budget_pending','deferred:awaiting_decision','deferred:unknown','deferred:other'],
  'reason picklists match the shared taxonomy');
select ok((select bool_and(requires_detail) from api.outcome_reasons where key = 'other') and (select count(*) = 3 from api.outcome_reasons where key = 'unknown' and not requires_detail),
  'Other always needs an explanation; Unknown is an explicit choice in every set');
select is((select count(*) from api.outcome_reasons where hint is null or length(hint) < 12), 0::bigint, 'every reason explains itself');

-- Criterion 1: loss requires a primary reason and an effective date.
select throws_ok($$select pg_temp.cmd('lose','{"lead_id":"cccccccc-2910-0024-0000-00000000000a","effective_date":"2026-10-01"}')$$,'23514','Choose a reason. Use Unknown when the reason is not known.','loss without a reason is refused');
select throws_ok($$select pg_temp.cmd('lose','{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"price"}')$$,'23514','Enter the date the outcome took effect','loss without an effective date is refused');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"other"}')$$,'23514','Explain the reason (at least 3 characters)','Other without an explanation is refused');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"other","reason_detail":"  "}')$$,'23514','Explain the reason (at least 3 characters)','blank explanation is not an explanation');
select throws_ok($$select pg_temp.cmd('lose',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000a','reason_code','price','effective_date',pg_temp.today()+2))$$,'23514','The effective date cannot be in the future','future effective date is refused');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"spam"}')$$,'23514','Choose a listed reason','a rejection reason is not a loss reason');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"price","competitor_name":"Synthetic Supplier"}')$$,'23514','Supplier details are only recorded when the award went to another supplier','supplier details need the competitor reason');
select is((select count(*) from api.pursuit_outcome_events where lead_id='cccccccc-2910-0024-0000-00000000000a'),0::bigint,'refused attempts leave no event');

-- The free-text paths are retired, not silently defaulted.
select throws_ok($$select api.work_inquiry('cccccccc-2910-0024-0000-00000000000a','lost',gen_random_uuid(),p_body=>'Free text loss')$$,'23514',null,'old free-text inquiry loss is refused');
select throws_ok($$update api.leads set status='disqualified' where id='cccccccc-2910-0024-0000-00000000000a'$$,'23514',null,'direct status close is refused');
select throws_ok($$select api.change_opportunity_stage('eeeeeeee-2910-0024-0000-00000000000c','lost','Price')$$,'23514',null,'stage RPC cannot close as lost without a structured outcome');
select throws_ok($$select api.change_opportunity_stage('eeeeeeee-2910-0024-0000-00000000000c','deferred','Timing',null,null,pg_temp.today()+30)$$,'23514',null,'stage RPC cannot defer without the outcome form');

-- Unknown is explicit and accepted; retry is idempotent.
select lives_ok($$select pg_temp.cmd('lose',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000a','reason_code','unknown','effective_date',pg_temp.today()-1),'dddddddd-2910-0024-0000-000000000001')$$,'loss with explicit Unknown is recorded');
select is((select status from api.leads where id='cccccccc-2910-0024-0000-00000000000a'),'disqualified','lost inquiry is closed');
select is((select status from api.tasks where id='ffffffff-2910-0024-0000-00000000000a'),'cancelled','outstanding reminder is resolved');
select ok((select outcome like 'Pursuit lost: Unknown%' from api.tasks where id='ffffffff-2910-0024-0000-00000000000a'),'resolved reminder keeps the reason');
select is((pg_temp.cmd('lose',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000a','reason_code','unknown','effective_date',pg_temp.today()-1),'dddddddd-2910-0024-0000-000000000001')->>'event_id')::uuid,
  (select id from api.pursuit_outcome_events where request_id='dddddddd-2910-0024-0000-000000000001'),'retry returns the original outcome');
select is((select count(*) from api.pursuit_outcome_events where lead_id='cccccccc-2910-0024-0000-00000000000a'),1::bigint,'retry does not record a second loss');
select throws_ok($$select pg_temp.cmd('lose','{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"price","effective_date":"2026-10-01"}','dddddddd-2910-0024-0000-000000000001')$$,'22023','Request ID already used for a different action','changed retry is refused');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"price"}')$$,'23514','This inquiry is already closed. Reopen it first.','a second close of a closed pursuit is refused');
select throws_like($$update api.tasks set status='open' where id='ffffffff-2910-0024-0000-00000000000a'$$,'%Reopen the inquiry%','Tasks cannot revive a reminder on a lost inquiry');

-- Criterion 8: reopen preserves the earlier loss; current state becomes active.
select throws_ok($$select pg_temp.cmd('reopen',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000a','next_follow_up_at',now()+interval '1 day'))$$,'23514','Record why the pursuit is reopened (at least 3 characters)','reopen needs a reason');
select throws_ok($$select pg_temp.cmd('reopen',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000a','reason_detail','Customer came back'))$$,'23514','Choose the next follow-up date and time','reopen needs a next follow-up');
select throws_ok($$select api.work_inquiry('cccccccc-2910-0024-0000-00000000000a','reopen',gen_random_uuid(),now()+interval '1 day',p_body=>'Free text reopen')$$,'23514',null,'old free-text reopen is refused');
select lives_ok($$select pg_temp.cmd('reopen',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000a','reason_detail','Customer came back','next_follow_up_at',now()+interval '1 day'))$$,'reopen with reason and follow-up');
select ok((select status='new' and disqualified_reason is null and open_follow_ups=1 from api.inbox_leads where id='cccccccc-2910-0024-0000-00000000000a'),'reopened inquiry is active again with its prior status and a reminder');
select ok((select reason_code='unknown' and reopened_at is not null and actor_id='aaaaaaaa-0000-0000-0000-000000000003' and effective_date=pg_temp.today()-1
  from api.pursuit_outcome_history where lead_id='cccccccc-2910-0024-0000-00000000000a'),'earlier loss keeps its reason, actor and effective date after reopen');
select is((select count(*) from api.pursuit_outcome_events where lead_id='cccccccc-2910-0024-0000-00000000000a'),2::bigint,'reopen appends; nothing is deleted');
select throws_ok($$select pg_temp.cmd('reopen',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000a','reason_detail','Again','next_follow_up_at',now()+interval '1 day'))$$,'23514','Nothing to reopen: this pursuit is already active','an active pursuit cannot be reopened twice');
select lives_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000a","reason_code":"other","reason_detail":"Synthetic showroom closed for renovation"}')$$,'Other with an explanation is recorded');
select ok((select disqualified_reason = 'Other (explain): Synthetic showroom closed for renovation' from api.leads where id='cccccccc-2910-0024-0000-00000000000a'),'current reason names the reason and the explanation');
select is((select count(*) from api.pursuit_outcome_history where lead_id='cccccccc-2910-0024-0000-00000000000a' and outcome_type='lost'),2::bigint,'lost, reopened and lost again keeps both loss events');

-- Criterion 4 + 5: linked lead/opportunity close once; values labelled apart; competitor neutral.
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000b","reason_code":"competitor"}')$$,'23514','State the relationship with the supplier, or choose Unknown','competitor relationship must be stated, even as Unknown');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000b","reason_code":"competitor","competitor_relationship":"reported","competitor_relationship_detail":"Said to be friendly"}')$$,'23514','State how the relationship is known','a reported relationship needs an evidence quality');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000b","reason_code":"competitor","competitor_relationship":"reported","competitor_evidence":"unverified"}')$$,'23514','Describe the reported relationship (at least 3 characters)','a reported relationship needs a description');
select throws_ok($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-00000000000b","reason_code":"competitor","competitor_relationship":"unknown","competitor_evidence":"documented"}')$$,'23514','Relationship detail is only recorded for a reported relationship','evidence is not attached to an unknown relationship');
select lives_ok($$select pg_temp.cmd('lose',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000b','reason_code','competitor','competitor_relationship','unknown','effective_date',pg_temp.today()),'dddddddd-2910-0024-0000-00000000000b')$$,'loss to an unnamed supplier with unknown relationship');
select ok((select lead_id='cccccccc-2910-0024-0000-00000000000b' and opportunity_id='eeeeeeee-2910-0024-0000-00000000000b' and closes_lead and closes_opportunity
  and competitor_name is null and competitor_relationship='unknown' and pursuit_key='cccccccc-2910-0024-0000-00000000000b'
  from api.pursuit_outcome_events where request_id='dddddddd-2910-0024-0000-00000000000b'),'one event closes the inquiry and its opportunity; unnamed supplier stays Unknown');
select ok((select quoted_value=19500 and quoted_currency='MYR' and estimated_value=25000 and estimated_currency='MYR'
  from api.pursuit_outcome_events where request_id='dddddddd-2910-0024-0000-00000000000b'),'latest quoted value and unquoted estimate are kept apart');
select ok((select status='lost' and stage_key='lost' and lost_at is not null and outcome_reason='Awarded to another supplier' from api.opportunities where id='eeeeeeee-2910-0024-0000-00000000000b'),'linked opportunity moved to Lost');
select is((select status from api.leads where id='cccccccc-2910-0024-0000-00000000000b'),'disqualified','linked inquiry closed');
select is((select count(*) from api.tasks where id in ('ffffffff-2910-0024-0000-00000000000b','ffffffff-2910-0024-0000-0000000000b2') and status='cancelled'),2::bigint,'reminders on both records resolved');
select is((select count(*) from sales.opportunity_stage_events where opportunity_id='eeeeeeee-2910-0024-0000-00000000000b' and to_stage_key='lost'),1::bigint,'stage history records the move');
select is((select count(*) from api.pursuit_outcome_events where opportunity_id='eeeeeeee-2910-0024-0000-00000000000b'),1::bigint,'linked closure counts once');

-- Reopen from the opportunity reopens the inquiry that closed with it.
select throws_ok($$select pg_temp.cmd('reopen',jsonb_build_object('opportunity_id','eeeeeeee-2910-0024-0000-00000000000b','reason_detail','Supplier failed to deliver','next_follow_up_at',now()+interval '2 days'))$$,'23514','Enter the next action for the reopened opportunity','reopened opportunity needs a next action');
select lives_ok($$select pg_temp.cmd('reopen',jsonb_build_object('opportunity_id','eeeeeeee-2910-0024-0000-00000000000b','reason_detail','Supplier failed to deliver','next_follow_up_at',now()+interval '2 days','next_action','Send revised quote'))$$,'reopen opportunity');
select ok((select status='open' and stage_key='quote_sent' and lost_at is null and outcome_reason is null and next_action='Send revised quote' from api.opportunities where id='eeeeeeee-2910-0024-0000-00000000000b'),'opportunity resumes its prior stage with the new next action');
select is((select status from api.leads where id='cccccccc-2910-0024-0000-00000000000b'),'converted','inquiry resumes its prior status');
select ok((select reopened_at is not null and competitor_relationship='unknown' and quoted_value=19500 from api.pursuit_outcome_history where opportunity_id='eeeeeeee-2910-0024-0000-00000000000b'),'earlier loss evidence survives the reopen');

-- Criterion 3: timing is either a deferral with a review date or a genuine loss.
select throws_ok($$select pg_temp.cmd('defer',jsonb_build_object('opportunity_id','eeeeeeee-2910-0024-0000-00000000000c','reason_code','timing','effective_date',pg_temp.today()))$$,'23514','Choose a review date for the deferral','deferral needs a review date');
select throws_ok($$select pg_temp.cmd('defer',jsonb_build_object('opportunity_id','eeeeeeee-2910-0024-0000-00000000000c','reason_code','timing','effective_date',pg_temp.today()-5,'review_date',pg_temp.today()-1))$$,'23514','The review date must be today or later','review date cannot be in the past');
select throws_ok($$select pg_temp.cmd('lose',jsonb_build_object('opportunity_id','eeeeeeee-2910-0024-0000-00000000000c','reason_code','timing','effective_date',pg_temp.today(),'review_date',pg_temp.today()+30))$$,'23514','Only a deferral has a review date','a loss does not carry a review date');
select lives_ok($$select pg_temp.cmd('defer',jsonb_build_object('opportunity_id','eeeeeeee-2910-0024-0000-00000000000c','reason_code','timing','effective_date',pg_temp.today(),'review_date',pg_temp.today()+30))$$,'timing deferral with a review date');
select ok((select status='deferred' and stage_key='deferred' and deferred_until=pg_temp.today()+30 from api.opportunities where id='eeeeeeee-2910-0024-0000-00000000000c'),'opportunity deferred until the review date');
select is((select count(*) from api.tasks where opportunity_id='eeeeeeee-2910-0024-0000-00000000000c' and status='open' and title like 'Review deferred%'),1::bigint,'one review reminder replaces outstanding reminders');
select lives_ok($$select pg_temp.cmd('lose',jsonb_build_object('opportunity_id','eeeeeeee-2910-0024-0000-00000000000c','reason_code','timing','effective_date',pg_temp.today()),'dddddddd-2910-0024-0000-00000000000c')$$,'a deferred pursuit can later record a genuine timing loss');
select is((select count(*) from api.tasks where opportunity_id='eeeeeeee-2910-0024-0000-00000000000c' and status='open'),0::bigint,'loss resolves the review reminder');
select ok((select quoted_value is null and estimated_value=8000 and pursuit_key='eeeeeeee-2910-0024-0000-00000000000c' from api.pursuit_outcome_events where request_id='dddddddd-2910-0024-0000-00000000000c'),'standalone opportunity is its own pursuit with an unquoted estimate');

-- Correction supersedes the reason without counting a second loss.
select throws_ok($$select pg_temp.cmd('correct',jsonb_build_object('event_id',(select id from api.pursuit_outcome_events where request_id='dddddddd-2910-0024-0000-00000000000c'),'reason_code','price','effective_date',pg_temp.today()))$$,'23514','Record why the outcome is corrected (at least 3 characters)','correction needs a note');
select lives_ok($$select pg_temp.cmd('correct',jsonb_build_object('event_id',(select id from api.pursuit_outcome_events where request_id='dddddddd-2910-0024-0000-00000000000c'),'reason_code','price','effective_date',pg_temp.today(),'correction_note','Customer confirmed price was the reason'))$$,'reason correction recorded');
select ok((select reason_code='price' and original_reason_code='timing' and latest_correction_id is not null from api.pursuit_outcome_history where opportunity_id='eeeeeeee-2910-0024-0000-00000000000c' and outcome_type='lost'),'effective reason is the correction; original is kept');
select is((select outcome_reason from api.opportunities where id='eeeeeeee-2910-0024-0000-00000000000c'),'Price or budget','current reason follows the correction');
select throws_ok($$select pg_temp.lose('{"opportunity_id":"eeeeeeee-2910-0024-0000-00000000000c","reason_code":"price"}')$$,'23514','This opportunity is already lost. Reopen it first.','a lost opportunity cannot be lost twice');
select lives_ok($$select api.change_opportunity_stage('eeeeeeee-2910-0024-0000-0000000000d4','won','Synthetic order confirmed',null,null,pg_temp.today())$$,'won is still recorded through the stage control');
select throws_ok($$select pg_temp.lose('{"opportunity_id":"eeeeeeee-2910-0024-0000-0000000000d4","reason_code":"price"}')$$,'23514','This opportunity is won. Move its stage back before recording another outcome.','a won opportunity is not silently turned into a loss');

-- Criterion 2: rejection is separate from loss; no response never closes.
select lives_ok($$select api.work_inquiry('cccccccc-2910-0024-0000-00000000000d','no_response',gen_random_uuid())$$,'no response recorded');
select lives_ok($$select api.work_inquiry('cccccccc-2910-0024-0000-00000000000d','no_response',gen_random_uuid())$$,'second no response recorded');
select ok((select status='contact_attempted' and not exists(select 1 from api.pursuit_outcome_events e where e.lead_id='cccccccc-2910-0024-0000-00000000000d') from api.leads where id='cccccccc-2910-0024-0000-00000000000d'),'repeated no response does not close the pursuit');
select throws_ok($$select pg_temp.cmd('reject',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000e','reason_code','price','effective_date',pg_temp.today()))$$,'23514','Choose a listed reason','a loss reason is not a rejection reason');
select lives_ok($$select pg_temp.cmd('reject',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000e','reason_code','spam','effective_date',pg_temp.today()))$$,'spam is a qualification rejection');
select ok((select outcome_type='rejected' and reason_code='spam' from api.pursuit_outcome_history where lead_id='cccccccc-2910-0024-0000-00000000000e'),'rejection is recorded as rejection, not loss');
select throws_ok($$select pg_temp.cmd('reject',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-000000000010','reason_code','duplicate','effective_date',pg_temp.today()))$$,'23514','Link the original inquiry or explain which inquiry this duplicates','duplicate needs its original or an explanation');
select lives_ok($$select pg_temp.cmd('reject',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-000000000010','reason_code','duplicate','duplicate_of_lead_id','cccccccc-2910-0024-0000-00000000000e','effective_date',pg_temp.today()))$$,'duplicate linked to its original');
select ok((select status='duplicate' and duplicate_of_lead_id='cccccccc-2910-0024-0000-00000000000e' from api.leads where id='cccccccc-2910-0024-0000-000000000010'),'duplicate status and link stored');
select throws_ok($$select pg_temp.cmd('reject',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-000000000011','reason_code','not_buying','effective_date',pg_temp.today()))$$,'23514','This inquiry already has an active opportunity. Record a sales loss or archive the opportunity instead.','an inquiry with an active opportunity is not rejected at qualification');

-- Lead-only deferral keeps the inquiry open with a review reminder.
select lives_ok($$select pg_temp.cmd('defer',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000f','reason_code','budget_pending','effective_date',pg_temp.today(),'review_date',pg_temp.today()+14))$$,'inquiry deferred');
select ok((select status='contacted' and open_follow_ups=1 and next_follow_up_at::date >= pg_temp.today()+13 from api.inbox_leads where id='cccccccc-2910-0024-0000-00000000000f'),'deferred inquiry stays open with its review reminder');
select lives_ok($$select pg_temp.cmd('reopen',jsonb_build_object('lead_id','cccccccc-2910-0024-0000-00000000000f','reason_detail','Budget released early','next_follow_up_at',now()+interval '1 day'))$$,'deferred inquiry resumed early');
select ok((select open_follow_ups=1 and next_follow_up_at < now()+interval '2 days' from api.inbox_leads where id='cccccccc-2910-0024-0000-00000000000f'),'review reminder replaced by the new follow-up');

-- Reporting keeps earlier weekly outcomes and separates losses from rejections.
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select ok((select events=1 and pursuits=1 and reopened_later=1 from api.report_pursuit_outcomes(pg_temp.today()-1,pg_temp.today()-1)
  where outcome_type='lost' and reason_code='unknown'),'reopened loss still counts in its own week');
select ok((select count(*)=2 and count(distinct pursuit_key)=1 from api.pursuit_outcome_history where lead_id='cccccccc-2910-0024-0000-00000000000a' and outcome_type='lost'),
  'two loss events, one distinct pursuit');
select ok((select count(*) = 1 from api.pursuit_outcome_history where outcome_type='lost' and reopened_at is not null and lead_id='cccccccc-2910-0024-0000-00000000000a'),'history marks the reopened loss instead of removing it');
select ok(exists(select 1 from api.report_pursuit_outcomes(pg_temp.today()-7,pg_temp.today()) where outcome_type='rejected' and reason_code='spam'),'rejections are reported separately');
select ok((select lost_quoted_value >= 19500 and lost_estimated_unquoted_value >= 0 from api.report_pursuit_outcomes(pg_temp.today(),pg_temp.today()) where outcome_type='lost' and reason_code='competitor'),'lost quoted value is reported under its own label');
select ok((select lost_estimated_unquoted_value >= 8000 from api.report_pursuit_outcomes(pg_temp.today(),pg_temp.today()) where outcome_type='lost' and reason_code='price'),'unquoted estimate is reported under its own label after correction');

-- Criterion 6: role isolation.
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000007');
select throws_ok($$select pg_temp.lose('{"opportunity_id":"eeeeeeee-2910-0024-0000-0000000000d4","reason_code":"price"}')$$,'42501',null,'a role without sales.write cannot close a pursuit');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
select throws_like($$select pg_temp.lose('{"opportunity_id":"eeeeeeee-2910-0024-0000-0000000000d4","reason_code":"price"}')$$,'%not the owner%','showroom cannot close another owner''s opportunity');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_like($$select pg_temp.lose('{"opportunity_id":"eeeeeeee-2910-0024-0000-000000000099","reason_code":"price"}')$$,'%workspace%','cross-workspace opportunity cannot be closed');
select throws_like($$select pg_temp.lose('{"lead_id":"cccccccc-2910-0024-0000-000000000099","reason_code":"price"}')$$,'%workspace%','cross-workspace inquiry cannot be closed');
select throws_ok($$insert into api.pursuit_outcome_events(workspace_id,lead_id,closes_lead,closes_opportunity,outcome_type,reason_code,effective_date,request_id,command,actor_id)
  values('11111111-1111-1111-1111-111111111111','cccccccc-2910-0024-0000-00000000000d',true,false,'lost','price',pg_temp.today(),gen_random_uuid(),'{}','aaaaaaaa-0000-0000-0000-000000000003')$$,'42501',null,'outcome history cannot be written directly');
reset role;
set local role anon;
select throws_ok($$select api.pursuit_outcome_command('lose','{}',gen_random_uuid())$$,'42501',null,'anonymous callers cannot record outcomes');
reset role;

-- Append-only, even for the table owner.
select throws_ok($$update sales.pursuit_outcome_events set reason_code='price' where lead_id='cccccccc-2910-0024-0000-00000000000a'$$,'42501','Pursuit outcome history is append-only. Record a correction or reopen instead.','history cannot be rewritten');
select throws_ok($$delete from sales.pursuit_outcome_events where lead_id='cccccccc-2910-0024-0000-00000000000a'$$,'42501','Pursuit outcome history is append-only. Record a correction or reopen instead.','history cannot be deleted');
select ok((select count(*) = (select count(*) from sales.pursuit_outcome_events where lead_id='cccccccc-2910-0024-0000-00000000000a' and outcome_type <> 'reopened')
  from audit.audit_events where object_table='pursuit_outcome_events' and action in ('pursuit.lose','pursuit.reject','pursuit.defer')
  and object_id in (select id from sales.pursuit_outcome_events where lead_id='cccccccc-2910-0024-0000-00000000000a')),'every close is audited');
select is((select count(*) from sales.activities where metadata->>'event'='pursuit_outcome' and lead_id='cccccccc-2910-0024-0000-00000000000a'),3::bigint,'timeline shows each loss and the reopen');

select * from finish();
rollback;
