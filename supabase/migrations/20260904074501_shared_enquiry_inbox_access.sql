-- Make the Enquiry Box a shared read surface for the sales team without
-- widening access to opportunities or permitting sales reps to edit leads
-- owned by somebody else.

insert into core.role_permissions (role_key, permission)
select granted.role_key, 'sales.leads.read_all'
from unnest(array['admin', 'management', 'sales_manager', 'sales_rep']::text[]) as granted(role_key)
on conflict (role_key, permission) do nothing;

drop policy if exists member_read on sales.leads;
create policy member_read on sales.leads
  for select
  to authenticated
  using (
    workspace_id in (select core.member_workspace_ids())
    and (select core.has_permission('sales.read'))
    and (
      (select core.has_permission('sales.read_all'))
      or (select core.has_permission('sales.leads.read_all'))
      or owner_id is null
      or owner_id = (select auth.uid())
    )
  );

-- The old SELECT policy also acted as part of the UPDATE boundary. Keep that
-- owner boundary explicit now that sales reps can read the shared inbox.
drop policy if exists member_update on sales.leads;
create policy member_update on sales.leads
  for update
  to authenticated
  using (
    workspace_id in (select core.member_workspace_ids())
    and (select core.has_permission('sales.write'))
    and (
      (select core.has_permission('sales.read_all'))
      or owner_id is null
      or owner_id = (select auth.uid())
    )
  )
  with check (
    workspace_id in (select core.member_workspace_ids())
    and (select core.has_permission('sales.write'))
    and (
      (select core.has_permission('sales.read_all'))
      or owner_id is null
      or owner_id = (select auth.uid())
    )
  );

comment on policy member_read on sales.leads is
  'Workspace members need sales.read. sales reps share lead visibility through sales.leads.read_all; sales.read_all retains manager/admin access.';

comment on policy member_update on sales.leads is
  'sales.write remains owner-scoped for sales reps even though the Enquiry Box is shared for reading.';
