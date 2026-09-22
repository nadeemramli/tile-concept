
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into identity.accounts(id, workspace_id, name)
values ('aaaaaaaa-3419-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Synthetic optional due company');
create temp table created(result jsonb);
grant all on created to authenticated;
create function pg_temp.project_input(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'account_id', 'aaaaaaaa-3419-0000-0000-000000000001',
    'name', 'Synthetic undated opportunity',
    'project_name', 'Synthetic undated project',
    'create_project', true,
    'next_action', 'Send proposal',
    'currency', 'MYR'
  ) || extra;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);

select lives_ok($$insert into created select api.opportunity_command('create', pg_temp.project_input(), 'dddddddd-3419-0000-0000-000000000001')$$,
  'project and opportunity can be created without a due date');
select ok((select o.next_action_due_at is null and o.project_id = (c.result->>'project_id')::uuid
  from api.opportunities o join created c on o.id = (c.result->>'opportunity_id')::uuid),
  'opportunity is linked to the new project and has no invented due date');
select is(api.opportunity_command('create', pg_temp.project_input(), 'dddddddd-3419-0000-0000-000000000001'),
  (select result from created), 'undated creation retry returns the original records');
select throws_ok($$select api.opportunity_command('create', pg_temp.project_input('{"next_action":"Changed"}'), 'dddddddd-3419-0000-0000-000000000001')$$,
  '23514', 'Retry differs from original command', 'changed retry is rejected');
select lives_ok($$select api.opportunity_command('create', pg_temp.project_input('{"next_action_due_at":""}'), gen_random_uuid())$$,
  'blank due date is also accepted for new projects');
select lives_ok($$select api.opportunity_command('create', pg_temp.project_input('{"next_action_due_at":null}'), gen_random_uuid())$$,
  'null due date is accepted for new projects');
select throws_ok($$select api.opportunity_command('create', pg_temp.project_input('{"next_action":""}'), gen_random_uuid())$$,
  '23514', 'Enter a next action and due date', 'new project opportunity still needs a next action');
select throws_ok($$select api.opportunity_command('create', pg_temp.project_input('{"create_project":false}'), gen_random_uuid())$$,
  '23514', 'Enter a next action and due date', 'standalone opportunity still requires a due date');
select throws_ok($$select api.opportunity_command('edit', pg_temp.project_input(jsonb_build_object('id',o.id,'version',o.version)),gen_random_uuid())
  from api.opportunities o join created c on o.id=(c.result->>'opportunity_id')::uuid$$,
  '23514', 'Enter a next action and due date', 'create_project flag cannot bypass open-opportunity edit validation');
select throws_ok($$select api.opportunity_command('create', pg_temp.project_input('{"owner_id":"aaaaaaaa-0000-0000-0000-000000000004"}'), gen_random_uuid())$$,
  '42501', 'permission denied: sales.assign', 'undated creation retains owner assignment restrictions');
select throws_ok($$select api.opportunity_command('create', pg_temp.project_input('{"account_id":"aaaaaaaa-3419-0000-0000-000000000099"}'), gen_random_uuid())$$,
  '23514', 'Choose an active company in this workspace', 'undated creation retains workspace identity validation');
select lives_ok($$select api.opportunity_command('create', pg_temp.project_input('{"create_opportunity":false,"next_action":null}'), gen_random_uuid())$$,
  'project-only creation still works without opportunity follow-up fields');

reset role;
select ok(not has_function_privilege('anon','api.opportunity_command(text,jsonb,uuid)','EXECUTE'),
  'anonymous callers still cannot execute opportunity commands');
select * from finish();
rollback;
