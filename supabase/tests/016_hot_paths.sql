-- The inbox follow-up rollup and the timeline must read the same as before the
-- per-row function was replaced, and the advisor fixes must hold.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.hot_act_as(uid text) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
$$;

insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id,created_at) values
('eeeeeeee-2109-0016-0000-000000000001','11111111-1111-1111-1111-111111111111','contacted','meta','Rollup fixture with reminders','aaaaaaaa-0000-0000-0000-000000000003',now()-interval '3 days'),
('eeeeeeee-2109-0016-0000-000000000002','11111111-1111-1111-1111-111111111111','new','website','Rollup fixture without reminders','aaaaaaaa-0000-0000-0000-000000000003',now()-interval '1 day');
-- Two open reminders (one assigned to a colleague, one unassigned) and one done.
insert into sales.tasks(id,workspace_id,title,status,due_at,assignee_id,lead_id,created_by) values
('eeeeeeee-2109-0016-0001-000000000001','11111111-1111-1111-1111-111111111111','Later reminder','open',now()+interval '3 days','aaaaaaaa-0000-0000-0000-000000000004','eeeeeeee-2109-0016-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000004'),
('eeeeeeee-2109-0016-0001-000000000002','11111111-1111-1111-1111-111111111111','Sooner reminder','open',now()+interval '1 day',null,'eeeeeeee-2109-0016-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000004'),
('eeeeeeee-2109-0016-0001-000000000003','11111111-1111-1111-1111-111111111111','Finished reminder','done',now()-interval '1 day','aaaaaaaa-0000-0000-0000-000000000003','eeeeeeee-2109-0016-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003');
insert into sales.activities(id,workspace_id,kind,subject,occurred_at,actor_id,lead_id) values
('eeeeeeee-2109-0016-0002-000000000001','11111111-1111-1111-1111-111111111111','note','Rollup timeline note',now()-interval '2 hours','aaaaaaaa-0000-0000-0000-000000000003','eeeeeeee-2109-0016-0000-000000000001');

set local role authenticated;
select pg_temp.hot_act_as('aaaaaaaa-0000-0000-0000-000000000003');

-- The view agrees with the per-lead function it replaced, for a lead whose
-- reminders are assigned to somebody else (task RLS would hide them).
select is(
  (select row(next_follow_up_task_id,next_follow_up_at,follow_up_owner_id,open_follow_ups,completed_follow_ups)::text
     from api.inbox_leads where id='eeeeeeee-2109-0016-0000-000000000001'),
  (select row(next_follow_up_task_id,next_follow_up_at,follow_up_owner_id,open_follow_ups,completed_follow_ups)::text
     from api.lead_followup_summary('eeeeeeee-2109-0016-0000-000000000001')),
  'inbox view follow-up columns match lead_followup_summary');
select is((select next_follow_up_task_id from api.inbox_leads where id='eeeeeeee-2109-0016-0000-000000000001'),
  'eeeeeeee-2109-0016-0001-000000000002'::uuid,'next follow-up is the soonest open reminder');
select is((select (open_follow_ups,completed_follow_ups)::text from api.inbox_leads where id='eeeeeeee-2109-0016-0000-000000000002'),
  '(0,0)','a lead without reminders reports zero counts, not null');
select ok((select needs_action from api.inbox_leads where id='eeeeeeee-2109-0016-0000-000000000002'),
  'a new lead with no response still needs action');
select is((api.inquiry_page('upcoming','Rollup fixture')->>'total')::int,1,'inquiry_page sees the upcoming reminder through the rollup');

-- Timeline still filters by the requested entity and respects the limit.
select is((select count(*)::int from api.entity_timeline('lead','eeeeeeee-2109-0016-0000-000000000001',5)),1,'lead timeline returns the note');
select is((select count(*)::int from api.entity_timeline('contact','eeeeeeee-2109-0016-0000-000000000001',5)),0,'timeline does not leak across entity types');
select is((select count(*)::int from api.entity_timeline('nonsense','eeeeeeee-2109-0016-0000-000000000001',5)),0,'unknown entity type returns nothing');

-- A teammate without sales.read_all still gets the shared summary, not the tasks.
select pg_temp.hot_act_as('aaaaaaaa-0000-0000-0000-000000000004');
select is((select open_follow_ups::int from api.inbox_leads where id='eeeeeeee-2109-0016-0000-000000000001'),2,'shared summary counts colleague reminders');

reset role;
-- Advisor fixes: no SECURITY DEFINER api function is callable by anon, and the
-- rollup itself is not reachable through the exposed schema.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')),0,'anon cannot execute SECURITY DEFINER api functions');
select ok(not has_function_privilege('anon','core.lead_followup_rollup()','execute'),'anon cannot call the rollup');
select is((select count(*)::int from pg_indexes where schemaname='sales' and indexname='intake_events_lead_idx'),1,'intake events are indexed by lead');

select * from finish();
rollback;
