-- TILE-59: connector run bookkeeping is the trusted worker's, and freshness tells
-- the truth.
--
-- Workspace A is the seed workspace and B the synthetic demo workspace. Every
-- connection, run, checkpoint and account below is synthetic and the whole file
-- is rolled back.
--
-- Rules under test (supabase/migrations/20261029000003_connector_sync_guards.sql):
--   * api.start_sync_run / api.finish_sync_run run for service_role only;
--   * sync_runs and connector_checkpoints are read-only to members (audit.read in
--     the connection's own workspace) through views and base tables alike;
--   * only a complete success moves last_success_at or the checkpoint; partial and
--     failed runs keep both and say why;
--   * a finished run is final, and an invalid finish writes nothing.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.act_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
-- Rows a reader returned, or -1 when it refused with 42501.
create function pg_temp.rows_or_denied(q text) returns int language plpgsql as $$
declare n int; begin execute format('select count(*) from (%s) x', q) into n; return n;
exception when insufficient_privilege then return -1; end $$;

create temp table ws(a uuid, b uuid);
insert into ws values ('11111111-1111-1111-1111-111111111111', core.demo_workspace_id());

create temp table fx(conn_a uuid, conn_b uuid, run_running uuid, run_done uuid, run_b uuid);
insert into fx values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

-- A connection that last succeeded at a known instant, with a known cursor, one
-- run still running (started before the cursor's next move) and one finished.
insert into ingest.integration_connections(id, workspace_id, provider, name, environment, direction, status, last_attempt_at, last_success_at)
select fx.conn_a, ws.a, 'synthetic_probe', 'Synthetic TILE-59 connector A', 'demo', 'pull', 'healthy', '2026-01-01T00:00:00Z'::timestamptz, '2026-01-01T00:00:00Z'::timestamptz from fx, ws
union all
select fx.conn_b, ws.b, 'synthetic_probe', 'Synthetic TILE-59 connector B', 'demo', 'pull', 'healthy', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z' from fx, ws;
insert into ingest.connector_checkpoints(connection_id, stream, cursor, updated_at)
select conn_a, 'default', 'synthetic-cursor-0', '2026-01-01T00:00:00Z'::timestamptz from fx
union all select conn_b, 'default', 'synthetic-b-cursor-0', '2026-01-01T00:00:00Z' from fx;
insert into ingest.sync_runs(id, connection_id, started_at, status)
select run_running, conn_a, '2026-01-02T00:00:00Z'::timestamptz, 'running' from fx
union all select run_b, conn_b, '2026-01-02T00:00:00Z', 'running' from fx;
insert into ingest.sync_runs(id, connection_id, started_at, finished_at, status, records_read, records_created, records_updated, records_rejected)
select run_done, conn_a, '2025-12-31T00:00:00Z', '2025-12-31T00:10:00Z', 'succeeded', 10, 4, 6, 0 from fx;

-- Everything a sync could touch, in every workspace.
create function pg_temp.sync_fingerprint() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(to_jsonb(c)::text, ',' order by c.id) from ingest.integration_connections c),
    (select string_agg(to_jsonb(r)::text, ',' order by r.id) from ingest.sync_runs r),
    (select string_agg(to_jsonb(k)::text, ',' order by k.id) from ingest.connector_checkpoints k),
    (select count(*)::text from ingest.data_quality_issues),
    (select count(*)::text from audit.audit_events e where e.object_table in ('sync_runs','connector_checkpoints','integration_connections'))))
$$;

-- Synthetic people. The oldest active membership is the acting one.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false
from (values
  ('dddddddd-5900-0000-0000-000000000001'::uuid,'synthetic.sync.no-membership@tileconcept.test'),
  ('dddddddd-5900-0000-0000-000000000002'::uuid,'synthetic.sync.showroom-a@tileconcept.test'),
  ('dddddddd-5900-0000-0000-000000000003'::uuid,'synthetic.sync.driver-a@tileconcept.test'),
  ('dddddddd-5900-0000-0000-000000000004'::uuid,'synthetic.sync.admin-b@tileconcept.test'),
  ('dddddddd-5900-0000-0000-000000000005'::uuid,'synthetic.sync.driver-a.admin-b@tileconcept.test'),
  ('dddddddd-5900-0000-0000-000000000006'::uuid,'synthetic.sync.admin-a@tileconcept.test')
) as u(id,email);
insert into core.memberships(workspace_id,user_id,role_key,status,created_at)
select case w when 'a' then ws.a else ws.b end, u, r, 'active', now() - (d || ' days')::interval
from ws, (values
  ('dddddddd-5900-0000-0000-000000000002'::uuid,'a','showroom',1),
  ('dddddddd-5900-0000-0000-000000000003'::uuid,'a','driver',1),
  ('dddddddd-5900-0000-0000-000000000004'::uuid,'b','admin',1),
  ('dddddddd-5900-0000-0000-000000000005'::uuid,'a','driver',2), ('dddddddd-5900-0000-0000-000000000005'::uuid,'b','admin',1),
  ('dddddddd-5900-0000-0000-000000000006'::uuid,'a','admin',1)
) as m(u,w,r,d);

grant select on ws, fx to authenticated, anon, service_role;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

select ok((select count(*) from ingest.sync_runs s join fx on s.connection_id in (fx.conn_a, fx.conn_b)) = 3
          and (select count(*) from ingest.connector_checkpoints k join fx on k.connection_id in (fx.conn_a, fx.conn_b)) = 2,
          'fixture: synthetic connections in A and B with runs and checkpoints');

------------------------------------------------------------------------------
-- 1. Privileges: the RPCs are the worker's; members only read
------------------------------------------------------------------------------
select is(has_function_privilege(r, 'api.start_sync_run(uuid)', 'execute'), r = 'service_role', 'start_sync_run EXECUTE for ' || r)
from unnest(array['public','anon','authenticated','service_role']) r;
select is(has_function_privilege(r, 'api.finish_sync_run(uuid,text,int,int,int,int,text,text,text)', 'execute'), r = 'service_role', 'finish_sync_run EXECUTE for ' || r)
from unnest(array['public','anon','authenticated','service_role']) r;
select is(has_table_privilege(r, t, p), false, format('%s has no %s on %s', r, p, t))
from unnest(array['anon','authenticated']) r,
     unnest(array['api.sync_runs','api.connector_checkpoints','ingest.sync_runs','ingest.connector_checkpoints']) t,
     unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
select is(has_table_privilege('anon', t, 'SELECT'), false, 'anon has no SELECT on ' || t)
from unnest(array['api.sync_runs','api.connector_checkpoints','ingest.sync_runs','ingest.connector_checkpoints']) t;
select is(has_table_privilege('authenticated', t, 'SELECT'), true, 'authenticated keeps SELECT on ' || t)
from unnest(array['api.sync_runs','api.connector_checkpoints']) t;
select is((select coalesce(array_agg(tablename || ':' || policyname || ':' || cmd order by 1), '{}') from pg_policies
           where schemaname = 'ingest' and tablename in ('sync_runs','connector_checkpoints') and cmd <> 'SELECT'),
          '{}'::text[], 'no member policy writes sync runs or checkpoints');

------------------------------------------------------------------------------
-- 2. Denials: no member, in any workspace or role, starts, finishes or writes
------------------------------------------------------------------------------
create temp table fingerprint as select pg_temp.sync_fingerprint() as before;

create function pg_temp.cannot_operate(who text) returns setof text language plpgsql as $$
declare f record;
begin
  select * into f from fx;
  return next throws_ok(format('select api.start_sync_run(%L)', f.conn_a), '42501', null, who || ': cannot start an A sync run');
  return next throws_ok(format('select api.start_sync_run(%L)', f.conn_b), '42501', null, who || ': cannot start a B sync run');
  return next throws_ok(format($q$select api.finish_sync_run(%L,'partial',5,1,1,3,'probe','probe-cursor')$q$, f.run_running), '42501', null, who || ': cannot finish a running A run');
  return next throws_ok(format($q$select api.finish_sync_run(%L,'succeeded',9,9,9,0,null,'probe-cursor')$q$, f.run_done), '42501', null, who || ': cannot re-finish a finished A run');
  return next throws_ok(format($q$select api.finish_sync_run(%L,'succeeded',1,1,0,0,null,'probe-cursor')$q$, f.run_b), '42501', null, who || ': cannot finish a running B run');
  return next throws_ok(format($q$insert into api.sync_runs(connection_id, status) values (%L,'succeeded')$q$, f.conn_a), '42501', null, who || ': cannot insert a run through api.sync_runs');
  return next throws_ok(format($q$update api.sync_runs set status='succeeded', records_read=99 where connection_id in (%L,%L)$q$, f.conn_a, f.conn_b), '42501', null, who || ': cannot update runs through api.sync_runs');
  return next throws_ok(format($q$delete from api.sync_runs where connection_id in (%L,%L)$q$, f.conn_a, f.conn_b), '42501', null, who || ': cannot delete runs through api.sync_runs');
  return next throws_ok(format($q$insert into api.connector_checkpoints(connection_id, stream, cursor) values (%L,'probe','probe-cursor')$q$, f.conn_a), '42501', null, who || ': cannot insert a checkpoint through api.connector_checkpoints');
  return next throws_ok(format($q$update api.connector_checkpoints set cursor='probe-cursor' where connection_id in (%L,%L)$q$, f.conn_a, f.conn_b), '42501', null, who || ': cannot move a checkpoint through api.connector_checkpoints');
  return next throws_ok(format($q$delete from api.connector_checkpoints where connection_id in (%L,%L)$q$, f.conn_a, f.conn_b), '42501', null, who || ': cannot delete a checkpoint through api.connector_checkpoints');
  return next throws_ok(format($q$insert into ingest.sync_runs(connection_id, status) values (%L,'succeeded')$q$, f.conn_a), '42501', null, who || ': cannot insert into ingest.sync_runs');
  return next throws_ok(format($q$update ingest.sync_runs set records_read=99 where connection_id=%L$q$, f.conn_a), '42501', null, who || ': cannot update ingest.sync_runs');
  return next throws_ok(format($q$delete from ingest.sync_runs where connection_id=%L$q$, f.conn_a), '42501', null, who || ': cannot delete from ingest.sync_runs');
  return next throws_ok(format($q$insert into ingest.connector_checkpoints(connection_id, stream, cursor) values (%L,'probe','probe-cursor')$q$, f.conn_a), '42501', null, who || ': cannot insert into ingest.connector_checkpoints');
  return next throws_ok(format($q$update ingest.connector_checkpoints set cursor='probe-cursor' where connection_id=%L$q$, f.conn_a), '42501', null, who || ': cannot update ingest.connector_checkpoints');
  return next throws_ok(format($q$delete from ingest.connector_checkpoints where connection_id=%L$q$, f.conn_a), '42501', null, who || ': cannot delete from ingest.connector_checkpoints');
end $$;

-- What each reader sees: A runs, A checkpoints, B runs, B checkpoints (-1 = refused).
create function pg_temp.visible() returns text language sql as $$
  select concat_ws('/',
    pg_temp.rows_or_denied(format('select 1 from api.sync_runs where connection_id = %L', (select conn_a from fx))),
    pg_temp.rows_or_denied(format('select 1 from api.connector_checkpoints where connection_id = %L', (select conn_a from fx))),
    pg_temp.rows_or_denied(format('select 1 from api.sync_runs where connection_id = %L', (select conn_b from fx))),
    pg_temp.rows_or_denied(format('select 1 from api.connector_checkpoints where connection_id = %L', (select conn_b from fx))))
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select * from pg_temp.cannot_operate('anon');
select is(pg_temp.visible(), '-1/-1/-1/-1', 'anon: reads nothing');
reset role;

set local role authenticated;
select pg_temp.act_as('dddddddd-5900-0000-0000-000000000001');
select * from pg_temp.cannot_operate('no membership');
select is(pg_temp.visible(), '0/0/0/0', 'no membership: reads no runs or checkpoints');

select pg_temp.act_as('dddddddd-5900-0000-0000-000000000002');
select * from pg_temp.cannot_operate('showroom A (audit.read, no settings.manage)');
select is(pg_temp.visible(), '2/1/0/0', 'showroom A: still reads A runs and checkpoints, nothing of B');

select pg_temp.act_as('dddddddd-5900-0000-0000-000000000003');
select * from pg_temp.cannot_operate('driver A');
select is(pg_temp.visible(), '0/0/0/0', 'driver A: no audit.read, reads nothing');

select pg_temp.act_as('dddddddd-5900-0000-0000-000000000004');
select * from pg_temp.cannot_operate('admin B only');
select is(pg_temp.visible(), '0/0/1/1', 'admin B only: reads B, nothing of A');

select pg_temp.act_as('dddddddd-5900-0000-0000-000000000005');
select * from pg_temp.cannot_operate('driver A + admin B');
select is(pg_temp.visible(), '0/0/1/1', 'driver A + admin B: B membership reads B, A stays closed');

select pg_temp.act_as('dddddddd-5900-0000-0000-000000000006');
select * from pg_temp.cannot_operate('admin A (settings.manage)');
select is(pg_temp.visible(), '2/1/0/0', 'admin A: reads A runs and checkpoints');
reset role;

select is(pg_temp.sync_fingerprint(), (select before from fingerprint), 'denials: no connection, run, checkpoint, data-quality or audit row changed');

------------------------------------------------------------------------------
-- 3. The trusted worker (service_role): truthful freshness
------------------------------------------------------------------------------
create temp table runs(label text primary key, id uuid);
create temp table snap(label text primary key, fp text);
grant select, insert on runs, snap to service_role;

create function pg_temp.conn() returns ingest.integration_connections language sql as $$
  select * from ingest.integration_connections where id = (select conn_a from fx) $$;
create function pg_temp.cp() returns ingest.connector_checkpoints language sql as $$
  select * from ingest.connector_checkpoints where connection_id = (select conn_a from fx) and stream = 'default' $$;
create function pg_temp.run(l text) returns ingest.sync_runs language sql as $$
  select * from ingest.sync_runs where id = (select id from runs where label = l) $$;
create function pg_temp.finished_audit(l text) returns jsonb language sql as $$
  select after_data from audit.audit_events where action = 'sync_run.finished' and object_id = (select id from runs where label = l) $$;
create function pg_temp.snapped(l text) returns text language sql as $$ select fp from snap where label = l $$;
-- Put connection A back at a known last success and cursor time, so "kept" is
-- distinguishable from "set to now()" inside this one transaction.
create function pg_temp.rewind() returns void language sql as $$
  update ingest.integration_connections set status = 'healthy', last_success_at = '2026-01-01T00:00:00Z', last_error = null where id = (select conn_a from fx);
  update ingest.connector_checkpoints set updated_at = '2026-01-01T00:00:00Z' where connection_id = (select conn_a from fx);
$$;
grant execute on all functions in schema pg_temp to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- start
insert into runs select 'r1', api.start_sync_run(conn_a) from fx;
select is((pg_temp.run('r1')).status, 'running', 'worker: start opens a running run');
select is((pg_temp.conn()).last_attempt_at, now(), 'worker: start records the attempt');
select is((pg_temp.conn()).last_success_at, '2026-01-01T00:00:00Z'::timestamptz, 'worker: start does not claim a success');

-- complete success
select lives_ok(format($q$select api.finish_sync_run(%L,'succeeded',10,4,5,0,null,'synthetic-cursor-1')$q$, (select id from runs where label='r1')), 'worker: finishes a complete success');
select is(row((pg_temp.run('r1')).status, (pg_temp.run('r1')).records_read, (pg_temp.run('r1')).records_created, (pg_temp.run('r1')).records_updated, (pg_temp.run('r1')).records_rejected)::text,
          row('succeeded', 10, 4, 5, 0)::text, 'succeeded: run counts recorded');
select is(row((pg_temp.conn()).status, (pg_temp.conn()).last_success_at, (pg_temp.conn()).last_error)::text, row('healthy', now(), null::text)::text,
          'succeeded: healthy, last success now, no error');
select is(row((pg_temp.cp()).cursor, (pg_temp.cp()).updated_at)::text, row('synthetic-cursor-1', now())::text, 'succeeded: checkpoint advanced');
select is(pg_temp.finished_audit('r1')->>'checkpoint_advanced', 'true', 'succeeded: audit says the checkpoint moved');

-- a finished run is final
insert into snap values ('r1', pg_temp.sync_fingerprint());
select throws_ok(format($q$select api.finish_sync_run(%L,'succeeded',99,99,99,0,null,'synthetic-cursor-replay')$q$, (select id from runs where label='r1')), '55000', null, 'terminal: re-finishing a succeeded run as succeeded is refused');
select throws_ok(format($q$select api.finish_sync_run(%L,'failed',0,0,0,0,'replayed failure',null)$q$, (select id from runs where label='r1')), '55000', null, 'terminal: re-finishing a succeeded run as failed is refused');
select throws_ok(format($q$select api.finish_sync_run(%L,'partial',5,0,0,5,'replayed partial','synthetic-cursor-replay')$q$, (select id from runs where label='r1')), '55000', null, 'terminal: re-finishing a succeeded run as partial is refused');
select throws_ok(format($q$update ingest.sync_runs set records_read = 99 where id = %L$q$, (select id from runs where label='r1')), '55000', null, 'terminal: even a direct service_role update of a finished run is refused');
select is(pg_temp.sync_fingerprint(), pg_temp.snapped('r1'), 'terminal: counts, cursor, health and audit unchanged by the replays');

-- partial: keep the last complete success and the cursor, keep the detail
select pg_temp.rewind();
insert into runs select 'r2', api.start_sync_run(conn_a) from fx;
select lives_ok(format($q$select api.finish_sync_run(%L,'partial',10,3,2,5,'synthetic: 5 rows rejected','synthetic-cursor-2')$q$, (select id from runs where label='r2')), 'worker: finishes a partial run');
select is(row((pg_temp.run('r2')).status, (pg_temp.run('r2')).records_rejected, (pg_temp.run('r2')).error)::text, row('partial', 5, 'synthetic: 5 rows rejected')::text,
          'partial: run keeps the rejected count and detail');
select is((pg_temp.conn()).status, 'degraded', 'partial: connection is degraded, not healthy');
select is((pg_temp.conn()).last_success_at, '2026-01-01T00:00:00Z'::timestamptz, 'partial: last complete success is kept');
select is((pg_temp.conn()).last_error, 'synthetic: 5 rows rejected', 'partial: the rejection detail is shown on the connection');
select is(row((pg_temp.cp()).cursor, (pg_temp.cp()).updated_at)::text, row('synthetic-cursor-1', '2026-01-01T00:00:00Z'::timestamptz)::text, 'partial: checkpoint is kept for the retry');
select is(pg_temp.finished_audit('r2')->>'checkpoint_advanced', 'false', 'partial: audit says the checkpoint did not move');
select is(pg_temp.finished_audit('r2')->>'proposed_checkpoint', 'synthetic-cursor-2', 'partial: audit keeps the cursor the worker proposed');

insert into runs select 'r2b', api.start_sync_run(conn_a) from fx;
select lives_ok(format($q$select api.finish_sync_run(%L,'partial',8,5,0,3)$q$, (select id from runs where label='r2b')), 'worker: finishes a partial run without detail');
select ok((pg_temp.conn()).last_error like '%3%rejected%', 'partial without detail: the connection still says how many were rejected');
select is((pg_temp.conn()).last_success_at, '2026-01-01T00:00:00Z'::timestamptz, 'partial without detail: last complete success is kept');

-- failed: same, plus a data-quality issue
insert into snap select 'dq', count(*)::text from ingest.data_quality_issues where object_id = (select conn_a from fx);
insert into runs select 'r3', api.start_sync_run(conn_a) from fx;
select lives_ok(format($q$select api.finish_sync_run(%L,'failed',0,0,0,0,'synthetic: provider timeout','synthetic-cursor-3')$q$, (select id from runs where label='r3')), 'worker: finishes a failed run');
select is(row((pg_temp.conn()).status, (pg_temp.conn()).last_success_at, (pg_temp.conn()).last_error)::text,
          row('failed', '2026-01-01T00:00:00Z'::timestamptz, 'synthetic: provider timeout')::text, 'failed: failed status, last complete success kept, error shown');
select is((pg_temp.cp()).cursor, 'synthetic-cursor-1', 'failed: checkpoint is kept');
select is((select count(*) from ingest.data_quality_issues where object_id = (select conn_a from fx)), pg_temp.snapped('dq')::bigint + 1, 'failed: a data-quality issue is raised');

insert into runs select 'r4', api.start_sync_run(conn_a) from fx;
select lives_ok(format($q$select api.finish_sync_run(%L,'failed')$q$, (select id from runs where label='r4')), 'worker: finishes a failed run without detail');
select isnt((pg_temp.conn()).last_error, null, 'failed without detail: the connection still carries an error');

-- retry after partial/failed resumes from the kept cursor and then advances
insert into runs select 'r5', api.start_sync_run(conn_a) from fx;
select lives_ok(format($q$select api.finish_sync_run(%L,'succeeded',8,8,0,0,null,'synthetic-cursor-2')$q$, (select id from runs where label='r5')), 'retry: the next complete run succeeds');
select is(row((pg_temp.conn()).status, (pg_temp.conn()).last_success_at, (pg_temp.conn()).last_error)::text, row('healthy', now(), null::text)::text, 'retry: healthy again, freshness moves');
select is((pg_temp.cp()).cursor, 'synthetic-cursor-2', 'retry: checkpoint advances from the kept cursor');

-- a run that started before the cursor last moved cannot move it back
insert into runs select 'stale', run_running from fx;
select lives_ok(format($q$select api.finish_sync_run(%L,'succeeded',3,3,0,0,null,'synthetic-cursor-stale')$q$, (select run_running from fx)), 'overlap: an older run still finishes');
select is((pg_temp.run('stale')).status, 'succeeded', 'overlap: older run recorded as succeeded');
select is((pg_temp.cp()).cursor, 'synthetic-cursor-2', 'overlap: the newer cursor is not overwritten by an older run');
select is(pg_temp.finished_audit('stale')->>'checkpoint_advanced', 'false', 'overlap: audit says the checkpoint did not move');

------------------------------------------------------------------------------
-- 4. Invalid finishes write nothing; the run can still be finished properly
------------------------------------------------------------------------------
insert into runs select 'r6', api.start_sync_run(conn_a) from fx;
insert into snap values ('r6', pg_temp.sync_fingerprint());
select throws_ok(format($q$select api.finish_sync_run(%L,%L)$q$, (select id from runs where label='r6'), s), '22023', null, format('invalid: finish status %s is refused', coalesce(s, 'null')))
from unnest(array['running','bogus','SUCCEEDED','',null]) s;
select throws_ok(format($q$select api.finish_sync_run(%L,'succeeded',%s,%s,%s,%s)$q$, (select id from runs where label='r6'), c[1], c[2], c[3], c[4]), '22023', null, 'invalid: counts ' || array_to_string(c, ',', 'null') || ' are refused')
from (values (array['-1','0','0','0']), (array['0','-1','0','0']), (array['0','0','-1','0']), (array['0','0','0','-1']), (array['null','0','0','0'])) v(c);
select throws_ok(format($q$select api.finish_sync_run(%L,'succeeded',5,3,0,2,null,'synthetic-cursor-x')$q$, (select id from runs where label='r6')), '22023', null, 'invalid: a run that rejected records cannot claim complete success');
select throws_ok(format($q$select api.finish_sync_run(%L,'succeeded',1,1,0,0,null,'synthetic-cursor-x',%L)$q$, (select id from runs where label='r6'), s), '22023', null, 'invalid: checkpoint with stream ' || coalesce(quote_literal(s), 'null') || ' is refused')
from unnest(array['', '  ', null]) s;
select throws_ok(format($q$select api.finish_sync_run(%L,'succeeded')$q$, gen_random_uuid()), 'P0002', null, 'unknown run is refused');
select throws_ok(format($q$select api.start_sync_run(%L)$q$, gen_random_uuid()), 'P0002', null, 'unknown connection is refused');
select is(pg_temp.sync_fingerprint(), pg_temp.snapped('r6'), 'invalid: nothing written by any refused finish');
select is((pg_temp.run('r6')).status, 'running', 'invalid: the run is still running');
select lives_ok(format($q$update ingest.sync_runs set records_read = 1 where id = %L$q$, (select id from runs where label='r6')), 'service_role may still touch a running run directly');
select lives_ok(format($q$select api.finish_sync_run(%L,'succeeded',1,1,0,0)$q$, (select id from runs where label='r6')), 'invalid attempts leave the run finishable');
reset role;

select * from finish();
rollback;
