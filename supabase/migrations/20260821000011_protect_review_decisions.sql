-- A re-import must not un-decide what a reviewer decided.
--
-- The corpus importer writes every candidate table with a PostgREST upsert, and
-- an upsert has no way to say "insert these columns, but on conflict update only
-- some of them" — every column in the payload is written on the update path too.
-- The payload carries the literal review_state 'pending_review' that a new
-- candidate needs. So a second run over an unchanged corpus silently reset the
-- decision column on every row it re-observed.
--
-- This is not hypothetical. On the hosted project on 2026-08-21, migration
-- …10_publish_corpus_priced_catalog approved 6,701 price candidates and 5,126
-- variant candidates at 01:53:39; a reconciliation re-import at 01:55:28 set all
-- of them back to 'pending_review'. The published catalog was untouched (5,087
-- products, 6,575 prices are still live) and so were the append-only
-- review_decisions, so nothing was lost — but the review queue then claimed
-- 10,183 prices and 6,011 variants were awaiting a person when 11,827 of those
-- rows had already been decided.
--
-- The fix belongs in the database, not the importer: re-observing a source is
-- never a reason to forget a decision about it, whichever client does the
-- observing. Restoring the column rather than raising is deliberate — the
-- importer legitimately re-writes the source-derived columns of thousands of
-- rows per batch, and an exception would make a re-import impossible instead of
-- making it correct. Nothing in the application ever moves a candidate back to
-- pending, so no legitimate transition is blocked; the only writer of the
-- pending sentinel onto an existing row is an importer that should not be
-- writing that column at all.

------------------------------------------------------------------------------
-- 1. The guard.
--
-- tg_argv[0] is the decision column, tg_argv[1] the value that means "nobody has
-- decided yet", and any further arguments are the reviewer-owned columns that
-- travel with it and must be restored alongside.
------------------------------------------------------------------------------
create or replace function ingest.preserve_review_decision()
returns trigger
language plpgsql
as $fn$
declare
  v_state_col text := tg_argv[0];
  v_pending   text := tg_argv[1];
  v_old_json  jsonb := to_jsonb(old);
  v_old_state text;
  v_new_state text;
  v_restore   jsonb;
  i           int;
begin
  v_old_state := v_old_json ->> v_state_col;
  v_new_state := to_jsonb(new) ->> v_state_col;

  -- Only one transition is refused: decided -> undecided. Everything else,
  -- including a reviewer moving a row on to its next state, passes through.
  if v_old_state is not distinct from v_pending or v_new_state is distinct from v_pending then
    return new;
  end if;

  v_restore := jsonb_build_object(v_state_col, v_old_json -> v_state_col);
  for i in 2 .. coalesce(array_length(tg_argv, 1), 0) - 1 loop
    v_restore := v_restore || jsonb_build_object(tg_argv[i], v_old_json -> tg_argv[i]);
  end loop;

  -- Keys absent from v_restore keep the incoming value, so the source-derived
  -- columns the importer came to update are still updated.
  return jsonb_populate_record(new, v_restore);
end $fn$;

revoke all on function ingest.preserve_review_decision() from public;

comment on function ingest.preserve_review_decision() is
  'Refuses the decided -> pending transition on an ingest candidate table. Re-observing a source is not a reason to forget a decision about it.';

------------------------------------------------------------------------------
-- 2. Every table the importer upserts that carries a reviewer-owned column.
--
-- ingest.visual_observations and ingest.review_decisions are absent because they
-- are already append-only; ingest.reject_mutation() covers them more strictly.
------------------------------------------------------------------------------
create trigger candidate_records_preserve_decision
  before update on ingest.candidate_records
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger variant_candidates_preserve_decision
  before update on ingest.variant_candidates
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger price_candidates_preserve_decision
  before update on ingest.price_candidates
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger certificate_candidates_preserve_decision
  before update on ingest.certificate_candidates
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger catalog_edition_candidates_preserve_decision
  before update on ingest.catalog_edition_candidates
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger corpus_validation_issues_preserve_decision
  before update on ingest.corpus_validation_issues
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger shape_profiles_preserve_decision
  before update on ingest.shape_profiles
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger shape_clusters_preserve_decision
  before update on ingest.shape_clusters
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger source_assets_preserve_class_decision
  before update on ingest.source_assets
  for each row execute function ingest.preserve_review_decision('asset_class_review_state', 'pending_review');

-- The raw-observation state is this table's "nobody has ruled on it" value.
create trigger commercial_amount_observations_preserve_decision
  before update on ingest.commercial_amount_observations
  for each row execute function ingest.preserve_review_decision('review_state', 'retained_raw_observation');

-- Media carries two independent judgements: what the image is, and whether we
-- are allowed to use it. Neither may be reset by re-observing the file.
create trigger media_assets_preserve_decision
  before update on ingest.media_assets
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review');

create trigger media_assets_preserve_usage_rights
  before update on ingest.media_assets
  for each row execute function ingest.preserve_review_decision('usage_rights_state', 'unreviewed');

create trigger media_asset_variant_links_preserve_decision
  before update on ingest.media_asset_variant_links
  for each row execute function ingest.preserve_review_decision('review_state', 'pending_review', 'reviewed_at', 'reviewed_by');

-- A review task's answer is status plus who gave it and why; the three are one
-- decision and are restored together.
create trigger review_items_preserve_decision
  before update on ingest.review_items
  for each row execute function ingest.preserve_review_decision('status', 'pending', 'reviewed_at', 'reviewed_by', 'decision_note');

------------------------------------------------------------------------------
-- 3. Repair what the 01:55 re-import erased.
--
-- Every statement rebuilds the decision from evidence that survived, never from
-- an assumption: an append-only approval decision, a published variant id, or a
-- review task that still carries the timestamp and note of the answer it was
-- given. On a database with no corpus every statement matches nothing.
------------------------------------------------------------------------------

-- Variant candidates that name the variant they were published as.
update ingest.variant_candidates
set review_state = 'approved', updated_at = now()
where review_state = 'pending_review'
  and published_variant_id is not null;

-- Price candidates with a recorded approval in the append-only decision log.
update ingest.price_candidates pc
set review_state = 'approved', updated_at = now()
where pc.review_state = 'pending_review'
  and exists (
    select 1 from ingest.review_decisions rd
    where rd.review_target_type = 'price_candidate'
      and rd.review_target_id = pc.id
      and rd.decision = 'approved'
  );

-- The generic record beside each typed candidate follows the typed row.
update ingest.candidate_records cr
set review_state = 'approved', updated_at = now()
where cr.review_state = 'pending_review'
  and (
    exists (
      select 1 from ingest.price_candidates pc
      where pc.workspace_id = cr.workspace_id
        and pc.candidate_key = cr.candidate_key
        and pc.review_state = 'approved'
    )
    or exists (
      select 1 from ingest.variant_candidates vc
      where vc.workspace_id = cr.workspace_id
        and vc.candidate_key = cr.candidate_key
        and vc.review_state = 'approved'
    )
  );

-- A task cannot be both pending and answered. These carry reviewed_at and the
-- note the publication wrote; only status was reset.
update ingest.review_items
set status = 'approved'
where status = 'pending'
  and reviewed_at is not null;

------------------------------------------------------------------------------
-- 4. Let the reconciler see this class of drift.
--
-- api.corpus_reconciliation called `*_not_pending` "the headline safety number:
-- anything not pending here has been published". After the 01:55 re-import that
-- number was 0 while 5,087 products and 6,575 prices were live, and the
-- reconciler duly printed "nothing is published". The count was never a safety
-- number on its own — it only means something next to the independent record of
-- what was actually published. Both are exposed now so the two can be compared.
------------------------------------------------------------------------------
create or replace view api.corpus_reconciliation with (security_invoker = true) as
select
  a.id as workspace_id,
  (select count(*) from ingest.source_assets s where s.workspace_id = a.id and s.provider = 'google_drive') as source_assets,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'uploaded') as versions_uploaded,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'binary_not_staged') as versions_deferred,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'connector_text_only') as versions_connector_only,
  (select count(*) from ingest.source_asset_versions v where v.workspace_id = a.id and v.snapshot_state = 'excluded_by_policy') as versions_excluded,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id) as media_assets,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id and m.asset_kind = 'pdf_page_render') as page_renders,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id and m.asset_kind = 'standalone_image') as standalone_images,
  (select count(*) from ingest.media_assets m where m.workspace_id = a.id and m.asset_kind = 'source_pdf') as source_pdfs,
  (select count(*) from ingest.visual_observations o where o.workspace_id = a.id) as visual_observations,
  (select count(*) from ingest.media_asset_variant_links k where k.workspace_id = a.id) as media_links,
  (select count(*) from ingest.variant_candidates c where c.workspace_id = a.id) as variant_candidates,
  (select count(*) from ingest.price_candidates c where c.workspace_id = a.id) as price_candidates,
  (select count(*) from ingest.certificate_candidates c where c.workspace_id = a.id) as certificate_candidates,
  (select count(*) from ingest.catalog_edition_candidates c where c.workspace_id = a.id) as catalog_edition_candidates,
  (select count(*) from ingest.commercial_amount_observations c where c.workspace_id = a.id) as commercial_amount_observations,
  (select count(*) from ingest.duplicate_code_groups g where g.workspace_id = a.id) as duplicate_code_groups,
  (select count(*) from ingest.shape_profiles p where p.workspace_id = a.id) as shape_profiles,
  (select count(*) from ingest.review_items r where r.workspace_id = a.id and r.task_type is not null) as corpus_review_tasks,
  -- What the candidate rows currently claim.
  (select count(*) from ingest.variant_candidates c where c.workspace_id = a.id and c.review_state <> 'pending_review') as variant_candidates_not_pending,
  (select count(*) from ingest.price_candidates c where c.workspace_id = a.id and c.review_state <> 'pending_review') as price_candidates_not_pending,
  (select count(*) from ingest.certificate_candidates c where c.workspace_id = a.id and c.review_state <> 'pending_review') as certificate_candidates_not_pending,
  -- What was independently published, and what was independently decided. A
  -- candidate row can be rewritten; a published variant and an append-only
  -- decision cannot, so these are the check on the three counts above.
  (select count(*) from ingest.variant_candidates c
    where c.workspace_id = a.id and c.published_variant_id is not null) as variant_candidates_published,
  (select count(*) from ingest.review_decisions d
    where d.workspace_id = a.id and d.review_target_type = 'price_candidate' and d.decision = 'approved') as price_approvals_recorded,
  (select count(*) from merch.variant_prices p where p.workspace_id = a.id and p.state = 'current') as prices_live
from core.workspaces a;
grant select on api.corpus_reconciliation to authenticated, service_role;
