-- Walk-in Daily Tracker parity.
-- The showroom Daily Tracker sheet records, per visit, the renovation area the
-- customer is shopping for and (optionally) the quotation number + amount issued
-- that day. These are plain per-visit log fields — not the formal opportunity
-- quote subsystem (sales.quotes) — so they live on sales.visits and are set
-- through the api.visits view under the existing member_update RLS policy.

alter table sales.visits
  add column renovation_area text,
  add column quotation_ref   text,
  add column quotation_amount numeric(14,2) check (quotation_amount is null or quotation_amount >= 0);

comment on column sales.visits.renovation_area is 'Room/area the customer is renovating (Daily Tracker "Area Renovation"): free text e.g. Wet Kitchen, Master Bath.';
comment on column sales.visits.quotation_ref is 'Quotation/SQ number noted for this visit (Daily Tracker "SQ Number"). Operational note, distinct from sales.quotes.';
comment on column sales.visits.quotation_amount is 'Quotation amount noted for this visit (Daily Tracker "Quotation Amount (RM)").';

-- api.visits was created as `select *` in ...0006 and froze its column list
-- there; recreate it so the three new columns are exposed. create-or-replace
-- appends the new trailing columns without disturbing the existing ones.
create or replace view api.visits with (security_invoker = true) as select * from sales.visits;
grant select, insert, update, delete on api.visits to authenticated;
grant all on api.visits to service_role;
