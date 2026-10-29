-- TILE-87: classification history is read with the caller's own active
-- sales.read in the history row's workspace.
--
-- 20261029160000 created sales.classification_events.member_read as
--   membership in the row's workspace AND core.has_permission('sales.read')
--   AND a linked lead or opportunity the caller can see.
-- TILE-62 (20261029000002) runs earlier, narrows core.has_permission to the
-- ACTING membership and rewrites every policy that existed then; this one was
-- created afterwards and kept the global check. A legitimate reader in B whose
-- acting membership (A) lacks sales.read could therefore see B's lead or
-- opportunity but not its correction history; before TILE-62 the same check
-- was the union over every membership, so sales.read in A opened B's history
-- wherever B's parent was visible.
--
-- The middle conjunct becomes TILE-62's per-row rule, exactly as its policy
-- rewrite would have produced it:
--   workspace_id in (select core.permitted_workspace_ids('sales.read'))
-- Nothing else changes: the membership filter and both parent guards (lead OR
-- opportunity, each under its own RLS, so owner and shared-inquiry
-- restrictions still decide) stay as they are. History stays append-only and
-- is still written only by the classification commands.
--
-- core.permitted_workspace_ids is TILE-62's helper; 20261029160003 provides the
-- identical definition when TILE-62 is absent. The policy expression below
-- fails to parse if neither is present.
alter policy member_read on sales.classification_events using (
  workspace_id in (select core.member_workspace_ids())
  and workspace_id in (select core.permitted_workspace_ids('sales.read'))
  and ((lead_id is not null and lead_id in (select l.id from sales.leads l))
    or (opportunity_id is not null and opportunity_id in (select o.id from sales.opportunities o))));
