-- TILE-62: a permission held in one workspace never authorizes another.
--
-- Workspace A is the seed workspace and B the synthetic demo workspace; both
-- hold synthetic rows only. Every account below is synthetic and the whole file
-- is rolled back.
--
-- Rules under test (supabase/migrations/20261029000002_workspace_permission_scope.sql):
--   * rows (RLS and the cross-workspace report readers) follow the membership in
--     the row's own workspace;
--   * commands (SECURITY DEFINER RPCs), core.has_permission, api.my_permissions
--     and the app session follow the acting membership, and a command only
--     touches records of the acting workspace.
--
-- Ported from commit 9e6dffb (draft PR #40) without its TILE-32 workspace-entry
-- migration, which defines the driver/warehouse roles and
-- api.my_workspace_permissions. Here those roles are test-only fixtures holding
-- no permission at all (on PR #40 they hold only admin-area keys, none of which
-- exist on this branch), and the acting membership's permissions are computed
-- with core.has_permission_in. Every case and assertion is otherwise unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into core.roles(key,label,rank) values
  ('driver','Synthetic driver (test fixture, no permissions)',985),
  ('warehouse','Synthetic warehouse (test fixture, no permissions)',980)
on conflict (key) do nothing;
-- The acting membership's permissions, judged independently of core.has_permission.
create function pg_temp.acting_permissions() returns setof text language sql as $$
  select rp.permission from (select distinct permission from core.role_permissions) rp
  where core.has_permission_in(core.current_workspace_id(), rp.permission)
$$;

create function pg_temp.act_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
-- Rows a statement changed (RLS hides rows from UPDATE/DELETE instead of raising).
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
-- Rows a legitimate write would change, rolled back so the fingerprint holds.
create function pg_temp.affected_undone(q text) returns int language plpgsql as $$
declare n int; begin
  begin execute q; get diagnostics n = row_count; raise exception using errcode = 'TC062', message = n::text;
  exception when sqlstate 'TC062' then return sqlerrm::int; end;
end $$;
-- Rows a reader returned, or -1 when it refused with 42501.
create function pg_temp.rows_or_denied(q text) returns int language plpgsql as $$
declare n int; begin execute format('select count(*) from (%s) x', q) into n; return n;
exception when insufficient_privilege then return -1; end $$;

create temp table ws(a uuid, b uuid);
insert into ws values ('11111111-1111-1111-1111-111111111111', core.demo_workspace_id());

-- Fixture rows in A that the probes aim at.
create temp table a_fixture as
select (select id from sales.leads where workspace_id=(select a from ws) order by id limit 1) as lead_id,
       (select id from identity.contacts where workspace_id=(select a from ws) and merged_into_contact_id is null order by id limit 1) as contact_id,
       (select id from identity.contacts where workspace_id=(select a from ws) and merged_into_contact_id is null order by id offset 1 limit 1) as contact2_id,
       (select id from sales.opportunities where workspace_id=(select a from ws) order by id limit 1) as opportunity_id,
       (select id from identity.contacts where workspace_id=(select b from ws) and merged_into_contact_id is null order by id limit 1) as b_contact_id,
       (select id from sales.leads where workspace_id=(select b from ws) order by id limit 1) as b_lead_id;
-- Every customer/sales entity id in A, to recognise A results from RPC readers.
create temp table a_ids as
  select id from sales.leads where workspace_id=(select a from ws)
  union all select id from identity.contacts where workspace_id=(select a from ws)
  union all select id from identity.accounts where workspace_id=(select a from ws)
  union all select id from identity.projects where workspace_id=(select a from ws)
  union all select id from sales.opportunities where workspace_id=(select a from ws)
  union all select id from sales.purchases where workspace_id=(select a from ws);
create temp table expected as
select (select count(*)::int from sales.leads where workspace_id=(select a from ws)) as a_leads,
       (select count(*)::int from sales.leads where workspace_id=(select b from ws)) as b_leads,
       (select count(*)::int from identity.contacts where workspace_id=(select b from ws)) as b_contacts;
-- A fingerprint of workspace A's protected data, compared after every probe.
create function pg_temp.a_fingerprint() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(to_jsonb(l)::text, ',' order by l.id) from sales.leads l where l.workspace_id='11111111-1111-1111-1111-111111111111'),
    (select string_agg(to_jsonb(c)::text, ',' order by c.id) from identity.contacts c where c.workspace_id='11111111-1111-1111-1111-111111111111'),
    (select string_agg(to_jsonb(p)::text, ',' order by p.id) from identity.contact_points p where p.workspace_id='11111111-1111-1111-1111-111111111111'),
    (select string_agg(to_jsonb(o)::text, ',' order by o.id) from sales.opportunities o where o.workspace_id='11111111-1111-1111-1111-111111111111'),
    (select string_agg(to_jsonb(m)::text, ',' order by m.id) from core.memberships m where m.workspace_id='11111111-1111-1111-1111-111111111111'),
    (select string_agg(to_jsonb(i)::text, ',' order by i.id) from core.membership_invites i where i.workspace_id='11111111-1111-1111-1111-111111111111'),
    (select to_jsonb(w)::text from core.workspaces w where w.id='11111111-1111-1111-1111-111111111111'),
    (select count(*)::text from audit.audit_events e where e.workspace_id='11111111-1111-1111-1111-111111111111')))
$$;

-- Synthetic people. The oldest active membership is the acting one.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false
from (values
  ('dddddddd-6200-0000-0000-000000000001'::uuid,'synthetic.scope.driver-a.admin-b@tileconcept.test'),
  ('dddddddd-6200-0000-0000-000000000002'::uuid,'synthetic.scope.admin-b.driver-a@tileconcept.test'),
  ('dddddddd-6200-0000-0000-000000000003'::uuid,'synthetic.scope.warehouse-a.manager-b@tileconcept.test'),
  ('dddddddd-6200-0000-0000-000000000004'::uuid,'synthetic.scope.manager-b.analyst-a@tileconcept.test'),
  ('dddddddd-6200-0000-0000-000000000005'::uuid,'synthetic.scope.rep-a.rep-b@tileconcept.test'),
  ('dddddddd-6200-0000-0000-000000000006'::uuid,'synthetic.scope.admin-b@tileconcept.test'),
  ('dddddddd-6200-0000-0000-000000000007'::uuid,'synthetic.scope.suspended-admin-a@tileconcept.test'),
  ('dddddddd-6200-0000-0000-000000000008'::uuid,'synthetic.scope.no-membership@tileconcept.test')
) as u(id,email);
insert into core.memberships(workspace_id,user_id,role_key,status,created_at)
select case w when 'a' then ws.a else ws.b end, u, r, s, now() - (d || ' days')::interval
from ws, (values
  ('dddddddd-6200-0000-0000-000000000001'::uuid,'a','driver','active',2), ('dddddddd-6200-0000-0000-000000000001'::uuid,'b','admin','active',1),
  ('dddddddd-6200-0000-0000-000000000002'::uuid,'b','admin','active',2), ('dddddddd-6200-0000-0000-000000000002'::uuid,'a','driver','active',1),
  ('dddddddd-6200-0000-0000-000000000003'::uuid,'a','warehouse','active',2), ('dddddddd-6200-0000-0000-000000000003'::uuid,'b','sales_manager','active',1),
  ('dddddddd-6200-0000-0000-000000000004'::uuid,'b','sales_manager','active',2), ('dddddddd-6200-0000-0000-000000000004'::uuid,'a','analyst','active',1),
  ('dddddddd-6200-0000-0000-000000000005'::uuid,'a','sales_rep','active',2), ('dddddddd-6200-0000-0000-000000000005'::uuid,'b','sales_rep','active',1),
  ('dddddddd-6200-0000-0000-000000000006'::uuid,'b','admin','active',1),
  -- Suspended admin here; the only active membership is a driver in B.
  ('dddddddd-6200-0000-0000-000000000007'::uuid,'a','admin','suspended',2), ('dddddddd-6200-0000-0000-000000000007'::uuid,'b','driver','active',1)
) as m(u,w,r,s,d);
-- The dual sales rep owns one B lead (the shared enquiry inbox shows reps every lead).
update sales.leads set owner_id='dddddddd-6200-0000-0000-000000000005' where id=(select b_lead_id from a_fixture);
-- Taken with every fixture in place; compared once all denial probes have run.
create temp table fingerprint as select pg_temp.a_fingerprint() as before;

-- Results of the B-only admin, to compare cross-workspace readers against.
create temp table reference(label text, value text);
grant select, insert on reference to authenticated;
grant select on ws, a_fixture, a_ids, expected to authenticated, service_role;
grant execute on all functions in schema pg_temp to authenticated;

select ok((select a_leads from expected) > 0 and (select b_leads from expected) > 0
          and (select count(*) from a_fixture where lead_id is not null and contact2_id is not null and opportunity_id is not null and b_contact_id is not null) = 1,
          'fixture: both workspaces hold synthetic sales and customer rows');

------------------------------------------------------------------------------
-- Probes
------------------------------------------------------------------------------
-- Every A row of a protected surface this caller can see.
create function pg_temp.a_visible() returns int language sql as $$
  select (select count(*) from api.leads where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.contacts where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.contact_points where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.accounts where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.opportunities where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.purchases where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.tasks where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.visits where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.audit_events where workspace_id='11111111-1111-1111-1111-111111111111')
       + (select count(*) from api.membership_invites where workspace_id='11111111-1111-1111-1111-111111111111')
$$;

-- Weak (or no) membership in A, stronger membership in B: nothing in A.
create function pg_temp.no_power_in_a(who text) returns setof text language plpgsql as $$
declare f record;
begin
  select * into f from a_fixture;
  return next is(pg_temp.a_visible()::int, 0, who || ': sees no A sales, customer, contact-point, audit or invite rows');
  return next is((select count(*)::int from api.global_search('a') s where s.entity_id in (select id from a_ids)), 0, who || ': global search returns nothing from A');
  return next is((select count(*)::int from core.lead_followup_rollup() r where r.lead_id in (select id from a_ids)), 0, who || ': follow-up rollup returns no A leads');
  return next ok(pg_temp.rows_or_denied(format('select * from api.entity_timeline(%L,%L)', 'contact', f.contact_id)) <= 0, who || ': cannot read an A contact timeline');
  return next ok(pg_temp.rows_or_denied(format('select * from api.lead_followup_summary(%L)', f.lead_id)) <= 0, who || ': cannot read an A lead follow-up summary');
  return next throws_ok(format('select * from api.reveal_contact_points(%L)', f.contact_id), '42501', null, who || ': cannot reveal A contact points');
  return next throws_ok(format('select api.suggest_contact_duplicates(%L)', f.contact_id), '42501', null, who || ': cannot run duplicate detection on an A contact');
  return next throws_ok(format($q$insert into api.leads(workspace_id, source_channel) values (%L,'other')$q$, '11111111-1111-1111-1111-111111111111'), '42501', null, who || ': cannot insert an A lead');
  return next throws_ok(format($q$insert into api.contacts(workspace_id, display_name) values (%L,'Synthetic probe')$q$, '11111111-1111-1111-1111-111111111111'), '42501', null, who || ': cannot insert an A contact');
  return next is(pg_temp.affected($q$update api.leads set source_channel = source_channel where workspace_id = '11111111-1111-1111-1111-111111111111'$q$), 0, who || ': cannot update A leads');
  return next is(pg_temp.affected($q$update api.contacts set display_name = display_name where workspace_id = '11111111-1111-1111-1111-111111111111'$q$), 0, who || ': cannot update A contacts');
  return next is(pg_temp.affected($q$delete from api.contact_points where workspace_id = '11111111-1111-1111-1111-111111111111'$q$), 0, who || ': cannot delete A contact points');
  return next throws_ok(format('select api.assign_lead(%L,%L)', f.lead_id, 'aaaaaaaa-0000-0000-0000-000000000003'), '42501', null, who || ': cannot assign an A lead');
  return next throws_ok(format('select api.change_opportunity_stage(%L,%L,%L)', f.opportunity_id, 'contacted', 'probe'), '42501', null, who || ': cannot move an A opportunity');
  return next throws_ok(format('select api.merge_contacts(%L,%L,%L)', f.contact_id, f.contact2_id, 'probe'), '42501', null, who || ': cannot merge A contacts');
  -- Settings and role mutations.
  return next throws_ok(format($q$insert into api.membership_invites(workspace_id, email, role_key) values (%L,'synthetic.scope.invite@tileconcept.test','admin')$q$, '11111111-1111-1111-1111-111111111111'), '42501', null, who || ': cannot invite into A');
  return next is(pg_temp.affected($q$update api.memberships set role_key = 'admin' where workspace_id = '11111111-1111-1111-1111-111111111111'$q$), 0, who || ': cannot change roles in A');
  return next is(pg_temp.affected($q$update api.workspaces set name = name where id = '11111111-1111-1111-1111-111111111111'$q$), 0, who || ': cannot change A workspace settings');
  return next throws_ok(format($q$insert into api.saved_views(workspace_id, user_id, surface, name) values (%L, null, 'leads', 'Synthetic shared view')$q$, '11111111-1111-1111-1111-111111111111'), '42501', null, who || ': cannot publish a shared view in A');
end $$;

-- The session mirror and core.has_permission follow the acting membership.
create function pg_temp.acting_only(who text) returns setof text language plpgsql as $$
begin
  return next is((select coalesce(array_agg(p order by p), '{}') from api.my_permissions() p),
                 (select coalesce(array_agg(p order by p), '{}') from pg_temp.acting_permissions() p),
                 who || ': api.my_permissions is the acting membership''s permissions');
  return next is((select bool_and(core.has_permission(rp.permission) = (rp.permission in (select pg_temp.acting_permissions())))
                  from (select distinct permission from core.role_permissions) rp), true,
                 who || ': core.has_permission agrees with the acting membership for every key');
end $$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;

-- Reference: an admin whose only membership is B.
select pg_temp.act_as('dddddddd-6200-0000-0000-000000000006');
insert into reference
  select 'report_lead_source', coalesce(sum(leads), 0)::text from api.report_lead_source()
  union all select 'report_stock_freshness', count(*)::text from api.report_stock_freshness()
  union all select 'rollup', count(*)::text from core.lead_followup_rollup()
  union all select 'b_leads', count(*)::text from api.leads where workspace_id = (select b from ws);
select is((select value from reference where label = 'b_leads')::int, (select b_leads from expected), 'reference: a B-only admin reads every B lead');
select pg_temp.acting_only('B-only admin');

------------------------------------------------------------------------------
-- 1. Driver in A (acting) + admin in B — the reproduced leak
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-6200-0000-0000-000000000001');
select ok(not core.has_permission_in((select a from ws), 'sales.read'), 'driver A + admin B: no sales.read in A');
select ok(not core.has_permission('sales.read') and not core.has_permission('sales.read_all') and not core.has_permission('settings.manage'),
          'driver A + admin B: acting permissions carry nothing from B');
select is((select count(*)::int from api.leads where workspace_id = (select a from ws)), 0, 'driver A + admin B: sees no A leads (was 30)');
select is((select count(*)::int from api.contacts where workspace_id = (select a from ws)), 0, 'driver A + admin B: sees no A contacts (was 41)');
select * from pg_temp.no_power_in_a('driver A + admin B');
select * from pg_temp.acting_only('driver A + admin B');
select throws_ok($$select api.command_centre_summary()$$, '42501', null, 'driver A + admin B: no sales summary');
select throws_ok($$select api.create_contact('Synthetic probe')$$, '42501', null, 'driver A + admin B: cannot create a contact in the acting workspace');
select is((select count(*)::int from api.leads where workspace_id = (select b from ws)), (select b_leads from expected), 'driver A + admin B: still reads B leads through the B admin membership');
select is((select coalesce(sum(leads), 0)::text from api.report_lead_source()), (select value from reference where label = 'report_lead_source'), 'driver A + admin B: lead-source report covers B only');
select is((select count(*)::text from api.report_stock_freshness()), (select value from reference where label = 'report_stock_freshness'), 'driver A + admin B: stock report covers B only');

------------------------------------------------------------------------------
-- 2. Admin in B (acting) + driver in A — acting permissions must not reach A rows
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-6200-0000-0000-000000000002');
select ok(core.has_permission('sales.read_all') and core.has_permission('settings.manage'), 'admin B + driver A: acts as the B admin');
select * from pg_temp.no_power_in_a('admin B + driver A');
select * from pg_temp.acting_only('admin B + driver A');
select is((select count(*)::text from core.lead_followup_rollup()), (select value from reference where label = 'rollup'), 'admin B + driver A: rollup equals the B-only admin''s');
select is((select coalesce(sum(leads), 0)::text from api.report_lead_source()), (select value from reference where label = 'report_lead_source'), 'admin B + driver A: lead-source report covers B only');
select is((select count(*)::text from api.report_stock_freshness()), (select value from reference where label = 'report_stock_freshness'), 'admin B + driver A: stock report covers B only');
-- Legitimate: everything the B admin membership grants, in B.
select ok((select count(*) from api.reveal_contact_points((select b_contact_id from a_fixture))) >= 0, 'admin B + driver A: reveals B contact points');
insert into reference select 'created_contact', api.create_contact('Synthetic scope probe')::text;
select is((select workspace_id from api.contacts where id = (select value from reference where label = 'created_contact')::uuid), (select b from ws), 'admin B + driver A: creates a contact in B');
select is(pg_temp.affected(format($q$update api.leads set source_channel = source_channel where id = %L$q$, (select b_lead_id from a_fixture))), 1, 'admin B + driver A: updates a B lead');
select ok(api.command_centre_summary() is not null, 'admin B + driver A: reads the B sales summary');

------------------------------------------------------------------------------
-- 3. Warehouse in A (acting) + sales manager in B
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-6200-0000-0000-000000000003');
select * from pg_temp.no_power_in_a('warehouse A + manager B');
select * from pg_temp.acting_only('warehouse A + manager B');
select throws_ok($$select api.command_centre_summary()$$, '42501', null, 'warehouse A + manager B: no sales summary');
select is((select count(*)::int from api.leads where workspace_id = (select b from ws)), (select b_leads from expected), 'warehouse A + manager B: reads B leads through the B manager membership');

------------------------------------------------------------------------------
-- 4. Sales manager in B (acting) + read-only analyst in A
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-6200-0000-0000-000000000004');
select * from pg_temp.no_power_in_a('manager B + analyst A');
select * from pg_temp.acting_only('manager B + analyst A');
-- Legitimate: the analyst membership grants the masked A reports (and no A rows, above).
select is((select coalesce(sum(leads), 0)::int from api.report_lead_source()), (select a_leads + b_leads from expected),
          'manager B + analyst A: lead-source report covers A through the analyst membership and B through the manager');

------------------------------------------------------------------------------
-- 5. Suspended and missing memberships confer nothing
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-6200-0000-0000-000000000007');
select is(core.current_workspace_id(), (select b from ws), 'suspended admin A + driver B: acts in B, the only active membership');
select * from pg_temp.no_power_in_a('suspended admin A + driver B');
select * from pg_temp.acting_only('suspended admin A + driver B');
select is((select count(*)::int from api.leads), 0, 'suspended admin A + driver B: no leads anywhere');

select pg_temp.act_as('dddddddd-6200-0000-0000-000000000008');
select * from pg_temp.no_power_in_a('no membership');
select is((select count(*)::int from api.my_permissions()), 0, 'no membership: no permissions');
select throws_ok($$select api.create_contact('Synthetic probe')$$, '42501', null, 'no membership: cannot create a contact');

select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from api.leads), 0, 'unauthenticated: no leads');
select throws_ok($$select api.create_contact('Synthetic probe')$$, null, null, 'unauthenticated: commands refuse');


reset role;
select is(pg_temp.a_fingerprint(), (select before from fingerprint),
          'after every denial probe: no A lead, contact, contact point, opportunity, membership, invite, workspace or audit row changed');
set local role authenticated;

------------------------------------------------------------------------------
-- 6. Sales rep in A (acting) and in B — legitimate access in both
------------------------------------------------------------------------------
select pg_temp.act_as('dddddddd-6200-0000-0000-000000000005');
select * from pg_temp.acting_only('rep A + rep B');
select is((select count(*)::int from api.leads where workspace_id = (select a from ws)), (select a_leads from expected), 'rep A + rep B: reads the A enquiry inbox through the A rep membership');
select is((select count(*)::int from api.leads where workspace_id = (select b from ws)), (select b_leads from expected), 'rep A + rep B: reads the B enquiry inbox through the B rep membership');
select is((select count(*)::int from api.contacts where workspace_id = (select b from ws)), (select b_contacts from expected) + 1, 'rep A + rep B: reads B contacts (including the one created above) through the B rep membership');
select ok((select count(*) from api.reveal_contact_points((select contact_id from a_fixture))) >= 0, 'rep A + rep B: reveals A contact points (acting workspace)');
select is(pg_temp.affected(format($q$update api.leads set source_channel = source_channel where id = %L$q$, (select b_lead_id from a_fixture))), 1, 'rep A + rep B: updates its own B lead through RLS');
-- Commands act in the acting workspace only; there is no tenant selector.
select throws_ok(format('select * from api.reveal_contact_points(%L)', (select b_contact_id from a_fixture)), '42501', null, 'rep A + rep B: commands do not reach B records from the acting workspace A');
select ok(not core.has_permission('settings.manage') and not core.has_permission('identity.merge'), 'rep A + rep B: no admin or merge rights from anywhere');

------------------------------------------------------------------------------
-- 7. Ordinary single-membership roles keep their access
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from api.leads), (select a_leads from expected), 'admin: reads every A lead');
select ok(core.has_permission('settings.manage') and (select count(*) from api.reveal_contact_points((select contact_id from a_fixture))) >= 0, 'admin: settings and reveal intact');
select ok(pg_temp.affected_undone($q$update api.memberships set status = status where workspace_id = '11111111-1111-1111-1111-111111111111'$q$) > 0, 'admin: can still manage A memberships');
select * from pg_temp.acting_only('admin');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select is((select count(*)::int from api.leads), (select a_leads from expected), 'sales manager: reads every A lead');
select ok(api.command_centre_summary() is not null, 'sales manager: reads the sales summary');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select is((select count(*)::int from api.leads), (select a_leads from expected), 'sales rep: still reads the shared enquiry inbox');
select ok((select count(*) from api.global_search('a')) > 0, 'sales rep: global search still works');
select pg_temp.act_as('00000000-9999-4000-8000-000000000001');
select is((select count(*)::int from api.leads), (select b_leads from expected), 'demo guest: reads the demo workspace only');
select is((select count(*)::int from api.leads where workspace_id = (select a from ws)), 0, 'demo guest: nothing from A');

------------------------------------------------------------------------------
-- 8. Scoped service access and persistence
------------------------------------------------------------------------------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from sales.leads where workspace_id = (select a from ws)), (select a_leads from expected), 'service role: server-side tooling still reads A');
select is((select count(*)::int from api.my_permissions()), 0, 'service role: holds no member permissions');
reset role;

------------------------------------------------------------------------------
-- 9. Guards: nothing left on the aggregated path
------------------------------------------------------------------------------
select is((select coalesce(array_agg(schemaname || '.' || tablename || ':' || policyname order by 1), '{}')
           from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%core.has_permission(%'),
          '{}'::text[], 'no RLS policy authorizes rows with the acting-membership core.has_permission');
select is((select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}')
           from pg_proc p where p.prosrc like '%member_workspace_ids%' and p.prosrc like '%has_permission(%'),
          '{}'::text[], 'no function pairs every-membership rows with a single permission check');

select * from finish();
rollback;
