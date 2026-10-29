create table marketing.meta_sync_state (
 workspace_id uuid not null references core.workspaces(id) on delete cascade,
 account_id text not null check(account_id ~ '^[0-9]{5,30}$'),
 last_attempt_at timestamptz not null default now(),last_success_at timestamptz,
 last_error text,last_from date,last_to date,primary key(workspace_id,account_id)
);
create table marketing.meta_spend_days (
 workspace_id uuid not null references core.workspaces(id) on delete cascade,account_id text not null,
 day date not null,entry_id uuid references marketing.spend_entries(id),reported_amount numeric(14,2) not null,
 entry_version integer,last_fetched_at timestamptz not null default now(),primary key(workspace_id,account_id,day)
);
alter table marketing.meta_sync_state enable row level security;
alter table marketing.meta_spend_days enable row level security;
revoke all on marketing.meta_sync_state,marketing.meta_spend_days from public,anon,authenticated;

create function api.sync_meta_spend(p_workspace uuid,p_actor uuid,p_account text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; d date; amount numeric; e marketing.spend_entries%rowtype; prior marketing.meta_spend_days%rowtype;
 ref text; modified boolean; adopted integer:=0; inserted integer:=0; changed integer:=0; unchanged integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if not exists(select 1 from core.memberships m join core.role_permissions rp on rp.role_key=m.role_key
 where m.workspace_id=p_workspace and m.user_id=p_actor and m.status='active' and rp.permission='marketing.spend.review') then raise exception 'Active spend reviewer required' using errcode='42501'; end if;
 if p_account is null or p_account !~ '^[0-9]{5,30}$' or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 31 then raise exception 'Invalid Meta import' using errcode='23514'; end if;
 if (select count(distinct x->>'day') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then raise exception 'Duplicate dates' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('marketing-spend:'||p_workspace,0));
 for item in select value from jsonb_array_elements(p_rows) loop
 d:=(item->>'day')::date; amount:=(item->>'amount')::numeric;
 if d is null or d>=(now() at time zone 'Asia/Kuala_Lumpur')::date or amount is null or amount<0 or amount::text in ('NaN','Infinity','-Infinity') or round(amount,2)<>amount or amount>999999999999.99 then raise exception 'Invalid completed Meta day' using errcode='23514'; end if;
 modified:=false; ref:='META-'||p_account||'-'||d;
 select * into prior from marketing.meta_spend_days m where m.workspace_id=p_workspace and m.account_id=p_account and m.day=d;
 e:=null;
 if prior.entry_id is not null then
 select * into e from marketing.spend_entries where id=prior.entry_id and workspace_id=p_workspace for update;
 if e.id is null or e.status<>'recorded' or e.version<>prior.entry_version or e.before_tax<>prior.reported_amount or e.reference<>ref or e.platform<>'meta' or e.entry_mode<>'daily_total' or e.incurred_on<>d
 then raise exception 'Meta spend conflict on %: review the manually changed entry',d using errcode='23514'; end if;
 else
 select * into e from marketing.spend_entries s where s.workspace_id=p_workspace and s.platform='meta' and s.incurred_on=d and s.status='recorded' and s.entry_mode in ('daily_total','campaign') order by s.id limit 1 for update;
 if e.id is not null then
 if e.entry_mode<>'daily_total' or e.reference<>ref or e.before_tax<>amount or e.import_batch_id is not null then raise exception 'Meta spend conflict on %: existing ledger cost needs reconciliation',d using errcode='23514'; end if;
 adopted:=adopted+1;
 end if;
 end if;
 if e.id is null and amount>0 then
 insert into marketing.spend_entries(workspace_id,incurred_on,platform,category,entry_mode,entry_key,vendor,description,reference,before_tax,tax,currency,created_by)
 values(p_workspace,d,'meta','platform_ads','daily_total','daily-total','Meta Platforms','Meta Ads Insights daily spend; MYR; Asia/Kuala_Lumpur. Tax not reported by source.',ref,amount,null,'MYR',p_actor) returning * into e;
 inserted:=inserted+1; modified:=true;
 perform audit.emit(p_workspace,'marketing.spend.meta_sync','marketing','spend_entries',e.id,null,to_jsonb(e),null,jsonb_build_object('actor_id',p_actor,'account_id',p_account));
 elsif e.id is not null and e.before_tax<>amount then
 if exists(select 1 from marketing.spend_entries c where c.credit_of=e.id and c.status='recorded') then raise exception 'Meta spend with credits requires review' using errcode='23514'; end if;
 perform audit.emit(p_workspace,'marketing.spend.meta_adjustment','marketing','spend_entries',e.id,to_jsonb(e),jsonb_build_object('before_tax',amount),'Meta restated daily spend',jsonb_build_object('actor_id',p_actor,'account_id',p_account));
 update marketing.spend_entries s set before_tax=amount,version=s.version+1,updated_at=now() where s.id=e.id returning * into e;
 changed:=changed+1; modified:=true;
 else unchanged:=unchanged+1;
 end if;
 if modified then
 update marketing.spend_coverage c set invalidated_at=now() where c.workspace_id=p_workspace and c.platform='meta' and c.invalidated_at is null and d between c.date_from and c.date_to;
 end if;
 insert into marketing.meta_spend_days(workspace_id,account_id,day,entry_id,reported_amount,entry_version)
 values(p_workspace,p_account,d,e.id,amount,e.version)
 on conflict(workspace_id,account_id,day) do update set entry_id=excluded.entry_id,reported_amount=excluded.reported_amount,entry_version=excluded.entry_version,last_fetched_at=now();
 end loop;
 insert into marketing.meta_sync_state(workspace_id,account_id,last_attempt_at,last_success_at,last_from,last_to)
 values(p_workspace,p_account,now(),now(),(select min((x->>'day')::date) from jsonb_array_elements(p_rows) x),(select max((x->>'day')::date) from jsonb_array_elements(p_rows) x))
 on conflict(workspace_id,account_id) do update set last_attempt_at=now(),last_success_at=now(),last_error=null,last_from=excluded.last_from,last_to=excluded.last_to;
 return jsonb_build_object('inserted',inserted,'adopted',adopted,'changed',changed,'unchanged',unchanged);
end $$;
revoke all on function api.sync_meta_spend(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function api.sync_meta_spend(uuid,uuid,text,jsonb) to service_role;

create function api.meta_sync_failed(p_workspace uuid,p_account text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 insert into marketing.meta_sync_state(workspace_id,account_id,last_error) values(p_workspace,p_account,'Daily sync failed. Check server configuration, Meta permissions or ledger conflicts.')
 on conflict(workspace_id,account_id) do update set last_attempt_at=now(),last_error=excluded.last_error;
end $$;
revoke all on function api.meta_sync_failed(uuid,text) from public,anon,authenticated;
grant execute on function api.meta_sync_failed(uuid,text) to service_role;

create function api.meta_sync_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not core.has_permission('report.read') then raise exception 'Permission denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('account_id',s.account_id,'last_attempt_at',s.last_attempt_at,'last_success_at',s.last_success_at,'last_error',s.last_error,'last_from',s.last_from,'last_to',s.last_to)) from marketing.meta_sync_state s where s.workspace_id=core.current_workspace_id()),'[]'::jsonb);
end $$;
revoke all on function api.meta_sync_status() from public,anon;
grant execute on function api.meta_sync_status() to authenticated;
