-- TILE-85: quotation history reads use the row's own workspace permission.
--
-- 20261029161000_canonical_quotations.sql created read policies on five new
-- tables (quote_references, quote_deliveries, quote_delivery_voids,
-- quote_events, visit_quote_evidence_decisions) as
--   workspace_id in member_workspace_ids() and has_permission('sales.read')
-- That pairs membership in ANY workspace with ONE permission check. Under
-- TILE-62 (20261029000002_workspace_permission_scope.sql, which orders before
-- the quotation migration) has_permission is the ACTING membership's
-- permission, so an admin of the acting workspace read another workspace's
-- quotation history through a membership there that has no sales.read; and a
-- sales reader of a non-acting workspace was refused its own rows. TILE-62
-- rewrote every policy that existed when it ran; these five came later.
--
-- The fix is TILE-62's per-row rule, applied to exactly these five policies:
--   workspace_id in (select core.permitted_workspace_ids('sales.read'))
-- Nothing else changes: same tables, same single SELECT policy each, no write
-- path, no grant, no new role privilege.

------------------------------------------------------------------------------
-- 1. The per-row helper
--
-- TILE-62 defines core.permitted_workspace_ids. On a stack that already has it
-- (the integrated order: TILE-62, then the quotation migration, then this) it
-- is left exactly as TILE-62 made it. On a stack without TILE-62 it is created
-- here with TILE-62's accepted body, so the policies below are correct on
-- either; TILE-62's later `create or replace` then replaces it with the same
-- definition.
------------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('core.permitted_workspace_ids(text)') is null then
    -- The body text is byte-identical to TILE-62's, so either migration may
    -- define it and pg_get_functiondef reads the same.
    execute $f$create function core.permitted_workspace_ids(perm text)
returns setof uuid
language sql stable security definer set search_path = '' as $b$
  select m.workspace_id from core.memberships m
  join core.role_permissions rp on rp.role_key = m.role_key
  where m.user_id = (select auth.uid()) and m.status = 'active' and rp.permission = perm
$b$$f$;
    revoke all on function core.permitted_workspace_ids(text) from public, anon;
    grant execute on function core.permitted_workspace_ids(text) to authenticated, service_role;
    comment on function core.permitted_workspace_ids(text) is
      'Workspaces in which the caller''s own active membership grants perm. Use as `workspace_id in (select core.permitted_workspace_ids(...))` in RLS and readers.';
  end if;
end $do$;

------------------------------------------------------------------------------
-- 2. The five read policies, per row
------------------------------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array['quote_references','quote_deliveries','quote_delivery_voids','quote_events','visit_quote_evidence_decisions']
  loop
    execute format($p$alter policy member_read on sales.%I
      using (workspace_id in (select core.permitted_workspace_ids('sales.read')))$p$, t);
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'sales'
      and tablename in ('quote_references','quote_deliveries','quote_delivery_voids','quote_events','visit_quote_evidence_decisions')
      and (coalesce(qual, '') || coalesce(with_check, '') like '%has_permission(%'
           or coalesce(qual, '') not like '%permitted_workspace_ids(''sales.read''::text)%')
  ) then
    raise exception 'TILE-85: a quotation history policy still authorizes rows outside the row''s workspace';
  end if;
end $do$;
