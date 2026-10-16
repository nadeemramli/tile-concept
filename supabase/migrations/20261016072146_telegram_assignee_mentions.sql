-- Mention only the current assignee verified in this workspace with active sales access.
create or replace function sales.telegram_card_data(p_lead uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lead_id',l.id,'token',c.token,'chat_id',c.chat_id::text,'message_id',c.message_id,
   'phone',l.raw_phone,'name',coalesce(nullif(l.raw_name,''),'New prospect'),'assignee',coalesce(case when a.owner_id=l.owner_id then a.slot_name end,p.full_name,'Unassigned'),
   'assignee_telegram_id',tm.telegram_user_id::text,
   'status',l.status,'routing_reason',a.reason,'customer_type',a.customer_type,
   'whatsapp_sent_at',l.first_whatsapp_sent_at,'customer_reply_at',l.first_customer_reply_at,'no_response_at',l.last_no_response_at,'last_customer_reply_at',l.last_customer_reply_at,'last_contact_attempt_at',l.last_contact_attempt_at,
   'follow_up_at',c.leased_follow_up_at,
   'email',l.raw_email,'company',l.raw_company,'interest',l.interest,'product_interest',l.product_interest,
   'enquiry_message',e.payload->>'message','project_stage',e.payload->>'project_stage','area',e.payload->>'area',
   'source',coalesce(e.payload->>'source',e.provider,l.source_channel),'received_at',coalesce(e.occurred_at,l.created_at))
 from sales.telegram_lead_cards c join sales.leads l on l.id=c.lead_id
 left join core.profiles p on p.user_id=l.owner_id left join sales.lead_routing_assignments a on a.lead_id=l.id
 left join sales.telegram_members tm on tm.workspace_id=l.workspace_id and tm.user_id=l.owner_id
   and tm.telegram_user_id>0 and sales.member_can(l.workspace_id,l.owner_id,'sales.write')
 left join lateral (
   select i.payload,i.provider,i.occurred_at from sales.intake_events i
   where i.workspace_id=l.workspace_id and i.lead_id=l.id and i.status='processed'
   order by i.occurred_at desc nulls last,i.received_at desc,i.id limit 1
 ) e on true
 where l.id=p_lead
$$;
revoke all on function sales.telegram_card_data(uuid) from public,anon,authenticated;

-- Link changes refresh existing messages and invalidate their previous buttons, without
-- changing customer progress or advancing routing cursors.
create function sales.refresh_telegram_member_cards() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.workspace_id=old.workspace_id and new.user_id=old.user_id
    and new.telegram_user_id=old.telegram_user_id then return null; end if;
  if tg_op in ('UPDATE','DELETE') then
    update sales.telegram_lead_cards c set needs_sync=true,token=gen_random_uuid(),lease_until=null
      from sales.leads l where l.id=c.lead_id and l.workspace_id=old.workspace_id and l.owner_id=old.user_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update sales.telegram_lead_cards c set needs_sync=true,token=gen_random_uuid(),lease_until=null
      from sales.leads l where l.id=c.lead_id and l.workspace_id=new.workspace_id and l.owner_id=new.user_id;
  end if;
  return null;
end $$;
revoke all on function sales.refresh_telegram_member_cards() from public,anon,authenticated;
create trigger telegram_member_cards_changed after insert or update or delete on sales.telegram_members
for each row execute function sales.refresh_telegram_member_cards();
