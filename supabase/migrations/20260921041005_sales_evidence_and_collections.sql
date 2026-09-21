-- F3: purchases remain the sale authority. Unreviewed historical values are not revenue.
alter table sales.purchases add column financial_state text not null default 'legacy_unclassified'
  check (financial_state in ('legacy_unclassified','pending_evidence','confirmed','collection_only')),
  add column lead_id uuid references sales.leads(id),
  add column document_type text,
  add column gross_before_discount numeric(14,2),
  add column discount_amount numeric(14,2),
  add column tax_amount numeric(14,2),
  add column net_sale_amount numeric(14,2),
  add column confirmed_at timestamptz,
  add column legacy_snapshot jsonb,
  add column collection_parent_id uuid references sales.purchases(id) on delete set null;
alter table sales.purchases drop constraint purchases_status_check;
alter table sales.purchases add constraint purchases_status_check check(status in ('draft','recorded','corrected','voided'));
create index purchases_lead_idx on sales.purchases(workspace_id,lead_id,purchased_at);
create unique index purchases_confirmed_document_idx on sales.purchases(workspace_id,lower(btrim(external_ref)))
  where financial_state in ('pending_evidence','confirmed') and external_ref is not null;

alter table sales.purchase_payments add column review_state text not null default 'legacy_unclassified'
  check(review_state in ('legacy_unclassified','confirmed')),
  add column direction text not null default 'collection' check(direction in ('collection','refund')),
  add column reason text,
  add column recorded_by uuid references auth.users(id);

create table sales.sale_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  purchase_id uuid not null references sales.purchases(id) on delete cascade,
  kind text not null check(kind in ('confirmed','credit','void','collection_only','link','draft_updated')),
  occurred_at timestamptz not null,
  net_delta numeric(14,2) not null default 0,
  tax_delta numeric(14,2) not null default 0,
  reason text not null,
  evidence_id uuid,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index sale_events_purchase_idx on sales.sale_events(purchase_id,occurred_at);
create index sale_events_period_idx on sales.sale_events(workspace_id,occurred_at);
create table sales.sale_receipts (
  id uuid primary key,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  purchase_id uuid not null references sales.purchases(id) on delete cascade,
  object_path text not null unique,
  file_name text not null,
  content_type text not null check(content_type in ('application/pdf','image/jpeg','image/png')),
  file_size integer not null check(file_size between 1 and 5242880),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table sales.sale_events add constraint sale_events_evidence_fk foreign key(evidence_id) references sales.sale_receipts(id);
alter table sales.purchase_payments add column evidence_id uuid references sales.sale_receipts(id);
create index sale_receipts_purchase_idx on sales.sale_receipts(purchase_id);
create table sales.sale_requests (
  workspace_id uuid not null references core.workspaces(id) on delete cascade, request_id uuid not null, actor_id uuid not null,
  payload jsonb not null, result uuid not null, primary key(workspace_id,request_id)
);
alter table sales.sale_requests enable row level security;
revoke all on sales.sale_requests from public,anon,authenticated;
alter table sales.sale_events enable row level security;
alter table sales.sale_receipts enable row level security;
create policy sale_event_read on sales.sale_events for select to authenticated
  using(workspace_id = (select core.current_workspace_id()) and (select core.has_permission('sales.read')));
create policy sale_receipt_read on sales.sale_receipts for select to authenticated
  using(workspace_id = (select core.current_workspace_id()) and (select core.has_permission('sales.read')));
grant select on sales.sale_events,sales.sale_receipts to authenticated;
create view api.sale_events with(security_invoker=true) as select * from sales.sale_events;
create view api.sale_receipts with(security_invoker=true) as select * from sales.sale_receipts;
create or replace view api.purchases with(security_invoker=true) as select * from sales.purchases;
create or replace view api.purchase_payments with(security_invoker=true) as select * from sales.purchase_payments;
grant select on api.sale_events,api.sale_receipts to authenticated;

-- Financial mutations go through permissioned transactions, including legacy corrections.
revoke insert,update,delete on sales.purchases,sales.purchase_payments,sales.sale_events,sales.sale_receipts,
  api.purchases,api.purchase_payments,api.sale_events,api.sale_receipts from authenticated;

create view api.sale_balances with(security_invoker=true) as
select p.id,p.workspace_id,p.lead_id,p.financial_state,p.status,
  coalesce(e.net,0) as net_sales,coalesce(e.tax,0) as sales_tax,
  coalesce(c.collected,0) as collections,
  coalesce(e.net,0)+coalesce(e.tax,0)-coalesce(c.collected,0) as balance_due,
  coalesce(c.unreviewed,0) as unreviewed_payments
from sales.purchases p
left join lateral(select sum(net_delta) as net,sum(tax_delta) as tax from sales.sale_events where purchase_id=p.id) e on true
left join lateral(select sum(case when review_state='confirmed' then amount * case when direction='refund' then -1 else 1 end else 0 end) as collected,
  count(*) filter(where review_state='legacy_unclassified') as unreviewed from sales.purchase_payments where purchase_id=p.id) c on true;
grant select on api.sale_balances to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sales-receipts','sales-receipts',false,5242880,array['application/pdf','image/jpeg','image/png']);
create policy sale_receipt_upload on storage.objects for insert to authenticated with check(
  bucket_id='sales-receipts' and exists(select 1 from sales.sale_receipts r where r.object_path=name
    and r.workspace_id=(select core.current_workspace_id()) and r.created_by=(select auth.uid())
    and (select core.has_permission('purchase.write'))));
create policy sale_receipt_download on storage.objects for select to authenticated using(
  bucket_id='sales-receipts' and exists(select 1 from sales.sale_receipts r where r.object_path=name
    and r.workspace_id=(select core.current_workspace_id()) and (select core.has_permission('sales.read'))));
-- No UPDATE/DELETE: uploaded evidence cannot be replaced behind a confirmed sale.

create function api.prepare_sale_receipt(p_purchase_id uuid,p_receipt_id uuid,p_name text,p_type text,p_size integer)
returns text language plpgsql security definer set search_path='' as $$
declare p sales.purchases; r sales.sale_receipts; v_path text;
begin
  perform core.require_permission('purchase.write');
  select * into p from sales.purchases where id=p_purchase_id and workspace_id=core.current_workspace_id() for update;
  if not found then raise exception 'Sale not found' using errcode='42501'; end if;
  if p_receipt_id is null or p_name is null or length(btrim(p_name)) not between 1 and 200
    or p_type is null or p_type not in ('application/pdf','image/jpeg','image/png') or p_size is null or p_size not between 1 and 5242880 then
    raise exception 'Choose a PDF, JPG or PNG up to 5 MB' using errcode='23514'; end if;
  select * into r from sales.sale_receipts where id=p_receipt_id;
  if found then
    if r.purchase_id<>p.id or r.created_by<>auth.uid() or r.file_name<>p_name or r.content_type<>p_type or r.file_size<>p_size then
      raise exception 'Receipt retry differs from the original upload' using errcode='23514'; end if;
    return r.object_path;
  end if;
  v_path:=p.workspace_id::text||'/'||p.id::text||'/'||p_receipt_id::text||case p_type when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end;
  insert into sales.sale_receipts values(p_receipt_id,p.workspace_id,p.id,v_path,p_name,p_type,p_size,auth.uid(),now());
  return v_path;
end $$;

create function api.sale_command(p_action text,p_input jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  ws uuid:=core.current_workspace_id(); p sales.purchases; l sales.leads; v sales.visits;
  req sales.sale_requests; pay sales.purchase_payments;
  id uuid:=nullif(p_input->>'purchase_id','')::uuid;
  lead uuid:=nullif(p_input->>'lead_id','')::uuid;
  visit uuid:=nullif(p_input->>'visit_id','')::uuid;
  customer uuid; acct uuid; opp uuid; project uuid; loc uuid; staff uuid;
  at_time timestamptz:=coalesce(nullif(p_input->>'occurred_at','')::timestamptz,now());
  gross numeric; discount numeric; tax numeric; net numeric; amount numeric; collected numeric;
  ref text:=nullif(btrim(p_input->>'external_ref'),'');
  reason text:=btrim(coalesce(p_input->>'reason',''));
  evidence uuid:=nullif(p_input->>'evidence_id','')::uuid;
  method text:=p_input->>'method'; doc_type text:=p_input->>'document_type';
  payload jsonb:=jsonb_build_object('action',p_action,'input',p_input);
  before_row jsonb; parent sales.purchases;
begin
  perform core.require_permission('purchase.write');
  if p_request_id is null or p_input is null or p_action is null or p_action not in ('save','confirm','collection','refund','credit','void','review_payment','collection_only','link','correct_legacy') then
    raise exception 'Invalid sale command' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text||p_request_id::text,0));
  select * into req from sales.sale_requests where workspace_id=ws and request_id=p_request_id;
  if found then
    if req.actor_id<>auth.uid() or req.payload<>payload then raise exception 'Retry differs from original command' using errcode='23514'; end if;
    return req.result;
  end if;
  if not isfinite(at_time) or at_time>now()+interval '5 minutes' then raise exception 'Choose a valid date, no later than now' using errcode='23514'; end if;
  if id is not null then
    select * into p from sales.purchases where purchases.id=id and workspace_id=ws for update;
    if not found then raise exception 'Sale not found' using errcode='42501'; end if;
    before_row:=to_jsonb(p);
    if p.currency<>'MYR' and p_action<>'correct_legacy' then raise exception 'This record uses another currency. Review its conversion basis before including it in MYR reporting.' using errcode='23514'; end if;
    if nullif(p_input->>'version','')::int is distinct from p.version then raise exception 'Sale changed. Refresh before saving.' using errcode='40001'; end if;
  elsif p_action<>'save' then raise exception 'Choose a sale' using errcode='23514'; end if;

  if p_action='save' or p_action='link' then
    if id is not null then
      lead:=coalesce(lead,p.lead_id); visit:=coalesce(visit,p.visit_id);
      customer:=p.contact_id; acct:=p.account_id; opp:=p.opportunity_id; project:=p.project_id; loc:=p.location_id; staff:=p.salesperson_id;
    end if;
    if visit is not null then
      select * into v from sales.visits where visits.id=visit and workspace_id=ws for update;
      if not found then raise exception 'Visit not found' using errcode='42501'; end if;
      if customer is not null and customer is distinct from v.contact_id then raise exception 'Visit belongs to a different customer' using errcode='23514'; end if;
      if lead is not null and v.lead_id is not null and lead<>v.lead_id then raise exception 'Visit and inquiry links disagree' using errcode='23514'; end if;
      lead:=coalesce(lead,v.lead_id); customer:=v.contact_id; acct:=v.account_id; opp:=v.opportunity_id; loc:=v.location_id; staff:=v.staff_user_id;
    end if;
    if lead is not null then
      select * into l from sales.leads where leads.id=lead and workspace_id=ws for update;
      if not found or not (core.has_permission('sales.leads.read_all') or core.has_permission('sales.read_all') or l.owner_id=auth.uid() or l.owner_id is null) then
        raise exception 'Inquiry not accessible' using errcode='42501'; end if;
      if l.status in ('duplicate','disqualified') then raise exception 'Resolve duplicate or reopen the lost inquiry before linking a sale' using errcode='23514'; end if;
      if l.contact_id is null then raise exception 'Confirm the customer identity on the inquiry before recording a sale' using errcode='23514'; end if;
      if customer is not null and customer<>l.contact_id then raise exception 'Inquiry belongs to a different customer' using errcode='23514'; end if;
      if acct is not null and l.account_id is not null and acct<>l.account_id then raise exception 'Inquiry and sale accounts disagree' using errcode='23514'; end if;
      customer:=l.contact_id; acct:=coalesce(acct,l.account_id); opp:=coalesce(opp,l.converted_opportunity_id); loc:=coalesce(loc,l.location_id); staff:=coalesce(staff,l.owner_id);
      if at_time<l.created_at and p_action='save' then raise exception 'Sale cannot predate its inquiry' using errcode='23514'; end if;
    end if;
    if customer is null or not exists(select 1 from identity.contacts c where c.id=customer and c.workspace_id=ws and c.merged_into_contact_id is null and c.archived_at is null and not c.is_provisional) then
      raise exception 'Confirm an active customer before saving' using errcode='23514'; end if;
    if opp is not null then
      select o.project_id into project from sales.opportunities o where o.id=opp and o.workspace_id=ws and o.contact_id=customer;
      if not found then raise exception 'Opportunity does not match customer' using errcode='23514'; end if;
    end if;
    if p_action='link' then
      perform core.require_permission('purchase.correct');
      if length(reason)<5 then raise exception 'Give a link correction reason' using errcode='23514'; end if;
      update sales.purchases set lead_id=lead,visit_id=visit where purchases.id=id;
      insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,reason,actor_id) values(ws,id,'link',now(),reason,auth.uid());
      if p.lead_id is distinct from lead and p.lead_id is not null then
        insert into sales.activities(workspace_id,kind,subject,body,actor_id,lead_id,purchase_id)
          values(ws,'note','Sale attribution corrected',reason,auth.uid(),p.lead_id,id);
      end if;
      if p.financial_state='confirmed' and exists(select 1 from api.sale_balances where sale_balances.id=id and net_sales>0) then
        update sales.tasks set status='cancelled',outcome='Cancelled: documented sale confirmed' where lead_id=lead and status='open';
      end if;
    else
      if id is not null and (p.financial_state not in ('pending_evidence','legacy_unclassified','collection_only') or p.collection_parent_id is not null) then raise exception 'Confirmed values are immutable; record a credit or void instead' using errcode='23514'; end if;
      if id is not null and p.financial_state in ('legacy_unclassified','collection_only') then
        perform core.require_permission('purchase.correct');
        if length(reason)<5 then raise exception 'Explain how the historical amount was verified as a full sale' using errcode='23514'; end if;
      end if;
      gross:=(p_input->>'gross_before_discount')::numeric; discount:=(p_input->>'discount_amount')::numeric; tax:=(p_input->>'tax_amount')::numeric;
      if gross is null or discount is null or tax is null or gross not between 0.01 and 999999999999.99 or discount not between 0 and gross or tax not between 0 and 999999999999.99
        or round(gross,2)<>gross or round(discount,2)<>discount or round(tax,2)<>tax or gross-discount<=0
        or ref is null or length(ref)>100 or doc_type is null or doc_type not in ('invoice','receipt','sales_order') then
        raise exception 'Enter a document, positive sale before tax, discount and explicitly stated tax (zero if none)' using errcode='23514'; end if;
      perform pg_advisory_xact_lock(hashtextextended(ws::text||lower(ref),1));
      if exists(select 1 from sales.purchases q where q.workspace_id=ws and lower(btrim(q.external_ref))=lower(ref) and (id is null or q.id<>id)) then
        raise exception 'Document already recorded. Open and review the existing purchase instead.' using errcode='23514'; end if;
      if id is null then
        insert into sales.purchases(workspace_id,contact_id,account_id,lead_id,visit_id,opportunity_id,project_id,location_id,salesperson_id,purchased_at,
          external_ref,amount,currency,purchase_source,status,financial_state,document_type,gross_before_discount,discount_amount,tax_amount,net_sale_amount,recorded_by,notes)
        values(ws,customer,acct,lead,visit,opp,project,loc,coalesce(staff,auth.uid()),at_time,ref,0,'MYR',case when visit is null then 'other' else 'walk_in' end,
          'draft','pending_evidence',doc_type,gross,discount,tax,gross-discount,auth.uid(),nullif(p_input->>'notes','')) returning purchases.id into id;
      else
        update sales.purchases set legacy_snapshot=case when financial_state='legacy_unclassified' then to_jsonb(p) else legacy_snapshot end,
          lead_id=lead,visit_id=visit,financial_state='pending_evidence',status='draft',amount=0,purchased_at=at_time,external_ref=ref,document_type=doc_type,
          gross_before_discount=gross,discount_amount=discount,tax_amount=tax,net_sale_amount=gross-discount where purchases.id=id;
      end if;
      insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,reason,actor_id) values(ws,id,'draft_updated',now(),coalesce(nullif(reason,''),'Sale details saved; awaiting evidence and confirmation'),auth.uid());
    end if;
  elsif p_action='correct_legacy' then
    perform core.require_permission('purchase.correct');
    amount:=(p_input->>'amount')::numeric;
    if p.financial_state<>'legacy_unclassified' or amount is null or amount not between 0 and 999999999999.99 or round(amount,2)<>amount or length(reason)<5 then
      raise exception 'Only unclassified legacy amounts can be corrected here; enter a valid amount and reason' using errcode='23514'; end if;
    update sales.purchases set legacy_snapshot=coalesce(legacy_snapshot,to_jsonb(p)),amount=amount,status='corrected' where purchases.id=id;
  elsif p_action='collection_only' then
    perform core.require_permission('purchase.correct');
    if p.financial_state not in ('legacy_unclassified','collection_only') or length(reason)<5 then raise exception 'Choose an unreviewed or collection-only record and explain the classification' using errcode='23514'; end if;
    if nullif(p_input->>'collection_parent_id','') is not null then
      select * into parent from sales.purchases where purchases.id=(p_input->>'collection_parent_id')::uuid and workspace_id=ws for update;
      if not found or parent.id=id or parent.financial_state<>'confirmed' or parent.status='voided' or parent.contact_id is distinct from p.contact_id or parent.currency<>p.currency or p.collection_parent_id is not null then
        raise exception 'Choose a confirmed sale for the same customer; collection records can be linked once' using errcode='23514'; end if;
      if exists(select 1 from sales.purchase_payments where purchase_id=id and review_state='confirmed') then
        raise exception 'Review already-confirmed collections before moving this record' using errcode='23514'; end if;
      update sales.purchase_payments set purchase_id=parent.id where purchase_id=id;
    end if;
    update sales.purchases set financial_state='collection_only',legacy_snapshot=coalesce(legacy_snapshot,to_jsonb(p)),collection_parent_id=coalesce(parent.id,collection_parent_id) where purchases.id=id;
    insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,reason,actor_id) values(ws,id,'collection_only',now(),reason,auth.uid());
  elsif p_action='confirm' then
    if p.financial_state<>'pending_evidence' or p.status<>'draft' then raise exception 'Only an evidence-pending sale can be confirmed' using errcode='23514'; end if;
    perform 1 from identity.contacts c where c.id=p.contact_id and c.workspace_id=ws and c.archived_at is null and c.merged_into_contact_id is null and not c.is_provisional for update;
    if not found then raise exception 'Customer identity changed. Review this draft before confirmation.' using errcode='23514'; end if;
    if not exists(select 1 from sales.sale_receipts r join storage.objects o on o.bucket_id='sales-receipts' and o.name=r.object_path
      where r.purchase_id=id and (o.metadata->>'size')::bigint=r.file_size and o.metadata->>'mimetype'=r.content_type) then
      raise exception 'Upload the receipt or invoice before confirming this sale' using errcode='23514'; end if;
    if p.lead_id is not null then
      select * into l from sales.leads where leads.id=p.lead_id for update;
      if l.status in ('disqualified','duplicate') or l.contact_id is distinct from p.contact_id then raise exception 'Inquiry changed. Resolve its identity or lost status first.' using errcode='23514'; end if;
    end if;
    update sales.purchases set status='recorded',financial_state='confirmed',confirmed_at=now(),amount=net_sale_amount+tax_amount,
      is_repeat=exists(select 1 from sales.purchases other join api.sale_balances b on b.id=other.id
        where other.workspace_id=ws and other.id<>id and other.contact_id=p.contact_id and other.purchased_at<=p.purchased_at and b.net_sales>0)
      where purchases.id=id;
    insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,net_delta,tax_delta,reason,actor_id)
      values(ws,id,'confirmed',p.purchased_at,p.net_sale_amount,p.tax_amount,'Documented sale confirmed; pending inquiry reminders cancelled',auth.uid());
    update sales.tasks set status='cancelled',outcome='Cancelled: documented sale confirmed' where lead_id=p.lead_id and status='open';
    update identity.contacts set lifecycle_state=case when (select count(*) from sales.purchases q join api.sale_balances b on b.id=q.id where q.workspace_id=ws and q.contact_id=p.contact_id and b.net_sales>0)>1 then 'repeat' else 'active' end where contacts.id=p.contact_id;
  elsif p_action in ('collection','refund','review_payment') then
    if p.collection_parent_id is not null then raise exception 'Record payments on the linked full sale' using errcode='23514'; end if;
    if p_action='review_payment' then
      perform core.require_permission('purchase.correct');
      select * into pay from sales.purchase_payments pp where pp.id=nullif(p_input->>'payment_id','')::uuid and pp.purchase_id=id for update;
      if not found or pay.review_state<>'legacy_unclassified' then raise exception 'Unreviewed payment not found' using errcode='23514'; end if;
      amount:=pay.amount; method:=pay.method;
    else amount:=(p_input->>'amount')::numeric;
    end if;
    if p.financial_state not in ('confirmed','collection_only') or amount is null or amount not between 0.01 and 999999999999.99 or round(amount,2)<>amount
      or method is null or method not in ('cash','card','bank_transfer','ewallet','cheque','other') or length(reason)<5 or at_time<p.purchased_at then
      raise exception 'Choose a reviewed sale, actual payment method, valid amount/date and reference or reason; credit terms are not cash' using errcode='23514'; end if;
    select coalesce(sum(pp.amount * case when pp.direction='refund' then -1 else 1 end),0) into collected from sales.purchase_payments pp where pp.purchase_id=id and review_state='confirmed';
    if p_action='refund' then
      perform core.require_permission('purchase.correct');
      if amount>collected then raise exception 'Cash refund exceeds recorded collections' using errcode='23514'; end if;
      if evidence is null or not exists(select 1 from sales.sale_receipts r join storage.objects o on o.bucket_id='sales-receipts' and o.name=r.object_path where r.id=evidence and r.purchase_id=id) then
        raise exception 'Upload and select supporting evidence for the cash refund' using errcode='23514'; end if;
    elsif p.financial_state='confirmed' then
      select coalesce(sum(net_delta+tax_delta),0) into net from sales.sale_events where purchase_id=id;
      if collected+amount>net then raise exception 'Collection exceeds the remaining document balance' using errcode='23514'; end if;
    end if;
    if p_action='review_payment' then
      update sales.purchase_payments set review_state='confirmed',paid_at=at_time,reason=reason,recorded_by=auth.uid() where purchase_payments.id=pay.id;
    else
      insert into sales.purchase_payments(purchase_id,method,amount,reference,paid_at,review_state,direction,reason,recorded_by,evidence_id)
        values(id,method,amount,nullif(p_input->>'reference',''),at_time,'confirmed',case when p_action='refund' then 'refund' else 'collection' end,reason,auth.uid(),case when p_action='refund' then evidence else null end);
    end if;
  elsif p_action in ('credit','void') then
    perform core.require_permission('purchase.correct');
    if p.financial_state<>'confirmed' or p.status='voided' or length(reason)<5 or at_time<p.purchased_at then raise exception 'Choose a confirmed sale and give a dated adjustment reason' using errcode='23514'; end if;
    if evidence is null or not exists(select 1 from sales.sale_receipts r join storage.objects o on o.bucket_id='sales-receipts' and o.name=r.object_path where r.id=evidence and r.purchase_id=id) then
      raise exception 'Upload and select supporting evidence for the adjustment' using errcode='23514'; end if;
    select coalesce(sum(net_delta),0),coalesce(sum(tax_delta),0) into net,tax from sales.sale_events where purchase_id=id;
    if p_action='credit' then
      amount:=(p_input->>'amount')::numeric; gross:=(p_input->>'tax_amount')::numeric;
      if amount is null or gross is null or amount not between 0 and net or gross not between 0 and tax or amount+gross<=0 or round(amount,2)<>amount or round(gross,2)<>gross then
        raise exception 'Credit must be positive and no greater than the remaining sale and tax' using errcode='23514'; end if;
    else amount:=net; gross:=tax;
      update sales.purchases set status='voided' where purchases.id=id;
    end if;
    insert into sales.sale_events(workspace_id,purchase_id,kind,occurred_at,net_delta,tax_delta,reason,evidence_id,actor_id)
      values(ws,id,p_action,at_time,-amount,-gross,reason,evidence,auth.uid());
  end if;
  update sales.purchases set version=version+1 where purchases.id=id;
  select * into p from sales.purchases where purchases.id=id;
  insert into sales.activities(workspace_id,kind,subject,body,actor_id,lead_id,contact_id,purchase_id,metadata)
    values(ws,'note','Sale · '||p_action,coalesce(nullif(reason,''),p.external_ref),auth.uid(),p.lead_id,p.contact_id,id,jsonb_build_object('request_id',p_request_id,'action',p_action));
  perform audit.emit(ws,'sale.'||p_action,'sales','purchases',id,before_row,to_jsonb(p),null,payload);
  insert into sales.sale_requests values(ws,p_request_id,auth.uid(),payload,id);
  return id;
end $$;
revoke all on function api.prepare_sale_receipt(uuid,uuid,text,text,integer),api.sale_command(text,jsonb,uuid) from public,anon;
grant execute on function api.prepare_sale_receipt(uuid,uuid,text,text,integer),api.sale_command(text,jsonb,uuid) to authenticated;

create or replace view api.inbox_leads with (security_invoker = true) as
select l.*, f.next_follow_up_task_id, f.next_follow_up_at, f.follow_up_owner_id,
       f.open_follow_ups, f.completed_follow_ups,
       (coalesce(b.confirmed_sales,0)=0 and l.status not in ('disqualified','duplicate') and
         ((l.first_response_at is null and s.first_showroom_at is null) or
          (f.open_follow_ups = 0 and l.no_next_action_reason is null) or
          (f.open_follow_ups > 0 and f.next_follow_up_at is null) or
          coalesce(f.next_follow_up_at < (date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur',false))) as needs_action, s.first_showroom_at, s.showroom_visits, b.first_sale_at, b.confirmed_sales, b.recorded_net_sales
from sales.leads l left join lateral api.lead_followup_summary(l.id) f on true
left join lateral (select min(v.occurred_at) as first_showroom_at, count(*) as showroom_visits
  from sales.visits v where v.workspace_id = l.workspace_id and v.lead_id = l.id) s on true
left join lateral (select min(p.purchased_at) filter(where x.net_sales>0 and p.status<>'voided') as first_sale_at,
 count(*) filter(where x.net_sales>0 and p.status<>'voided') as confirmed_sales,coalesce(sum(x.net_sales),0) as recorded_net_sales
 from sales.purchases p join api.sale_balances x on x.id=p.id where p.workspace_id=l.workspace_id and p.lead_id=l.id and p.financial_state='confirmed') b on true;
grant select on api.inbox_leads to authenticated;


create or replace function api.inquiry_page(p_view text default 'needs-action', p_search text default '',
  p_owner text default 'all', p_source text default '', p_page integer default 1, p_size integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb; v_end timestamptz := (date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur';
begin
  perform core.require_permission('sales.read');
  if p_view is null or p_view not in ('needs-action','new','waiting','contacted','replied','unassigned','mine','no-response','follow-up','follow-ups-due','upcoming','follow-ups-completed','duplicates','qualified','disqualified','all','aging','showroom','won') then
    raise exception 'Unknown inbox view' using errcode = '22023';
  end if;
  if p_size is null or p_page is null or p_search is null or p_owner is null or p_source is null
    or p_size < 1 or p_size > 100 or p_page < 1 or p_page > 1000000 or length(p_search) > 200 then
    raise exception 'Invalid page or search' using errcode = '22023';
  end if;
  with base as materialized (
    select l.*, array_remove(array[
      'all',
      case when l.confirmed_sales>0 then 'won' end,
      case when l.first_showroom_at is not null then 'showroom' end,
      case when l.needs_action then 'needs-action' end,
      case when l.confirmed_sales=0 and l.status = 'new' then 'new' end,
      case when l.confirmed_sales=0 and l.status = 'contact_attempted' and l.source_channel <> 'walk_in' and l.first_customer_reply_at is null then 'waiting' end,
      case when l.confirmed_sales=0 and l.status = 'contacted' and l.source_channel <> 'walk_in' then 'contacted' end,
      case when l.confirmed_sales=0 and l.first_customer_reply_at is not null and l.status not in ('disqualified','duplicate') then 'replied' end,
      case when l.confirmed_sales=0 and l.owner_id is null and l.status in ('new','contact_attempted','contacted','qualified','converted') then 'unassigned' end,
      case when l.confirmed_sales=0 and l.owner_id = auth.uid() and l.status in ('new','contact_attempted','contacted','qualified','converted') then 'mine' end,
      case when l.confirmed_sales=0 and l.status not in ('disqualified','duplicate') and l.last_no_response_at is not null
        and l.last_no_response_at >= l.last_contact_attempt_at
        and (l.last_customer_reply_at is null or l.last_no_response_at > l.last_customer_reply_at) then 'no-response' end,
      case when l.confirmed_sales=0 and l.status in ('new','contact_attempted','contacted') and l.first_response_at is null and l.first_response_due_at < now() then 'follow-up' end,
      case when l.confirmed_sales=0 and l.next_follow_up_at < v_end and l.status not in ('disqualified','duplicate') then 'follow-ups-due' end,
      case when l.confirmed_sales=0 and l.next_follow_up_at >= v_end and l.status not in ('disqualified','duplicate') then 'upcoming' end,
      case when l.completed_follow_ups > 0 then 'follow-ups-completed' end,
      case when l.status = 'duplicate' or l.duplicate_of_lead_id is not null then 'duplicates' end,
      case when l.status in ('qualified','converted') then 'qualified' end,
      case when l.status = 'disqualified' then 'disqualified' end,
      case when l.confirmed_sales=0 and l.status in ('new','contact_attempted') and l.created_at < now() - interval '2 days' then 'aging' end
    ], null) as inbox_views
    from api.inbox_leads l
    where (p_source = '' or l.source_channel = p_source)
      and (p_owner = 'all' or (p_owner = 'mine' and l.owner_id = auth.uid()) or (p_owner = 'unassigned' and l.owner_id is null)
        or l.owner_id::text = p_owner)
      and (btrim(p_search) = '' or
        strpos(lower(concat_ws(' ',l.raw_name,l.raw_company,l.raw_email,l.source_detail,l.id::text)), lower(btrim(p_search))) > 0
        or (length(regexp_replace(p_search,'[^0-9]','','g')) >= 4 and
          strpos(regexp_replace(coalesce(l.raw_phone_normalized,l.raw_phone,''),'[^0-9]','','g'),
            regexp_replace(p_search,'[^0-9]','','g')) > 0))
  ), filtered as materialized (select * from base where p_view = any(inbox_views)),
  totals as (select count(*) as total from filtered),
  paging as (select total, least(p_page, greatest(1, ceil(total::numeric / p_size)::integer)) as page from totals),
  page_rows as (
    select * from filtered order by
      case when p_view in ('needs-action','follow-ups-due','upcoming') then next_follow_up_at end asc nulls last,
      created_at desc, id
    offset (select (page - 1) * p_size from paging) limit p_size
  ), counts as (
    select v, count(*) as n from base cross join lateral unnest(inbox_views) v group by v
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
    'total', (select total from paging), 'page', (select page from paging), 'page_size', p_size,
    'counts', coalesce((select jsonb_object_agg(v,n) from counts),'{}'::jsonb)) into result;
  return result;
end $$;
revoke all on function api.inquiry_page(text,text,text,text,integer,integer) from public, anon;
grant execute on function api.inquiry_page(text,text,text,text,integer,integer) to authenticated;

create or replace function api.record_purchase(
  p_contact_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_external_ref text default null,
  p_payments jsonb default '[]'::jsonb,      -- [{method, amount, reference}]
  p_items jsonb default '[]'::jsonb,         -- [{description, quantity, unit, unit_price, product_variant_id}]
  p_opportunity_id uuid default null,
  p_project_id uuid default null,
  p_visit_id uuid default null,
  p_location_id uuid default null,
  p_salesperson_id uuid default null,
  p_purchase_source text default 'walk_in',
  p_purchased_at timestamptz default now(),
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_id uuid;
  v_prior int;
  v_pay jsonb;
  v_item jsonb;
  v_pos int := 0;
begin
  perform core.require_permission('purchase.write');
  if p_contact_id is not null and not exists(select 1 from identity.contacts where id=p_contact_id and workspace_id=v_ws) then raise exception 'Customer not in workspace' using errcode='42501'; end if;
  if p_account_id is not null and not exists(select 1 from identity.accounts where id=p_account_id and workspace_id=v_ws) then raise exception 'Account not in workspace' using errcode='42501'; end if;
  if p_visit_id is not null and not exists(select 1 from sales.visits where id=p_visit_id and workspace_id=v_ws and contact_id is not distinct from p_contact_id) then raise exception 'Visit does not match customer' using errcode='23514'; end if;
  if p_opportunity_id is not null and not exists(select 1 from sales.opportunities where id=p_opportunity_id and workspace_id=v_ws and contact_id is not distinct from p_contact_id) then raise exception 'Opportunity does not match customer' using errcode='23514'; end if;
  if p_project_id is not null and not exists(select 1 from identity.projects where id=p_project_id and workspace_id=v_ws) then raise exception 'Project not in workspace' using errcode='42501'; end if;
  if p_location_id is not null and not exists(select 1 from core.business_locations where id=p_location_id and workspace_id=v_ws) then raise exception 'Location not in workspace' using errcode='42501'; end if;
  if p_salesperson_id is not null and not exists(select 1 from core.memberships where user_id=p_salesperson_id and workspace_id=v_ws and status='active') then raise exception 'Salesperson not in workspace' using errcode='42501'; end if;
  if p_amount is null or p_amount not between 0 and 999999999999.99 or round(p_amount,2)<>p_amount then raise exception 'Invalid amount' using errcode='23514'; end if;
  if nullif(btrim(p_external_ref),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_ws::text||lower(btrim(p_external_ref)),1));
    if exists(select 1 from sales.purchases where workspace_id=v_ws and lower(btrim(external_ref))=lower(btrim(p_external_ref))) then raise exception 'Document already recorded; review the existing purchase' using errcode='23514'; end if;
  end if;

  if p_contact_id is null and p_account_id is null then
    raise exception 'purchase needs a contact or account' using errcode = '23514';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be >= 0' using errcode = '23514';
  end if;

  select count(*) into v_prior from sales.purchases p
  where p.workspace_id = v_ws and p.status <> 'voided'
    and ((p_contact_id is not null and p.contact_id = p_contact_id) or (p_account_id is not null and p.account_id = p_account_id));

  insert into sales.purchases (workspace_id, contact_id, account_id, opportunity_id, project_id, visit_id, purchased_at, external_ref, amount,
    purchase_source, location_id, salesperson_id, is_repeat, notes, recorded_by)
  values (v_ws, p_contact_id, p_account_id, p_opportunity_id, p_project_id, p_visit_id, coalesce(p_purchased_at, now()), p_external_ref, p_amount,
    p_purchase_source, p_location_id, coalesce(p_salesperson_id, auth.uid()), v_prior > 0, p_notes, auth.uid())
  returning id into v_id;

  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if (v_pay->>'amount')::numeric not between 0.01 and 999999999999.99 then raise exception 'Invalid payment amount' using errcode='23514'; end if;
    insert into sales.purchase_payments (purchase_id, method, amount, reference, paid_at)
    values (v_id, coalesce(v_pay->>'method', 'other'), (v_pay->>'amount')::numeric, v_pay->>'reference', coalesce(p_purchased_at, now()));
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into sales.purchase_items (purchase_id, product_variant_id, description, quantity, unit, unit_price, line_total, position)
    values (v_id, nullif(v_item->>'product_variant_id', '')::uuid, coalesce(v_item->>'description', 'Item'),
      coalesce((v_item->>'quantity')::numeric, 1), v_item->>'unit', (v_item->>'unit_price')::numeric,
      coalesce((v_item->>'line_total')::numeric, coalesce((v_item->>'quantity')::numeric, 1) * coalesce((v_item->>'unit_price')::numeric, 0)), v_pos);
  end loop;

  insert into sales.activities (workspace_id, kind, channel, subject, body, actor_id, contact_id, account_id, project_id, opportunity_id, visit_id, purchase_id, metadata)
  values (v_ws, 'note', p_purchase_source, format('Purchase recorded%s', case when p_external_ref is null then '' else ' · ' || p_external_ref end),
    p_notes, auth.uid(), p_contact_id, p_account_id, p_project_id, p_opportunity_id, p_visit_id, v_id,
    jsonb_build_object('amount', p_amount, 'repeat', v_prior > 0));

  -- lifecycle derivation (does not touch original_acquisition_source)
  if p_contact_id is not null then
    update identity.contacts set lifecycle_state = case when v_prior > 0 then 'repeat' else 'active' end where id = p_contact_id;
  end if;
  if p_account_id is not null then
    update identity.accounts set lifecycle_state = case when v_prior > 0 then 'repeat' else 'active' end where id = p_account_id;
  end if;

  perform audit.emit(v_ws, case when v_prior > 0 then 'purchase.recorded.repeat' else 'purchase.recorded' end, 'sales', 'purchases', v_id, null,
    jsonb_build_object('amount', p_amount, 'external_ref', p_external_ref), null, jsonb_build_object('repeat', v_prior > 0));
  return v_id;
end $$;
grant execute on function api.record_purchase(uuid,uuid,numeric,text,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text) to authenticated;


revoke all on function api.record_purchase(uuid,uuid,numeric,text,jsonb,jsonb,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text) from public,anon;

create or replace function sales.guard_inquiry_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l sales.leads%rowtype;
begin
  if tg_op = 'UPDATE' and auth.role() = 'authenticated' and old.lead_id is not null and old.lead_id is distinct from new.lead_id then
    raise exception 'An inquiry task cannot be moved to another inquiry' using errcode = '23514';
  end if;
  if new.lead_id is null then return new; end if;
  select * into l from sales.leads where id = new.lead_id;
  if not found or l.workspace_id <> new.workspace_id then
    raise exception 'Task and inquiry must belong to the same workspace' using errcode = '23514';
  end if;
  if auth.role() = 'authenticated' then
    perform core.require_workspace(l.workspace_id);
    perform core.require_permission('sales.write');
    -- The confirming transaction may close reminders owned by another salesperson.
    -- The immutable event must already exist in this transaction; direct task edits
    -- cannot forge it, and no other task field can change through this exception.
    if tg_op='UPDATE' and old.status='open' and new.status='cancelled'
      and new.outcome='Cancelled: documented sale confirmed'
      and (to_jsonb(new)-array['status','outcome','updated_at'])=(to_jsonb(old)-array['status','outcome','updated_at'])
      and exists(select 1 from sales.sale_events e join sales.purchases p on p.id=e.purchase_id
        where p.lead_id=l.id and p.workspace_id=l.workspace_id and p.financial_state='confirmed'
          and e.kind in ('confirmed','link') and e.actor_id=auth.uid() and e.created_at=transaction_timestamp()) then return new; end if;
    perform sales.require_lead_owner(l);
    if new.status = 'open' and l.status in ('disqualified','duplicate') then
      raise exception 'Reopen the inquiry before reopening its follow-up' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace function api.report_walkins(p_from date default null, p_to date default null)
returns table (bucket text, visits bigint, new_customers bigint, purchases bigint, amount numeric, payment_mix jsonb)
language sql stable security definer set search_path = '' as $$
  select coalesce(loc.name, 'Unassigned'),
         count(distinct v.id),
         count(distinct v.id) filter (where v.is_new_customer),
         count(distinct p.id),
         coalesce(sum(p.amount), 0),
         coalesce((select jsonb_object_agg(m.method, m.n) from (
            select pp.method, count(*) n
            from sales.purchase_payments pp
            join sales.purchases p2 on p2.id = pp.purchase_id
            where p2.location_id is not distinct from v.location_id and p2.workspace_id = v.workspace_id
              and (p_from is null or p2.purchased_at >= p_from) and (p_to is null or p2.purchased_at < p_to + 1)
            group by pp.method) m), '{}'::jsonb)
  from sales.visits v
  left join core.business_locations loc on loc.id = v.location_id
  left join sales.purchases p on p.visit_id = v.id and p.status in ('recorded','corrected')
  where v.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
    and (p_from is null or v.occurred_at >= p_from) and (p_to is null or v.occurred_at < p_to + 1)
  group by loc.name, v.location_id, v.workspace_id
  order by 2 desc
$$;
create or replace function api.report_cohorts(p_from date default null, p_to date default null)
returns table (cohort_month date, customers bigint, repeat_customers bigint, purchases bigint, amount numeric, median_days_between numeric)
language sql stable security definer set search_path = '' as $$
  with per_contact as (
    select p.contact_id,
           date_trunc('month', min(p.purchased_at))::date as cohort_month,
           count(*) as purchase_count,
           sum(p.amount) as amount,
           case when count(*) > 1
                then extract(epoch from (max(p.purchased_at) - min(p.purchased_at))) / 86400 / (count(*) - 1)
           end as avg_gap_days
    from sales.purchases p
    where p.workspace_id in (select core.member_workspace_ids()) and core.has_permission('report.read')
      and p.status in ('recorded','corrected') and p.contact_id is not null
      and (p_from is null or p.purchased_at >= p_from) and (p_to is null or p.purchased_at < p_to + 1)
    group by p.contact_id
  )
  select cohort_month, count(*), count(*) filter (where purchase_count > 1),
         sum(purchase_count), sum(amount),
         round((percentile_cont(0.5) within group (order by avg_gap_days))::numeric, 1)
  from per_contact
  group by cohort_month
  order by cohort_month
$$;

create or replace function api.feedback_purchase_context(p_purchase_id uuid)
returns table (
  purchase_id uuid, purchase_ref text, purchased_at timestamptz, amount numeric, currency text,
  contact_id uuid, customer_name text, phone text, visit_id uuid, location_id uuid,
  location_name text, salesperson_id uuid, salesperson_name text, existing_request_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform core.require_permission('sales.write');
  return query
  select p.id, p.external_ref, p.purchased_at, p.amount, p.currency::text,
    p.contact_id, c.display_name,
    case when core.has_permission('contact.reveal') then cp.normalized_value else null end,
    p.visit_id, p.location_id, l.name, p.salesperson_id, pr.full_name, fr.id
  from sales.purchases p
  join identity.contacts c on c.id = p.contact_id
  left join lateral (
    select x.normalized_value from identity.contact_points x
    where x.contact_id = p.contact_id and x.kind in ('phone','whatsapp')
    order by x.is_primary desc, x.created_at asc limit 1
  ) cp on true
  left join core.business_locations l on l.id = p.location_id
  left join core.profiles pr on pr.user_id = p.salesperson_id
  left join feedback.requests fr on fr.purchase_id = p.id
  where p.id = p_purchase_id
    and p.workspace_id = core.current_workspace_id()
    and p.status in ('recorded','corrected');
end $$;
create or replace function api.sales_scorecard(p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_me uuid := auth.uid();
  v_all boolean := core.has_permission('sales.read_all');
  v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Kuala_Lumpur'))::int);
  v_start timestamptz := (make_date(v_year, 1, 1)::timestamp) at time zone 'Asia/Kuala_Lumpur';
  v_end   timestamptz := (make_date(v_year + 1, 1, 1)::timestamp) at time zone 'Asia/Kuala_Lumpur';
  v_target numeric; v_currency char(3);
  v_collected numeric; v_pipeline numeric; v_segments jsonb;
begin
  perform core.require_permission('sales.read');
  select target_amount, currency into v_target, v_currency
    from sales.sales_targets where workspace_id = v_ws and year = v_year;
  select coalesce(sum(pp.amount * case when pp.direction='refund' then -1 else 1 end),0) into v_collected
    from sales.purchase_payments pp join sales.purchases p on p.id=pp.purchase_id
    where p.workspace_id=v_ws and pp.review_state='confirmed' and pp.currency='MYR'
      and pp.paid_at>=v_start and pp.paid_at<v_end;
  select coalesce(sum(o.estimated_value), 0) into v_pipeline from sales.opportunities o
    where o.workspace_id = v_ws and o.status = 'open' and (v_all or o.owner_id = v_me);
  select coalesce(jsonb_agg(jsonb_build_object('segment', seg, 'value', val) order by val desc), '[]'::jsonb)
    into v_segments from (
      select coalesce(o.segment, 'other') as seg, sum(o.estimated_value) as val
      from sales.opportunities o
      where o.workspace_id = v_ws and o.status = 'open' and o.estimated_value is not null
        and (v_all or o.owner_id = v_me)
      group by coalesce(o.segment, 'other')
    ) s;
  return jsonb_build_object(
    'year', v_year, 'target', v_target, 'currency', coalesce(v_currency, 'MYR'),
    'collected', v_collected, 'pipeline', v_pipeline, 'segments', v_segments,
    'unreviewed_records', (select count(*) from sales.purchases p where p.workspace_id=v_ws and p.financial_state='legacy_unclassified'), 'generated_at', now());
end $$;

create or replace function api.command_centre_summary()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid := core.current_workspace_id();
  v_me uuid := auth.uid();
  v_all boolean := core.has_permission('sales.read_all');
  result jsonb;
begin
  perform core.require_permission('sales.read');
  select jsonb_build_object(
    'aging_leads', (select count(*) from sales.leads l where l.workspace_id = v_ws and l.status in ('new','contact_attempted') and l.created_at < now() - interval '2 days' and (v_all or l.owner_id = v_me or l.owner_id is null)),
    'unassigned_leads', (select count(*) from sales.leads l where l.workspace_id = v_ws and l.status in ('new','contact_attempted','contacted') and l.owner_id is null),
    'no_response_leads', (select count(*) from sales.leads l where l.workspace_id = v_ws and l.status = 'new' and l.first_response_at is null and (v_all or l.owner_id = v_me or l.owner_id is null)),
    'overdue_followups', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and o.next_action_due_at < now() and (v_all or o.owner_id = v_me)),
    'missing_next_action', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and (o.next_action is null or o.next_action_due_at is null) and (v_all or o.owner_id = v_me)),
    'open_opportunities', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and (v_all or o.owner_id = v_me)),
    'open_value', (select coalesce(sum(o.estimated_value), 0) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'open' and (v_all or o.owner_id = v_me)),
    'won_30d', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'won' and o.won_at > now() - interval '30 days' and (v_all or o.owner_id = v_me)),
    'lost_30d', (select count(*) from sales.opportunities o where o.workspace_id = v_ws and o.status = 'lost' and o.lost_at > now() - interval '30 days' and (v_all or o.owner_id = v_me)),
    'quotes_expiring', (select count(*) from sales.quote_versions qv join sales.quotes qt on qt.id = qv.quote_id where qv.workspace_id = v_ws and qt.status in ('issued','revised') and qv.version_no = qt.current_version_no and qv.valid_until between current_date and current_date + 7),
    'my_open_tasks', (select count(*) from sales.tasks t where t.workspace_id = v_ws and t.status = 'open' and t.assignee_id = v_me),
    'my_overdue_tasks', (select count(*) from sales.tasks t where t.workspace_id = v_ws and t.status = 'open' and t.assignee_id = v_me and t.due_at < now()),
    'lead_followups_due', (select count(distinct t.lead_id) from sales.tasks t where t.workspace_id = v_ws and t.status = 'open' and t.lead_id is not null and t.due_at < ((date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') + interval '1 day') at time zone 'Asia/Kuala_Lumpur') and (v_all or t.assignee_id = v_me)),
    'duplicate_candidates', (select count(*) from identity.identity_match_candidates m where m.workspace_id = v_ws and m.status = 'suggested'),
    'visits_today', (select count(*) from sales.visits v where v.workspace_id = v_ws and v.occurred_at >= date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'),
    'purchases_7d', (select count(*) from sales.purchases p where p.workspace_id = v_ws and p.purchased_at > now() - interval '7 days' and p.status in ('recorded','corrected') and p.financial_state='confirmed'),
    'purchase_amount_7d', (select coalesce(sum(p.amount), 0) from sales.purchases p where p.workspace_id = v_ws and p.purchased_at > now() - interval '7 days' and p.status in ('recorded','corrected') and p.financial_state='confirmed'),
    'products_without_price', (select count(*) from merch.products pr where pr.workspace_id = v_ws and pr.status = 'active' and not exists (select 1 from merch.product_variants v join merch.variant_prices vp on vp.variant_id = v.id and vp.state = 'current' where v.product_id = pr.id)),
    'price_conflicts', (select count(*) from merch.variant_prices vp where vp.workspace_id = v_ws and vp.state = 'conflicted'),
    'unreviewed_products', (select count(*) from merch.products pr where pr.workspace_id = v_ws and pr.review_state = 'unreviewed' and pr.status <> 'archived'),
    'open_data_issues', (select count(*) from ingest.data_quality_issues d where d.workspace_id = v_ws and d.status = 'open'),
    'pending_reviews', (select count(*) from ingest.review_items r where r.workspace_id = v_ws and r.status = 'pending'),
    'connectors_failed', (select count(*) from ingest.integration_connections ic where ic.workspace_id = v_ws and ic.status in ('failed','degraded')),
    'content_opps_pending', (select count(*) from marketing.content_opportunities co where co.workspace_id = v_ws and co.status in ('nominated','under_review','needs_info')),
    'shoots_next_7d', (select count(*) from marketing.shoot_bookings sb where sb.workspace_id = v_ws and sb.status in ('tentative','confirmed','customer_confirmation_pending') and sb.starts_at between now() and now() + interval '7 days'),
    'generated_at', now()
  ) into result;
  return result;
end $$;