-- After "Done WhatsApp" a lead left the New view and nothing said where it
-- went: Contact attempted is not New, not (yet) a follow-up, and not "mine"
-- unless somebody had assigned it. Two views give the next states a home,
-- and answering an unowned lead claims it for the responder so it also lands
-- in "My leads" (PRD §7.2: whoever responds is on the clock).

create or replace function api.log_lead_response(p_lead_id uuid, p_kind text, p_channel text, p_body text default null, p_reached boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l sales.leads%rowtype;
  v_id uuid;
begin
  perform core.require_permission('sales.write');
  select * into l from sales.leads where id = p_lead_id;
  if not found then raise exception 'lead not found'; end if;
  perform core.require_workspace(l.workspace_id);
  perform sales.require_lead_owner(l);
  insert into sales.activities (workspace_id, kind, channel, subject, body, actor_id, lead_id, contact_id, metadata)
  values (l.workspace_id, coalesce(p_kind, 'call'), p_channel, case when p_reached then 'Contacted' else 'Contact attempted' end, p_body, auth.uid(), p_lead_id, l.contact_id, jsonb_build_object('reached', p_reached))
  returning id into v_id;
  update sales.leads set
    first_response_at = coalesce(first_response_at, now()),
    contact_attempts = contact_attempts + 1,
    status = case when status in ('new','contact_attempted') then (case when p_reached then 'contacted' else 'contact_attempted' end) else status end
  where id = p_lead_id;
  -- The first person to respond to an unowned lead owns it from then on.
  if l.owner_id is null then
    update sales.leads set owner_id = auth.uid(), assigned_at = coalesce(assigned_at, now()) where id = p_lead_id;
    perform audit.emit(l.workspace_id, 'lead.claimed', 'sales', 'leads', p_lead_id,
      jsonb_build_object('owner_id', null), jsonb_build_object('owner_id', auth.uid()), 'Claimed by first response', '{}'::jsonb);
  end if;
  return v_id;
end $$;

-- Saved views for the two states a lead moves into after a response. Existing
-- workspaces get them right after "New"; seed.sql carries the same rows for a
-- fresh database. Idempotent: skipped when the view already exists.
do $$
begin
  if not exists (select 1 from core.saved_views where surface = 'inbox' and user_id is null and name = 'Waiting for reply') then
    update core.saved_views set position = position + 2
    where surface = 'inbox' and user_id is null and position >= 2;
    insert into core.saved_views (workspace_id, user_id, surface, name, filters, position, is_default)
    select w.id, null, 'inbox', 'Waiting for reply', '{"status":["contact_attempted"]}'::jsonb, 2, false from core.workspaces w;
    insert into core.saved_views (workspace_id, user_id, surface, name, filters, position, is_default)
    select w.id, null, 'inbox', 'Contacted', '{"status":["contacted"]}'::jsonb, 3, false from core.workspaces w;
  end if;
end $$;
