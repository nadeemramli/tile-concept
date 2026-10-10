-- TILE-22 — OCR-assisted scanned catalogue imports (PRD §7.8, §12.5).
--
-- A scanned PDF page or an image is read by a background worker running
-- Tesseract, never inside an interactive request. This migration gives that
-- worker a durable queue on ingest.ingestion_jobs (job_type 'ocr'):
--
--   request_ocr        source.import   queue pages of one source version; an
--                                      identical request returns the same job
--   retry_ocr_job      source.import   requeue a failed job with a new budget
--   add_manual_review_item             the fallback that never waits for OCR
--   ocr_claim_job      service_role    lease one due job (SKIP LOCKED)
--   ocr_complete_job   service_role    store page evidence + staged proposals
--   ocr_fail_job       service_role    bounded retry, then manual-entry items
--
-- OCR output is evidence and proposal only. Every proposal lands in
-- ingest.review_items as 'pending' and reaches the catalog or a price list
-- only through api.approve_review_item, whose strict gate is unchanged.

------------------------------------------------------------------------------
-- Queue columns on the existing job table.
------------------------------------------------------------------------------
alter table ingest.ingestion_jobs
  add column if not exists requested_pages int[],
  add column if not exists source_checksum text,
  add column if not exists engine text,
  add column if not exists engine_version text,
  add column if not exists max_attempts int not null default 3,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists failure_kind text;

alter table ingest.ingestion_jobs drop constraint if exists ingestion_jobs_failure_kind_check;
alter table ingest.ingestion_jobs add constraint ingestion_jobs_failure_kind_check check (
  failure_kind is null or failure_kind in
    ('transient','encrypted','unsupported','oversize','too_many_pages','engine_unavailable','source_missing','retries_exhausted'));

-- One live or finished OCR job per source version and page set: asking again
-- returns it. A failed job is retried in place rather than duplicated. Partial
-- and expression-based on purpose — it is never a PostgREST upsert target.
create unique index if not exists ingestion_jobs_ocr_dedup_idx
  on ingest.ingestion_jobs (source_asset_id, source_checksum, coalesce(requested_pages, '{}'::int[]))
  where job_type = 'ocr';

create index if not exists ingestion_jobs_ocr_due_idx
  on ingest.ingestion_jobs (status, next_attempt_at, created_at)
  where job_type = 'ocr';

------------------------------------------------------------------------------
-- Raw OCR per page, kept apart from the normalized proposals (PRD §12.5 step 4).
-- Written by the worker only; members with source.import read it.
------------------------------------------------------------------------------
create table if not exists ingest.ocr_page_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  job_id uuid not null references ingest.ingestion_jobs(id) on delete cascade,
  page_no int not null check (page_no >= 1),
  outcome text not null check (outcome in ('read','unreadable','no_text','no_image','failed')),
  word_count int not null default 0,
  mean_confidence numeric(5,2),
  width_px int,
  height_px int,
  image_path text,
  tsv_path text,
  text text,
  preprocessing jsonb not null default '{}'::jsonb,
  engine text,
  engine_version text,
  detail text,
  created_at timestamptz not null default now(),
  unique (job_id, page_no)
);
create index if not exists ocr_page_results_job_idx on ingest.ocr_page_results (job_id);

alter table ingest.ocr_page_results enable row level security;
create policy member_read on ingest.ocr_page_results for select to authenticated
  using (workspace_id in (select core.member_workspace_ids()) and (select core.has_permission('source.import')));
grant select on ingest.ocr_page_results to authenticated;
grant all on ingest.ocr_page_results to service_role;
create or replace view api.ocr_page_results with (security_invoker = true) as select * from ingest.ocr_page_results;
grant select on api.ocr_page_results to authenticated;
grant all on api.ocr_page_results to service_role;

-- The job view froze its column list before these columns existed.
create or replace view api.ingestion_jobs with (security_invoker = true) as select * from ingest.ingestion_jobs;

------------------------------------------------------------------------------
-- Shared insert path for staged proposals. Mirrors api.record_extraction's
-- per-record logic (duplicate-code conflict, fields with region/source text,
-- one pending review item per record) without its user checks, so the worker
-- and the user-facing functions store records identically.
------------------------------------------------------------------------------
create or replace function ingest.store_extraction_records(p_job_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j ingest.ingestion_jobs%rowtype;
  rec jsonb;
  fld jsonb;
  v_record_id uuid;
  v_code text;
  v_dupe boolean;
  n_records int := 0;
  n_dupe int := 0;
  n_manual int := 0;
begin
  select * into j from ingest.ingestion_jobs where id = p_job_id;
  if not found then raise exception 'job not found'; end if;

  for rec in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    v_code := core.normalize_key(rec->'normalized'->>'code');
    v_dupe := v_code is not null and exists (
      select 1 from merch.products pr where pr.workspace_id = j.workspace_id and pr.code_key = v_code and pr.merged_into_product_id is null);

    insert into ingest.ingestion_records (job_id, row_no, page_no, raw, normalized, confidence, status, issues)
    values (p_job_id, (rec->>'row_no')::int, (rec->>'page_no')::int, coalesce(rec->'raw', '{}'::jsonb), rec->'normalized',
            (rec->>'confidence')::numeric, case when v_dupe then 'duplicate' else 'valid' end, coalesce(rec->'issues', '[]'::jsonb))
    returning id into v_record_id;
    n_records := n_records + 1;
    if v_dupe then n_dupe := n_dupe + 1; end if;
    if coalesce(rec->'issues', '[]'::jsonb) @> '[{"code":"needs_manual"}]'::jsonb then n_manual := n_manual + 1; end if;

    for fld in select * from jsonb_array_elements(coalesce(rec->'fields', '[]'::jsonb)) loop
      insert into ingest.extracted_fields (record_id, field_key, value, confidence, region, source_text)
      values (v_record_id, fld->>'key', fld->>'value', (fld->>'confidence')::numeric, fld->'region', fld->>'source_text');
    end loop;

    insert into ingest.review_items (workspace_id, job_id, record_id, source_asset_id, item_type, proposed, conflicts, status, confidence)
    values (j.workspace_id, p_job_id, v_record_id, j.source_asset_id, coalesce(rec->>'item_type', 'product'), coalesce(rec->'normalized', '{}'::jsonb),
            case when v_dupe
              then coalesce(rec->'issues', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('code', 'duplicate_product', 'detail', 'A product with this code already exists'))
              else coalesce(rec->'issues', '[]'::jsonb) end,
            'pending', (rec->>'confidence')::numeric);
  end loop;

  return jsonb_build_object('records', n_records, 'duplicates', n_dupe, 'manual', n_manual);
end $$;
revoke all on function ingest.store_extraction_records(uuid, jsonb) from public;

-- Pages a job covers: the explicit list, else every page we know of, else 1.
create or replace function ingest.ocr_job_pages(p_job ingest.ingestion_jobs)
returns int[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_job.requested_pages,
    (select array_agg(g) from ingest.source_assets a, generate_series(1, greatest(coalesce(a.page_count, 1), 1)) g where a.id = p_job.source_asset_id),
    array[1]);
$$;
revoke all on function ingest.ocr_job_pages(ingest.ingestion_jobs) from public;

------------------------------------------------------------------------------
-- Limits. Bounded so a scanned batch never pretends to be interactive work;
-- anything larger is entered by hand or split (PRD §12.5).
------------------------------------------------------------------------------
create or replace function ingest.ocr_limits()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'max_bytes', 26214400,        -- 25 MiB
    'max_pages', 20,
    'mime_types', jsonb_build_array('application/pdf','image/png','image/jpeg','image/tiff','image/webp'));
$$;
grant execute on function ingest.ocr_limits() to authenticated, service_role;

------------------------------------------------------------------------------
-- Request OCR for pages of a source (source.import).
------------------------------------------------------------------------------
create or replace function api.request_ocr(p_source_asset_id uuid, p_pages int[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a ingest.source_assets%rowtype;
  lim jsonb := ingest.ocr_limits();
  v_pages int[];
  v_existing ingest.ingestion_jobs%rowtype;
  v_id uuid;
  v_count int;
begin
  perform core.require_permission('source.import');
  select * into a from ingest.source_assets where id = p_source_asset_id;
  if not found then raise exception 'source asset not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(a.workspace_id);

  if a.status = 'archived' then
    raise exception 'this source is archived; restore it before running OCR' using errcode = '22023';
  end if;
  if a.kind not in ('pdf', 'image') then
    raise exception 'OCR reads scanned PDFs and images only. Enter this source''s rows by hand.' using errcode = '22023';
  end if;
  if a.storage_path is null then
    raise exception 'this source has no stored file to read' using errcode = '22023';
  end if;
  if a.mime_type is not null and not (lim->'mime_types') ? lower(a.mime_type) then
    raise exception 'OCR does not read % files. Supported: PDF, PNG, JPEG, TIFF, WebP. Enter the rows by hand.', a.mime_type using errcode = '22023';
  end if;
  if coalesce(a.size_bytes, 0) > (lim->>'max_bytes')::bigint then
    raise exception 'this file is % MB; OCR accepts at most 25 MB. Split it, or enter the rows by hand.', round(a.size_bytes / 1048576.0, 1) using errcode = '22023';
  end if;

  if p_pages is not null then
    select array_agg(distinct p order by p) into v_pages from unnest(p_pages) p;
    if v_pages is null or exists (select 1 from unnest(v_pages) p where p < 1 or (a.page_count is not null and p > a.page_count)) then
      raise exception 'page numbers must be between 1 and %', coalesce(a.page_count, 1) using errcode = '22023';
    end if;
  elsif a.kind = 'image' then
    v_pages := array[1];
  end if;

  v_count := coalesce(array_length(v_pages, 1), a.page_count, 1);
  if v_count > (lim->>'max_pages')::int then
    raise exception 'OCR reads at most 20 pages per job; this request covers %. Choose the pages to read.', v_count using errcode = '22023';
  end if;

  select * into v_existing from ingest.ingestion_jobs j
  where j.job_type = 'ocr' and j.source_asset_id = a.id and j.source_checksum is not distinct from a.checksum
    and coalesce(j.requested_pages, '{}'::int[]) = coalesce(v_pages, '{}'::int[])
  for update;
  if found then
    if v_existing.status in ('failed', 'dead_letter') then
      return api.retry_ocr_job(v_existing.id) || jsonb_build_object('reused', true);
    end if;
    return jsonb_build_object('job_id', v_existing.id, 'status', v_existing.status, 'reused', true);
  end if;

  insert into ingest.ingestion_jobs (workspace_id, source_asset_id, job_type, status, parser_version, requested_pages,
                                     source_checksum, created_by, stats)
  values (a.workspace_id, a.id, 'ocr', 'queued', 'ocr-tesseract@1', v_pages, a.checksum, auth.uid(),
          jsonb_build_object('pages_requested', v_count))
  returning id into v_id;

  perform audit.emit(a.workspace_id, 'ocr.requested', 'ingest', 'ingestion_jobs', v_id, null,
    jsonb_build_object('source_asset_id', a.id, 'pages', v_pages, 'checksum', a.checksum), null, '{}'::jsonb);
  return jsonb_build_object('job_id', v_id, 'status', 'queued', 'reused', false);
end $$;
revoke all on function api.request_ocr(uuid, int[]) from public;
grant execute on function api.request_ocr(uuid, int[]) to authenticated;

------------------------------------------------------------------------------
-- Retry a failed OCR job (source.import). Input problems are not retried:
-- the same file fails the same way, so the answer is a new file or manual entry.
------------------------------------------------------------------------------
create or replace function api.retry_ocr_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j ingest.ingestion_jobs%rowtype;
begin
  perform core.require_permission('source.import');
  select * into j from ingest.ingestion_jobs where id = p_job_id for update;
  if not found or j.job_type <> 'ocr' then raise exception 'OCR job not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(j.workspace_id);
  if j.status not in ('failed', 'dead_letter') then
    raise exception 'only a failed OCR job can be retried (this one is %)', j.status using errcode = '22023';
  end if;
  if j.failure_kind in ('encrypted', 'unsupported', 'oversize', 'too_many_pages') then
    raise exception 'retrying would fail the same way (%). Upload a readable version of the file, or enter the rows by hand.', j.failure_kind using errcode = '22023';
  end if;

  update ingest.ingestion_jobs
  set status = 'queued', error = null, failure_kind = null, next_attempt_at = null,
      lease_token = null, lease_expires_at = null, finished_at = null,
      max_attempts = j.attempts + 3
  where id = p_job_id;

  perform audit.emit(j.workspace_id, 'ocr.retry_requested', 'ingest', 'ingestion_jobs', p_job_id,
    jsonb_build_object('status', j.status, 'error', j.error, 'attempts', j.attempts), null, null, '{}'::jsonb);
  return jsonb_build_object('job_id', p_job_id, 'status', 'queued', 'retried', true);
end $$;
revoke all on function api.retry_ocr_job(uuid) from public;
grant execute on function api.retry_ocr_job(uuid) to authenticated;

------------------------------------------------------------------------------
-- Manual fallback: an empty, pending review item tied to a page of the
-- original. Available whether or not OCR ran, failed or is still queued.
------------------------------------------------------------------------------
create or replace function api.add_manual_review_item(p_source_asset_id uuid, p_page_no int default null, p_item_type text default 'product', p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a ingest.source_assets%rowtype;
  v_job uuid;
  v_record uuid;
  v_item uuid;
  v_row int;
begin
  perform core.require_permission('source.import');
  select * into a from ingest.source_assets where id = p_source_asset_id;
  if not found then raise exception 'source asset not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(a.workspace_id);
  if p_item_type not in ('product', 'price') then
    raise exception 'a manual row is a product or a price' using errcode = '22023';
  end if;
  if p_page_no is not null and (p_page_no < 1 or (a.page_count is not null and p_page_no > a.page_count)) then
    raise exception 'page must be between 1 and %', coalesce(a.page_count, 1) using errcode = '22023';
  end if;

  -- One 'manual' job per source holds every hand-entered row, so they share
  -- the source's provenance and show up with it in the review queue.
  select id into v_job from ingest.ingestion_jobs
  where source_asset_id = a.id and job_type = 'manual' order by created_at limit 1;
  if v_job is null then
    insert into ingest.ingestion_jobs (workspace_id, source_asset_id, job_type, status, parser_version, started_at, finished_at, created_by)
    values (a.workspace_id, a.id, 'manual', 'succeeded', 'manual@1', now(), now(), auth.uid())
    returning id into v_job;
  end if;

  select coalesce(max(row_no), 0) + 1 into v_row from ingest.ingestion_records where job_id = v_job;
  insert into ingest.ingestion_records (job_id, row_no, page_no, raw, normalized, confidence, status, issues)
  values (v_job, v_row, p_page_no,
          jsonb_build_object('entry', 'manual', 'page', p_page_no, 'note', p_note),
          jsonb_build_object('source_page_or_row', case when p_page_no is null then 'manual entry' else 'page ' || p_page_no || ' (manual entry)' end),
          null, 'valid',
          jsonb_build_array(jsonb_build_object('code', 'needs_manual', 'detail',
            'Entered by hand from ' || case when p_page_no is null then 'the original' else 'page ' || p_page_no || ' of the original' end || '. Type each value as it appears on the page.')))
  returning id into v_record;

  insert into ingest.review_items (workspace_id, job_id, record_id, source_asset_id, item_type, proposed, conflicts, status, confidence)
  select a.workspace_id, v_job, v_record, a.id, p_item_type, r.normalized, r.issues, 'pending', null
  from ingest.ingestion_records r where r.id = v_record
  returning id into v_item;

  perform audit.emit(a.workspace_id, 'review_item.manual_created', 'ingest', 'review_items', v_item, null,
    jsonb_build_object('source_asset_id', a.id, 'page', p_page_no, 'item_type', p_item_type), p_note, '{}'::jsonb);
  return v_item;
end $$;
revoke all on function api.add_manual_review_item(uuid, int, text, text) from public;
grant execute on function api.add_manual_review_item(uuid, int, text, text) to authenticated;

------------------------------------------------------------------------------
-- Worker interface (service_role only). Not callable by a signed-in member.
------------------------------------------------------------------------------
create or replace function api.ocr_claim_job(p_worker text, p_lease_seconds int default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j ingest.ingestion_jobs%rowtype;
  a ingest.source_assets%rowtype;
  v_path text;
  v_token uuid := gen_random_uuid();
begin
  -- A crashed worker's lease expires; past its attempt budget the job is
  -- dead-lettered (with manual-entry items) instead of being picked up forever.
  for j in
    select * from ingest.ingestion_jobs
    where job_type = 'ocr' and status = 'running' and lease_expires_at < now() and attempts >= max_attempts
    for update skip locked
  loop
    perform ingest.ocr_terminal_failure(j, 'retries_exhausted', 'The worker stopped responding on every attempt');
  end loop;

  select * into j from ingest.ingestion_jobs
  where job_type = 'ocr'
    and ((status = 'queued' and coalesce(next_attempt_at, now()) <= now())
      or (status = 'running' and lease_expires_at < now() and attempts < max_attempts))
  order by coalesce(next_attempt_at, created_at), created_at
  limit 1
  for update skip locked;
  if not found then return null; end if;

  select * into a from ingest.source_assets where id = j.source_asset_id;
  -- Read the exact version that was requested, not whatever replaced it since.
  select v.storage_path into v_path from ingest.source_asset_versions v
  where v.source_asset_id = a.id and v.checksum = j.source_checksum order by v.version_no desc limit 1;

  update ingest.ingestion_jobs
  set status = 'running', attempts = attempts + 1, started_at = now(), lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      progress = jsonb_build_object('worker', p_worker, 'claimed_at', now())
  where id = j.id;

  return jsonb_build_object(
    'job_id', j.id, 'lease_token', v_token, 'attempt', j.attempts + 1, 'max_attempts', j.max_attempts,
    'workspace_id', j.workspace_id, 'source_asset_id', a.id, 'name', a.name, 'kind', a.kind,
    'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'page_count', a.page_count,
    'checksum', j.source_checksum, 'storage_bucket', coalesce(a.storage_bucket, 'source-assets'),
    'storage_path', coalesce(v_path, a.storage_path), 'pages', to_jsonb(j.requested_pages),
    'limits', ingest.ocr_limits());
end $$;

-- Terminal failure: record it visibly and give every page a manual-entry item.
create or replace function ingest.ocr_terminal_failure(p_job ingest.ingestion_jobs, p_kind text, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_records jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'row_no', ord, 'page_no', p, 'raw', jsonb_build_object('page', p, 'ocr_failure', p_kind),
           'normalized', jsonb_build_object('source_page_or_row', 'page ' || p || ' (manual entry)'),
           'confidence', 0, 'item_type', 'product',
           'issues', jsonb_build_array(jsonb_build_object('code', 'needs_manual', 'detail',
             'OCR could not read page ' || p || ' (' || p_error || '). Enter this page''s rows by hand from the original — nothing was guessed.')),
           'fields', '[]'::jsonb) order by ord), '[]'::jsonb)
    into v_records
  from unnest(ingest.ocr_job_pages(p_job)) with ordinality as t(p, ord);

  perform ingest.store_extraction_records(p_job.id, v_records);

  update ingest.ingestion_jobs
  set status = case when p_kind in ('transient', 'retries_exhausted', 'engine_unavailable') then 'dead_letter' else 'failed' end,
      failure_kind = p_kind, error = p_error, finished_at = now(), lease_token = null, lease_expires_at = null,
      stats = stats || jsonb_build_object('manual_items', jsonb_array_length(v_records))
  where id = p_job.id;

  insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
  values (p_job.workspace_id, 'ocr_low_confidence', 'high', 'ingestion_job', p_job.id, 'OCR failed: ' || p_error,
          jsonb_build_object('failure_kind', p_kind, 'attempts', p_job.attempts));
  perform audit.emit(p_job.workspace_id, 'ocr.failed', 'ingest', 'ingestion_jobs', p_job.id, null,
    jsonb_build_object('failure_kind', p_kind, 'attempts', p_job.attempts), p_error, '{}'::jsonb);
end $$;
revoke all on function ingest.ocr_terminal_failure(ingest.ingestion_jobs, text, text) from public;

create or replace function api.ocr_complete_job(
  p_job_id uuid, p_lease_token uuid, p_records jsonb, p_pages jsonb, p_stats jsonb default '{}'::jsonb,
  p_engine text default null, p_engine_version text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j ingest.ingestion_jobs%rowtype;
  pg jsonb;
  v_counts jsonb;
  n_unreadable int := 0;
begin
  select * into j from ingest.ingestion_jobs where id = p_job_id for update;
  if not found or j.job_type <> 'ocr' then raise exception 'OCR job not found' using errcode = 'P0002'; end if;
  -- Exactly one completion per lease: a late or repeated delivery cannot add
  -- a second copy of the proposals.
  if j.status <> 'running' or j.lease_token is distinct from p_lease_token then
    raise exception 'this OCR lease is no longer current (job is %)', j.status using errcode = '40001';
  end if;

  for pg in select * from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) loop
    insert into ingest.ocr_page_results (workspace_id, job_id, page_no, outcome, word_count, mean_confidence, width_px, height_px,
                                         image_path, tsv_path, text, preprocessing, engine, engine_version, detail)
    values (j.workspace_id, j.id, (pg->>'page_no')::int, pg->>'outcome', coalesce((pg->>'word_count')::int, 0),
            (pg->>'mean_confidence')::numeric, (pg->>'width_px')::int, (pg->>'height_px')::int,
            pg->>'image_path', pg->>'tsv_path', pg->>'text', coalesce(pg->'preprocessing', '{}'::jsonb),
            p_engine, p_engine_version, pg->>'detail')
    on conflict (job_id, page_no) do nothing;
    if pg->>'outcome' <> 'read' then n_unreadable := n_unreadable + 1; end if;
  end loop;

  v_counts := ingest.store_extraction_records(j.id, p_records);

  update ingest.ingestion_jobs
  set status = 'succeeded', finished_at = now(), lease_token = null, lease_expires_at = null,
      error = null, failure_kind = null, engine = p_engine, engine_version = p_engine_version,
      stats = stats || coalesce(p_stats, '{}'::jsonb) || v_counts || jsonb_build_object('pages_unreadable', n_unreadable)
  where id = j.id;
  update ingest.source_assets set status = 'processed' where id = j.source_asset_id and status <> 'archived';

  if n_unreadable > 0 then
    insert into ingest.data_quality_issues (workspace_id, issue_type, severity, object_type, object_id, summary, details)
    values (j.workspace_id, 'ocr_low_confidence', 'medium', 'ingestion_job', j.id,
            n_unreadable || ' page(s) could not be read by OCR and need manual entry', jsonb_build_object('pages_unreadable', n_unreadable));
  end if;

  perform audit.emit(j.workspace_id, 'ocr.completed', 'ingest', 'ingestion_jobs', j.id, null,
    v_counts || jsonb_build_object('engine', p_engine, 'engine_version', p_engine_version, 'pages_unreadable', n_unreadable), null, '{}'::jsonb);
  return v_counts || jsonb_build_object('pages_unreadable', n_unreadable);
end $$;

create or replace function api.ocr_fail_job(p_job_id uuid, p_lease_token uuid, p_error text, p_failure_kind text default 'transient')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j ingest.ingestion_jobs%rowtype;
begin
  select * into j from ingest.ingestion_jobs where id = p_job_id for update;
  if not found or j.job_type <> 'ocr' then raise exception 'OCR job not found' using errcode = 'P0002'; end if;
  if j.status <> 'running' or j.lease_token is distinct from p_lease_token then
    raise exception 'this OCR lease is no longer current (job is %)', j.status using errcode = '40001';
  end if;
  if p_failure_kind is null or p_failure_kind not in ('transient','encrypted','unsupported','oversize','too_many_pages','engine_unavailable','source_missing') then
    raise exception 'unknown OCR failure kind %', p_failure_kind using errcode = '22023';
  end if;

  if p_failure_kind = 'transient' and j.attempts < j.max_attempts then
    -- Bounded exponential backoff: 30 s, 2 min, 4.5 min…
    update ingest.ingestion_jobs
    set status = 'queued', error = p_error, failure_kind = null, lease_token = null, lease_expires_at = null,
        next_attempt_at = now() + make_interval(secs => 30 * j.attempts * j.attempts)
    where id = j.id;
    perform audit.emit(j.workspace_id, 'ocr.attempt_failed', 'ingest', 'ingestion_jobs', j.id, null,
      jsonb_build_object('attempt', j.attempts, 'max_attempts', j.max_attempts), p_error, '{}'::jsonb);
    return jsonb_build_object('status', 'queued', 'retry', true, 'attempt', j.attempts);
  end if;

  perform ingest.ocr_terminal_failure(j, case when p_failure_kind = 'transient' then 'retries_exhausted' else p_failure_kind end, p_error);
  return jsonb_build_object('status', (select status from ingest.ingestion_jobs where id = j.id), 'retry', false, 'attempt', j.attempts);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'api.ocr_claim_job(text,int)',
    'api.ocr_complete_job(uuid,uuid,jsonb,jsonb,jsonb,text,text)',
    'api.ocr_fail_job(uuid,uuid,text,text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

------------------------------------------------------------------------------
-- Read models.
------------------------------------------------------------------------------
-- OCR jobs with what a reviewer needs to judge them.
create or replace view api.ocr_jobs with (security_invoker = true) as
select j.id, j.workspace_id, j.source_asset_id, a.name as source_name, j.status, j.attempts, j.max_attempts,
       j.requested_pages, j.source_checksum, (j.source_checksum is distinct from a.checksum) as superseded,
       j.engine, j.engine_version, j.parser_version, j.error, j.failure_kind, j.next_attempt_at,
       j.created_at, j.started_at, j.finished_at, j.created_by, j.stats,
       (select count(*) from ingest.review_items ri where ri.job_id = j.id) as review_items,
       (select count(*) from ingest.review_items ri where ri.job_id = j.id and ri.status = 'pending') as pending_items,
       (select coalesce(jsonb_agg(jsonb_build_object('page_no', p.page_no, 'outcome', p.outcome, 'word_count', p.word_count,
                 'mean_confidence', p.mean_confidence, 'detail', p.detail) order by p.page_no), '[]'::jsonb)
          from ingest.ocr_page_results p where p.job_id = j.id) as pages
from ingest.ingestion_jobs j
join ingest.source_assets a on a.id = j.source_asset_id
where j.job_type = 'ocr';
grant select on api.ocr_jobs to authenticated;

-- The review queue gains the OCR page image and engine for the evidence pane.
-- Appended columns only, so existing selects keep working.
create or replace view api.review_queue with (security_invoker = true) as
select ri.id, ri.workspace_id, ri.item_type, ri.proposed, ri.conflicts, ri.status, ri.confidence,
       ri.reviewed_by, ri.reviewed_at, ri.decision_note, ri.created_at, ri.published_object_id,
       j.id as job_id, j.job_type, j.parser_version,
       a.id as source_asset_id, a.name as source_name, a.kind as source_kind, a.storage_bucket, a.storage_path, a.page_count,
       s.name as supplier_name,
       r.row_no, r.page_no, r.raw,
       (select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'value', f.value, 'confidence', f.confidence, 'region', f.region, 'source_text', f.source_text) order by f.field_key), '[]'::jsonb)
          from ingest.extracted_fields f where f.record_id = r.id) as fields,
       ri.task_type, ri.priority, ri.review_target_type, ri.review_target_key,
       op.image_path as ocr_image_path, op.width_px as ocr_width_px, op.height_px as ocr_height_px,
       op.mean_confidence as ocr_page_confidence, j.engine as ocr_engine, j.engine_version as ocr_engine_version
from ingest.review_items ri
left join ingest.ingestion_jobs j on j.id = ri.job_id
left join ingest.source_assets a on a.id = coalesce(ri.source_asset_id, j.source_asset_id)
left join merch.suppliers s on s.id = a.supplier_id
left join ingest.ingestion_records r on r.id = ri.record_id
left join ingest.ocr_page_results op on op.job_id = j.id and op.page_no = r.page_no;
grant select on api.review_queue to authenticated;
