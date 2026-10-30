-- TILE-85: the five quotation history/reference/evidence views authorize each
-- row with the caller's own membership in that row's workspace (TILE-62 per-row
-- semantics), never with a permission held in another workspace.
-- Synthetic users, workspaces and rows only; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
-- Rows of workspace ws visible in each of the five views, as name=count.
create function pg_temp.visible(ws uuid) returns text language sql as $$
  select concat_ws(',',
    'references=' || (select count(*) from api.quote_references where workspace_id = ws),
    'deliveries=' || (select count(*) from api.quote_deliveries where workspace_id = ws),
    'voids=' || (select count(*) from api.quote_delivery_voids where workspace_id = ws),
    'events=' || (select count(*) from api.quote_events where workspace_id = ws),
    'evidence=' || (select count(*) from api.visit_quote_evidence_decisions where workspace_id = ws))
$$;
create function pg_temp.set_role(ws uuid, uid uuid, r text) returns void language sql as $$
  update core.memberships set role_key = r where workspace_id = ws and user_id = uid
$$;

-- Workspace A (the acting one: its membership is older) and workspace B.
insert into core.workspaces(id, slug, name) values
  ('99999999-8500-0000-0000-00000000000a', 'tile85-a', 'Synthetic TILE-85 workspace A'),
  ('99999999-8500-0000-0000-00000000000b', 'tile85-b', 'Synthetic TILE-85 workspace B'),
  ('99999999-8500-0000-0000-00000000000c', 'tile85-c', 'Synthetic TILE-85 workspace C');
insert into auth.users(id, email) values
  ('eeeeeeee-8500-0000-0000-0000000000f1', 'tile85-mixed@example.test'),
  ('eeeeeeee-8500-0000-0000-0000000000f2', 'tile85-outsider@example.test');
insert into core.memberships(workspace_id, user_id, role_key, created_at) values
  ('99999999-8500-0000-0000-00000000000a', 'eeeeeeee-8500-0000-0000-0000000000f1', 'admin', now() - interval '2 days'),
  ('99999999-8500-0000-0000-00000000000b', 'eeeeeeee-8500-0000-0000-0000000000f1', 'catalog_pricing', now() - interval '1 day'),
  ('99999999-8500-0000-0000-00000000000c', 'eeeeeeee-8500-0000-0000-0000000000f2', 'admin', now());

-- One row in each of the five tables, in A and in B.
do $$
declare ws uuid; tag text; v uuid; q uuid; qv uuid; d uuid; f uuid;
begin
  foreach ws in array array['99999999-8500-0000-0000-00000000000a','99999999-8500-0000-0000-00000000000b']::uuid[] loop
    tag := right(ws::text, 1);
    insert into sales.visits(workspace_id, purpose) values (ws, 'consultation') returning id into v;
    insert into sales.quotes(workspace_id, visit_id, status, current_version_no, origin) values (ws, v, 'issued', 1, 'visit') returning id into q;
    insert into sales.quote_versions(workspace_id, quote_id, version_no, prepared_at, issued_at, currency, evidence_state)
      values (ws, q, 1, now() - interval '1 hour', now() - interval '30 minutes', 'MYR', 'staff_entered') returning id into qv;
    insert into sales.quote_references(workspace_id, ref_key, quote_id, ref_text, ref_kind) values (ws, 'SQTILE85' || upper(tag), q, 'SQ-TILE85-' || tag, 'external_ref');
    insert into sales.quote_deliveries(workspace_id, quote_id, quote_version_id, sent_at, channel, sent_by, evidence, recorded_by, request_id)
      values (ws, q, qv, now() - interval '10 minutes', 'email', 'eeeeeeee-8500-0000-0000-0000000000f1', 'staff_attested', 'eeeeeeee-8500-0000-0000-0000000000f1', gen_random_uuid()) returning id into d;
    insert into sales.quote_delivery_voids(delivery_id, workspace_id, reason, voided_by) values (d, ws, 'Synthetic void', 'eeeeeeee-8500-0000-0000-0000000000f1');
    insert into sales.quote_events(workspace_id, quote_id, quote_version_id, event_type, occurred_at) values (ws, q, qv, 'issued', now());
    insert into sales.visit_quotation_files(id, workspace_id, visit_id, object_path, file_name, content_type, file_size, created_by, uploaded_at)
      values (gen_random_uuid(), ws, v, ws || '/' || v || '/tile85.pdf', 'tile85.pdf', 'application/pdf', 10, 'eeeeeeee-8500-0000-0000-0000000000f1', now()) returning id into f;
    insert into sales.visit_quote_evidence_decisions(workspace_id, visit_id, evidence_kind, file_id, resolution, quote_id, snapshot, decided_by)
      values (ws, v, 'file', f, 'linked', q, '{}', 'eeeeeeee-8500-0000-0000-0000000000f1');
  end loop;
end $$;

create temp table ws as select '99999999-8500-0000-0000-00000000000a'::uuid as a, '99999999-8500-0000-0000-00000000000b'::uuid as b;
grant select on ws to authenticated;
create temp table none_visible as select 'references=0,deliveries=0,voids=0,events=0,evidence=0'::text as v;
create temp table all_visible as select 'references=1,deliveries=1,voids=1,events=1,evidence=1'::text as v;
grant select on none_visible, all_visible to authenticated;

set local role authenticated;
select pg_temp.act_as('eeeeeeee-8500-0000-0000-0000000000f1');

-- 1. Admin in A, catalog/pricing (no sales.read) in B.
select is(pg_temp.visible((select a from ws)), (select v from all_visible), 'admin A reads its own workspace history');
select is(pg_temp.visible((select b from ws)), (select v from none_visible), 'admin A + catalog B: no B quotation history in any of the five views');

-- 2. Catalog/pricing in A (acting, denied), sales rep in B: B stays readable.
reset role;
select pg_temp.set_role((select a from ws), 'eeeeeeee-8500-0000-0000-0000000000f1', 'catalog_pricing');
select pg_temp.set_role((select b from ws), 'eeeeeeee-8500-0000-0000-0000000000f1', 'sales_rep');
set local role authenticated;
select pg_temp.act_as('eeeeeeee-8500-0000-0000-0000000000f1');
select is(pg_temp.visible((select b from ws)), (select v from all_visible), 'catalog A + rep B: the B membership still reads B history');
select is(pg_temp.visible((select a from ws)), (select v from none_visible), 'catalog A + rep B: no A history without sales.read in A');

-- 3. Readers in both: each workspace exactly as its own membership allows.
reset role;
select pg_temp.set_role((select a from ws), 'eeeeeeee-8500-0000-0000-0000000000f1', 'sales_rep');
set local role authenticated;
select pg_temp.act_as('eeeeeeee-8500-0000-0000-0000000000f1');
select is(pg_temp.visible((select a from ws)) || ';' || pg_temp.visible((select b from ws)),
  (select v from all_visible) || ';' || (select v from all_visible), 'rep A + rep B: both workspaces readable');

-- 4. Suspended B membership with a reading role, admin A: B is denied.
reset role;
select pg_temp.set_role((select a from ws), 'eeeeeeee-8500-0000-0000-0000000000f1', 'admin');
update core.memberships set status = 'suspended' where workspace_id = (select b from ws) and user_id = 'eeeeeeee-8500-0000-0000-0000000000f1';
set local role authenticated;
select pg_temp.act_as('eeeeeeee-8500-0000-0000-0000000000f1');
select is(pg_temp.visible((select b from ws)), (select v from none_visible), 'admin A + suspended rep B: no B history');

-- 5. Removed B membership: B is denied.
reset role;
delete from core.memberships where workspace_id = (select b from ws) and user_id = 'eeeeeeee-8500-0000-0000-0000000000f1';
set local role authenticated;
select pg_temp.act_as('eeeeeeee-8500-0000-0000-0000000000f1');
select is(pg_temp.visible((select b from ws)), (select v from none_visible), 'admin A, no B membership: no B history');

-- 6. An admin of another workspace only: neither A nor B.
select pg_temp.act_as('eeeeeeee-8500-0000-0000-0000000000f2');
select is(pg_temp.visible((select a from ws)) || ';' || pg_temp.visible((select b from ws)),
  (select v from none_visible) || ';' || (select v from none_visible), 'admin of an unrelated workspace reads neither');

-- 7. Anonymous callers and the request ledger stay closed.
reset role;
set local role anon;
select throws_ok($$select count(*) from api.quote_events$$, '42501', null, 'anonymous cannot read quote history');
reset role;
set local role authenticated;
select pg_temp.act_as('eeeeeeee-8500-0000-0000-0000000000f1');
select throws_ok($$select count(*) from sales.quote_requests$$, '42501', null, 'the request ledger stays private');

-- 8. The policies themselves: per-row workspace permission, no acting-membership check.
reset role;
select is((select array_agg(tablename::text order by tablename) from pg_policies
            where schemaname = 'sales' and tablename in ('quote_references','quote_deliveries','quote_delivery_voids','quote_events','visit_quote_evidence_decisions')
              and policyname = 'member_read' and cmd = 'SELECT'
              and qual like '%permitted_workspace_ids(''sales.read''::text)%' and qual not like '%has_permission(%'),
          array['quote_deliveries','quote_delivery_voids','quote_events','quote_references','visit_quote_evidence_decisions'],
          'each of the five read policies uses the row workspace''s own sales.read');
select is((select count(*) from pg_policies
            where schemaname = 'sales' and tablename in ('quote_references','quote_deliveries','quote_delivery_voids','quote_events','visit_quote_evidence_decisions')),
          5::bigint, 'still exactly one policy (read) on each: no write path was added');

select * from finish();
rollback;
