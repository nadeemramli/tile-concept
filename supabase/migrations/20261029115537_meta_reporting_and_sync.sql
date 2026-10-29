-- Same inquiry cohort, explicit invoice links, and recorded customer taxonomy.
create or replace function api.marketing_journey(p_from date,p_to date,p_as_of date,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid:=core.current_workspace_id(); cutoff timestamptz; result jsonb;
begin
 if auth.uid() is null or ws is null or not core.has_permission('report.read') then raise exception 'Permission denied: report.read' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_as_of is null or p_from>p_to or p_to-p_from>366 or p_as_of<p_to or p_as_of>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Invalid reporting period' using errcode='23514'; end if;
 if p_location is not null and not exists(select 1 from core.business_locations where id=p_location and workspace_id=ws) then raise exception 'Location not found' using errcode='42501'; end if;
 cutoff:=(p_as_of+1)::timestamp at time zone 'Asia/Kuala_Lumpur';
 with cohort as (
 select l.id,l.created_at,reporting.channel_group(l.source_channel) platform,
 coalesce(nullif(c.customer_type,''),nullif(r.customer_type,''),'unknown') customer_type,
 least(l.first_response_at,l.first_whatsapp_sent_at)<cutoff contacted,
 l.first_customer_reply_at<cutoff replied
 from sales.leads l left join identity.contacts c on c.id=l.contact_id and c.workspace_id=ws
 left join sales.lead_routing_assignments r on r.lead_id=l.id and r.workspace_id=ws
 where l.workspace_id=ws and l.status<>'duplicate' and l.created_at>=p_from::timestamp at time zone 'Asia/Kuala_Lumpur'
 and l.created_at<(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur' and (p_location is null or l.location_id=p_location)
 ), invoices as (
 select p.id,p.lead_id,sum(e.net_delta) amount from sales.purchases p join cohort l on l.id=p.lead_id
 join sales.sale_events e on e.purchase_id=p.id and e.workspace_id=ws and e.occurred_at<cutoff
 where p.workspace_id=ws and p.currency='MYR' and p.document_type='invoice' and p.financial_state='confirmed'
 and p.purchased_at>=l.created_at and p.purchased_at<cutoff group by p.id,p.lead_id having sum(e.net_delta)>0
 ), outcomes as (
 select l.*,coalesce(i.invoices,0) invoices,coalesce(i.amount,0) invoice_value from cohort l left join
 (select lead_id,count(*) invoices,sum(amount) amount from invoices group by lead_id) i on i.lead_id=l.id
 ), groups as (
 select platform,customer_type,count(*) leads,count(*) filter(where contacted) contacted,count(*) filter(where replied) replied,
 count(*) filter(where invoices>0) converted_leads,count(*) filter(where replied and invoices>0) replied_converted,
 count(*) filter(where contacted and replied) contacted_replied,sum(invoices) invoices,sum(invoice_value) invoice_value
 from outcomes group by platform,customer_type
 ), days as (
 select d::date as day,coalesce((select sum((e.before_tax+coalesce(e.tax,0))*case when e.credit_of is null then 1 else -1 end)
 from marketing.spend_entries e where e.workspace_id=ws and e.status='recorded' and e.incurred_on=d::date),0) spend,
 (select count(*) from cohort l where (l.created_at at time zone 'Asia/Kuala_Lumpur')::date=d::date) leads
 from generate_series(p_from::timestamp,p_to::timestamp,'1 day') d
 )
 select jsonb_build_object('groups',coalesce((select jsonb_agg(to_jsonb(g) order by leads desc) from groups g),'[]'::jsonb),
 'days',(select jsonb_agg(to_jsonb(d) order by day) from days d),
 'gaps',jsonb_build_object(
 'unlinked_invoices',(select count(*) from sales.purchases p where p.workspace_id=ws and p.document_type='invoice' and p.financial_state='confirmed' and p.lead_id is null and p.purchased_at>=p_from::timestamp at time zone 'Asia/Kuala_Lumpur' and p.purchased_at<cutoff and (p_location is null or p.location_id=p_location)),
 'external_invoice_links',(select count(*) from sales.external_document_links x where x.workspace_id=ws and x.document_type='invoice'),
 'unclassified_documents',(select count(*) from sales.purchases p where p.workspace_id=ws and p.financial_state='legacy_unclassified' and p.purchased_at<cutoff and (p_location is null or p.location_id=p_location)))) into result;
 return result;
end $$;
revoke all on function api.marketing_journey(date,date,date,uuid) from public,anon;
grant execute on function api.marketing_journey(date,date,date,uuid) to authenticated;
