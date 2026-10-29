-- TILE-4: reviewed backfill of pursuit classification from evidence already held.
--
-- Nothing here runs by itself. api.preview_classification_backfill() is a dry
-- run that reconciles every pursuit and dimension into:
--   known        one consistent value from the evidence, and the pursuit still says Unknown
--   already_set  the pursuit already holds exactly that value
--   conflicting  evidence disagrees with itself or with a value the pursuit holds
--   unmatched    evidence exists but does not map to a listed value
-- api.apply_classification_backfill() writes only the known rows, only while
-- the pursuit still says Unknown, and only when the caller confirms the count
-- they reviewed. A second run finds nothing left to write. Applying it to the
-- hosted database is a separate, explicitly authorised step.
--
-- Evidence, and what it is not:
--   buyer role    a visit linked to the inquiry by the matching rules (not a
--                 legacy link) or to the opportunity, recording customer_type;
--                 the contact's own customer_type only when that contact has
--                 exactly one pursuit (otherwise it says nothing about which one)
--   project use   opportunity.segment residential/commercial/hospitality/other;
--                 project.project_type residential/commercial/hospitality
--   work type     project.project_type renovation/new_build
--   GLC           no existing field records it. 'institutional' and 'fnb'
--                 segments are reported as unmatched, never mapped.
-- project_type 'other' was the value the system filled in when nobody chose
-- one, so it is not evidence of anything.

create function sales.classification_backfill_rows(p_workspace_id uuid)
returns table (pursuit_kind text, lead_id uuid, opportunity_id uuid, dimension text, current_value text,
  proposed_value text, outcome text, evidence jsonb)
language sql stable set search_path = '' as $$
  with p as (
    select x.* from sales.pursuits x where x.workspace_id = p_workspace_id
  ), contact_pursuits as (
    select p.contact_id, count(*) as n from p where p.contact_id is not null group by p.contact_id
  ), ev as (
    -- visits: the role stated at the counter for this pursuit
    select p.pursuit_kind, p.lead_id, p.opportunity_id, 'buyer_role'::text as dimension,
      v.customer_type as raw, core.classification_key('buyer_role', v.customer_type) as mapped,
      jsonb_build_object('source','visit','visit_id',v.id,'value',v.customer_type) as detail
    from p join sales.visits v on v.workspace_id = p.workspace_id
      and ((v.lead_id = p.lead_id and v.inquiry_link_state in ('linked','direct')) or (p.opportunity_id is not null and v.opportunity_id = p.opportunity_id))
    where nullif(btrim(v.customer_type),'') is not null
    union all
    -- the contact's own type, only when it can belong to one pursuit
    select p.pursuit_kind, p.lead_id, p.opportunity_id, 'buyer_role', c.customer_type,
      case when cp.n = 1 then core.classification_key('buyer_role', c.customer_type) end,
      jsonb_build_object('source','contact','contact_id',c.id,'value',c.customer_type,'contact_pursuits',cp.n)
    from p join identity.contacts c on c.id = p.contact_id and c.workspace_id = p.workspace_id
    join contact_pursuits cp on cp.contact_id = c.id
    where c.customer_type is not null
    union all
    select p.pursuit_kind, p.lead_id, p.opportunity_id, 'project_use', o.segment,
      case when o.segment in ('residential','commercial','hospitality','other') then o.segment end,
      jsonb_build_object('source','opportunity_segment','value',o.segment)
    from p join sales.opportunities o on o.id = p.opportunity_id where o.segment is not null
    union all
    select p.pursuit_kind, p.lead_id, p.opportunity_id,
      case when pr.project_type in ('renovation','new_build') then 'work_type' else 'project_use' end,
      pr.project_type,
      case when pr.project_type in ('residential','commercial','hospitality','renovation','new_build') then pr.project_type end,
      jsonb_build_object('source','project_type','project_id',pr.id,'value',pr.project_type)
    from p join identity.projects pr on pr.id = p.project_id and pr.workspace_id = p.workspace_id
    where pr.project_type is not null and pr.project_type <> 'other'
  ), grouped as (
    select ev.pursuit_kind, ev.lead_id, ev.opportunity_id, ev.dimension,
      array_agg(distinct ev.mapped) filter (where ev.mapped is not null and ev.mapped <> 'unknown') as mapped,
      jsonb_agg(ev.detail order by ev.detail->>'source', ev.detail->>'value') as evidence
    from ev group by 1,2,3,4
  )
  select g.pursuit_kind, g.lead_id, g.opportunity_id, g.dimension, cur.value,
    case when cardinality(g.mapped) = 1 then g.mapped[1] end,
    case
      when coalesce(cardinality(g.mapped),0) = 0 then 'unmatched'
      when cardinality(g.mapped) > 1 then 'conflicting'
      when cur.value = g.mapped[1] then 'already_set'
      when cur.value <> 'unknown' then 'conflicting'
      else 'known' end,
    g.evidence
  from grouped g
  join p on p.lead_id is not distinct from g.lead_id and p.opportunity_id is not distinct from g.opportunity_id
  cross join lateral (select case g.dimension when 'buyer_role' then p.buyer_role when 'project_use' then p.project_use
    when 'work_type' then p.work_type else p.glc_involvement end as value) cur
$$;
revoke all on function sales.classification_backfill_rows(uuid) from public, anon, authenticated;

create function api.preview_classification_backfill() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ws uuid := core.current_workspace_id(); v jsonb;
begin
  perform core.require_permission('settings.manage');
  perform core.require_workspace(ws);
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'known', count(*) filter (where r.outcome = 'known'),
      'already_set', count(*) filter (where r.outcome = 'already_set'),
      'conflicting', count(*) filter (where r.outcome = 'conflicting'),
      'unmatched', count(*) filter (where r.outcome = 'unmatched')),
    'rows', coalesce(jsonb_agg(to_jsonb(r) order by r.outcome, r.dimension, r.lead_id, r.opportunity_id), '[]'::jsonb))
  into v from sales.classification_backfill_rows(ws) r;
  return v;
end $$;
revoke all on function api.preview_classification_backfill() from public, anon;
grant execute on function api.preview_classification_backfill() to authenticated;

create function api.apply_classification_backfill(p_expected_known integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ws uuid := core.current_workspace_id(); r record; v_known integer; v_applied integer := 0; v_col text; v_rows integer;
begin
  perform core.require_permission('settings.manage');
  perform core.require_workspace(ws);
  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'Say who authorised this backfill and why (at least 5 characters)' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(ws::text || ':classification-backfill', 0));
  select count(*) into v_known from sales.classification_backfill_rows(ws) x where x.outcome = 'known';
  if p_expected_known is distinct from v_known then
    raise exception 'The dry run now finds % rows to write, not %. Preview again before applying.', v_known, p_expected_known using errcode = '40001';
  end if;
  for r in select * from sales.classification_backfill_rows(ws) x where x.outcome = 'known' order by x.lead_id, x.opportunity_id, x.dimension loop
    v_col := r.dimension;
    perform set_config('tile.classification_source', jsonb_build_object('backfill',true,'evidence',r.evidence)::text, true);
    if r.opportunity_id is not null then
      execute format('update sales.opportunities set %I = $1, classification_basis = %L, classification_note = $2 where id = $3 and workspace_id = $4 and %I = %L',
        v_col, 'backfill', v_col, 'unknown') using r.proposed_value, btrim(p_reason), r.opportunity_id, ws;
    else
      execute format('update sales.leads set %I = $1, classification_basis = %L, classification_note = $2 where id = $3 and workspace_id = $4 and %I = %L',
        v_col, 'backfill', v_col, 'unknown') using r.proposed_value, btrim(p_reason), r.lead_id, ws;
    end if;
    get diagnostics v_rows = row_count;
    v_applied := v_applied + v_rows;
  end loop;
  perform set_config('tile.classification_source', '', true);
  perform audit.emit(ws,'classification.backfill_applied','sales','leads',null,null,
    jsonb_build_object('applied',v_applied,'expected',p_expected_known),btrim(p_reason),'{}'::jsonb);
  return jsonb_build_object('applied', v_applied);
end $$;
revoke all on function api.apply_classification_backfill(integer,text) from public, anon;
grant execute on function api.apply_classification_backfill(integer,text) to authenticated;
