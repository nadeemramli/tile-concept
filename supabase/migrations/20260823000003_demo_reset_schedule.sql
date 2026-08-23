-- Reset the demo workspace once a week.
--
-- Guests share one workspace, which was a deliberate choice: it needs no auth
-- configuration change and no per-visitor provisioning. The cost is that they can
-- see and undo each other's work, so the demo has to be restored on a schedule or
-- it degrades into whatever the last visitor left behind.
--
-- Sunday 18:00 UTC is Monday 02:00 in Asia/Kuala_Lumpur — the workspace timezone,
-- and the quietest hour for anyone actually looking at it.
--
-- The reset is core.reset_demo_workspace(), the same function that built the
-- workspace in the first place, so what a visitor sees on a Monday morning is
-- exactly what the migration produced and never a partially cleaned variant.
--
-- Guarded on availability: pg_cron is present on Supabase and in the local stack,
-- but a database without it should still apply this migration and simply not have
-- a schedule, rather than failing the whole chain.
do $$
declare
  v_jobid bigint;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here; the demo workspace will not reset automatically';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Idempotent: re-running this migration must not leave two schedules behind.
  select jobid into v_jobid from cron.job where jobname = 'demo-workspace-weekly-reset';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'demo-workspace-weekly-reset',
    '0 18 * * 0',
    'select core.reset_demo_workspace();'
  );
end $$;
