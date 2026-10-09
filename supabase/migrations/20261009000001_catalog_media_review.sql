-- TILE-23: imported catalogue media review, rights and coverage.
--
-- 1. Storage reads follow the row rules. tc_read_product_media (the policy loop
--    in 20260820000008_phase_enablement.sql) granted SELECT on every
--    product-media object to any workspace member, so a sales user who knew an
--    object path could sign or download an unreviewed corpus page, a file whose
--    rights were never cleared, or an archived attachment, although the
--    merch.product_media row itself was hidden from them. A reader without
--    catalog.write may now read only an object that an active, reviewed,
--    rights-cleared product_media row in the same workspace points at.
-- 2. Imported evidence (ingest.media_assets, ingest.media_asset_variant_links)
--    changes state only through the audited review functions below, never by a
--    direct update from the client.
-- 3. Neither a direct insert nor an update can turn an unreviewed or
--    unlicensed imported asset into reviewed catalogue media, and a primary
--    image must be an active, reviewed, rights-cleared image.
-- 4. Coverage is read from live data with its time, source and unknowns.

------------------------------------------------------------------------------
-- 1. Storage
------------------------------------------------------------------------------
create index if not exists product_media_object_idx on merch.product_media (storage_bucket, storage_path);

-- SECURITY DEFINER so the storage policy can consult merch.product_media
-- regardless of the caller's row visibility; it answers only "is this exact
-- object published", never anything about the row.
create or replace function core.product_media_object_published(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from merch.product_media m
    where m.storage_bucket = p_bucket and m.storage_path = p_name
      and m.workspace_id = core.storage_workspace_of(p_name)
      and m.archived_at is null and m.review_state = 'reviewed' and m.usage_rights_state = 'accepted')
$$;
revoke all on function core.product_media_object_published(text, text) from public;
grant execute on function core.product_media_object_published(text, text) to authenticated, service_role;

drop policy if exists tc_read_product_media on storage.objects;
create policy tc_read_product_media on storage.objects for select to authenticated
using (bucket_id = 'product-media'
  and core.storage_workspace_of(name) in (select core.member_workspace_ids())
  and ((select core.has_permission('catalog.write'))
       or core.product_media_object_published(bucket_id, name)));

------------------------------------------------------------------------------
-- 2. Imported evidence is reviewed through functions only
------------------------------------------------------------------------------
revoke insert, update, delete on ingest.media_assets, ingest.media_asset_variant_links from authenticated;
revoke insert, update, delete on api.media_assets, api.media_asset_variant_links from authenticated;

------------------------------------------------------------------------------
-- 3. Publication gates on merch.product_media
------------------------------------------------------------------------------
-- NOT VALID: enforced for every new or changed row; existing rows are reported
-- by api.catalog_media_coverage() rather than silently rewritten here.
alter table merch.product_media add constraint product_media_primary_gate check (
  not is_primary or (kind = 'image' and archived_at is null and review_state = 'reviewed' and usage_rights_state = 'accepted')
) not valid;

create or replace function merch.guard_imported_media_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if new.review_state <> 'reviewed' and not new.is_primary then return new; end if;
  -- The imported asset this row shows, by explicit reference or by object path.
  select m.usage_rights_state, m.review_state into a
  from ingest.media_assets m
  where m.workspace_id = new.workspace_id
    and (m.id = new.media_asset_id or (m.storage_bucket = new.storage_bucket and m.object_path = new.storage_path))
  order by (m.id = new.media_asset_id) desc nulls last
  limit 1;
  if found and (a.usage_rights_state <> 'accepted' or a.review_state <> 'approved') then
    raise exception 'imported media must have reviewed evidence and accepted usage rights before it is published (asset review %, rights %)',
      a.review_state, a.usage_rights_state using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function merch.guard_imported_media_publication() from public;

drop trigger if exists guard_imported_media_publication on merch.product_media;
create trigger guard_imported_media_publication before insert or update on merch.product_media
for each row execute function merch.guard_imported_media_publication();

------------------------------------------------------------------------------
-- 4. Review functions. Each takes the catalog.write gate, checks the
--    workspace, writes one append-only ingest.review_decisions row and an
--    audit event, in one transaction.
------------------------------------------------------------------------------

-- Withdraw published catalogue media made from an asset whose evidence or
-- rights no longer hold. The row and the original are retained.
create or replace function merch.withdraw_media_from_asset(p_media_asset_id uuid, p_rights text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  update merch.product_media
  set archived_at = now(), is_primary = false, review_state = 'conflicted',
      usage_rights_state = coalesce(p_rights, usage_rights_state)
  where media_asset_id = p_media_asset_id and archived_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function merch.withdraw_media_from_asset(uuid, text) from public;

-- Confirm what an imported image shows, or correct it to another variant.
-- A same-document association is discovery context and cannot itself be
-- approved, so confirming one records a new human manual_match link and
-- supersedes the old one; the old row is kept.
create or replace function api.confirm_media_association(p_link_id uuid, p_variant_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l ingest.media_asset_variant_links%rowtype;
  v merch.product_variants%rowtype;
  v_link uuid := p_link_id;
  v_decision text;
begin
  perform core.require_permission('catalog.write');
  select * into l from ingest.media_asset_variant_links where id = p_link_id for update;
  if not found then raise exception 'media link not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(l.workspace_id);
  if l.review_state in ('rejected', 'superseded') then
    raise exception 'this association was % and can no longer be confirmed', l.review_state using errcode = '23514';
  end if;
  if exists (select 1 from merch.product_media where media_asset_variant_link_id = l.id and archived_at is null) then
    raise exception 'this association is published in the catalogue; archive that image before changing it' using errcode = '23514';
  end if;

  select * into v from merch.product_variants where id = p_variant_id;
  if not found or v.workspace_id <> l.workspace_id then
    raise exception 'product variant not found in this workspace' using errcode = 'P0002';
  end if;

  if l.link_basis = 'same_source_document' then
    update ingest.media_asset_variant_links
    set review_state = 'superseded', reviewed_by = auth.uid(), reviewed_at = now()
    where id = l.id;
    insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id, review_target_key, decision, reason, reviewed_by)
    values (l.workspace_id, 'media_asset_variant_link', l.id, l.external_key, 'superseded', coalesce(p_note, 'Replaced by a human-confirmed match'), auth.uid());

    insert into ingest.media_asset_variant_links (workspace_id, media_asset_id, external_key, variant_candidate_key, variant_candidate_id,
      product_variant_id, source_code_raw, link_basis, link_basis_raw, source_region, page_number, confidence,
      review_state, reviewed_by, reviewed_at)
    values (l.workspace_id, l.media_asset_id, l.external_key || ':manual:' || gen_random_uuid(), l.variant_candidate_key, l.variant_candidate_id,
      p_variant_id, l.source_code_raw, 'manual_match', 'human_confirmed_from_same_source_document', l.source_region, l.page_number, null,
      'approved', auth.uid(), now())
    returning id into v_link;
    v_decision := 'corrected';
  else
    v_decision := case when l.product_variant_id is distinct from p_variant_id then 'corrected' else 'approved' end;
    update ingest.media_asset_variant_links
    set product_variant_id = p_variant_id, review_state = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = l.id;
  end if;

  insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id, review_target_key, decision, corrected_value, reason, reviewed_by)
  values (l.workspace_id, 'media_asset_variant_link', v_link, l.external_key, v_decision,
    case when v_decision = 'corrected' then jsonb_build_object('product_variant_id', p_variant_id, 'proposed_variant_id', l.product_variant_id, 'link_basis', l.link_basis) end,
    p_note, auth.uid());
  perform audit.emit(l.workspace_id, 'media_link.' || v_decision, 'ingest', 'media_asset_variant_links', v_link,
    jsonb_build_object('product_variant_id', l.product_variant_id, 'review_state', l.review_state, 'link_basis', l.link_basis),
    jsonb_build_object('product_variant_id', p_variant_id, 'review_state', 'approved'), p_note,
    jsonb_build_object('media_asset_id', l.media_asset_id, 'previous_link_id', case when v_link <> l.id then l.id end));
  return v_link;
end $$;
revoke all on function api.confirm_media_association(uuid, uuid, text) from public;
grant execute on function api.confirm_media_association(uuid, uuid, text) to authenticated;

create or replace function api.reject_media_association(p_link_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare l ingest.media_asset_variant_links%rowtype;
begin
  perform core.require_permission('catalog.write');
  if nullif(btrim(p_reason), '') is null then raise exception 'a reason is required to reject an association' using errcode = '23514'; end if;
  select * into l from ingest.media_asset_variant_links where id = p_link_id for update;
  if not found then raise exception 'media link not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(l.workspace_id);
  if l.review_state in ('rejected', 'superseded') then
    raise exception 'this association was already %', l.review_state using errcode = '23514';
  end if;
  if exists (select 1 from merch.product_media where media_asset_variant_link_id = l.id and archived_at is null) then
    raise exception 'this association is published in the catalogue; archive that image before rejecting it' using errcode = '23514';
  end if;
  update ingest.media_asset_variant_links set review_state = 'rejected', reviewed_by = auth.uid(), reviewed_at = now() where id = l.id;
  insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id, review_target_key, decision, reason, reviewed_by)
  values (l.workspace_id, 'media_asset_variant_link', l.id, l.external_key, 'rejected', p_reason, auth.uid());
  perform audit.emit(l.workspace_id, 'media_link.rejected', 'ingest', 'media_asset_variant_links', l.id,
    jsonb_build_object('review_state', l.review_state), jsonb_build_object('review_state', 'rejected'), p_reason,
    jsonb_build_object('media_asset_id', l.media_asset_id));
end $$;
revoke all on function api.reject_media_association(uuid, text) from public;
grant execute on function api.reject_media_association(uuid, text) to authenticated;

-- Usage rights are a separate decision from correctness, and always need a
-- stated basis. Rights never return to "unreviewed" once decided. Restricting
-- or denying withdraws any catalogue media made from the asset.
create or replace function api.review_media_rights(p_media_asset_id uuid, p_rights_state text, p_reason text)
returns int language plpgsql security definer set search_path = '' as $$
declare m ingest.media_assets%rowtype; v_withdrawn int := 0;
begin
  perform core.require_permission('catalog.write');
  if p_rights_state not in ('accepted', 'restricted', 'denied') then
    raise exception 'usage rights must be accepted, restricted or denied' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'state the basis for this usage-rights decision' using errcode = '23514';
  end if;
  select * into m from ingest.media_assets where id = p_media_asset_id for update;
  if not found then raise exception 'media asset not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(m.workspace_id);

  if p_rights_state <> 'accepted' then
    v_withdrawn := merch.withdraw_media_from_asset(m.id, p_rights_state);
  end if;
  update ingest.media_assets set usage_rights_state = p_rights_state where id = m.id;
  insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id, review_target_key, decision, corrected_value, reason, reviewed_by)
  values (m.workspace_id, 'media_asset_usage_rights', m.id, m.external_key,
    case when p_rights_state = 'accepted' then 'approved' else 'rejected' end,
    jsonb_build_object('usage_rights_state', p_rights_state, 'previous', m.usage_rights_state, 'withdrawn_catalogue_media', v_withdrawn),
    p_reason, auth.uid());
  perform audit.emit(m.workspace_id, 'media_asset.rights_reviewed', 'ingest', 'media_assets', m.id,
    jsonb_build_object('usage_rights_state', m.usage_rights_state), jsonb_build_object('usage_rights_state', p_rights_state), p_reason,
    jsonb_build_object('withdrawn_catalogue_media', v_withdrawn));
  return v_withdrawn;
end $$;
revoke all on function api.review_media_rights(uuid, text, text) from public;
grant execute on function api.review_media_rights(uuid, text, text) to authenticated;

-- Is the evidence itself usable (legible, the right page, not a duplicate)?
create or replace function api.review_media_asset(p_media_asset_id uuid, p_decision text, p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare m ingest.media_assets%rowtype; v_withdrawn int := 0;
begin
  perform core.require_permission('catalog.write');
  if p_decision not in ('approved', 'needs_correction', 'rejected') then
    raise exception 'decision must be approved, needs_correction or rejected' using errcode = '22023';
  end if;
  if p_decision <> 'approved' and nullif(btrim(p_note), '') is null then
    raise exception 'a reason is required unless the evidence is approved' using errcode = '23514';
  end if;
  select * into m from ingest.media_assets where id = p_media_asset_id for update;
  if not found then raise exception 'media asset not found' using errcode = 'P0002'; end if;
  perform core.require_workspace(m.workspace_id);

  if p_decision <> 'approved' then
    v_withdrawn := merch.withdraw_media_from_asset(m.id, null);
  end if;
  update ingest.media_assets set review_state = p_decision where id = m.id;
  insert into ingest.review_decisions (workspace_id, review_target_type, review_target_id, review_target_key, decision, corrected_value, reason, reviewed_by)
  values (m.workspace_id, 'media_asset', m.id, m.external_key,
    case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'deferred' end,
    jsonb_build_object('review_state', p_decision, 'previous', m.review_state, 'withdrawn_catalogue_media', v_withdrawn),
    p_note, auth.uid());
  perform audit.emit(m.workspace_id, 'media_asset.reviewed', 'ingest', 'media_assets', m.id,
    jsonb_build_object('review_state', m.review_state), jsonb_build_object('review_state', p_decision), p_note,
    jsonb_build_object('withdrawn_catalogue_media', v_withdrawn));
  return v_withdrawn;
end $$;
revoke all on function api.review_media_asset(uuid, text, text) from public;
grant execute on function api.review_media_asset(uuid, text, text) to authenticated;

-- Publication: the original function kept, with three corrections. It refused
-- nothing on a second publish of the same link, it set is_primary without
-- clearing the product's other primary, and it could make a PDF primary.
create or replace function api.publish_product_media(
  p_link_id uuid,
  p_alt_text text default null,
  p_sort_order int default 0,
  p_is_primary boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l ingest.media_asset_variant_links%rowtype;
  m ingest.media_assets%rowtype;
  v merch.product_variants%rowtype;
  v_kind text;
  v_id uuid;
begin
  perform core.require_permission('catalog.write');
  select * into l from ingest.media_asset_variant_links where id = p_link_id for update;
  if not found then raise exception 'media link not found'; end if;
  perform core.require_workspace(l.workspace_id);

  if l.review_state <> 'approved' or l.product_variant_id is null then
    raise exception 'this image is not a reviewed match for a variant yet' using errcode = '23514';
  end if;

  select * into m from ingest.media_assets where id = l.media_asset_id for update;
  if m.usage_rights_state <> 'accepted' then
    raise exception 'image usage rights are % — publication needs accepted rights', m.usage_rights_state
      using errcode = '23514';
  end if;
  if m.review_state <> 'approved' then
    raise exception 'the media asset itself has not been reviewed' using errcode = '23514';
  end if;
  if m.object_path is null or m.storage_bucket is null then
    raise exception 'this asset has no stored file to publish' using errcode = '23514';
  end if;
  if exists (select 1 from merch.product_media where media_asset_variant_link_id = l.id and archived_at is null) then
    raise exception 'this image is already published for that variant' using errcode = '23505';
  end if;

  select * into v from merch.product_variants where id = l.product_variant_id for update;
  perform 1 from merch.products where id = v.product_id for update;
  v_kind := case when m.mime_type = 'application/pdf' then 'pdf' else 'image' end;
  if p_is_primary and v_kind <> 'image' then
    raise exception 'only an image can be the primary catalogue image' using errcode = '23514';
  end if;

  insert into merch.product_media (workspace_id, product_id, variant_id, storage_bucket, storage_path,
                                   kind, caption, source_ref, is_primary, media_asset_id,
                                   media_asset_variant_link_id, usage_rights_state, review_state,
                                   alt_text, sort_order, reviewed_by, reviewed_at, mime_type, size_bytes)
  values (l.workspace_id, v.product_id, v.id, m.storage_bucket, m.object_path,
          v_kind, null,
          concat_ws(' · ', m.source_path, case when m.page_number is not null then 'page ' || m.page_number end),
          false, m.id, l.id, 'accepted', 'reviewed',
          nullif(btrim(p_alt_text), ''), coalesce(p_sort_order, 0), auth.uid(), now(), m.mime_type, m.size_bytes)
  returning id into v_id;
  if p_is_primary then
    update merch.product_media set is_primary = (id = v_id) where product_id = v.product_id and workspace_id = l.workspace_id;
  end if;

  perform audit.emit(l.workspace_id, 'product_media.published', 'merch', 'product_media', v_id, null,
    jsonb_build_object('media_asset_id', m.id, 'link_id', l.id, 'link_basis', l.link_basis, 'is_primary', p_is_primary), null, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function api.publish_product_media(uuid, text, int, boolean) from public;
grant execute on function api.publish_product_media(uuid, text, int, boolean) to authenticated;

------------------------------------------------------------------------------
-- 5. Read models
------------------------------------------------------------------------------
-- One row per association awaiting or carrying a decision, with the page it
-- came from. security_invoker: ingest RLS keeps it to source.import holders in
-- their own workspace.
create or replace view api.media_review_queue with (security_invoker = true) as
select l.id as link_id, l.workspace_id, l.review_state as link_state, l.link_basis, l.link_basis_raw, l.confidence,
       coalesce(l.page_number, m.page_number) as page_number, l.source_code_raw, l.variant_candidate_key,
       l.product_variant_id, pv.sku as variant_sku, pv.name as variant_name, p.id as product_id, p.name as product_name, p.code as product_code,
       l.reviewed_at as link_reviewed_at, l.reviewed_by as link_reviewed_by, l.created_at,
       m.id as media_asset_id, m.asset_kind, m.storage_bucket, m.object_path, m.mime_type, m.width_px, m.height_px,
       m.review_state as asset_state, m.usage_rights_state, m.source_path, m.source_web_url, m.brand_hint, m.document_class,
       parent.storage_bucket as page_bucket, parent.object_path as page_object_path, parent.page_number as parent_page_number,
       s.id as source_asset_id, s.name as source_name,
       pm.id as published_media_id, pm.is_primary as published_is_primary,
       (select d.reason from ingest.review_decisions d
         where d.review_target_type = 'media_asset_usage_rights' and d.review_target_id = m.id
         order by d.reviewed_at desc limit 1) as rights_basis
from ingest.media_asset_variant_links l
join ingest.media_assets m on m.id = l.media_asset_id
left join ingest.media_assets parent on parent.id = m.parent_media_asset_id
left join ingest.source_assets s on s.id = m.source_asset_id
left join merch.product_variants pv on pv.id = l.product_variant_id
left join merch.products p on p.id = pv.product_id
left join merch.product_media pm on pm.media_asset_variant_link_id = l.id and pm.archived_at is null;
grant select on api.media_review_queue to authenticated;

-- Live coverage. Every count is computed now from the caller's workspace;
-- "unknown" is kept separate from "no" (rights never reviewed is not a denial,
-- and a product with no imported evidence is not a product without images).
create or replace function api.catalog_media_coverage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ws uuid := core.current_workspace_id(); v jsonb;
begin
  perform core.require_permission('catalog.write');
  perform core.require_workspace(v_ws);
  with prod as (
    select p.id,
      exists (select 1 from merch.product_media pm where pm.product_id = p.id and pm.archived_at is null and pm.kind = 'image'
              and pm.review_state = 'reviewed' and pm.usage_rights_state = 'accepted') as has_image,
      exists (select 1 from merch.product_media pm where pm.product_id = p.id and pm.archived_at is null and pm.is_primary) as has_primary,
      exists (select 1 from merch.product_variants pv join ingest.media_asset_variant_links l on l.product_variant_id = pv.id
              where pv.product_id = p.id and l.review_state in ('pending_review','needs_correction','approved')) as has_evidence
    from merch.products p where p.workspace_id = v_ws and p.status <> 'archived'
  ), var as (
    select pv.id,
      exists (select 1 from merch.product_media pm where pm.variant_id = pv.id and pm.archived_at is null and pm.kind = 'image'
              and pm.review_state = 'reviewed' and pm.usage_rights_state = 'accepted') as has_image
    from merch.product_variants pv join merch.products p on p.id = pv.product_id
    where pv.workspace_id = v_ws and p.status <> 'archived'
  )
  select jsonb_build_object(
    'generated_at', now(),
    'workspace_id', v_ws,
    'source', 'Live database: merch.products, merch.product_variants, merch.product_media, ingest.media_assets, ingest.media_asset_variant_links, ingest.review_decisions, ingest.price_candidates',
    'products', jsonb_build_object(
      'total', (select count(*) from prod),
      'with_published_image', (select count(*) from prod where has_image),
      'with_primary_image', (select count(*) from prod where has_primary),
      'evidence_pending_only', (select count(*) from prod where not has_image and has_evidence),
      'no_known_evidence', (select count(*) from prod where not has_image and not has_evidence)),
    'variants', jsonb_build_object(
      'total', (select count(*) from var),
      'with_published_image', (select count(*) from var where has_image)),
    'media_assets', jsonb_build_object(
      'total', (select count(*) from ingest.media_assets where workspace_id = v_ws),
      'by_review_state', coalesce((select jsonb_object_agg(review_state, n) from (select review_state, count(*) n from ingest.media_assets where workspace_id = v_ws group by 1) x), '{}'::jsonb),
      'by_rights_state', coalesce((select jsonb_object_agg(usage_rights_state, n) from (select usage_rights_state, count(*) n from ingest.media_assets where workspace_id = v_ws group by 1) x), '{}'::jsonb),
      'last_imported_at', (select max(created_at) from ingest.media_assets where workspace_id = v_ws)),
    'associations', jsonb_build_object(
      'by_state', coalesce((select jsonb_object_agg(review_state, n) from (select review_state, count(*) n from ingest.media_asset_variant_links where workspace_id = v_ws group by 1) x), '{}'::jsonb),
      'pending_by_basis', coalesce((select jsonb_object_agg(link_basis, n) from (select link_basis, count(*) n from ingest.media_asset_variant_links where workspace_id = v_ws and review_state in ('pending_review','needs_correction') group by 1) x), '{}'::jsonb),
      'pending_without_variant', (select count(*) from ingest.media_asset_variant_links where workspace_id = v_ws and review_state in ('pending_review','needs_correction') and product_variant_id is null)),
    'catalogue_media', jsonb_build_object(
      'active_published', (select count(*) from merch.product_media where workspace_id = v_ws and archived_at is null and review_state = 'reviewed' and usage_rights_state = 'accepted'),
      'active_unreviewed', (select count(*) from merch.product_media where workspace_id = v_ws and archived_at is null and not (review_state = 'reviewed' and usage_rights_state = 'accepted')),
      'from_imported_evidence', (select count(*) from merch.product_media where workspace_id = v_ws and archived_at is null and media_asset_id is not null),
      'archived', (select count(*) from merch.product_media where workspace_id = v_ws and archived_at is not null),
      'primary_failing_gate', (select count(*) from merch.product_media where workspace_id = v_ws and is_primary
        and not (kind = 'image' and archived_at is null and review_state = 'reviewed' and usage_rights_state = 'accepted'))),
    'commercial_proposals', jsonb_build_object(
      'price_candidates_by_state', coalesce((select jsonb_object_agg(review_state, n) from (select review_state, count(*) n from ingest.price_candidates where workspace_id = v_ws group by 1) x), '{}'::jsonb),
      'review_items_pending', (select count(*) from ingest.review_items where workspace_id = v_ws and status = 'pending')),
    'last_media_decision_at', (select max(reviewed_at) from ingest.review_decisions where workspace_id = v_ws
      and review_target_type in ('media_asset','media_asset_usage_rights','media_asset_variant_link')),
    'sources', coalesce((select jsonb_agg(s order by (s->>'pending')::int desc, s->>'name') from (
      select jsonb_build_object('source_asset_id', sa.id, 'name', sa.name,
        'assets', count(distinct m.id),
        'rights_unknown', count(distinct m.id) filter (where m.usage_rights_state = 'unreviewed'),
        'pending', count(l.id) filter (where l.review_state in ('pending_review','needs_correction')),
        'approved', count(l.id) filter (where l.review_state = 'approved'),
        'rejected', count(l.id) filter (where l.review_state = 'rejected'),
        'published', count(pm.id)) as s
      from ingest.media_assets m
      join ingest.source_assets sa on sa.id = m.source_asset_id
      left join ingest.media_asset_variant_links l on l.media_asset_id = m.id
      left join merch.product_media pm on pm.media_asset_variant_link_id = l.id and pm.archived_at is null
      where m.workspace_id = v_ws
      group by sa.id, sa.name
      order by count(l.id) filter (where l.review_state in ('pending_review','needs_correction')) desc
      limit 50) z), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function api.catalog_media_coverage() from public;
grant execute on function api.catalog_media_coverage() to authenticated;
