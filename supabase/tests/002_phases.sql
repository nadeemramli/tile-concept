-- pgTAP: the rules Phases 2-6 exist to enforce.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create or replace function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
set local role authenticated;

-- Marketing ------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');  -- sales rep
-- PRD §4.2: sales may nominate a project; only marketing confirms capacity.
select lives_ok(
  $$select api.nominate_content_opportunity((select id from api.projects limit 1), array['before_after'], 'Angle', 'Reason')$$,
  'a sales rep may nominate a customer project');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000007');  -- marketing coordinator
select lives_ok(
  $$select api.nominate_content_opportunity((select id from identity.projects order by created_at desc limit 1), array['testimonial'], 'Angle', 'Reason')$$,
  'marketing can nominate an existing project');
select throws_like(
  $$select api.nominate_content_opportunity((select id from identity.projects limit 1), '{}')$$,
  '%at least one content type%', 'a nomination needs a content type');

-- declining needs a reason
select throws_like(
  $$select api.set_content_opportunity_status((select id from marketing.content_opportunities limit 1), 'declined', null)$$,
  '%reason required%', 'declining a nomination requires a reason');

-- approving permission needs who granted it and at least one use
select throws_like(
  $$select api.record_media_permission((select id from marketing.content_opportunities limit 1), 'approved', null, '{}', '{}')$$,
  '%who granted%', 'approved permission must record who granted it');

-- an asset cannot be marked usable without an approved permission
select lives_ok($$select api.record_media_permission(
    (select content_opportunity_id from api.shoot_outputs limit 1), 'requested')$$,
  'permission can be moved back to requested');
select throws_like(
  $$select api.review_shoot_output((select id from api.shoot_outputs limit 1), 'usable')$$,
  '%permission%', 'usable requires an approved customer media permission');

-- confirming crew capacity needs marketing.confirm
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_like(
  $$select api.upsert_shoot_booking((select id from marketing.content_opportunities limit 1), now() + interval '1 day', now() + interval '1 day 2 hours', 'confirmed')$$,
  '%permission denied%', 'a sales rep cannot confirm a booking');

-- Sources --------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000006');  -- catalog operator
select is(
  (select (api.register_source_asset('Demo mosaic price list 2026.pdf', 'pdf', 'seedchecksum-mosaic-2026'))->>'reused'),
  'true', 're-importing identical content is idempotent');
select isnt(
  (select (api.register_source_asset('Demo mosaic price list 2026.pdf', 'pdf', 'a-different-checksum'))->>'version'),
  '1', 'changed content on the same document creates a new version');
select throws_like(
  $$select api.reject_review_item((select id from api.review_items where status = 'pending' limit 1), '')$$,
  '%reason required%', 'rejecting an extraction requires a reason');

-- Stock ----------------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select throws_like(
  $$select api.record_supplier_availability((select id from merch.suppliers limit 1), 'available', (select id from merch.product_variants limit 1))$$,
  '%permission denied%', 'a sales rep cannot publish supplier stock');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');  -- admin has stock.write
select throws_like(
  $$select api.record_supplier_availability((select id from merch.suppliers limit 1), 'plenty', (select id from merch.product_variants limit 1))$$,
  '%availability must be%', 'availability states are constrained, so "out" never becomes 0');

-- Intake ---------------------------------------------------------------------
select is(
  (select (api.accept_intake('11111111-1111-1111-1111-111111111111', 'website', 'website', 'ext-dup-1', 'seed-1',
           '{}'::jsonb, '{"name":"Retry"}'::jsonb))->>'duplicate'),
  'true', 'a provider retry with a used idempotency key creates no second lead');

select * from finish();
rollback;
