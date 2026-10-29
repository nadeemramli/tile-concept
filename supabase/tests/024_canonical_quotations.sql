-- TILE-5: canonical quotation identity, version history and sending.
-- Synthetic fixtures only; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.q(action text, input jsonb, req text) returns jsonb language sql as $$
  select api.quote_command(action, input, req::uuid)
$$;
-- Monday 00:00 of the current week in Asia/Kuala_Lumpur.
create function pg_temp.wk() returns timestamptz language sql stable as $$
  select date_trunc('week', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
$$;
create function pg_temp.at(t timestamptz) returns text language sql stable as $$ select to_jsonb(t) #>> '{}' $$;
create temp table kv(k text primary key, v jsonb);
grant all on kv to authenticated;
create function pg_temp.keep(k text, v jsonb) returns jsonb language sql as $$
  insert into kv values (k, v) on conflict (k) do update set v = excluded.v returning v
$$;
create function pg_temp.id(k text, f text default 'quote_id') returns uuid language sql stable as $$ select (v->>f)::uuid from kv where kv.k = id.k $$;

-- Fixtures (synthetic)
insert into core.workspaces(id, slug, name) values ('99999999-5000-0000-0000-000000000001', 'quote-isolation', 'Synthetic quote isolation workspace');
insert into identity.contacts(id, workspace_id, display_name) values
  ('eeeeeeee-5000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Synthetic quote customer'),
  ('eeeeeeee-5000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Synthetic other customer');
insert into sales.leads(id, workspace_id, source_channel, raw_name, owner_id, contact_id) values
  ('eeeeeeee-5000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'tiktok', 'Synthetic digital inquiry', 'aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-5000-0000-0000-0000000000c1'),
  ('eeeeeeee-5000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'tiktok', 'Synthetic teammate inquiry', 'aaaaaaaa-0000-0000-0000-000000000004', null),
  ('eeeeeeee-5000-0000-0000-0000000000a9', '99999999-5000-0000-0000-000000000001', 'other', 'Synthetic foreign inquiry', null, null);
insert into sales.opportunities(id, workspace_id, name, contact_id, owner_id, stage_key, next_action, next_action_due_at) values
  ('eeeeeeee-5000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'Synthetic own pursuit', 'eeeeeeee-5000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000003', 'new_inquiry', 'Call', now() + interval '1 day'),
  ('eeeeeeee-5000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'Synthetic teammate pursuit', 'eeeeeeee-5000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000004', 'new_inquiry', 'Call', now() + interval '1 day');
insert into sales.visits(id, workspace_id, purpose, lead_id, contact_id, quotation_ref, quotation_amount, occurred_at) values
  ('eeeeeeee-5000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 'consultation', 'eeeeeeee-5000-0000-0000-0000000000a1', 'eeeeeeee-5000-0000-0000-0000000000c1', 'SQ-T5-9001', 1000, now() - interval '20 days'),
  ('eeeeeeee-5000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111', 'browse', null, null, 'sq t5 9001', null, now() - interval '19 days'),
  ('eeeeeeee-5000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111', 'consultation', null, null, 'SQ-T5-9555', 800, now() - interval '40 days'),
  ('eeeeeeee-5000-0000-0000-0000000000d9', '99999999-5000-0000-0000-000000000001', 'browse', null, null, 'SQ-T5-9001', null, now() - interval '3 days');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
create temp table baseline as select (select count(*) from api.opportunities) as opportunities, (select count(*) from api.purchases) as purchases;

------------------------------------------------------------------ digital entrypoint
select lives_ok($$select pg_temp.keep('q1', pg_temp.q('prepare', jsonb_build_object(
  'lead_id','eeeeeeee-5000-0000-0000-0000000000a1','origin','inbox','quote_number','QT-T5-0001','external_ref','SQ-T5-9001',
  'currency','MYR','total_amount',1000,'prepared_at',pg_temp.at(pg_temp.wk() - interval '7 days' + interval '9 hours')),
  'ffffffff-5000-0000-0000-000000000001'))$$, 'staff prepare a quote from the inbox inquiry');
select is((select lifecycle from api.quote_register where quote_id = pg_temp.id('q1')), 'prepared', 'a prepared quote is neither issued nor sent');
select is((select status from api.quotes where id = pg_temp.id('q1')), 'draft', 'prepared quote status is draft');
select is((select contact_id from api.quotes where id = pg_temp.id('q1')), 'eeeeeeee-5000-0000-0000-0000000000c1'::uuid, 'identity comes from the inquiry, not re-entered');
select is((select opportunity_id from api.quotes where id = pg_temp.id('q1')), null, 'digital quote preparation creates no opportunity');
select is((select count(*) from api.opportunities), (select opportunities from baseline), 'opportunity count unchanged');
select is(pg_temp.q('prepare', jsonb_build_object(
  'lead_id','eeeeeeee-5000-0000-0000-0000000000a1','origin','inbox','quote_number','QT-T5-0001','external_ref','SQ-T5-9001',
  'currency','MYR','total_amount',1000,'prepared_at',pg_temp.at(pg_temp.wk() - interval '7 days' + interval '9 hours')),
  'ffffffff-5000-0000-0000-000000000001')->>'quote_id', pg_temp.id('q1')::text, 'repeated save replays the original result');
select is((select count(*) from api.quotes where lead_id = 'eeeeeeee-5000-0000-0000-0000000000a1'), 1::bigint, 'repeated save creates no second quote');
select throws_ok($$select pg_temp.q('prepare', '{"lead_id":"eeeeeeee-5000-0000-0000-0000000000a1","origin":"inbox","currency":"EUR"}', 'ffffffff-5000-0000-0000-000000000001')$$,
  '23514', 'Retry differs from original command', 'a request id cannot be reused for a different command');
select throws_ok($$select pg_temp.q('prepare', '{"lead_id":"eeeeeeee-5000-0000-0000-0000000000a1","origin":"inbox"}', 'ffffffff-5000-0000-0000-000000000002')$$,
  '23514', 'State the quote currency (three letters, for example MYR)', 'currency is never defaulted');
select throws_ok($$select pg_temp.q('prepare', '{"lead_id":"eeeeeeee-5000-0000-0000-0000000000a1","origin":"inbox","currency":"MYR","external_ref":"sq t5-9001"}', 'ffffffff-5000-0000-0000-000000000003')$$,
  '23505', null, 'the same SQ reference cannot become a second quote');
select throws_ok($$select pg_temp.q('prepare', '{"origin":"inbox","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000004')$$,
  '23514', 'Choose the inquiry, visit or opportunity this quote belongs to', 'a quote needs an anchor');

------------------------------------------------------------------ visit evidence resolves to the canonical quote
select is((select resolution from api.visit_quote_evidence where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d1'), 'matched', 'visit SQ note resolves to the canonical quote');
select is((select quote_id from api.visit_quote_evidence where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d2'), pg_temp.id('q1'), 'differently written duplicate SQ reference resolves to the same quote');
select is((select resolution from api.visit_quote_evidence where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d3'), 'unreviewed', 'unknown historical SQ note stays in explicit unreviewed state');
select is((select count(*) from api.visit_quote_evidence where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d9'), 0::bigint, 'foreign workspace evidence is hidden');
select is((select count(*) from api.quote_send_facts where quote_id = pg_temp.id('q1')), 0::bigint, 'evidence and preparation are never counted as sent');

------------------------------------------------------------------ issue / revise / send distinctions
select throws_ok(format($$select pg_temp.q('send', jsonb_build_object('version_id','%s','sent_at',now(),'channel','whatsapp','evidence','staff_attested'), 'ffffffff-5000-0000-0000-000000000010')$$, pg_temp.id('q1','version_id')),
  '23514', 'Issue version 1 before recording that it was sent', 'a prepared version cannot be marked sent without issuing');
select lives_ok($$select pg_temp.keep('q1v2', pg_temp.q('revise', jsonb_build_object('quote_id',pg_temp.id('q1'),'base_version_no',1,'currency','MYR','total_amount',950,
  'external_ref','SQ-T5-9001','prepared_at',pg_temp.at(pg_temp.wk() - interval '5 days'),
  'issue',jsonb_build_object('issued_at',pg_temp.at(pg_temp.wk() - interval '3 days'))), 'ffffffff-5000-0000-0000-000000000011'))$$,
  'revision v2 is prepared and issued last week');
select throws_ok($$select pg_temp.q('revise', jsonb_build_object('quote_id',pg_temp.id('q1'),'base_version_no',1,'currency','MYR'), 'ffffffff-5000-0000-0000-000000000012')$$,
  '40001', null, 'a concurrent revision from a stale version is refused');
select is((select count(*) from api.quote_versions where quote_id = pg_temp.id('q1')), 2::bigint, 'no duplicate version from the refused revision');
select is((select issued_at from api.quote_versions where id = pg_temp.id('q1','version_id')), null, 'v1 stays prepared and unissued');
select throws_ok(format($$update api.quote_versions set total_amount = 1 where id = '%s'$$, pg_temp.id('q1','version_id')), '42501', null, 'staff cannot edit a version directly');
reset role;
select throws_ok(format($$update sales.quote_versions set total_amount = 1 where id = '%s'$$, pg_temp.id('q1','version_id')), '0A000', null, 'earlier versions are immutable even to the owner role');
select throws_ok(format($$update sales.quote_versions set notes = 'x' where id = '%s'$$, pg_temp.id('q1v2','version_id')), '0A000', null, 'issued versions are immutable');
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');

select lives_ok($$select pg_temp.keep('s1', pg_temp.q('send', jsonb_build_object('version_id',pg_temp.id('q1v2','version_id'),'sent_at',pg_temp.at(pg_temp.wk() + interval '1 minute'),
  'channel','whatsapp','evidence','staff_attested'), 'ffffffff-5000-0000-0000-000000000013'))$$, 'v2 issued last week is sent this week');
select is((select send_kind from api.quote_send_facts where delivery_id = pg_temp.id('s1','delivery_id')), 'first_quote', 'prepared as v1, first sent as v2: one first quotation');
select is((select first_sent_version_no from api.quote_register where quote_id = pg_temp.id('q1')), 2, 'register keeps the actual first sent version');
select is((select sent_week_start from api.quote_send_facts where delivery_id = pg_temp.id('s1','delivery_id')), (now() at time zone 'Asia/Kuala_Lumpur')::date - (extract(isodow from now() at time zone 'Asia/Kuala_Lumpur')::int - 1), 'sent week is the local Monday of the send, not the issue week');
select ok((select date_trunc('week', current_issued_at at time zone 'Asia/Kuala_Lumpur') < date_trunc('week', first_sent_at at time zone 'Asia/Kuala_Lumpur') from api.quote_register where quote_id = pg_temp.id('q1')), 'issue and send weeks stay distinct');
select is(pg_temp.q('send', jsonb_build_object('version_id',pg_temp.id('q1v2','version_id'),'sent_at',pg_temp.at(pg_temp.wk() + interval '1 minute'),
  'channel','whatsapp','evidence','staff_attested'), 'ffffffff-5000-0000-0000-000000000014')->>'duplicate', 'true', 'a second mark-sent of the same send is recognised as a duplicate');
select is((select count(*) from api.quote_deliveries where quote_id = pg_temp.id('q1')), 1::bigint, 'repeated mark-sent creates no duplicate delivery');
select lives_ok($$select pg_temp.keep('s2', pg_temp.q('send', jsonb_build_object('version_id',pg_temp.id('q1v2','version_id'),'sent_at',pg_temp.at(pg_temp.wk() + interval '2 minutes'),
  'channel','email','evidence','message_reference','evidence_ref','synthetic-msg-1'), 'ffffffff-5000-0000-0000-000000000015'))$$, 'v2 resent by email');
select is((select send_kind from api.quote_send_facts where delivery_id = pg_temp.id('s2','delivery_id')), 'resend', 'resending a version is a resend, not a new quotation');
select lives_ok($$select pg_temp.keep('q1v3', pg_temp.q('revise', jsonb_build_object('quote_id',pg_temp.id('q1'),'base_version_no',2,'currency','MYR','total_amount',900,
  'prepared_at',pg_temp.at(pg_temp.wk() + interval '2 minutes'),
  'send',jsonb_build_object('sent_at',pg_temp.at(pg_temp.wk() + interval '3 minutes'),'channel','whatsapp','evidence','staff_attested','issue_if_prepared',true)), 'ffffffff-5000-0000-0000-000000000016'))$$,
  'v3 is prepared, issued and sent in one command');
select is((select send_kind from api.quote_send_facts where quote_version_id = pg_temp.id('q1v3','version_id')), 'revision', 'later v3 send counts only as a revision');
select is((select issued_at from api.quote_versions where id = pg_temp.id('q1v3','version_id')), (pg_temp.wk() + interval '3 minutes'), 'issue_if_prepared issues at the send time');
select throws_ok($$select pg_temp.q('send', jsonb_build_object('version_id',pg_temp.id('q1v3','version_id'),'sent_at',pg_temp.at(now() + interval '1 day'),'channel','email','evidence','staff_attested'), 'ffffffff-5000-0000-0000-000000000017')$$,
  '23514', 'Send time cannot be in the future', 'future sends are refused');
select throws_ok($$select pg_temp.q('send', jsonb_build_object('version_id',pg_temp.id('q1v3','version_id'),'sent_at',pg_temp.at(pg_temp.wk() - interval '30 days'),'channel','email','evidence','staff_attested'), 'ffffffff-5000-0000-0000-000000000018')$$,
  '23514', 'A version cannot be sent before it was issued', 'a send before issue is refused');

------------------------------------------------------------------ visit entrypoint
select lives_ok($$select pg_temp.keep('q2', pg_temp.q('prepare', jsonb_build_object('visit_id','eeeeeeee-5000-0000-0000-0000000000d1','origin','visit','currency','MYR','total_amount',300,
  'prepared_at',pg_temp.at(pg_temp.wk() + interval '1 minute'),
  'issue',jsonb_build_object('issued_at',pg_temp.at(pg_temp.wk() + interval '2 minutes')),
  'send',jsonb_build_object('sent_at',pg_temp.at(pg_temp.wk() + interval '4 minutes'),'channel','in_person','evidence','customer_acknowledged')), 'ffffffff-5000-0000-0000-000000000020'))$$,
  'staff prepare, issue and hand over a quote from the visit');
select is((select lead_id from api.quotes where id = pg_temp.id('q2')), 'eeeeeeee-5000-0000-0000-0000000000a1'::uuid, 'visit quote inherits the visit inquiry');
select is((select pursuit_key from api.quote_register where quote_id = pg_temp.id('q2')), (select pursuit_key from api.quote_register where quote_id = pg_temp.id('q1')), 'visit and digital quotes share one pursuit');

select is((select first_quotes from api.quote_send_summary(current_date - 6, current_date + 1) where week_start = (pg_temp.wk() at time zone 'Asia/Kuala_Lumpur')::date), 2::bigint, 'two first quotations this week');
select is((select revisions from api.quote_send_summary(current_date - 6, current_date + 1) where week_start = (pg_temp.wk() at time zone 'Asia/Kuala_Lumpur')::date), 1::bigint, 'one revision this week');
select is((select resends from api.quote_send_summary(current_date - 6, current_date + 1) where week_start = (pg_temp.wk() at time zone 'Asia/Kuala_Lumpur')::date), 1::bigint, 'one resend this week');
select is((select quoted_pursuits from api.quote_send_summary(current_date - 6, current_date + 1) where week_start = (pg_temp.wk() at time zone 'Asia/Kuala_Lumpur')::date), 1::bigint, 'one quoted pursuit this week');

select lives_ok($$select pg_temp.q('void_send', jsonb_build_object('delivery_id',pg_temp.id('s2','delivery_id'),'reason','Recorded on the wrong quote'), 'ffffffff-5000-0000-0000-000000000021')$$, 'a mistaken send can be voided');
select is((select resends from api.quote_send_summary(current_date - 6, current_date + 1) where week_start = (pg_temp.wk() at time zone 'Asia/Kuala_Lumpur')::date), 0::bigint, 'voided send leaves the counts');
select is((select count(*) from api.quote_deliveries where id = pg_temp.id('s2','delivery_id')), 1::bigint, 'voided delivery is preserved');

------------------------------------------------------------------ outcomes and links keep history and imply no sale
select lives_ok($$select pg_temp.q('accept', jsonb_build_object('quote_id',pg_temp.id('q1')), 'ffffffff-5000-0000-0000-000000000030')$$, 'quote can be accepted');
select is((select lifecycle from api.quote_register where quote_id = pg_temp.id('q1')), 'accepted', 'outcome recorded');
select is((select count(*) from api.purchases), (select purchases from baseline), 'acceptance records no sale');
select is((select count(*) from api.opportunities), (select opportunities from baseline), 'acceptance creates no opportunity');
select throws_ok($$select pg_temp.q('send', jsonb_build_object('version_id',pg_temp.id('q1v3','version_id'),'sent_at',now(),'channel','email','evidence','staff_attested'), 'ffffffff-5000-0000-0000-000000000031')$$,
  '23514', 'Reopen the quote before recording another send', 'closed quote refuses sends');
select throws_ok($$select pg_temp.q('reopen', jsonb_build_object('quote_id',pg_temp.id('q1')), 'ffffffff-5000-0000-0000-000000000032')$$, '23514', 'A reason is required', 'reopen needs a reason');
select lives_ok($$select pg_temp.q('reopen', jsonb_build_object('quote_id',pg_temp.id('q1'),'reason','Customer asked for changes'), 'ffffffff-5000-0000-0000-000000000033')$$, 'quote can be reopened');
select is((select status from api.quotes where id = pg_temp.id('q1')), 'revised', 'reopened quote returns to its issue state');
select throws_ok($$select pg_temp.q('link', jsonb_build_object('quote_id',pg_temp.id('q2'),'opportunity_id','eeeeeeee-5000-0000-0000-0000000000b1'), 'ffffffff-5000-0000-0000-000000000034')$$, '23514', 'A reason is required', 'link needs a reason');
select lives_ok($$select pg_temp.q('link', jsonb_build_object('quote_id',pg_temp.id('q2'),'opportunity_id','eeeeeeee-5000-0000-0000-0000000000b1','reason','Pursuit opened'), 'ffffffff-5000-0000-0000-000000000035')$$, 'quote can be linked to an existing opportunity');
select is((select details->'before'->>'opportunity_id' from api.quote_events where quote_id = pg_temp.id('q2') and event_type = 'anchors_changed'), null, 'link history keeps the previous anchor');
select is((select count(*) from api.quote_deliveries where quote_id = pg_temp.id('q2')), 1::bigint, 'linking preserves sent evidence');
select throws_ok($$select pg_temp.q('link', jsonb_build_object('quote_id',pg_temp.id('q2'),'opportunity_id','eeeeeeee-5000-0000-0000-0000000000b2','reason','Wrong pursuit'), 'ffffffff-5000-0000-0000-000000000036')$$,
  '23514', 'The linked records name different customers. Resolve the identity first', 'cannot link to a pursuit for a different customer');
select ok((select count(*) >= 5 from api.entity_timeline('lead', 'eeeeeeee-5000-0000-0000-0000000000a1') where subject like 'Quote %'), 'quote events appear on the inquiry timeline');

------------------------------------------------------------------ historical evidence review
select throws_ok($$select pg_temp.q('resolve_evidence', '{"visit_id":"eeeeeeee-5000-0000-0000-0000000000d3","resolution":"create_prepared"}', 'ffffffff-5000-0000-0000-000000000040')$$,
  '23514', 'State the quote currency (three letters, for example MYR)', 'historical evidence review must state currency');
select lives_ok($$select pg_temp.keep('q3', pg_temp.q('resolve_evidence', '{"visit_id":"eeeeeeee-5000-0000-0000-0000000000d3","resolution":"create_prepared","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000041'))$$,
  'reviewer creates a prepared record from a historical SQ note');
select is((select current_evidence_state || '/' || lifecycle from api.quote_register where quote_id = pg_temp.id('q3')), 'unverified_historical/prepared', 'historical evidence becomes only an unverified prepared record');
select is((select count(*) from api.quote_deliveries where quote_id = pg_temp.id('q3')), 0::bigint, 'no quote_sent from historical evidence');
select is((select resolution from api.visit_quote_evidence where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d3'), 'linked', 'evidence now resolves to the reviewed record');
select ok((select unverified_versions_prepared >= 1 from api.quote_send_summary(current_date - 50, current_date) where week_start = date_trunc('week', (now() - interval '40 days') at time zone 'Asia/Kuala_Lumpur')::date), 'unverified preparation is countable separately, at its business date');
select throws_ok($$select pg_temp.q('resolve_evidence', '{"visit_id":"eeeeeeee-5000-0000-0000-0000000000d3","resolution":"not_a_quote","reason":"Stale reviewer"}', 'ffffffff-5000-0000-0000-000000000042')$$,
  '40001', null, 'a stale concurrent review is refused');
select throws_ok($$select pg_temp.q('resolve_evidence', '{"visit_id":"eeeeeeee-5000-0000-0000-0000000000d2","resolution":"create_prepared","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000043')$$,
  '23505', null, 'a duplicate SQ note cannot create a second quote');
select lives_ok($$select pg_temp.keep('e3', pg_temp.q('resolve_evidence', jsonb_build_object('visit_id','eeeeeeee-5000-0000-0000-0000000000d3','resolution','unresolved','reason','Amount disputed',
  'expected_decision_id',(select decision_id from api.visit_quote_evidence where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d3')), 'ffffffff-5000-0000-0000-000000000044'))$$, 'a later decision supersedes the earlier one');
select is((select resolution from api.visit_quote_evidence where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d3'), 'unresolved', 'explicit unresolved state');
select is((select count(*) from api.visit_quote_evidence_decisions where visit_id = 'eeeeeeee-5000-0000-0000-0000000000d3'), 2::bigint, 'decision history is preserved');

-- A finished upload is evidence only.
create temp table before_upload as select count(*) as quotes from api.quotes;
select lives_ok($$select api.visit_quotation_command('prepare','eeeeeeee-5000-0000-0000-0000000000d1','eeeeeeee-5000-0000-0000-0000000000f1','{"file_name":"Synthetic quote.pdf","file_size":64,"content_type":"application/pdf"}')$$, 'quotation file reserved');
insert into storage.objects(bucket_id, name, metadata) select 'visit-quotations', object_path, '{"size":64,"mimetype":"application/pdf"}' from api.visit_quotation_files where id = 'eeeeeeee-5000-0000-0000-0000000000f1';
select lives_ok($$select api.visit_quotation_command('finish','eeeeeeee-5000-0000-0000-0000000000d1','eeeeeeee-5000-0000-0000-0000000000f1')$$, 'quotation file uploaded');
select is((select count(*) from api.quotes), (select quotes from before_upload), 'upload creates no quote');
select is((select resolution from api.visit_quote_evidence where file_id = 'eeeeeeee-5000-0000-0000-0000000000f1'), 'unreviewed', 'uploaded file waits for review');
select lives_ok($$select pg_temp.q('resolve_evidence', jsonb_build_object('visit_id','eeeeeeee-5000-0000-0000-0000000000d1','file_id','eeeeeeee-5000-0000-0000-0000000000f1','resolution','link',
  'quote_id',pg_temp.id('q1'),'version_id',pg_temp.id('q1v2','version_id')), 'ffffffff-5000-0000-0000-000000000045')$$, 'file linked to the canonical version');
select is((select decided_version_id from api.visit_quote_evidence where file_id = 'eeeeeeee-5000-0000-0000-0000000000f1'), pg_temp.id('q1v2','version_id'), 'file resolves to one canonical version');

------------------------------------------------------------------ permission and workspace boundaries
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000007');
select throws_ok($$select pg_temp.q('prepare', '{"lead_id":"eeeeeeee-5000-0000-0000-0000000000a1","origin":"inbox","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000050')$$, '42501', 'permission denied: sales.write', 'marketing cannot write quotes');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
select throws_ok($$select pg_temp.q('prepare', '{"opportunity_id":"eeeeeeee-5000-0000-0000-0000000000b2","origin":"pipeline","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000051')$$,
  '42501', 'Only the owner or a sales manager can quote on this opportunity', 'showroom cannot quote on a teammate opportunity');
select lives_ok($$select pg_temp.q('prepare', '{"lead_id":"eeeeeeee-5000-0000-0000-0000000000a2","origin":"inbox","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000052')$$, 'showroom can quote on a shared inbox inquiry');
select throws_ok($$select pg_temp.q('prepare', '{"lead_id":"eeeeeeee-5000-0000-0000-0000000000a9","origin":"inbox","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000053')$$,
  '42501', 'Inquiry not found in this workspace', 'foreign inquiry cannot anchor a quote');
select throws_ok($$select pg_temp.q('prepare', '{"visit_id":"eeeeeeee-5000-0000-0000-0000000000d9","origin":"visit","currency":"MYR"}', 'ffffffff-5000-0000-0000-000000000054')$$,
  '42501', 'Visit not found in this workspace', 'foreign visit cannot anchor a quote');
select throws_ok(format($$insert into api.quote_deliveries(workspace_id, quote_id, quote_version_id, sent_at, channel, sent_by, evidence, recorded_by, request_id)
  values ('11111111-1111-1111-1111-111111111111', '%s', '%s', now(), 'email', auth.uid(), 'staff_attested', auth.uid(), gen_random_uuid())$$, pg_temp.id('q1'), pg_temp.id('q1v3','version_id')),
  '42501', null, 'deliveries cannot be written directly');
select throws_ok(format($$update api.quotes set status = 'accepted' where id = '%s'$$, pg_temp.id('q1')), '42501', null, 'quotes cannot be updated directly');

reset role;
select throws_ok(format($$update sales.quote_deliveries set channel = 'email' where id = '%s'$$, pg_temp.id('s1','delivery_id')), '0A000', null, 'deliveries are append-only');
select throws_ok(format($$delete from sales.quote_events where quote_id = '%s'$$, pg_temp.id('q1')), '0A000', null, 'history is append-only');
-- A quote in another workspace, then the workspace is deleted (the demo reset path).
insert into sales.quotes(id, workspace_id, lead_id, status, current_version_no, origin) values
  ('eeeeeeee-5000-0000-0000-0000000000e9', '99999999-5000-0000-0000-000000000001', 'eeeeeeee-5000-0000-0000-0000000000a9', 'issued', 1, 'inbox');
insert into sales.quote_versions(id, workspace_id, quote_id, version_no, prepared_at, issued_at, currency, evidence_state) values
  ('eeeeeeee-5000-0000-0000-0000000000e8', '99999999-5000-0000-0000-000000000001', 'eeeeeeee-5000-0000-0000-0000000000e9', 1, now() - interval '1 day', now(), 'MYR', 'staff_entered');
insert into sales.quote_deliveries(workspace_id, quote_id, quote_version_id, sent_at, channel, sent_by, evidence, recorded_by, request_id) values
  ('99999999-5000-0000-0000-000000000001', 'eeeeeeee-5000-0000-0000-0000000000e9', 'eeeeeeee-5000-0000-0000-0000000000e8', now(), 'email', 'aaaaaaaa-0000-0000-0000-000000000001', 'staff_attested', 'aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid());
insert into sales.visit_quotation_files(id, workspace_id, visit_id, object_path, file_name, content_type, file_size, created_by, uploaded_at) values
  ('eeeeeeee-5000-0000-0000-0000000000f9', '99999999-5000-0000-0000-000000000001', 'eeeeeeee-5000-0000-0000-0000000000d9', '99999999-5000-0000-0000-000000000001/foreign-quote.pdf', 'Foreign.pdf', 'application/pdf', 10, 'aaaaaaaa-0000-0000-0000-000000000001', now());
insert into sales.visit_quote_evidence_decisions(workspace_id, visit_id, evidence_kind, file_id, resolution, quote_id, snapshot, decided_by) values
  ('99999999-5000-0000-0000-000000000001', 'eeeeeeee-5000-0000-0000-0000000000d9', 'file', 'eeeeeeee-5000-0000-0000-0000000000f9', 'linked', 'eeeeeeee-5000-0000-0000-0000000000e9', '{}', 'aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok($$delete from sales.visit_quote_evidence_decisions where file_id = 'eeeeeeee-5000-0000-0000-0000000000f9'$$, '0A000', null, 'evidence decisions are append-only');
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000003');
select is((select count(*) from api.quote_register where quote_id = 'eeeeeeee-5000-0000-0000-0000000000e9'), 0::bigint, 'foreign workspace quote is hidden');
select throws_ok($$select pg_temp.q('accept', '{"quote_id":"eeeeeeee-5000-0000-0000-0000000000e9"}', 'ffffffff-5000-0000-0000-000000000060')$$, '42501', 'Quote not found', 'foreign quote cannot be changed');
reset role;
select lives_ok($$delete from core.workspaces where id = '99999999-5000-0000-0000-000000000001'$$, 'workspace deletion still cascades through quote history');
select is((select count(*) from sales.visit_quotation_files where id = 'eeeeeeee-5000-0000-0000-0000000000f9'), 0::bigint, 'quotation files and their review history go with the workspace');

select * from finish();
rollback;
