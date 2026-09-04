------------------------------------------------------------------------------
-- Lead follow-ups: surface open lead-linked tasks in the command centre and
-- give the inbox a saved view for them. Follow-ups are sales.tasks rows with
-- lead_id + due_at — no new tables.
------------------------------------------------------------------------------

-- Recreate command_centre_summary with a lead_followups_due counter: distinct
-- leads with an open task due before the end of today (Asia/Kuala_Lumpur),
-- scoped to the caller unless sales.read_all.
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
    'purchases_7d', (select count(*) from sales.purchases p where p.workspace_id = v_ws and p.purchased_at > now() - interval '7 days' and p.status <> 'voided'),
    'purchase_amount_7d', (select coalesce(sum(p.amount), 0) from sales.purchases p where p.workspace_id = v_ws and p.purchased_at > now() - interval '7 days' and p.status <> 'voided'),
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
grant execute on function api.command_centre_summary() to authenticated;

-- The old "Follow-up due" inbox view is really the first-response SLA; rename
-- it to match its metric card so the name is free for the task-based view.
update core.saved_views set name = 'SLA overdue'
where surface = 'inbox' and name = 'Follow-up due' and user_id is null;

-- Task-based follow-up view for every existing workspace (idempotent; seed.sql
-- carries the same row for fresh databases).
insert into core.saved_views (workspace_id, user_id, surface, name, filters, position, is_default)
select w.id, null, 'inbox', 'Follow-ups due', '{"task_follow_up":"due"}'::jsonb, 10, false
from core.workspaces w
where not exists (
  select 1 from core.saved_views v
  where v.workspace_id = w.id and v.surface = 'inbox' and v.name = 'Follow-ups due'
);
