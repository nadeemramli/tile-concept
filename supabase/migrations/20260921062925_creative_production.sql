-- One deliverable per creative. Production and publication are distinct, with DB-owned gates.
insert into core.role_permissions(role_key,permission) values
 ('admin','creative.approve'),('admin','creative.publish'),('admin','creative.self_approve'),
 ('marketing_coordinator','creative.approve'),('marketing_coordinator','creative.publish'),
 ('guest','creative.approve'),('guest','creative.publish'),('guest','creative.self_approve') on conflict do nothing;

create table marketing.creative_items (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references core.workspaces(id) on delete cascade,
 title text not null check(length(trim(title)) between 2 and 200), template text not null check(template in ('project_showcase','testimonial','installation','product_education','promotion','graphic')),
 format text check(format in ('vertical_video','landscape_video','photo','carousel','graphic','copy')),
 source_mode text not null check(source_mode in ('new_footage','existing_footage','mixed','no_filming')),
 phase text not null default 'briefing' check(phase in ('briefing','preparing','in_production','review','approved')),
 condition text not null default 'active' check(condition in ('active','blocked','on_hold','cancelled')),
 owner_id uuid references auth.users(id), reviewer_id uuid references auth.users(id), production_due date, review_due date,
 channels text[] not null default '{}', priority text not null default 'normal' check(priority in ('low','normal','high')),
 brief jsonb not null default '{}', next_action text,
 blocker_reason text, blocker_owner_id uuid references auth.users(id), blocker_review_date date,
 source_ready boolean not null default false, source_readiness_note text, rights_confirmed boolean not null default false,
 approved_version_id uuid, revision integer not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,id), check(channels <@ array['tiktok','instagram','facebook','youtube','website','other']), check(jsonb_typeof(brief)='object')
);
create index creative_items_board_idx on marketing.creative_items(workspace_id,condition,phase,updated_at desc,id);
create index creative_items_owner_idx on marketing.creative_items(workspace_id,owner_id,production_due);
create index creative_items_reviewer_idx on marketing.creative_items(workspace_id,reviewer_id,review_due);

create table marketing.creative_sources (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creative_id uuid not null,
 content_opportunity_id uuid not null references marketing.content_opportunities(id), shoot_booking_id uuid references marketing.shoot_bookings(id), shoot_output_id uuid references marketing.shoot_outputs(id),
 booking_starts_at timestamptz, booking_ends_at timestamptz,
 added_by uuid not null references auth.users(id), added_at timestamptz not null default now(), removed_at timestamptz,
 foreign key(workspace_id,creative_id) references marketing.creative_items(workspace_id,id) on delete cascade
);
create unique index creative_sources_identity_idx on marketing.creative_sources(creative_id,content_opportunity_id,coalesce(shoot_booking_id,'00000000-0000-0000-0000-000000000000'),coalesce(shoot_output_id,'00000000-0000-0000-0000-000000000000')) where removed_at is null;
create index creative_sources_opportunity_idx on marketing.creative_sources(content_opportunity_id) where removed_at is null;
create table marketing.creative_links (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creative_id uuid not null,
 kind text not null check(kind in ('reference','brief_script','storyboard','shot_list','raw_footage','working_project','draft_review','final_export')),
 label text not null, url text not null, access_state text not null check(access_state in ('not_checked','confirmed','problem')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), removed_at timestamptz,
 foreign key(workspace_id,creative_id) references marketing.creative_items(workspace_id,id) on delete cascade
);
create index creative_links_parent_idx on marketing.creative_links(creative_id) where removed_at is null;
create table marketing.creative_versions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creative_id uuid not null,
 version_no integer not null, export_label text not null, review_url text not null, final_url text not null, notes text not null default '',
 brief_snapshot jsonb not null, source_snapshot jsonb not null, submitted_by uuid not null references auth.users(id), submitted_at timestamptz not null default now(),
 foreign key(workspace_id,creative_id) references marketing.creative_items(workspace_id,id) on delete cascade, unique(creative_id,version_no), unique(creative_id,id)
);
alter table marketing.creative_items add constraint creative_approved_version_fk foreign key(id,approved_version_id) references marketing.creative_versions(creative_id,id);
create table marketing.creative_reviews (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creative_id uuid not null, version_id uuid not null,
 decision text not null check(decision in ('approved','changes_requested')), notes text not null, restrictions_confirmed boolean not null default false,
 reviewer_id uuid not null references auth.users(id), reviewed_at timestamptz not null default now(),
 foreign key(workspace_id,creative_id) references marketing.creative_items(workspace_id,id) on delete cascade, foreign key(creative_id,version_id) references marketing.creative_versions(creative_id,id), unique(version_id)
);
create table marketing.creative_publications (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creative_id uuid not null, version_id uuid,
 channel text not null check(channel in ('tiktok','instagram','facebook','youtube','website','other')), account_label text not null check(length(trim(account_label)) between 1 and 200),
 intended_use text not null check(intended_use in ('organic_social','paid_ads','website','showroom_display','print')),
 target_date date, status text not null default 'planned' check(status in ('planned','scheduled','published','cancelled')),
 scheduled_at timestamptz, scheduling_method text, published_at timestamptz, live_url text, cancellation_reason text,
 external_action_required boolean not null default false, external_action_note text,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(workspace_id,creative_id) references marketing.creative_items(workspace_id,id) on delete cascade, foreign key(creative_id,version_id) references marketing.creative_versions(creative_id,id),
 check(status<>'scheduled' or (version_id is not null and scheduled_at is not null and nullif(trim(scheduling_method),'') is not null)),
 check(status<>'published' or (version_id is not null and published_at is not null and live_url is not null))
);
create index creative_publications_target_idx on marketing.creative_publications(workspace_id,target_date,id);
create index creative_publications_scheduled_idx on marketing.creative_publications(workspace_id,scheduled_at,id);
create index creative_publications_published_idx on marketing.creative_publications(workspace_id,published_at,id);
create index creative_publications_parent_idx on marketing.creative_publications(creative_id,status);
create table marketing.creative_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creative_id uuid not null, action text not null, actor_id uuid not null references auth.users(id), occurred_at timestamptz not null default now(), data jsonb not null,
 foreign key(workspace_id,creative_id) references marketing.creative_items(workspace_id,id) on delete cascade
);
create index creative_events_parent_idx on marketing.creative_events(creative_id,occurred_at desc);
create table marketing.creative_requests (
 workspace_id uuid not null references core.workspaces(id) on delete cascade, request_id uuid not null, actor_id uuid not null references auth.users(id), payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(workspace_id,request_id)
);

create or replace function marketing.creative_immutable() returns trigger language plpgsql set search_path='' as $$ begin if tg_op='DELETE' and not exists(select 1 from core.workspaces where id=old.workspace_id) then return old; end if; raise exception 'Creative versions, reviews and events are append-only' using errcode='23514'; end $$;
create trigger creative_versions_immutable before update or delete on marketing.creative_versions for each row execute function marketing.creative_immutable();
create trigger creative_reviews_immutable before update or delete on marketing.creative_reviews for each row execute function marketing.creative_immutable();
create trigger creative_events_immutable before update or delete on marketing.creative_events for each row execute function marketing.creative_immutable();
do $$ declare t text; begin
 foreach t in array array['creative_items','creative_sources','creative_links','creative_versions','creative_reviews','creative_publications','creative_events','creative_requests'] loop
  execute format('alter table marketing.%I enable row level security',t);
  execute format('revoke all on marketing.%I from anon,authenticated',t);
  if t<>'creative_requests' then
   execute format('create policy creative_read on marketing.%I for select to authenticated using(workspace_id=(select core.current_workspace_id()) and (select core.has_permission(''marketing.read'')))',t);
   execute format('grant select on marketing.%I to authenticated',t);
   execute format('create view api.%I with(security_invoker=true) as select * from marketing.%I',t,t);
   execute format('grant select on api.%I to authenticated',t);
  end if;
 end loop;
end $$;

create or replace function marketing.creative_valid_url(p_url text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(length(p_url)<=2048 and p_url ~ '^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' and p_url !~* '[?&](token|signature|sig|x-amz-signature|x-goog-signature|expires|se)=',false)
$$;
create or replace function marketing.creative_member(p_id uuid,p_workspace uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from core.memberships m join core.role_permissions rp on rp.role_key=m.role_key where m.workspace_id=p_workspace and m.user_id=p_id and m.status='active' and rp.permission=p_permission)
$$;
-- Every linked customer is checked. Free-text restrictions require a named human acknowledgement.
create or replace function marketing.creative_rights_issues(p_id uuid,p_use text default null,p_date date default null) returns text[] language sql stable security definer set search_path='' as $$
 with sources as (select distinct s.content_opportunity_id from marketing.creative_sources s where s.creative_id=p_id and s.removed_at is null),
 needed as (select distinct case coalesce(p_use,p.intended_use,case when ch.channel='website' then 'website' else 'organic_social' end) when 'organic_social' then 'social' when 'paid_ads' then 'advertising' when 'showroom_display' then 'showroom' else coalesce(p_use,p.intended_use,case when ch.channel='website' then 'website' else 'social' end) end as use_key
 from marketing.creative_items c left join marketing.creative_publications p on p.creative_id=c.id and p.status<>'cancelled' left join lateral unnest(c.channels) as ch(channel) on true where c.id=p_id),
 issues as (select distinct case
 when perm.id is null or perm.status not in ('approved','approved_with_restrictions') or perm.revoked_at is not null then 'Customer media permission missing or revoked: '||s.content_opportunity_id
 when perm.expires_at < greatest(coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date),(now() at time zone 'Asia/Kuala_Lumpur')::date) then 'Customer media permission expired before use: '||s.content_opportunity_id
 when exists(select 1 from needed n where not n.use_key=any(perm.permitted_uses)) then 'Customer media permission does not cover the intended use: '||s.content_opportunity_id
 else null end as issue from sources s left join lateral(select * from marketing.media_permission_records m where m.content_opportunity_id=s.content_opportunity_id order by m.created_at,m.id limit 1) perm on true)
 select coalesce(array_agg(issue) filter(where issue is not null),'{}') || case when exists(select 1 from marketing.creative_sources s join marketing.shoot_outputs o on o.id=s.shoot_output_id where s.creative_id=p_id and s.removed_at is null and o.state not in ('usable','restricted')) then array['Linked shoot output is no longer approved for use'] else '{}'::text[] end from issues
$$;
create or replace function marketing.creative_stage(p_id uuid,p_phase text) returns text language sql stable set search_path='' as $$
 select case when p_phase<>'approved' then p_phase
 when count(*) filter(where status<>'cancelled')=0 then 'approved'
 when bool_and(status='published') filter(where status<>'cancelled') then 'published'
 when count(*) filter(where status='scheduled')>0 and bool_and(status in ('scheduled','published')) filter(where status<>'cancelled') then 'scheduled'
 else 'approved' end from marketing.creative_publications where creative_id=p_id
$$;
create or replace function marketing.creative_risks(p_id uuid) returns text[] language sql stable security definer set search_path='' as $$
 select marketing.creative_rights_issues(c.id)||array_remove(array[
 case when c.condition in ('blocked','on_hold') then 'Work is '||replace(c.condition,'_',' ') end,
 case when not c.source_ready and c.phase<>'briefing' then 'Source readiness is not confirmed' end,
 case when c.owner_id is null then 'Unassigned owner' end,
 case when c.phase in ('briefing','preparing','in_production') and c.production_due<(now() at time zone 'Asia/Kuala_Lumpur')::date then 'Production overdue' end,
 case when c.phase='review' and c.review_due<(now() at time zone 'Asia/Kuala_Lumpur')::date then 'Review overdue' end,
 case when exists(select 1 from marketing.creative_sources s join marketing.shoot_bookings b on b.id=s.shoot_booking_id where s.creative_id=c.id and s.removed_at is null and (b.status in ('cancelled','postponed') or b.starts_at is distinct from s.booking_starts_at or b.ends_at is distinct from s.booking_ends_at)) then 'Linked shoot changed; review source readiness and release dates' end,
 case when exists(select 1 from marketing.creative_publications p where p.creative_id=c.id and p.status in ('planned','scheduled') and (c.production_due>p.target_date or c.review_due>p.target_date)) then 'Production or review deadline is after target release' end,
 case when exists(select 1 from marketing.creative_publications p where p.creative_id=c.id and p.status='planned' and p.target_date<(now() at time zone 'Asia/Kuala_Lumpur')::date) then 'Target release is overdue' end
 ],null) from marketing.creative_items c where c.id=p_id
$$;
revoke all on function marketing.creative_immutable(),marketing.creative_valid_url(text),marketing.creative_member(uuid,uuid,text),marketing.creative_rights_issues(uuid,text,date),marketing.creative_stage(uuid,text),marketing.creative_risks(uuid) from public,anon,authenticated;

create or replace function api.creative_command(p_action text,p_id uuid default null,p_expected_revision integer default null,p_request_id uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); actor uuid:=auth.uid(); c marketing.creative_items%rowtype; old_c jsonb; pub marketing.creative_publications%rowtype; ver marketing.creative_versions%rowtype;
 rid uuid; coid uuid; bid uuid; outid uuid; b marketing.shoot_bookings%rowtype;
 payload jsonb:=jsonb_build_object('action',p_action,'id',p_id,'revision',p_expected_revision,'data',p_data); prior marketing.creative_requests%rowtype; result jsonb; issues text[]; needed_date date;
begin
 if actor is null or ws is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 perform core.require_permission('marketing.read');
 if p_request_id is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>100000 then raise exception 'Request ID and object data of at most 100 KB are required' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||p_request_id::text,0));
 select * into prior from marketing.creative_requests where workspace_id=ws and request_id=p_request_id;
 if found then
  if prior.actor_id<>actor or prior.payload<>payload then raise exception 'Request ID was already used for different input' using errcode='23514'; end if;
  return prior.result;
 end if;
 if p_action='review' then perform core.require_permission('creative.approve');
 elsif p_action in ('publication_schedule','publication_publish','publication_cancel','external_action') then perform core.require_permission('creative.publish');
 else perform core.require_permission('marketing.write'); end if;
 if p_action='create' then
  insert into marketing.creative_items(workspace_id,title,template,source_mode,created_by) values(ws,p_data->>'title',p_data->>'template',p_data->>'source_mode',actor) returning * into c;
 else
  select * into c from marketing.creative_items where id=p_id and workspace_id=ws for update;
  if not found then raise exception 'Creative not found in this workspace' using errcode='42501'; end if;
  if c.revision is distinct from p_expected_revision then raise exception 'This creative changed. Refresh before saving.' using errcode='40001'; end if;
  if c.condition='cancelled' and p_action<>'condition' and p_action<>'external_action' and p_action<>'publication_cancel' then raise exception 'Restore the cancelled creative before changing it' using errcode='23514'; end if;
 end if;
 old_c:=to_jsonb(c);
 if p_action in ('create','update') then
  if c.phase in ('review','approved') then raise exception 'Reopen production before changing an approved or submitted brief' using errcode='23514'; end if;
  if nullif(p_data->>'owner_id','') is not null and not marketing.creative_member((p_data->>'owner_id')::uuid,ws,'marketing.write') then raise exception 'Owner must be an active marketing writer in this workspace' using errcode='42501'; end if;
  if nullif(p_data->>'reviewer_id','') is not null and not marketing.creative_member((p_data->>'reviewer_id')::uuid,ws,'creative.approve') then raise exception 'Reviewer must be an active creative approver in this workspace' using errcode='42501'; end if;
  update marketing.creative_items set title=trim(p_data->>'title'),template=p_data->>'template',format=nullif(p_data->>'format',''),source_mode=p_data->>'source_mode',owner_id=nullif(p_data->>'owner_id','')::uuid,reviewer_id=nullif(p_data->>'reviewer_id','')::uuid,production_due=nullif(p_data->>'production_due','')::date,review_due=nullif(p_data->>'review_due','')::date,channels=array(select distinct jsonb_array_elements_text(coalesce(p_data->'channels','[]'))),priority=coalesce(p_data->>'priority','normal'),brief=coalesce(p_data->'brief','{}'),next_action=nullif(p_data->>'next_action',''),source_ready=false,rights_confirmed=false where id=c.id;
 end if;
 if p_action in ('source_add','source_remove','link_add','link_remove','readiness') and c.phase in ('review','approved') then raise exception 'Reopen production before changing submitted sources or links' using errcode='23514'; end if;
 if p_action='source_add' or (p_action='create' and (nullif(p_data->>'content_opportunity_id','') is not null or nullif(p_data->>'shoot_booking_id','') is not null or nullif(p_data->>'shoot_output_id','') is not null)) then
  coid:=nullif(p_data->>'content_opportunity_id','')::uuid; bid:=nullif(p_data->>'shoot_booking_id','')::uuid; outid:=nullif(p_data->>'shoot_output_id','')::uuid;
  if outid is not null then
   select o.content_opportunity_id,o.shoot_booking_id into rid,bid from marketing.shoot_outputs o where o.id=outid and o.workspace_id=ws and o.state in ('usable','restricted');
   if not found or (coid is not null and coid<>rid) or (nullif(p_data->>'shoot_booking_id','') is not null and (p_data->>'shoot_booking_id')::uuid is distinct from bid) then raise exception 'Choose an approved output in this workspace with matching source' using errcode='23514'; end if; coid:=rid;
  end if;
  if bid is not null then
   select * into b from marketing.shoot_bookings where id=bid and workspace_id=ws;
   if not found or (coid is not null and coid<>b.content_opportunity_id) then raise exception 'Shoot and opportunity must match this workspace' using errcode='42501'; end if; coid:=b.content_opportunity_id;
  end if;
  perform 1 from marketing.content_opportunities where id=coid and workspace_id=ws and status in ('accepted','scheduled','completed');
  if not found then raise exception 'Choose an accepted content opportunity in this workspace' using errcode='23514'; end if;
  insert into marketing.creative_sources(workspace_id,creative_id,content_opportunity_id,shoot_booking_id,shoot_output_id,booking_starts_at,booking_ends_at,added_by) values(ws,c.id,coid,bid,outid,b.starts_at,b.ends_at,actor) on conflict do nothing;
  update marketing.creative_items set source_ready=false,rights_confirmed=false where id=c.id;
 elsif p_action='source_remove' then
  if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Removal reason required' using errcode='23514'; end if;
  update marketing.creative_sources set removed_at=now() where id=(p_data->>'source_id')::uuid and creative_id=c.id and removed_at is null;
  if not found then raise exception 'Active source not found' using errcode='23514'; end if;
  update marketing.creative_items set source_ready=false,rights_confirmed=false where id=c.id;
 elsif p_action='link_add' then
  if not marketing.creative_valid_url(p_data->>'url') or nullif(trim(p_data->>'label'),'') is null then raise exception 'Use a labeled durable HTTP(S) URL without credentials or expiring tokens' using errcode='23514'; end if;
  insert into marketing.creative_links(workspace_id,creative_id,kind,label,url,access_state,created_by) values(ws,c.id,p_data->>'kind',trim(p_data->>'label'),p_data->>'url',p_data->>'access_state',actor);
  update marketing.creative_items set source_ready=false where id=c.id;
 elsif p_action='link_remove' then
  if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Removal reason required' using errcode='23514'; end if;
  update marketing.creative_links set removed_at=now() where id=(p_data->>'link_id')::uuid and creative_id=c.id and removed_at is null;
  if not found then raise exception 'Active link not found' using errcode='23514'; end if;
  update marketing.creative_items set source_ready=false where id=c.id;
 elsif p_action='readiness' then
  if nullif(trim(p_data->>'note'),'') is null then raise exception 'Describe source completeness and any missing coverage' using errcode='23514'; end if;
  if coalesce((p_data->>'ready')::boolean,false) then
   if not coalesce((p_data->>'rights_confirmed')::boolean,false) then raise exception 'Confirm rights to all sources, including reused customer material' using errcode='23514'; end if;
   if c.source_mode<>'no_filming' and not exists(select 1 from marketing.creative_links where creative_id=c.id and removed_at is null and kind='raw_footage' and access_state='confirmed') and not exists(select 1 from marketing.creative_sources s join marketing.shoot_outputs o on o.id=s.shoot_output_id where s.creative_id=c.id and s.removed_at is null and o.state='usable') then raise exception 'Confirm an accessible raw footage link or a usable shoot output' using errcode='23514'; end if;
   if c.source_mode in ('new_footage','mixed') and (not exists(select 1 from marketing.creative_sources s join marketing.shoot_bookings sb on sb.id=s.shoot_booking_id where s.creative_id=c.id and s.removed_at is null and sb.status in ('completed','partially_completed')) or nullif(trim(c.brief->>'shot_plan'),'') is null) then raise exception 'New footage needs a completed or partly completed linked shoot and a shot plan' using errcode='23514'; end if;
   if exists(select 1 from marketing.creative_links where creative_id=c.id and removed_at is null and kind='raw_footage' and access_state='problem') then raise exception 'Resolve inaccessible raw footage before marking ready' using errcode='23514'; end if;
   if c.source_mode in ('new_footage','mixed') and exists(select 1 from marketing.creative_sources s join marketing.shoot_bookings sb on sb.id=s.shoot_booking_id where s.creative_id=c.id and s.removed_at is null and sb.status in ('cancelled','postponed')) then raise exception 'Resolve cancelled or postponed source shoots before confirming readiness' using errcode='23514'; end if;
   update marketing.creative_sources s set booking_starts_at=bk.starts_at,booking_ends_at=bk.ends_at from marketing.shoot_bookings bk where s.creative_id=c.id and s.shoot_booking_id=bk.id and s.removed_at is null;
  end if;
  update marketing.creative_items set source_ready=coalesce((p_data->>'ready')::boolean,false),source_readiness_note=p_data->>'note',rights_confirmed=coalesce((p_data->>'rights_confirmed')::boolean,false) where id=c.id;
 elsif p_action='phase' then
  if c.condition<>'active' or c.phase in ('review','approved') then raise exception 'Resolve the condition or reopen production first' using errcode='23514'; end if;
  if p_data->>'phase' not in ('briefing','preparing','in_production') then raise exception 'Use submission and review actions for later phases' using errcode='23514'; end if;
  if p_data->>'phase' in ('preparing','in_production') and (c.owner_id is null or c.reviewer_id is null or c.production_due is null or c.review_due is null or c.format is null or cardinality(c.channels)=0 or nullif(trim(c.brief->>'objective'),'') is null or nullif(trim(c.brief->>'audience'),'') is null or nullif(trim(c.brief->>'key_message'),'') is null) then raise exception 'Complete owner, reviewer, deadlines, format, channels, objective, audience and key message' using errcode='23514'; end if;
  if p_data->>'phase'='in_production' and (not c.source_ready or not c.rights_confirmed) then raise exception 'Confirm source readiness before production' using errcode='23514'; end if;
  update marketing.creative_items set phase=p_data->>'phase' where id=c.id;
 elsif p_action='condition' then
  if p_data->>'condition' not in ('active','blocked','on_hold','cancelled') or nullif(trim(p_data->>'reason'),'') is null then raise exception 'Valid condition and reason required' using errcode='23514'; end if;
  if p_data->>'condition'='blocked' and (nullif(p_data->>'blocker_owner_id','') is null or nullif(trim(p_data->>'next_action'),'') is null or nullif(p_data->>'blocker_review_date','') is null) then raise exception 'Blocked work needs an owner, next action and review date' using errcode='23514'; end if;
  if nullif(p_data->>'blocker_owner_id','') is not null and not marketing.creative_member((p_data->>'blocker_owner_id')::uuid,ws,'marketing.write') then raise exception 'Choose an active blocker owner in this workspace' using errcode='42501'; end if;
  update marketing.creative_items set condition=p_data->>'condition',blocker_reason=p_data->>'reason',blocker_owner_id=nullif(p_data->>'blocker_owner_id','')::uuid,next_action=nullif(p_data->>'next_action',''),blocker_review_date=nullif(p_data->>'blocker_review_date','')::date where id=c.id;
  if p_data->>'condition'<>'active' then update marketing.creative_publications set external_action_required=true where creative_id=c.id and status='scheduled'; end if;
 elsif p_action='submit' then
  if c.phase<>'in_production' or c.condition<>'active' or not c.source_ready or not c.rights_confirmed then raise exception 'Only active production with ready sources can be submitted' using errcode='23514'; end if;
  if not marketing.creative_valid_url(p_data->>'review_url') or not marketing.creative_valid_url(p_data->>'final_url') or nullif(trim(p_data->>'export_label'),'') is null or not coalesce((p_data->>'access_confirmed')::boolean,false) or not coalesce((p_data->>'specific_export_confirmed')::boolean,false) then raise exception 'Identify a specific export, durable review/final URLs and confirm reviewer access' using errcode='23514'; end if;
  insert into marketing.creative_versions(workspace_id,creative_id,version_no,export_label,review_url,final_url,notes,brief_snapshot,source_snapshot,submitted_by) select ws,c.id,coalesce(max(version_no),0)+1,p_data->>'export_label',p_data->>'review_url',p_data->>'final_url',coalesce(p_data->>'notes',''),c.brief,(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from marketing.creative_sources s where s.creative_id=c.id and s.removed_at is null),actor from marketing.creative_versions where creative_id=c.id;
  update marketing.creative_items set phase='review',approved_version_id=null where id=c.id;
 elsif p_action='review' then
  if c.phase<>'review' or c.condition<>'active' or not c.source_ready or not c.rights_confirmed or c.reviewer_id is distinct from actor then raise exception 'Only the designated reviewer can review active submitted work' using errcode='42501'; end if;
  select * into ver from marketing.creative_versions where creative_id=c.id order by version_no desc limit 1;
  if ver.id is distinct from (p_data->>'version_id')::uuid then raise exception 'Review the latest submitted version' using errcode='23514'; end if;
  if p_data->>'decision'='approved' and (ver.submitted_by=actor or c.owner_id=actor) and not core.has_permission('creative.self_approve') then raise exception 'Self approval requires the explicit creative.self_approve grant' using errcode='42501'; end if;
  if nullif(trim(p_data->>'notes'),'') is null then raise exception 'Review notes required' using errcode='23514'; end if;
  if p_data->>'decision'='approved' then
   issues:=marketing.creative_rights_issues(c.id);
   if cardinality(issues)>0 then raise exception '%',array_to_string(issues,'; ') using errcode='42501'; end if;
   if not coalesce((p_data->>'restrictions_confirmed')::boolean,false) then raise exception 'Confirm intended channels and every customer media permission restriction' using errcode='23514'; end if;
  end if;
  insert into marketing.creative_reviews(workspace_id,creative_id,version_id,decision,notes,restrictions_confirmed,reviewer_id) values(ws,c.id,ver.id,p_data->>'decision',p_data->>'notes',coalesce((p_data->>'restrictions_confirmed')::boolean,false),actor);
  update marketing.creative_items set phase=case when p_data->>'decision'='approved' then 'approved' else 'in_production' end,approved_version_id=case when p_data->>'decision'='approved' then ver.id else null end where id=c.id;
 elsif p_action='reopen' then
  if c.phase not in ('review','approved') or nullif(trim(p_data->>'reason'),'') is null then raise exception 'Reopening submitted work needs a reason' using errcode='23514'; end if;
  if exists(select 1 from marketing.creative_publications where creative_id=c.id and status='scheduled') and (not core.has_permission('creative.publish') or not coalesce((p_data->>'external_cancellation_acknowledged')::boolean,false)) then raise exception 'A publisher must confirm external scheduled posts were cancelled before reopening' using errcode='42501'; end if;
  update marketing.creative_publications set status='planned',version_id=null,scheduled_at=null,scheduling_method=null,external_action_required=false,external_action_note=p_data->>'reason',updated_at=now() where creative_id=c.id and status='scheduled';
  update marketing.creative_items set phase='in_production',approved_version_id=null where id=c.id;
 elsif p_action='publication_plan' then
  if not (p_data->>'channel')=any(c.channels) then raise exception 'Add the intended channel to the brief before planning it' using errcode='23514'; end if;
  if nullif(p_data->>'publication_id','') is null then
   insert into marketing.creative_publications(workspace_id,creative_id,channel,account_label,intended_use,target_date,created_by) values(ws,c.id,p_data->>'channel',p_data->>'account_label',p_data->>'intended_use',nullif(p_data->>'target_date','')::date,actor);
  else
   update marketing.creative_publications set channel=p_data->>'channel',account_label=p_data->>'account_label',intended_use=p_data->>'intended_use',target_date=nullif(p_data->>'target_date','')::date,updated_at=now() where id=(p_data->>'publication_id')::uuid and creative_id=c.id and status='planned';
   if not found then raise exception 'Only a planned release can be edited' using errcode='23514'; end if;
  end if;
 elsif p_action in ('publication_schedule','publication_publish','publication_cancel','external_action') then
  select * into pub from marketing.creative_publications where id=(p_data->>'publication_id')::uuid and creative_id=c.id for update;
  if not found then raise exception 'Publication not found on this creative' using errcode='42501'; end if;
  if p_action in ('publication_schedule','publication_publish') then
   if c.phase<>'approved' or c.condition<>'active' or not c.source_ready or not c.rights_confirmed or c.approved_version_id is null or c.approved_version_id is distinct from (p_data->>'version_id')::uuid or pub.status in ('published','cancelled') then raise exception 'An active approved creative and its exact approved version are required' using errcode='23514'; end if;
   needed_date:=case when p_action='publication_schedule' then ((p_data->>'scheduled_at')::timestamptz at time zone 'Asia/Kuala_Lumpur')::date else ((p_data->>'published_at')::timestamptz at time zone 'Asia/Kuala_Lumpur')::date end;
   if needed_date is null then raise exception 'Release timestamp required' using errcode='23514'; end if;
   issues:=marketing.creative_rights_issues(c.id,pub.intended_use,needed_date);
   if cardinality(issues)>0 then raise exception '%',array_to_string(issues,'; ') using errcode='42501'; end if;
   if not coalesce((p_data->>'restrictions_confirmed')::boolean,false) then raise exception 'Confirm actual channel/use complies with all customer media permission restrictions' using errcode='23514'; end if;
   if p_action='publication_schedule' then
    if nullif(trim(p_data->>'scheduling_method'),'') is null then raise exception 'Record how and where the post was actually scheduled' using errcode='23514'; end if;
    update marketing.creative_publications set status='scheduled',version_id=c.approved_version_id,scheduled_at=(p_data->>'scheduled_at')::timestamptz,scheduling_method=p_data->>'scheduling_method',external_action_required=false,updated_at=now() where id=pub.id;
   else
    if not marketing.creative_valid_url(p_data->>'live_url') or (p_data->>'published_at')::timestamptz>now() then raise exception 'A live HTTP(S) URL and actual publication time no later than now are required' using errcode='23514'; end if;
    update marketing.creative_publications set status='published',version_id=c.approved_version_id,published_at=(p_data->>'published_at')::timestamptz,live_url=p_data->>'live_url',external_action_required=false,updated_at=now() where id=pub.id;
   end if;
  elsif p_action='publication_cancel' then
   if pub.status='published' or nullif(trim(p_data->>'reason'),'') is null then raise exception 'Published history is retained; cancellation needs a reason' using errcode='23514'; end if;
   if pub.status='scheduled' and not coalesce((p_data->>'external_cancellation_acknowledged')::boolean,false) then raise exception 'Confirm cancellation in the external scheduler first' using errcode='23514'; end if;
   update marketing.creative_publications set status='cancelled',cancellation_reason=p_data->>'reason',external_action_required=false,updated_at=now() where id=pub.id;
  else
   if nullif(trim(p_data->>'note'),'') is null then raise exception 'Record the external cancellation or removal action' using errcode='23514'; end if;
   update marketing.creative_publications set external_action_note=p_data->>'note',external_action_required=false,updated_at=now() where id=pub.id;
  end if;
 elsif p_action not in ('create','update','source_add') then raise exception 'Unknown creative action' using errcode='23514';
 end if;
 update marketing.creative_items set revision=case when p_action='create' then revision else revision+1 end,updated_at=now() where id=c.id returning * into c;
 insert into marketing.creative_events(workspace_id,creative_id,action,actor_id,data) values(ws,c.id,p_action,actor,jsonb_build_object('input',p_data,'before',old_c,'after',to_jsonb(c)));
 result:=jsonb_build_object('id',c.id,'revision',c.revision);
 insert into marketing.creative_requests(workspace_id,request_id,actor_id,payload,result) values(ws,p_request_id,actor,payload,result);
 return result;
end $$;
revoke all on function api.creative_command(text,uuid,integer,uuid,jsonb) from public,anon;
grant execute on function api.creative_command(text,uuid,integer,uuid,jsonb) to authenticated;

create or replace function marketing.creative_card(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('stage',marketing.creative_stage(c.id,c.phase),'owner_name',owner.full_name,'reviewer_name',reviewer.full_name,
 'publication_count',(select count(*) from marketing.creative_publications where creative_id=c.id and status<>'cancelled'),
 'scheduled_count',(select count(*) from marketing.creative_publications where creative_id=c.id and status='scheduled'),
 'published_count',(select count(*) from marketing.creative_publications where creative_id=c.id and status='published'),
 'next_target_date',(select min(target_date) from marketing.creative_publications where creative_id=c.id and status in ('planned','scheduled')),
 'risks',marketing.creative_risks(c.id))
 from marketing.creative_items c left join core.profiles owner on owner.user_id=c.owner_id left join core.profiles reviewer on reviewer.user_id=c.reviewer_id where c.id=p_id
$$;
create or replace function marketing.creative_publication_card(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('title',c.title,'stage',marketing.creative_stage(c.id,c.phase),'condition',c.condition,'owner_name',owner.full_name,'risks',marketing.creative_risks(c.id),
 'external_action_required',p.external_action_required or (p.status in ('scheduled','published') and cardinality(marketing.creative_rights_issues(c.id,p.intended_use,coalesce((p.scheduled_at at time zone 'Asia/Kuala_Lumpur')::date,(p.published_at at time zone 'Asia/Kuala_Lumpur')::date)))>0))
 from marketing.creative_publications p join marketing.creative_items c on c.id=p.creative_id left join core.profiles owner on owner.user_id=c.owner_id where p.id=p_id
$$;
revoke all on function marketing.creative_card(uuid),marketing.creative_publication_card(uuid) from public,anon,authenticated;

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
   and (not coalesce((p_filters->>'unscheduled')::boolean,false) or not exists(select 1 from marketing.creative_publications p where p.creative_id=c.id and p.status<>'cancelled' and (p.target_date is not null or p.scheduled_at is not null or p.published_at is not null)))
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
revoke all on function api.creative_query(text,jsonb,uuid) from public,anon;
grant execute on function api.creative_query(text,jsonb,uuid) to authenticated;

-- Existing source operations invalidate dependent readiness and expose manual external action.
create or replace function marketing.creative_source_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; coid uuid; event_actor uuid:=auth.uid();
begin
 if tg_table_name='shoot_bookings' then
  if new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at and new.status is not distinct from old.status then return new; end if;
  coid:=new.content_opportunity_id;
 else
  if row(new.status,new.permitted_uses,new.restrictions,new.expires_at,new.revoked_at) is not distinct from row(old.status,old.permitted_uses,old.restrictions,old.expires_at,old.revoked_at) then return new; end if;
  coid:=new.content_opportunity_id;
 end if;
 for cid in select distinct creative_id from marketing.creative_sources where content_opportunity_id=coid and removed_at is null and (tg_table_name<>'shoot_bookings' or shoot_booking_id=new.id) order by creative_id loop
  update marketing.creative_items set source_ready=case when tg_table_name='shoot_bookings' then false else source_ready end,revision=revision+1,updated_at=now() where id=cid;
  update marketing.creative_publications set external_action_required=true,external_action_note=null where creative_id=cid and status in ('scheduled','published');
  if event_actor is not null then insert into marketing.creative_events(workspace_id,creative_id,action,actor_id,data) select workspace_id,cid,'source_changed',event_actor,jsonb_build_object('source_table',tg_table_name,'source_id',new.id,'instruction','Review affected schedules and published uses; external cancellation/removal is manual') from marketing.creative_items where id=cid; end if;
 end loop;
 return new;
end $$;
revoke all on function marketing.creative_source_changed() from public,anon,authenticated;
create trigger creative_booking_changed after update on marketing.shoot_bookings for each row execute function marketing.creative_source_changed();
create trigger creative_permission_changed after update on marketing.media_permission_records for each row execute function marketing.creative_source_changed();

-- Preserve existing booking conflicts while fixing interval arithmetic in the travel warning.
create or replace function api.shoot_conflicts(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_participant_ids uuid[] default '{}',
  p_booking_id uuid default null,
  p_buffer_minutes int default 45
) returns table (kind text, severity text, detail text, booking_id uuid, user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_ws uuid := core.current_workspace_id();
begin
  perform core.require_permission('marketing.read');
  return query
  -- same person on an overlapping confirmed/tentative booking
  select 'participant'::text, case when b.status = 'confirmed' then 'blocking' else 'warning' end,
         format('%s is already on "%s" (%s)', coalesce(p.full_name, 'A participant'), coalesce(b.title, 'a booking'), b.status),
         b.id, sp.user_id
  from marketing.shoot_bookings b
  join marketing.shoot_participants sp on sp.shoot_booking_id = b.id
  left join core.profiles p on p.user_id = sp.user_id
  where b.workspace_id = v_ws and b.status in ('tentative','confirmed','customer_confirmation_pending','standby')
    and (p_booking_id is null or b.id <> p_booking_id)
    and sp.user_id = any(coalesce(p_participant_ids, '{}'))
    and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at)
  union all
  -- not enough travel buffer between back-to-back bookings for the same person
  select 'travel_buffer', 'warning',
         format('Only %s minutes between this and "%s"',
                greatest(0, round(least(abs(extract(epoch from (b.starts_at - p_ends_at))), abs(extract(epoch from (p_starts_at - b.ends_at)))) / 60)::int),
                coalesce(b.title, 'another booking')),
         b.id, sp.user_id
  from marketing.shoot_bookings b
  join marketing.shoot_participants sp on sp.shoot_booking_id = b.id
  where b.workspace_id = v_ws and b.status in ('tentative','confirmed','customer_confirmation_pending')
    and (p_booking_id is null or b.id <> p_booking_id)
    and sp.user_id = any(coalesce(p_participant_ids, '{}'))
    and not (tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at))
    and least(abs(extract(epoch from (b.starts_at - p_ends_at))), abs(extract(epoch from (p_starts_at - b.ends_at)))) < coalesce(p_buffer_minutes, 45) * 60
  union all
  -- another shoot already scheduled at the same site
  select 'site', 'warning', format('Another shoot is booked at this site ("%s")', coalesce(b.title, 'booking')), b.id, null::uuid
  from marketing.shoot_bookings b
  join marketing.shoot_locations l on l.shoot_booking_id = b.id
  where b.workspace_id = v_ws and b.status in ('tentative','confirmed','customer_confirmation_pending')
    and (p_booking_id is null or b.id <> p_booking_id)
    and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at)
    and l.project_site_id in (
      select sl.project_site_id from marketing.shoot_locations sl where p_booking_id is not null and sl.shoot_booking_id = p_booking_id);
end $$;
