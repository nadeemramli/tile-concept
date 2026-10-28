-- TILE-59: connector run bookkeeping belongs to the trusted connector worker,
-- and a connector's freshness only ever reports a complete success.
--
-- Until now api.start_sync_run / api.finish_sync_run were SECURITY DEFINER
-- functions any signed-in user could execute, with no membership or permission
-- check: an account with no workspace could start a run on any connection and
-- finish it. finish_sync_run counted a partial run as a success (last_success_at
-- and the checkpoint moved, the rejection detail was dropped), and a finished
-- run could be finished again with new counts, a new cursor and a healthy
-- connection. Beneath them, ingest.sync_runs and ingest.connector_checkpoints
-- carried a FOR ALL policy, so anyone with audit.read (a showroom role, say)
-- could insert, rewrite or delete runs and cursors through the api views.
--
-- From here on:
--   * the two RPCs execute for service_role only. Nothing in the app calls
--     them; the connector worker runs server-side with the secret key, like the
--     corpus tooling. PUBLIC, anon and authenticated are revoked explicitly.
--   * members read runs and checkpoints with audit.read in the connection's own
--     workspace (what they could read before) and write neither, through the
--     api views or the base tables.
--   * finish_sync_run accepts only succeeded / partial / failed, non-negative
--     counts and a named stream, locks the run and refuses one that is no
--     longer running. A finished run cannot be updated by anyone.
--   * only a complete success moves last_success_at and the checkpoint. Partial
--     and failed keep both, mark the connection degraded / failed and keep the
--     detail. A run that started before the stream's checkpoint last moved does
--     not overwrite it (an older, overlapping run must not rewind the cursor).

------------------------------------------------------------------------------
-- 1. Members read; only the worker writes
------------------------------------------------------------------------------
drop policy via_parent on ingest.sync_runs;
drop policy via_parent on ingest.connector_checkpoints;

create policy via_parent_read on ingest.sync_runs for select to authenticated
  using (connection_id in (select c.id from ingest.integration_connections c
                           where c.workspace_id in (select core.permitted_workspace_ids('audit.read'))));
create policy via_parent_read on ingest.connector_checkpoints for select to authenticated
  using (connection_id in (select c.id from ingest.integration_connections c
                           where c.workspace_id in (select core.permitted_workspace_ids('audit.read'))));

revoke all on ingest.sync_runs, ingest.connector_checkpoints from public, anon;
revoke insert, update, delete, truncate, references, trigger on ingest.sync_runs, ingest.connector_checkpoints from authenticated;
revoke all on api.sync_runs, api.connector_checkpoints from public, anon;
revoke insert, update, delete, truncate, references, trigger on api.sync_runs, api.connector_checkpoints from authenticated;

------------------------------------------------------------------------------
-- 2. A finished run is final, whoever writes it
------------------------------------------------------------------------------
create or replace function ingest.guard_finished_sync_run()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'running' then
    raise exception 'sync run % already finished as %', old.id, old.status using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function ingest.guard_finished_sync_run() from public, anon, authenticated;

create trigger guard_finished_sync_run before update on ingest.sync_runs
for each row execute function ingest.guard_finished_sync_run();

------------------------------------------------------------------------------
-- 3. The worker's two calls
------------------------------------------------------------------------------
create or replace function api.start_sync_run(p_connection_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from ingest.integration_connections where id = p_connection_id;
  if not found then raise exception 'connection not found' using errcode = 'P0002'; end if;
  insert into ingest.sync_runs (connection_id, status) values (p_connection_id, 'running') returning id into v_id;
  update ingest.integration_connections set last_attempt_at = now() where id = p_connection_id;
  return v_id;
end $$;

create or replace function api.finish_sync_run(
  p_run_id uuid, p_status text, p_read int default 0, p_created int default 0,
  p_updated int default 0, p_rejected int default 0, p_error text default null, p_checkpoint text default null, p_stream text default 'default'
) returns void language plpgsql security definer set search_path = '' as $$
declare
  r ingest.sync_runs%rowtype;
  c ingest.integration_connections%rowtype;
  v_detail text := nullif(btrim(p_error), '');
  v_advance boolean := false;
begin
  if p_status is null or p_status not in ('succeeded','partial','failed') then
    raise exception 'finish status must be succeeded, partial or failed' using errcode = '22023';
  end if;
  if p_read is null or p_created is null or p_updated is null or p_rejected is null
     or least(p_read, p_created, p_updated, p_rejected) < 0 then
    raise exception 'record counts must be zero or more' using errcode = '22023';
  end if;
  if p_status = 'succeeded' and p_rejected > 0 then
    raise exception 'a run that rejected records is partial, not succeeded' using errcode = '22023';
  end if;
  if p_checkpoint is not null and nullif(btrim(p_stream), '') is null then
    raise exception 'a checkpoint needs a stream' using errcode = '22023';
  end if;

  -- Lock the run, then its connection: concurrent finishes of one run, or of two
  -- runs of one connection, are serialised before anything is decided. NO KEY
  -- UPDATE is the lock the connection update below takes anyway, and it does not
  -- conflict with the KEY SHARE a new run's foreign key takes.
  select * into r from ingest.sync_runs where id = p_run_id for update;
  if not found then raise exception 'sync run not found' using errcode = 'P0002'; end if;
  if r.status <> 'running' then
    raise exception 'sync run already finished as %', r.status using errcode = '55000';
  end if;
  select * into c from ingest.integration_connections where id = r.connection_id for no key update;

  if p_status = 'partial' then
    v_detail := coalesce(v_detail, format('%s of %s records rejected', p_rejected, p_read));
  elsif p_status = 'failed' then
    v_detail := coalesce(v_detail, 'sync failed; the worker reported no error detail');
  end if;

  -- Only a complete success moves the cursor, and never over a checkpoint that
  -- was written after this run started.
  v_advance := p_status = 'succeeded' and p_checkpoint is not null
    and not exists (select 1 from ingest.connector_checkpoints k
                    where k.connection_id = r.connection_id and k.stream = p_stream and k.updated_at > r.started_at);

  update ingest.sync_runs set status = p_status, finished_at = now(), records_read = p_read,
         records_created = p_created, records_updated = p_updated, records_rejected = p_rejected, error = v_detail
  where id = p_run_id;

  update ingest.integration_connections
  set status = case p_status when 'succeeded' then 'healthy' when 'partial' then 'degraded' else 'failed' end,
      last_success_at = case when p_status = 'succeeded' then now() else last_success_at end,
      last_error = case when p_status = 'succeeded' then null else v_detail end
  where id = r.connection_id;

  if v_advance then
    insert into ingest.connector_checkpoints (connection_id, stream, cursor, updated_at)
    values (r.connection_id, p_stream, p_checkpoint, now())
    on conflict (connection_id, stream) do update set cursor = excluded.cursor, updated_at = excluded.updated_at;
  end if;

  if p_status = 'failed' then
    insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
    values (c.workspace_id, 'failed_webhook', 'high', 'integration_connection', c.id,
            format('%s sync failed', c.name), jsonb_build_object('error', v_detail, 'run_id', p_run_id));
  end if;

  perform audit.emit(c.workspace_id, 'sync_run.finished', 'ingest', 'sync_runs', p_run_id, null,
    jsonb_build_object('status', p_status, 'read', p_read, 'created', p_created, 'updated', p_updated, 'rejected', p_rejected,
                       'stream', p_stream, 'proposed_checkpoint', p_checkpoint, 'checkpoint_advanced', v_advance),
    v_detail, '{}'::jsonb);
end $$;

revoke all on function api.start_sync_run(uuid) from public, anon, authenticated;
revoke all on function api.finish_sync_run(uuid,text,int,int,int,int,text,text,text) from public, anon, authenticated;
grant execute on function api.start_sync_run(uuid) to service_role;
grant execute on function api.finish_sync_run(uuid,text,int,int,int,int,text,text,text) to service_role;

comment on function api.start_sync_run(uuid) is
  'Connector worker only (service_role): open a running sync run and record the attempt. Members cannot execute it.';
comment on function api.finish_sync_run(uuid,text,int,int,int,int,text,text,text) is
  'Connector worker only (service_role): finish a running run once. Only succeeded moves last_success_at and the checkpoint; partial and failed keep both and record the detail.';
