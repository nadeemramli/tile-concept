-- TILE-88: pursuit outcome history and its report are read per row workspace.
--
-- 20261029163000_pursuit_outcomes.sql landed after TILE-62
-- (20261029000002_workspace_permission_scope.sql), whose policy narrowing only
-- reached policies that already existed. Two reads therefore still judged
-- every row by the ACTING membership:
--
--   history  sales.pursuit_outcome_events.member_read (raw, and the derived
--            api.pursuit_outcome_history built on it) required
--            core.has_permission('sales.read') of the acting workspace, so a
--            reader of workspace B lost B's history whenever the acting
--            membership A lacked sales.read.
--   report   api.report_pursuit_outcomes checked report.read once, for the
--            acting membership, then aggregated every visible history row, so
--            a report reader in A could aggregate B where B grants sales.read
--            but not report.read; a report reader in B alone was refused.
--
-- The repair applies TILE-62's per-row rule and nothing else:
--   history  the acting-membership test becomes the row's own workspace in
--            core.permitted_workspace_ids('sales.read'); membership and the
--            linked inquiry-or-opportunity guard (each under its own RLS:
--            owner scope, shared inquiry access) are unchanged.
--   report   each aggregated row also needs report.read in its own workspace.
--            The view keeps the history/parent RLS (security invoker). Refusal
--            stays the same message and code as core.require_permission, now
--            raised only when no membership grants report.read anywhere.
--
-- Unchanged: the outcome command and every write path (they still act in the
-- acting workspace only), the append-only events and their triggers, reasons,
-- corrections/reopen, effective weeks, counts, values and output shapes.
-- No new role, grant or permission.

------------------------------------------------------------------------------
-- 1. TILE-62's per-row helper, only where TILE-62 has not created it
--
-- Byte-identical to core.permitted_workspace_ids in
-- 20261029000002_workspace_permission_scope.sql (same body, STABLE, SECURITY
-- DEFINER, empty search_path, grants and comment). Never replaces an existing
-- definition: with TILE-62 applied first this block does nothing.
------------------------------------------------------------------------------
do $guard$
begin
  if to_regprocedure('core.permitted_workspace_ids(text)') is null then
    execute $fn$
create function core.permitted_workspace_ids(perm text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from core.memberships m
  join core.role_permissions rp on rp.role_key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active' and rp.permission = perm
$$
$fn$;
    revoke all on function core.permitted_workspace_ids(text) from public, anon;
    grant execute on function core.permitted_workspace_ids(text) to authenticated, service_role;
    comment on function core.permitted_workspace_ids(text) is
      'Workspaces in which the caller''s own active membership grants perm. Use as `workspace_id in (select core.permitted_workspace_ids(...))` in RLS and readers.';
  end if;
end $guard$;

------------------------------------------------------------------------------
-- 2. Raw and derived history: sales.read of the row's own workspace
--
-- The same substitution TILE-62 made on every other workspace table. The
-- inquiry-or-opportunity guard is kept exactly, so an outcome is still only
-- readable where its inquiry or opportunity is.
------------------------------------------------------------------------------
alter policy member_read on sales.pursuit_outcome_events using (
  workspace_id in (select core.member_workspace_ids())
  and (pursuit_outcome_events.workspace_id in (select core.permitted_workspace_ids('sales.read')))
  and (lead_id in (select l.id from sales.leads l) or opportunity_id in (select o.id from sales.opportunities o)));

------------------------------------------------------------------------------
-- 3. Report: report.read of each aggregated row's own workspace
------------------------------------------------------------------------------
create or replace function api.report_pursuit_outcomes(p_from date default null, p_to date default null)
returns table (week_start date, outcome_type text, reason_code text, reason_label text, events bigint, pursuits bigint,
  reopened_later bigint, lost_quoted_value numeric, lost_estimated_unquoted_value numeric, value_unknown bigint, value_not_myr bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  -- Same refusals as core.require_permission('report.read'), judged across the
  -- caller's own memberships instead of the acting one.
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from core.permitted_workspace_ids('report.read')) then
    raise exception 'permission denied: %', 'report.read' using errcode = '42501';
  end if;
  return query
  select h.effective_week, h.outcome_type, h.reason_code, r.label,
    count(*), count(distinct h.pursuit_key),
    count(*) filter (where h.reopened_at is not null),
    coalesce(sum(h.quoted_value) filter (where h.outcome_type = 'lost' and h.quoted_currency = 'MYR'), 0),
    coalesce(sum(h.estimated_value) filter (where h.outcome_type = 'lost' and h.quoted_value is null and h.estimated_currency = 'MYR'), 0),
    count(*) filter (where h.outcome_type = 'lost' and h.quoted_value is null and h.estimated_value is null),
    count(*) filter (where h.outcome_type = 'lost' and (h.quoted_currency <> 'MYR' or (h.quoted_value is null and h.estimated_currency <> 'MYR')))
  from api.pursuit_outcome_history h
  join core.outcome_reasons r on r.outcome_type = h.outcome_type and r.key = h.reason_code
  where h.workspace_id in (select core.permitted_workspace_ids('report.read'))
    and (p_from is null or h.effective_date >= p_from) and (p_to is null or h.effective_date <= p_to)
  group by h.effective_week, h.outcome_type, h.reason_code, r.label, r.position
  order by h.effective_week, h.outcome_type, r.position;
end $$;
revoke all on function api.report_pursuit_outcomes(date,date) from public, anon;
grant execute on function api.report_pursuit_outcomes(date,date) to authenticated, service_role;

comment on policy member_read on sales.pursuit_outcome_events is
  'Own active membership with sales.read in the row''s workspace (TILE-62 per-row rule), and the linked inquiry or opportunity visible under its own RLS.';
