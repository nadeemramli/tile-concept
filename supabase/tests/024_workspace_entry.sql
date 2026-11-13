-- TILE-32: workspace areas, new Admin System roles and the remembered default.
-- Synthetic accounts only; everything is rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
end $$;
create function pg_temp.perms(r text) returns text[] language sql as $$
  select coalesce(array_agg(permission order by permission),'{}') from core.role_permissions where role_key=r $$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false
from (values
  ('dddddddd-3200-0000-0000-000000000001'::uuid,'synthetic.driver@tileconcept.test'),
  ('dddddddd-3200-0000-0000-000000000002'::uuid,'synthetic.warehouse@tileconcept.test'),
  ('dddddddd-3200-0000-0000-000000000003'::uuid,'synthetic.office@tileconcept.test'),
  ('dddddddd-3200-0000-0000-000000000004'::uuid,'synthetic.management@tileconcept.test')
) as u(id,email);
insert into core.memberships(workspace_id,user_id,role_key) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-3200-0000-0000-000000000001','driver'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-3200-0000-0000-000000000002','warehouse'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-3200-0000-0000-000000000003','business_admin'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-3200-0000-0000-000000000004','management');

------------------------------------------------------------------------------
-- Grants are additive and exact
------------------------------------------------------------------------------
select is(pg_temp.perms('driver'),array['delivery.read_own','workspace.admin'],'driver holds only its own deliveries and the Admin System');
select is(pg_temp.perms('warehouse'),array['preparation.read','workspace.admin'],'warehouse holds only preparation and the Admin System');
select is(pg_temp.perms('business_admin'),array['admin.coordinate','preparation.read','workspace.admin'],'business admin employee holds only Admin System permissions');
select ok(not ('settings.manage' = any(pg_temp.perms('business_admin'))),'business admin employee is not a platform administrator');
select ok(array['workspace.operating','workspace.admin','overview.read'] <@ pg_temp.perms('management'),'management can enter both systems and starts on the overview');
select is((select array_agg(p order by p) from unnest(pg_temp.perms('management')) p
           where p in ('stock.write','settings.manage','purchase.correct','price.publish','review.approve','marketing.spend.review','marketing.spend.write','identity.merge','catalog.write','sales.assign','export.customer','audit.read_all')),
          null,'management oversight adds no stock, accounting, approval or user-management right');
select is((select count(*)::int from core.roles r where r.key not in ('business_admin','warehouse','driver')
           and not exists (select 1 from core.role_permissions rp where rp.role_key=r.key and rp.permission='workspace.operating')),
          0,'every pre-existing role keeps the Operating System');
select ok(not ('overview.read' = any(pg_temp.perms('admin'))),'platform administrator chooses a default instead of a fixed overview');
select ok(array['workspace.operating','workspace.admin','overview.read','admin.coordinate','preparation.read','delivery.read_own'] <@ pg_temp.perms('guest')
          and not ('settings.manage' = any(pg_temp.perms('guest'))),'guest keeps every permission except settings.manage');

------------------------------------------------------------------------------
-- A driver does not inherit sales or customer access
------------------------------------------------------------------------------
create temp table fixture_contact as select id from identity.contacts where workspace_id='11111111-1111-1111-1111-111111111111' limit 1;
grant select on fixture_contact to authenticated;
select ok((select count(*) from sales.leads where workspace_id='11111111-1111-1111-1111-111111111111')>0
          and (select count(*) from identity.contacts where workspace_id='11111111-1111-1111-1111-111111111111')>0,'fixture: the workspace has leads and contacts');

set local role authenticated;
select pg_temp.act_as('dddddddd-3200-0000-0000-000000000001');
select ok(not core.has_permission('sales.read') and not core.has_permission('contact.reveal') and not core.has_permission('catalog.read'),'driver has no sales, contact or catalogue permission');
select is((select count(*)::int from api.leads),0,'driver sees no leads');
select is((select count(*)::int from api.contacts),0,'driver sees no contacts');
select is((select count(*)::int from api.contact_points),0,'driver sees no phone numbers or emails');
select is((select count(*)::int from api.accounts),0,'driver sees no accounts');
select is((select count(*)::int from api.opportunities),0,'driver sees no opportunities');
select is((select count(*)::int from api.purchases),0,'driver sees no purchases');
select is((select count(*)::int from api.global_search('a')),0,'global search returns nothing to a driver');
select throws_ok($$select api.command_centre_summary()$$,'42501',null,'driver cannot read the sales summary');
select throws_ok($$select api.reveal_contact_points((select id from fixture_contact))$$,'42501',null,'driver cannot reveal contact points');

-- The remembered default is a preference and refuses an area the role lacks.
select throws_ok($$select api.set_default_area('operating')$$,'42501','permission denied: workspace.operating','driver cannot remember the Operating System');
select throws_ok($$select api.set_default_area('everything')$$,'22023',null,'unknown areas are refused');
select is(api.set_default_area('admin'),'admin','driver may remember the Admin System');
select is((select default_area from api.user_preferences),'admin','the remembered area persists for the driver');
select throws_ok($$insert into api.user_preferences(user_id,workspace_id,default_area) values ('dddddddd-3200-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','operating')$$,'42501',null,'preferences cannot be written around the function');
select throws_ok($$update api.user_preferences set default_area='operating'$$,'42501',null,'preferences cannot be updated around the function');

select pg_temp.act_as('dddddddd-3200-0000-0000-000000000002');
select throws_ok($$select api.set_default_area('operating')$$,'42501',null,'warehouse cannot remember the Operating System');
select is((select count(*)::int from api.leads),0,'warehouse sees no leads');

select pg_temp.act_as('dddddddd-3200-0000-0000-000000000003');
select is((select count(*)::int from api.contacts),0,'business admin employee sees no contacts');
select ok(not core.has_permission('settings.manage'),'business admin employee cannot manage users');

------------------------------------------------------------------------------
-- Dual-area members: remember, change and clear; never see others' rows
------------------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from api.user_preferences),0,'platform administrator has no default yet and cannot see the driver''s');
select is(api.set_default_area('operating'),'operating','platform administrator remembers the Operating System');
select is(api.set_default_area('admin'),'admin','and can change it to the Admin System');
select is((select default_area from api.user_preferences),'admin','the change persists');
select is(api.set_default_area(),null,'clearing returns to asking each time');
select is((select default_area from api.user_preferences),null,'the cleared default persists');

select pg_temp.act_as('dddddddd-3200-0000-0000-000000000004');
select ok((select count(*) from api.leads)>0,'management can browse Operating System records');
select ok(not core.has_permission('stock.write') and not core.has_permission('settings.manage') and not core.has_permission('purchase.correct'),'management browsing grants no approval');
select is(api.set_default_area('admin'),'admin','management may remember an area it can enter');

------------------------------------------------------------------------------
-- Dual membership: entry follows the acting membership, not the union
------------------------------------------------------------------------------
reset role;
insert into core.workspaces(id,slug,name) values ('99999999-3200-0000-0000-000000000002','synthetic-entry-other','Synthetic other workspace');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false
from (values
  ('dddddddd-3200-0000-0000-000000000011'::uuid,'synthetic.dual.driver@tileconcept.test'),
  ('dddddddd-3200-0000-0000-000000000012'::uuid,'synthetic.dual.rep@tileconcept.test')
) as u(id,email);
-- The oldest active membership is the acting one (core.current_workspace_id).
insert into core.memberships(workspace_id,user_id,role_key,created_at) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-3200-0000-0000-000000000011','driver',now()-interval '1 day'),
  ('99999999-3200-0000-0000-000000000002','dddddddd-3200-0000-0000-000000000011','sales_rep',now()),
  ('11111111-1111-1111-1111-111111111111','dddddddd-3200-0000-0000-000000000012','sales_rep',now()-interval '1 day'),
  ('99999999-3200-0000-0000-000000000002','dddddddd-3200-0000-0000-000000000012','driver',now());
set local role authenticated;

select pg_temp.act_as('dddddddd-3200-0000-0000-000000000011');
select ok(core.has_permission_in('99999999-3200-0000-0000-000000000002','workspace.operating'),'fixture: the other workspace''s membership grants the Operating System');
select ok(not core.has_permission('workspace.operating'),'core.has_permission follows the acting membership, not the union');
select is((select array_agg(p order by p) from api.my_workspace_permissions() p),array['delivery.read_own','workspace.admin'],'acting permissions are the driver role only');
select throws_ok($$select api.set_default_area('operating')$$,'42501','permission denied: workspace.operating','a driver here cannot remember the Operating System granted elsewhere');
select is(api.set_default_area('admin'),'admin','the acting area can still be remembered');
select is((select workspace_id from api.user_preferences),'11111111-1111-1111-1111-111111111111'::uuid,'the preference is stored for the acting workspace only');

select pg_temp.act_as('dddddddd-3200-0000-0000-000000000012');
select ok(not ('delivery.read_own' = any(array(select api.my_workspace_permissions()))),'a sales rep here gets no driver queue from another workspace');
select throws_ok($$select api.set_default_area('admin')$$,'42501','permission denied: workspace.admin','a sales rep here cannot remember the Admin System granted elsewhere');

-- TILE-62: rows follow the membership in their own workspace, so the sales
-- role elsewhere reads nothing here (full matrix in 025_workspace_permission_scope).
select pg_temp.act_as('dddddddd-3200-0000-0000-000000000011');
select is((select count(*)::int from api.leads where workspace_id='11111111-1111-1111-1111-111111111111'),0,'a driver here sees no leads here despite a sales role elsewhere');
select is((select count(*)::int from api.contacts where workspace_id='11111111-1111-1111-1111-111111111111'),0,'a driver here sees no contacts here despite a sales role elsewhere');

select set_config('request.jwt.claims','',true);
select throws_ok($$select api.set_default_area('admin')$$,'42501',null,'an unauthenticated caller cannot store a preference');

reset role;
select is((select count(*)::int from core.user_preferences where user_id='dddddddd-3200-0000-0000-000000000001'),1,'one row per member and workspace');

select * from finish();
rollback;
