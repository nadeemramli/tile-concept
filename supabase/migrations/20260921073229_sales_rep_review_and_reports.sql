-- Sales representatives gain reviews and reports.
--
-- Requested for the whole sales_rep role, not one person: permissions are held
-- by the role (core.role_permissions), never per user, so all six
-- representatives get this together.
--
-- Granted:
--   sales.read_all   every salesperson's records, not only your own
--   review.approve   approve or reject parsed import items
--   report.read      open reports
--
-- Deliberately withheld, so this is not an admin in all but name:
--   settings.manage  workspace settings and invites
--   audit.read_all   the whole audit trail (audit.read is already held)
--   export.customer  bulk customer export
--   price.publish    publishing a price
--   catalog.write / stock.write / identity.merge / sales.assign /
--   purchase.correct / marketing.confirm / marketing.spend.*
insert into core.role_permissions (role_key, permission)
values ('sales_rep', 'sales.read_all'),
       ('sales_rep', 'review.approve'),
       ('sales_rep', 'report.read')
on conflict (role_key, permission) do nothing;
