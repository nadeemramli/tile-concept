-- A changed cut needs its own publication evidence. Older published history remains visible.
create or replace function marketing.creative_stage(p_id uuid,p_phase text) returns text language sql stable set search_path='' as $$
 select case when p_phase<>'approved' then p_phase
 when count(*) filter(where status<>'cancelled')=0 then 'approved'
 when bool_and(status='published') filter(where status<>'cancelled')
   and count(*) filter(where status='published' and version_id=(select approved_version_id from marketing.creative_items where id=p_id))>0 then 'published'
 when count(*) filter(where status='scheduled')>0 and bool_and(status in ('scheduled','published')) filter(where status<>'cancelled') then 'scheduled'
 else 'approved' end from marketing.creative_publications where creative_id=p_id
$$;

-- Demo fixtures use the same builder on initial setup and every controlled weekly reset.
-- There is no data write to a real workspace, no media fetch and no external post.
-- Cross-domain evidence checks run at transaction end, after all workspace cascades finish.
-- Deleting a live source on its own still fails while its creative evidence remains.
alter table marketing.creative_sources alter constraint creative_sources_content_opportunity_id_fkey deferrable initially deferred;
alter table marketing.creative_sources alter constraint creative_sources_shoot_booking_id_fkey deferrable initially deferred;
alter table marketing.creative_sources alter constraint creative_sources_shoot_output_id_fkey deferrable initially deferred;
alter table marketing.creative_items alter constraint creative_approved_version_fk deferrable initially deferred;
alter table marketing.creative_reviews alter constraint creative_reviews_creative_id_version_id_fkey deferrable initially deferred;
alter table marketing.creative_publications alter constraint creative_publications_creative_id_version_id_fkey deferrable initially deferred;
create or replace function core.build_demo_creative_dataset(p_workspace uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; project_one identity.projects%rowtype; project_two identity.projects%rowtype; co_one uuid; co_two uuid; shoot_one uuid; shoot_two uuid;
 c_id uuid; v_id uuid; item record; brief jsonb; day date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; dkey text; pch text;
begin
 if not exists(select 1 from core.workspaces where id=p_workspace and slug='demo' and settings->>'is_demo'='true') then raise exception 'Creative demo fixtures require the isolated demo workspace' using errcode='42501'; end if;
 select user_id into actor from core.memberships where workspace_id=p_workspace and status='active' and role_key='guest' order by created_at,user_id limit 1;
 -- On a fresh install the guest is provisioned after migrations; the regular reset builds then.
 if actor is null then return; end if;
 select * into project_one from identity.projects where workspace_id=p_workspace order by created_at,id limit 1;
 select * into project_two from identity.projects where workspace_id=p_workspace order by created_at,id offset 1 limit 1;
 if project_one.id is null or project_two.id is null then raise exception 'Build the ordinary demo dataset before creative fixtures' using errcode='23514'; end if;
 co_one:=md5(p_workspace::text||':creative-demo-v1:source-ready')::uuid;
 co_two:=md5(p_workspace::text||':creative-demo-v1:source-pending')::uuid;
 shoot_one:=md5(p_workspace::text||':creative-demo-v1:shoot-complete')::uuid;
 shoot_two:=md5(p_workspace::text||':creative-demo-v1:shoot-planned')::uuid;
 insert into marketing.content_opportunities(id,workspace_id,project_id,contact_id,account_id,nominated_by,customer_owner_id,marketing_owner_id,status,story_angle,nomination_reason,content_types,readiness_state)
 values(co_one,p_workspace,project_one.id,project_one.primary_contact_id,project_one.account_id,actor,actor,actor,'completed','Demo: fictional completed kitchen transformation','Synthetic creative demo source; not a real customer story',array['showcase','short_form'],'completed'),
 (co_two,p_workspace,project_two.id,project_two.primary_contact_id,project_two.account_id,actor,actor,actor,'accepted','Demo: fictional pickup footage needed','Synthetic creative demo source; customer use is not yet approved',array['showcase','short_form'],'in_progress') on conflict(id) do nothing;
 insert into marketing.media_permission_records(id,workspace_id,content_opportunity_id,contact_id,status,granted_by_name,granted_at,permitted_capture,permitted_uses,restrictions,expires_at,recorded_by)
 values(md5(p_workspace::text||':creative-demo-v1:permission-ready')::uuid,p_workspace,co_one,project_one.primary_contact_id,'approved_with_restrictions','Fictional demo customer',now()-interval '10 days',array['photo','video','interview'],array['social','website'],'Synthetic example only: organic company channels and website; no paid ads.',day+90,actor),
 (md5(p_workspace::text||':creative-demo-v1:permission-pending')::uuid,p_workspace,co_two,project_two.primary_contact_id,'requested',null,null,'{}','{}','Synthetic example awaiting written customer media permission.',null,actor) on conflict(id) do nothing;
 insert into marketing.shoot_bookings(id,workspace_id,content_opportunity_id,status,starts_at,ends_at,title,coordinator_id,notes,created_by,outcome)
 values(shoot_one,p_workspace,co_one,'completed',((day-4)+time '10:00') at time zone 'Asia/Kuala_Lumpur',((day-4)+time '12:00') at time zone 'Asia/Kuala_Lumpur','Demo: completed kitchen footage',actor,'Synthetic completed shoot for creative workflow demonstrations.',actor,'completed'),
 (shoot_two,p_workspace,co_two,'customer_confirmation_pending',((day+3)+time '10:00') at time zone 'Asia/Kuala_Lumpur',((day+3)+time '11:30') at time zone 'Asia/Kuala_Lumpur','Demo: pickup shoot awaiting confirmation',actor,'Synthetic future booking; confirm customer media permission before use.',actor,null) on conflict(id) do nothing;
 for item in select * from (values
 ('briefing','Demo: tile-care carousel','graphic','carousel','no_filming','briefing','active',false,false,5),
 ('preparing','Demo: kitchen pickup reel','project_showcase','vertical_video','new_footage','preparing','active',false,true,6),
 ('production','Demo: installation detail edit','installation','vertical_video','existing_footage','in_production','active',true,false,3),
 ('review','Demo: customer story version 1','testimonial','vertical_video','existing_footage','review','active',true,false,2),
 ('approved','Demo: approved kitchen showcase','project_showcase','vertical_video','existing_footage','approved','active',true,false,1),
 ('scheduled','Demo: scheduled transformation reel','project_showcase','vertical_video','existing_footage','approved','active',true,false,0),
 ('published','Demo: published tile-detail reel','installation','vertical_video','existing_footage','approved','active',true,false,-3),
 ('blocked','Demo: missing before-footage','project_showcase','vertical_video','mixed','preparing','blocked',false,true,4)
 ) as example(key,title,template,format,source_mode,phase,condition,ready,pending_source,due_offset) loop
  c_id:=md5(p_workspace::text||':creative-demo-v1:'||item.key)::uuid;
  if exists(select 1 from marketing.creative_items where id=c_id) then continue; end if;
  brief:=jsonb_build_object('objective','Synthetic demonstration of '||item.title,'audience','Fictional homeowners exploring tile ideas','key_message','Example content for learning the production workflow; no real customer or claim','cta','Explore the demo workflow','shot_plan','Example coverage: wide view, before/after and installation closeup','caption','DEMO ONLY — invented content, links and release evidence.','mandatory_coverage','Example: wide view plus closeup; confirm completeness per deliverable.','claims','Synthetic example; replace with verified facts before creating real work.');
  insert into marketing.creative_items(id,workspace_id,title,template,format,source_mode,phase,condition,owner_id,reviewer_id,production_due,review_due,channels,priority,brief,next_action,blocker_reason,blocker_owner_id,blocker_review_date,source_ready,source_readiness_note,rights_confirmed,created_by)
  values(c_id,p_workspace,item.title,item.template,item.format,item.source_mode,item.phase,item.condition,actor,actor,day+item.due_offset,day+item.due_offset+1,array['instagram','tiktok'],case when item.key='blocked' then 'high' else 'normal' end,brief,
  case item.key when 'briefing' then 'Complete the fictional carousel brief' when 'preparing' then 'Confirm the example shoot and customer media permission' when 'production' then 'Submit a numbered synthetic export' when 'review' then 'Review version 1 as the designated demo approver' when 'approved' then 'Create a channel release plan for this approved version' when 'scheduled' then 'Record actual release only when it happens' when 'published' then 'Inspect preserved version and release history' else 'Resolve missing before-footage or narrow the deliverable' end,
  case when item.key='blocked' then 'Synthetic blocker: required before-footage and written customer media permission are missing' end,case when item.key='blocked' then actor end,case when item.key='blocked' then day+1 end,item.ready,case when item.ready then 'Synthetic fixture: required source coverage and intended organic use confirmed' end,item.ready,actor);
  if item.source_mode<>'no_filming' then
   insert into marketing.creative_sources(workspace_id,creative_id,content_opportunity_id,shoot_booking_id,booking_starts_at,booking_ends_at,added_by)
   select p_workspace,c_id,content_opportunity_id,id,starts_at,ends_at,actor from marketing.shoot_bookings where id=case when item.pending_source then shoot_two else shoot_one end;
   if item.ready then insert into marketing.creative_links(workspace_id,creative_id,kind,label,url,access_state,created_by)
    values(p_workspace,c_id,'raw_footage','Synthetic raw folder — demonstration only','https://example.invalid/creative-demo/raw-kitchen','confirmed',actor); end if;
  end if;
  if item.phase in ('review','approved') then
   v_id:=md5(c_id::text||':version1')::uuid;
   insert into marketing.creative_versions(id,workspace_id,creative_id,version_no,export_label,review_url,final_url,notes,brief_snapshot,source_snapshot,submitted_by)
   select v_id,p_workspace,c_id,1,'Synthetic export v1 — demo only','https://example.invalid/creative-demo/'||item.key||'/v1-review','https://example.invalid/creative-demo/'||item.key||'/v1-final','Fictional version; no real external file or post was created.',brief,coalesce(jsonb_agg(to_jsonb(s)),'[]'),actor from marketing.creative_sources s where s.creative_id=c_id;
   if item.phase='approved' then
    insert into marketing.creative_reviews(workspace_id,creative_id,version_id,decision,notes,restrictions_confirmed,reviewer_id)
    values(p_workspace,c_id,v_id,'approved','Synthetic approval demonstration; organic company channels only, as documented on the fictional source.',true,actor);
    update marketing.creative_items set approved_version_id=v_id where id=c_id;
   end if;
  end if;
  if item.key in ('scheduled','published') then
   foreach pch in array array['instagram','tiktok'] loop
    dkey:=item.key||':'||pch;
    insert into marketing.creative_publications(id,workspace_id,creative_id,version_id,channel,account_label,intended_use,target_date,status,scheduled_at,scheduling_method,published_at,live_url,created_by)
    values(md5(p_workspace::text||':creative-demo-v1:publication:'||dkey)::uuid,p_workspace,c_id,v_id,pch,'Synthetic company account','organic_social',case when item.key='published' then day-1 else day+2 end,
     case when item.key='published' then 'published' else 'scheduled' end,
     case when item.key='scheduled' then ((day+2)+time '12:00') at time zone 'Asia/Kuala_Lumpur' end,
     case when item.key='scheduled' then 'Synthetic scheduler confirmation — demonstration only; no external post scheduled' end,
     case when item.key='published' then ((day-1)+time '12:00') at time zone 'Asia/Kuala_Lumpur' end,
     case when item.key='published' then 'https://example.invalid/creative-demo/live/'||pch end,actor);
   end loop;
  elsif item.key in ('briefing','review') then
   insert into marketing.creative_publications(workspace_id,creative_id,channel,account_label,intended_use,target_date,created_by)
   values(p_workspace,c_id,'instagram','Synthetic company account','organic_social',day+7,actor);
  end if;
  insert into marketing.creative_events(workspace_id,creative_id,action,actor_id,data) values(p_workspace,c_id,'demo_fixture',actor,jsonb_build_object('note','Entirely synthetic demonstration. No real customer, file fetch, scheduling or publishing action occurred.','fixture_key',item.key));
 end loop;
end $$;
revoke all on function core.build_demo_creative_dataset(uuid) from public,anon,authenticated;

alter function core.build_demo_dataset(uuid) rename to build_demo_dataset_before_creative;
create or replace function core.build_demo_dataset(p_workspace uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform core.build_demo_dataset_before_creative(p_workspace);
 perform core.build_demo_creative_dataset(p_workspace);
end $$;
revoke all on function core.build_demo_dataset(uuid),core.build_demo_dataset_before_creative(uuid) from public,anon,authenticated;
comment on function core.build_demo_dataset(uuid) is 'Builds the synthetic demo dataset and creative examples through the same initial-build and reset path.';

-- Populate an already provisioned demo without resetting it or touching ordinary workspaces.
select core.build_demo_creative_dataset(core.demo_workspace_id());

-- Unscheduled includes a newly approved cut with only older publication history.
create or replace function api.creative_query(p_mode text,p_filters jsonb default '{}',p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); result jsonb; page integer:=coalesce((p_filters->>'page')::integer,1); size integer:=coalesce((p_filters->>'page_size')::integer,30); first_date date:=nullif(p_filters->>'from','')::date; last_date date:=nullif(p_filters->>'to','')::date; basis text:=coalesce(p_filters->>'basis','target');
begin
 if auth.uid() is null or ws is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 perform core.require_permission('marketing.read');
 if page<1 or size<1 or size>100 or page>1000000 then raise exception 'Invalid pagination' using errcode='23514'; end if;
 if p_mode='list' then
  with filtered as materialized(
   select c.id,c.updated_at,marketing.creative_stage(c.id,c.phase) as stage from marketing.creative_items c
   where c.workspace_id=ws
   and (nullif(p_filters->>'search','') is null or c.title ilike '%'||(p_filters->>'search')||'%')
   and (nullif(p_filters->>'owner_id','') is null or c.owner_id=(p_filters->>'owner_id')::uuid)
   and (nullif(p_filters->>'reviewer_id','') is null or c.reviewer_id=(p_filters->>'reviewer_id')::uuid)
   and (not coalesce((p_filters->>'mine')::boolean,false) or c.owner_id=auth.uid() or c.reviewer_id=auth.uid())
   and (coalesce(p_filters->>'condition','')='all' or case when nullif(p_filters->>'condition','') is null then c.condition<>'cancelled' else c.condition=p_filters->>'condition' end)
   and (not coalesce((p_filters->>'unscheduled')::boolean,false) or not exists(select 1 from marketing.creative_publications p where p.creative_id=c.id and p.status<>'cancelled' and (p.status<>'published' or p.version_id=c.approved_version_id) and (p.target_date is not null or p.scheduled_at is not null or p.published_at is not null)))
   and (nullif(p_filters->>'content_opportunity_id','') is null or exists(select 1 from marketing.creative_sources s where s.creative_id=c.id and s.removed_at is null and s.content_opportunity_id=(p_filters->>'content_opportunity_id')::uuid))
   and (nullif(p_filters->>'shoot_booking_id','') is null or exists(select 1 from marketing.creative_sources s where s.creative_id=c.id and s.removed_at is null and s.shoot_booking_id=(p_filters->>'shoot_booking_id')::uuid))
   and (first_date is null or case when p_filters->>'date_basis'='review_due' then c.review_due else c.production_due end>=first_date)
   and (last_date is null or case when p_filters->>'date_basis'='review_due' then c.review_due else c.production_due end<last_date)
  ), selected as materialized(select * from filtered where nullif(p_filters->>'stage','') is null or stage=p_filters->>'stage'),
  paged as (select * from selected order by updated_at desc,id limit size offset (page-1)*size)
  select jsonb_build_object('items',coalesce((select jsonb_agg(marketing.creative_card(id) order by updated_at desc,id) from paged),'[]'),'total',(select count(*) from selected),'stage_counts',(select jsonb_object_agg(st,(select count(*) from filtered f where f.stage=st)) from unnest(array['briefing','preparing','in_production','review','approved','scheduled','published']) st),'page',page,'page_size',size) into result;
 elsif p_mode='detail' then
  if not exists(select 1 from marketing.creative_items where id=p_id and workspace_id=ws) then return null; end if;
  select marketing.creative_card(p_id)||jsonb_build_object(
   'sources',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('title',proj.name,'booking_title',b.title,'booking_status',b.status,'starts_at',b.starts_at,'ends_at',b.ends_at,'permission_status',m.status,'permission_expires_at',m.expires_at,'permitted_uses',coalesce(m.permitted_uses,'{}'),'restrictions',m.restrictions) order by s.added_at,s.id) from marketing.creative_sources s join marketing.content_opportunities co on co.id=s.content_opportunity_id join identity.projects proj on proj.id=co.project_id left join marketing.shoot_bookings b on b.id=s.shoot_booking_id left join lateral(select * from marketing.media_permission_records where content_opportunity_id=co.id order by created_at,id limit 1) m on true where s.creative_id=p_id and s.removed_at is null),'[]'),
   'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from marketing.creative_links l where l.creative_id=p_id and l.removed_at is null),'[]'),
   'versions',coalesce((select jsonb_agg(to_jsonb(v) order by v.version_no desc) from marketing.creative_versions v where v.creative_id=p_id),'[]'),
   'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.reviewed_at desc,r.id) from marketing.creative_reviews r where r.creative_id=p_id),'[]'),
   'publications',coalesce((select jsonb_agg(marketing.creative_publication_card(p.id) order by p.created_at,p.id) from marketing.creative_publications p where p.creative_id=p_id),'[]'),
   'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id) from (select * from marketing.creative_events where creative_id=p_id order by occurred_at desc,id limit 100) e),'[]')) into result;
 elsif p_mode='calendar' then
  if first_date is null or last_date is null or last_date<=first_date or last_date-first_date>366 or basis not in ('target','scheduled','published') then raise exception 'Calendar requires an exclusive range of at most one year and a valid date basis' using errcode='23514'; end if;
  with matching as materialized(select p.id,p.creative_id,case basis when 'target' then p.target_date when 'scheduled' then (p.scheduled_at at time zone 'Asia/Kuala_Lumpur')::date else (p.published_at at time zone 'Asia/Kuala_Lumpur')::date end as event_date from marketing.creative_publications p join marketing.creative_items c on c.id=p.creative_id where p.workspace_id=ws and p.status<>'cancelled' and (basis='published' or c.condition<>'cancelled') and (basis='target' or (basis='scheduled' and p.status='scheduled') or (basis='published' and p.status='published')) and (nullif(p_filters->>'owner_id','') is null or c.owner_id=(p_filters->>'owner_id')::uuid)),
  ranged as materialized(select * from matching where event_date>=first_date and event_date<last_date), paged as(select * from ranged order by event_date,id limit size offset (page-1)*size)
  select jsonb_build_object('items',coalesce((select jsonb_agg(marketing.creative_publication_card(id) order by event_date,id) from paged),'[]'),'total',(select count(*) from ranged),'unique_creatives',(select count(distinct creative_id) from ranged),'page',page,'page_size',size) into result;
 elsif p_mode='options' then
  with opps as materialized(select co.id,p.name as title from marketing.content_opportunities co join identity.projects p on p.id=co.project_id where co.workspace_id=ws and co.status in ('accepted','scheduled','completed') and (nullif(p_filters->>'search','') is null or p.name ilike '%'||(p_filters->>'search')||'%')),
  bookings as materialized(select b.id,coalesce(b.title,p.name) as title,b.content_opportunity_id,b.starts_at,b.ends_at from marketing.shoot_bookings b join marketing.content_opportunities co on co.id=b.content_opportunity_id join identity.projects p on p.id=co.project_id where b.workspace_id=ws and co.status in ('accepted','scheduled','completed') and (nullif(p_filters->>'search','') is null or coalesce(b.title,p.name) ilike '%'||(p_filters->>'search')||'%'))
  select jsonb_build_object('lookup_limit',30,'opportunities_total',(select count(*) from opps),'bookings_total',(select count(*) from bookings),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(p.full_name,p.email::text),'can_write',marketing.creative_member(m.user_id,ws,'marketing.write'),'can_review',marketing.creative_member(m.user_id,ws,'creative.approve'),'can_publish',marketing.creative_member(m.user_id,ws,'creative.publish')) order by p.full_name,m.user_id),'[]') from core.memberships m join core.profiles p on p.user_id=m.user_id where m.workspace_id=ws and m.status='active'),
  'opportunities',(select coalesce(jsonb_agg(to_jsonb(o) order by title,id),'[]') from (select * from opps order by title,id limit 30) o),
  'bookings',(select coalesce(jsonb_agg(to_jsonb(b) order by starts_at desc,id),'[]') from (select * from bookings order by starts_at desc,id limit 30) b)) into result;
 else raise exception 'Unknown creative query' using errcode='23514'; end if;
 return result;
end $$;
