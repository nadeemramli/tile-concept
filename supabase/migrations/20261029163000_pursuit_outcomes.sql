-- TILE-8: structured pursuit outcomes (loss, qualification rejection, deferral,
-- reopen and reason correction) shared by the Inquiry Inbox and the Pipeline.
--
-- What this replaces
--   * The inbox "lost" action wrote free text into sales.leads.disqualified_reason
--     and "reopen" nulled it, so the earlier loss reason only survived as an
--     activity body.
--   * api.change_opportunity_stage wrote one free-text outcome_reason for won,
--     lost and deferred, overwrote it on every close and left lost_at behind
--     on reopen.
--   * Rejection, spam, duplicate and genuine sales loss shared one lead status
--     with no way to tell them apart.
--
-- What this adds
--   1. core.outcome_reasons: one reason taxonomy for lost / rejected / deferred,
--      read by SQL, the inbox and the pipeline. Unknown is an explicit choice in
--      every set; Other always needs an explanation. The wording is a
--      configurable proposal (TILE-3), not an accepted business taxonomy.
--   2. sales.pursuit_outcome_events: an append-only history. One event per
--      business outcome at the pursuit grain: a lead and the opportunity that
--      closes with it are one event, so a linked closure counts once. Reopen
--      and correction append rows; nothing is updated or deleted.
--   3. api.pursuit_outcome_command(action, input, request_id): lose | reject |
--      defer | reopen | correct. Idempotent on request_id, locks lead before
--      opportunity, resolves outstanding reminders, writes the stage history,
--      the timeline and audit in the same transaction.
--   4. Guard triggers: an authenticated caller can no longer move a lead into
--      or out of a closed status, or an opportunity into or out of lost /
--      deferred, except through that command. This retires the free-text
--      api.work_inquiry('lost'|'reopen') path and the lost/deferred targets of
--      api.change_opportunity_stage without redefining either function, so the
--      forecast work (TILE-7) can keep redefining change_opportunity_stage.
--      Won and open-stage moves are unchanged.
--   5. api.pursuit_outcome_history (effective reason after corrections, reopen
--      marker, Asia/Kuala_Lumpur Monday week) and api.report_pursuit_outcomes
--      (weekly counts by outcome and reason, events and distinct pursuits,
--      quoted vs estimated-unquoted value kept apart). Reopen never removes an
--      earlier week's outcome.
--
-- Competitor relationship ("friendly competitor") is recorded neutrally and is
-- explicitly provisional: the business has not defined it, so neither a mutual
-- referral arrangement nor an existing customer relationship is asserted. A
-- reported relationship needs a description and an evidence quality.

------------------------------------------------------------------------------
-- 1. Reason taxonomy
------------------------------------------------------------------------------
create table core.outcome_reasons (
  outcome_type text not null check (outcome_type in ('lost','rejected','deferred')),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(btrim(label)) > 0),
  hint text not null check (length(btrim(hint)) >= 12),
  requires_detail boolean not null default false,
  is_competitor boolean not null default false,
  position int not null,
  is_active boolean not null default true,
  primary key (outcome_type, key),
  unique (outcome_type, position),
  check (not is_competitor or outcome_type = 'lost')
);
comment on table core.outcome_reasons is
  'Reason picklists for pursuit outcomes. Mirrored by src/lib/domain/outcome-reasons.ts; a unit test and a pgTAP test keep the two identical. Provisional wording (TILE-3), configurable by migration.';

insert into core.outcome_reasons (outcome_type, key, label, hint, requires_detail, is_competitor, position) values
  ('lost','price','Price or budget','The customer said price or their budget decided it against us.',false,false,1),
  ('lost','competitor','Awarded to another supplier','The customer chose another supplier. Name it only if known; an unnamed supplier stays Unknown. Any relationship with that supplier is recorded separately and provisionally.',false,true,2),
  ('lost','timing','Timing: the award is gone','Timing ended this pursuit for good, for example the order was placed before we could respond. If the customer is only not ready yet, defer with a review date instead.',false,false,3),
  ('lost','product_fit','Product, specification or availability','What we could offer did not fit the specification, design or delivery the customer needed.',false,false,4),
  ('lost','project_cancelled','Project cancelled by the customer','The customer''s project itself stopped, so nobody won it.',false,false,5),
  ('lost','customer_unresponsive','Customer stopped responding','Chosen by staff after deciding to close the pursuit. Recording No response never closes an inquiry by itself.',false,false,6),
  ('lost','unknown','Unknown','The reason is genuinely not known. Kept as its own bucket and never counted as any other reason.',false,false,7),
  ('lost','other','Other (explain)','None of the listed reasons fits. The explanation is required and kept with the outcome.',true,false,8),
  ('rejected','not_buying','Not a buying inquiry','Not someone looking to buy, for example a job seeker, supplier pitch or general question.',false,false,1),
  ('rejected','out_of_scope','Product or service we do not offer','A genuine request for something outside our range or services.',false,false,2),
  ('rejected','out_of_area','Outside our service area','The location is outside where we deliver or work.',false,false,3),
  ('rejected','spam','Spam or fake contact','Automated, abusive or fake details. Excluded from valid inquiries.',false,false,4),
  ('rejected','test','Test or internal entry','Created by staff to try the system. Excluded from valid inquiries.',false,false,5),
  ('rejected','duplicate','Duplicate of another inquiry','The same buying need is already being handled. Link the original inquiry or explain which one it duplicates.',false,false,6),
  ('rejected','unknown','Unknown','Rejected at qualification without a known reason. Kept explicit, never guessed.',false,false,7),
  ('rejected','other','Other (explain)','None of the listed reasons fits. The explanation is required.',true,false,8),
  ('deferred','timing','Customer not ready yet','The customer still intends to buy but not now. Review on the stated date.',false,false,1),
  ('deferred','budget_pending','Waiting on budget approval','The decision depends on budget the customer has not released yet.',false,false,2),
  ('deferred','awaiting_decision','Waiting on the customer''s design or project decision','A design, contractor or project decision has to happen first.',false,false,3),
  ('deferred','unknown','Unknown','Deferred without a stated reason. Kept explicit, never guessed.',false,false,4),
  ('deferred','other','Other (explain)','None of the listed reasons fits. The explanation is required.',true,false,5);

alter table core.outcome_reasons enable row level security;
create policy anyone_read on core.outcome_reasons for select to authenticated using (true);
grant select on core.outcome_reasons to authenticated;
grant all on core.outcome_reasons to service_role;
create view api.outcome_reasons with (security_invoker = true) as select * from core.outcome_reasons;
grant select on api.outcome_reasons to authenticated;
grant all on api.outcome_reasons to service_role;

------------------------------------------------------------------------------
-- 2. Append-only outcome history
------------------------------------------------------------------------------
create table sales.pursuit_outcome_events (
  id uuid primary key default gen_random_uuid(),
  -- Recording order. recorded_at can tie inside one transaction; seq cannot.
  seq bigint generated always as identity unique,
  workspace_id uuid not null references core.workspaces(id) on delete cascade,
  lead_id uuid references sales.leads(id),
  opportunity_id uuid references sales.opportunities(id),
  -- Whether this event changed the lead's / opportunity's current state.
  closes_lead boolean not null,
  closes_opportunity boolean not null,
  -- Counting identity: a lead and the opportunity that closed with it are one
  -- pursuit; an opportunity that closed alone is its own pursuit.
  pursuit_key uuid generated always as (
    case when opportunity_id is null or closes_lead or not closes_opportunity then coalesce(lead_id, opportunity_id) else opportunity_id end) stored,
  outcome_type text not null check (outcome_type in ('lost','rejected','deferred','reopened')),
  corrects_event_id uuid references sales.pursuit_outcome_events(id),
  reopens_event_id uuid references sales.pursuit_outcome_events(id),
  reason_set text generated always as (case when outcome_type <> 'reopened' then outcome_type end) stored,
  reason_code text,
  reason_detail text check (reason_detail is null or length(reason_detail) <= 2000),
  effective_date date not null,
  review_date date,
  competitor_name text check (competitor_name is null or length(btrim(competitor_name)) between 1 and 200),
  competitor_relationship text check (competitor_relationship in ('unknown','none_reported','reported')),
  competitor_relationship_detail text check (competitor_relationship_detail is null or length(competitor_relationship_detail) <= 2000),
  competitor_evidence text check (competitor_evidence in ('unverified','customer_stated','documented')),
  quoted_value numeric(14,2), quoted_currency char(3),
  estimated_value numeric(14,2), estimated_currency char(3),
  duplicate_of_lead_id uuid references sales.leads(id),
  review_task_id uuid references sales.tasks(id),
  prior_state jsonb not null default '{}'::jsonb,
  request_id uuid not null,
  command jsonb not null,
  result jsonb not null default '{}'::jsonb,
  actor_id uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (workspace_id, request_id),
  foreign key (reason_set, reason_code) references core.outcome_reasons(outcome_type, key),
  check (lead_id is not null or opportunity_id is not null),
  check ((outcome_type = 'reopened') = (reason_code is null)),
  check ((outcome_type = 'deferred') = (review_date is not null)),
  check (review_date is null or review_date >= effective_date),
  check (corrects_event_id is null or outcome_type <> 'reopened'),
  check (corrects_event_id is null or reopens_event_id is null),
  check (reopens_event_id is null or outcome_type = 'reopened'),
  check (competitor_relationship is distinct from 'reported'
         or (competitor_evidence is not null and length(btrim(coalesce(competitor_relationship_detail,''))) >= 3)),
  check (duplicate_of_lead_id is null or reason_code = 'duplicate'),
  check ((quoted_value is null) = (quoted_currency is null)),
  check ((estimated_value is null) = (estimated_currency is null))
);
create index pursuit_outcome_events_lead_idx on sales.pursuit_outcome_events (lead_id, seq desc) where lead_id is not null;
create index pursuit_outcome_events_opp_idx on sales.pursuit_outcome_events (opportunity_id, seq desc) where opportunity_id is not null;
create index pursuit_outcome_events_ws_date_idx on sales.pursuit_outcome_events (workspace_id, effective_date);
create index pursuit_outcome_events_corrects_idx on sales.pursuit_outcome_events (corrects_event_id) where corrects_event_id is not null;
create index pursuit_outcome_events_reopens_idx on sales.pursuit_outcome_events (reopens_event_id) where reopens_event_id is not null;
comment on table sales.pursuit_outcome_events is
  'Append-only pursuit outcome history (TILE-8). Reopen and reason correction add rows; earlier outcomes, reasons, actors and evidence are never changed.';
comment on column sales.pursuit_outcome_events.effective_date is 'Business date the outcome took effect (Asia/Kuala_Lumpur), stated by staff. recorded_at is when it was entered.';
comment on column sales.pursuit_outcome_events.competitor_relationship is 'Provisional, neutral: unknown | none_reported | reported. "Friendly competitor" is not defined by the business; a reported relationship is never asserted as a referral or customer relationship.';
comment on column sales.pursuit_outcome_events.quoted_value is 'Latest quotation total on the opportunity at the time of the outcome. Separate from estimated_value, which was never quoted.';

create function sales.protect_pursuit_outcome_events() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Pursuit outcome history is append-only. Record a correction or reopen instead.' using errcode = '42501';
end $$;
create trigger protect_pursuit_outcome_events before update or delete on sales.pursuit_outcome_events
for each row execute function sales.protect_pursuit_outcome_events();

alter table sales.pursuit_outcome_events enable row level security;
-- Readable when the reader can see the lead or the opportunity it belongs to.
-- The subqueries run under the reader's own RLS on those tables.
create policy member_read on sales.pursuit_outcome_events for select to authenticated using (
  workspace_id in (select core.member_workspace_ids())
  and (select core.has_permission('sales.read'))
  and (lead_id in (select l.id from sales.leads l) or opportunity_id in (select o.id from sales.opportunities o)));
grant select on sales.pursuit_outcome_events to authenticated;
grant all on sales.pursuit_outcome_events to service_role;
create view api.pursuit_outcome_events with (security_invoker = true) as select * from sales.pursuit_outcome_events;
grant select on api.pursuit_outcome_events to authenticated;
grant all on api.pursuit_outcome_events to service_role;

------------------------------------------------------------------------------
-- 3. Guard triggers: closed states change only through the outcome command
------------------------------------------------------------------------------
create function sales.guard_lead_outcome() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status is distinct from new.status
     and (old.status in ('disqualified','duplicate') or new.status in ('disqualified','duplicate'))
     and auth.role() = 'authenticated'
     and coalesce(current_setting('tile.pursuit_outcome', true), '') <> 'on' then
    raise exception 'Close or reopen an inquiry with Close inquiry / Reopen so its reason and effective date are kept'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function sales.guard_lead_outcome() from public, anon, authenticated;
create trigger guard_lead_outcome before update of status on sales.leads
for each row execute function sales.guard_lead_outcome();

create function sales.guard_opportunity_outcome() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status is distinct from new.status
     and (old.status in ('lost','deferred') or new.status in ('lost','deferred'))
     and auth.role() = 'authenticated'
     and coalesce(current_setting('tile.pursuit_outcome', true), '') <> 'on' then
    raise exception 'Record a loss, deferral or reopen with the outcome form so its reason and effective date are kept'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function sales.guard_opportunity_outcome() from public, anon, authenticated;
create trigger guard_opportunity_outcome before update of status on sales.opportunities
for each row execute function sales.guard_opportunity_outcome();

------------------------------------------------------------------------------
-- 4. The command
------------------------------------------------------------------------------
-- Effective outcome currently held by a lead or opportunity: the latest
-- non-correction event, if it has not been reopened.
create function sales.current_pursuit_outcome(p_lead_id uuid, p_opportunity_id uuid)
returns sales.pursuit_outcome_events language sql stable set search_path = '' as $$
  select e.* from sales.pursuit_outcome_events e
  where e.corrects_event_id is null
    and ((p_lead_id is not null and e.lead_id = p_lead_id and e.closes_lead)
      or (p_opportunity_id is not null and e.opportunity_id = p_opportunity_id and e.closes_opportunity))
  order by e.seq desc limit 1
$$;
revoke all on function sales.current_pursuit_outcome(uuid,uuid) from public, anon, authenticated;

create function api.pursuit_outcome_command(p_action text, p_input jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_input jsonb := coalesce(p_input, '{}'::jsonb);
  v_command jsonb;
  v_ws uuid;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_lead_id uuid := nullif(v_input->>'lead_id','')::uuid;
  v_opp_id uuid := nullif(v_input->>'opportunity_id','')::uuid;
  l sales.leads%rowtype;
  o sales.opportunities%rowtype;
  v_has_lead boolean := false;
  v_has_opp boolean := false;
  v_other_active int := 0;
  v_existing sales.pursuit_outcome_events%rowtype;
  v_target sales.pursuit_outcome_events%rowtype;
  r core.outcome_reasons%rowtype;
  v_type text;
  v_code text := nullif(btrim(v_input->>'reason_code'),'');
  v_detail text := nullif(btrim(v_input->>'reason_detail'),'');
  v_effective date;
  v_review date;
  v_comp_name text := nullif(btrim(v_input->>'competitor_name'),'');
  v_comp_rel text := nullif(v_input->>'competitor_relationship','');
  v_comp_rel_detail text := nullif(btrim(v_input->>'competitor_relationship_detail'),'');
  v_comp_evidence text := nullif(v_input->>'competitor_evidence','');
  v_dup uuid := nullif(v_input->>'duplicate_of_lead_id','')::uuid;
  v_next_at timestamptz;
  v_next_action text := nullif(btrim(v_input->>'next_action'),'');
  v_stage core.opportunity_stages%rowtype;
  v_from_stage core.opportunity_stages%rowtype;
  v_closes_lead boolean := false;
  v_closes_opp boolean := false;
  v_prior jsonb := '{}'::jsonb;
  v_quoted numeric; v_quoted_cur char(3);
  v_est numeric; v_est_cur char(3);
  v_task uuid;
  v_event uuid := gen_random_uuid();
  v_label text;
  v_reason_text text;
  v_result jsonb;
  v_subject text;
  v_from_lead boolean := nullif(v_input->>'lead_id','') is not null;
  v_corrects uuid;
  v_reopens uuid;
begin
  perform core.require_permission('sales.write');
  if p_request_id is null then raise exception 'Request ID is required' using errcode = '22023'; end if;
  if p_action is null or p_action not in ('lose','reject','defer','reopen','correct') then
    raise exception 'Unknown outcome action' using errcode = '22023';
  end if;
  v_command := jsonb_build_object('action', p_action, 'input', v_input);

  -- A correction names the event; its lead/opportunity come from that event.
  if p_action = 'correct' then
    select * into v_target from sales.pursuit_outcome_events where id = nullif(v_input->>'event_id','')::uuid;
    if not found then raise exception 'Outcome not found' using errcode = 'P0002'; end if;
    v_lead_id := v_target.lead_id; v_opp_id := v_target.opportunity_id;
  end if;

  -- Lock order: lead, then opportunity (matches api.work_inquiry and task completion).
  if v_lead_id is null and v_opp_id is not null and p_action <> 'correct' then
    select lead_id into v_lead_id from sales.opportunities where id = v_opp_id;
  end if;
  if v_lead_id is not null then
    select * into l from sales.leads where id = v_lead_id for update;
    if not found then raise exception 'Inquiry not found' using errcode = 'P0002'; end if;
    v_has_lead := true;
    v_ws := l.workspace_id;
  end if;
  if v_opp_id is null and v_has_lead and p_action <> 'correct' then
    -- Started from the inquiry: its one active opportunity closes with it.
    select count(*) into v_other_active from sales.opportunities
      where lead_id = l.id and workspace_id = l.workspace_id and archived_at is null and status in ('open','deferred');
    if v_other_active > 1 and p_action in ('lose','defer') then
      raise exception 'This inquiry has % active opportunities. Close each one from Pipeline.', v_other_active using errcode = '23514';
    end if;
    if p_action = 'reopen' then
      select * into v_target from sales.current_pursuit_outcome(l.id, null);
      v_opp_id := case when v_target.id is not null and v_target.closes_opportunity then v_target.opportunity_id end;
    elsif v_other_active = 1 then
      select id into v_opp_id from sales.opportunities
        where lead_id = l.id and workspace_id = l.workspace_id and archived_at is null and status in ('open','deferred');
    end if;
  end if;
  if v_opp_id is not null then
    select * into o from sales.opportunities where id = v_opp_id for update;
    if not found then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
    if v_has_lead and o.lead_id is distinct from l.id and p_action <> 'correct' then
      raise exception 'Opportunity changed. Refresh and try again.' using errcode = '40001';
    end if;
    if v_ws is not null and o.workspace_id <> v_ws then raise exception 'Opportunity not found' using errcode = 'P0002'; end if;
    v_has_opp := true;
    v_ws := o.workspace_id;
  end if;
  if v_ws is null then raise exception 'Choose an inquiry or opportunity' using errcode = '22023'; end if;
  perform core.require_workspace(v_ws);
  if v_has_lead then perform sales.require_lead_owner(l); end if;
  if v_has_opp and not core.has_permission('sales.read_all') and o.owner_id is not null and o.owner_id <> auth.uid() then
    raise exception 'permission denied: not the owner' using errcode = '42501';
  end if;

  -- Idempotency: a retry returns the original result; a changed retry is refused.
  select * into v_existing from sales.pursuit_outcome_events where workspace_id = v_ws and request_id = p_request_id;
  if found then
    if v_existing.command is distinct from v_command then
      raise exception 'Request ID already used for a different action' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  if v_has_opp and o.archived_at is not null then
    raise exception 'Restore the opportunity before changing it' using errcode = '23514';
  end if;

  ----------------------------------------------------------------------------
  -- Validate the reason fields shared by lose / reject / defer / correct.
  ----------------------------------------------------------------------------
  v_type := case p_action when 'lose' then 'lost' when 'reject' then 'rejected' when 'defer' then 'deferred'
                          when 'correct' then v_target.outcome_type else 'reopened' end;
  if p_action = 'correct' and (v_target.outcome_type = 'reopened' or v_target.corrects_event_id is not null) then
    raise exception 'Only a loss, rejection or deferral can be corrected' using errcode = '23514';
  end if;
  if length(coalesce(v_input->>'reason_detail','')) > 2000 then raise exception 'Explanation is too long' using errcode = '22023'; end if;

  if p_action = 'reopen' then
    if v_code is not null or v_comp_name is not null or v_comp_rel is not null or v_dup is not null or nullif(v_input->>'review_date','') is not null then
      raise exception 'A reopen records why, not a reason code' using errcode = '22023';
    end if;
  else
    if v_code is null then
      raise exception 'Choose a reason. Use Unknown when the reason is not known.' using errcode = '23514';
    end if;
    select * into r from core.outcome_reasons where outcome_type = v_type and key = v_code and is_active;
    if not found then raise exception 'Choose a listed reason' using errcode = '23514'; end if;
    if r.requires_detail and length(coalesce(v_detail,'')) < 3 then
      raise exception 'Explain the reason (at least 3 characters)' using errcode = '23514';
    end if;
    begin
      v_effective := (v_input->>'effective_date')::date;
      v_review := (v_input->>'review_date')::date;
    exception when others then
      raise exception 'Enter valid dates' using errcode = '22023';
    end;
    if v_effective is null then raise exception 'Enter the date the outcome took effect' using errcode = '23514'; end if;
    if v_effective > v_today or v_effective < date '2020-01-01' then
      raise exception 'The effective date cannot be in the future' using errcode = '23514';
    end if;
    if v_type = 'deferred' then
      if v_review is null then raise exception 'Choose a review date for the deferral' using errcode = '23514'; end if;
      if v_review < v_effective or (p_action = 'defer' and v_review < v_today) then
        raise exception 'The review date must be today or later' using errcode = '23514';
      end if;
    elsif v_review is not null then
      raise exception 'Only a deferral has a review date' using errcode = '23514';
    end if;
    if r.is_competitor then
      if v_comp_rel is null then
        raise exception 'State the relationship with the supplier, or choose Unknown' using errcode = '23514';
      end if;
      if v_comp_rel not in ('unknown','none_reported','reported') then raise exception 'Choose a listed relationship' using errcode = '22023'; end if;
      if v_comp_rel = 'reported' then
        if length(coalesce(v_comp_rel_detail,'')) < 3 then
          raise exception 'Describe the reported relationship (at least 3 characters)' using errcode = '23514';
        end if;
        if v_comp_evidence is null or v_comp_evidence not in ('unverified','customer_stated','documented') then
          raise exception 'State how the relationship is known' using errcode = '23514';
        end if;
      elsif v_comp_rel_detail is not null or v_comp_evidence is not null then
        raise exception 'Relationship detail is only recorded for a reported relationship' using errcode = '23514';
      end if;
    elsif v_comp_name is not null or v_comp_rel is not null or v_comp_rel_detail is not null or v_comp_evidence is not null then
      raise exception 'Supplier details are only recorded when the award went to another supplier' using errcode = '23514';
    end if;
    if v_code = 'duplicate' then
      if v_dup is null and length(coalesce(v_detail,'')) < 3 then
        raise exception 'Link the original inquiry or explain which inquiry this duplicates' using errcode = '23514';
      end if;
      if v_dup is not null and (v_dup = l.id or not exists(select 1 from sales.leads where id = v_dup and workspace_id = v_ws)) then
        raise exception 'Choose another inquiry in this workspace as the original' using errcode = '23514';
      end if;
    elsif v_dup is not null then
      raise exception 'Only a duplicate links an original inquiry' using errcode = '23514';
    end if;
    v_label := r.label;
    v_reason_text := v_label || coalesce(': ' || v_detail, '');
  end if;

  perform set_config('tile.pursuit_outcome', 'on', true);

  ----------------------------------------------------------------------------
  -- lose / reject / defer
  ----------------------------------------------------------------------------
  if p_action in ('lose','reject','defer') then
    if v_has_lead and l.status in ('disqualified','duplicate') then
      if not v_has_opp or p_action = 'reject' then
        raise exception 'This inquiry is already closed. Reopen it first.' using errcode = '23514';
      end if;
    end if;
    if v_has_opp and o.status = 'won' then
      raise exception 'This opportunity is won. Move its stage back before recording another outcome.' using errcode = '23514';
    elsif v_has_opp and o.status not in ('open','deferred') then
      raise exception 'This opportunity is already %. Reopen it first.', o.status using errcode = '23514';
    end if;
    if p_action = 'reject' then
      if not v_has_lead then raise exception 'Qualification rejection applies to an inquiry. Record a loss for an opportunity.' using errcode = '23514'; end if;
      if v_has_opp or exists(select 1 from sales.opportunities where lead_id = l.id and archived_at is null and status in ('open','deferred')) then
        raise exception 'This inquiry already has an active opportunity. Record a sales loss or archive the opportunity instead.' using errcode = '23514';
      end if;
    end if;

    -- A lead closes with the opportunity only when no other active opportunity remains.
    v_closes_opp := v_has_opp;
    v_closes_lead := v_has_lead and l.status not in ('disqualified','duplicate')
      and not exists(select 1 from sales.opportunities x where x.lead_id = l.id and x.archived_at is null
                     and x.status in ('open','deferred') and x.id is distinct from v_opp_id);
    if p_action = 'defer' and v_has_lead and not v_has_opp then v_closes_lead := true; end if;

    if v_has_lead then v_prior := v_prior || jsonb_build_object('lead_status', l.status, 'lead_reason', l.disqualified_reason); end if;
    if v_has_opp then
      v_prior := v_prior || jsonb_build_object('stage_key', o.stage_key, 'opportunity_status', o.status,
        'outcome_reason', o.outcome_reason, 'deferred_until', o.deferred_until, 'next_action', o.next_action, 'next_action_due_at', o.next_action_due_at);
      -- Value at stake, kept apart: the latest quotation total versus an estimate that was never quoted.
      select v.total_amount, v.currency into v_quoted, v_quoted_cur
      from sales.quotes q join sales.quote_versions v on v.quote_id = q.id and v.version_no = q.current_version_no
      where q.opportunity_id = o.id and v.total_amount is not null
      order by v.issued_at desc nulls last, v.created_at desc limit 1;
      if o.estimated_value is not null then v_est := o.estimated_value; v_est_cur := o.currency; end if;
    end if;

    -- Outstanding reminders are resolved once, with the reason, and kept in history.
    update sales.tasks set status = 'cancelled', completed_at = now(),
      outcome = case v_type when 'lost' then 'Pursuit lost: ' when 'rejected' then 'Inquiry rejected: ' else 'Deferred to ' || v_review::text || ': ' end || v_reason_text
    where workspace_id = v_ws and status = 'open'
      and ((v_closes_lead and lead_id = l.id) or (v_closes_opp and opportunity_id = o.id));

    if v_type = 'deferred' then
      insert into sales.tasks (workspace_id, title, description, due_at, assignee_id, lead_id, opportunity_id, contact_id, account_id, project_id, created_by)
      values (v_ws,
        'Review deferred ' || case when v_closes_opp then 'opportunity: ' || o.name else 'inquiry: ' || coalesce(nullif(l.raw_name,''), nullif(l.raw_company,''), 'customer') end,
        v_reason_text, (v_review::timestamp + interval '10 hours') at time zone 'Asia/Kuala_Lumpur',
        coalesce(case when v_closes_opp then o.owner_id end, case when v_has_lead then l.owner_id end, auth.uid()),
        case when v_closes_lead then l.id end, case when v_closes_opp then o.id end,
        coalesce(case when v_closes_opp then o.contact_id end, case when v_has_lead then l.contact_id end),
        case when v_closes_opp then o.account_id end, case when v_closes_opp then o.project_id end, auth.uid())
      returning id into v_task;
    end if;

    if v_closes_lead and v_type <> 'deferred' then
      update sales.leads set status = case when v_code = 'duplicate' then 'duplicate' else 'disqualified' end,
        disqualified_reason = v_reason_text, no_next_action_reason = null,
        duplicate_of_lead_id = case when v_code = 'duplicate' then coalesce(v_dup, duplicate_of_lead_id) else duplicate_of_lead_id end
      where id = l.id;
    elsif v_closes_lead then
      update sales.leads set no_next_action_reason = null where id = l.id;
    end if;

    if v_closes_opp then
      select * into v_stage from core.opportunity_stages
        where workspace_id = v_ws and is_active and reporting_group = case when v_type = 'deferred' then 'deferred' else 'lost' end
        order by position limit 1;
      if not found then raise exception 'No active % stage is configured for this workspace', v_type using errcode = '23514'; end if;
      select * into v_from_stage from core.opportunity_stages where workspace_id = v_ws and key = o.stage_key;
      update sales.opportunities set stage_key = v_stage.key, status = v_stage.reporting_group,
        lost_at = case when v_type = 'lost' then (v_effective::timestamp + interval '12 hours') at time zone 'Asia/Kuala_Lumpur' else null end,
        deferred_until = case when v_type = 'deferred' then v_review else null end,
        outcome_reason = v_reason_text,
        next_action = case when v_type = 'deferred' then 'Review deferred opportunity' else next_action end,
        next_action_due_at = case when v_type = 'deferred' then (v_review::timestamp + interval '10 hours') at time zone 'Asia/Kuala_Lumpur' else next_action_due_at end
      where id = o.id;
      if v_stage.key is distinct from o.stage_key then
        insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, is_backward, reason, actor_id)
        values (v_ws, o.id, o.stage_key, v_stage.key, false, v_reason_text, auth.uid());
      end if;
    end if;

    v_subject := case v_type when 'lost' then 'Pursuit lost' when 'rejected' then 'Inquiry rejected at qualification' else 'Pursuit deferred to ' || to_char(v_review, 'DD Mon YYYY') end
      || ': ' || v_label;

  ----------------------------------------------------------------------------
  -- reopen: the latest held outcome becomes history; current state is active.
  ----------------------------------------------------------------------------
  elsif p_action = 'reopen' then
    if v_target.id is null then
      select * into v_target from sales.current_pursuit_outcome(case when v_has_lead then l.id end, case when v_has_opp then o.id end);
    end if;
    -- A held outcome is current only while the record is still in the state it set.
    if v_target.id is not null and not (
         (v_target.closes_opportunity and v_has_opp and v_target.opportunity_id = o.id and o.status in ('lost','deferred'))
      or (v_target.closes_lead and v_has_lead and v_target.lead_id = l.id
          and (l.status in ('disqualified','duplicate') or v_target.outcome_type = 'deferred'))) then
      v_target := null;
    end if;
    if v_target.id is not null and exists(select 1 from sales.pursuit_outcome_events where reopens_event_id = v_target.id) then
      v_target := null;
    end if;
    -- From the inquiry: reopen it. From the opportunity: reopen the inquiry only
    -- when the same outcome closed both.
    v_closes_lead := v_has_lead and ((v_from_lead and l.status in ('disqualified','duplicate'))
      or (v_target.id is not null and v_target.closes_lead and v_target.lead_id = l.id));
    v_closes_opp := v_has_opp and o.status in ('lost','deferred');
    if not v_closes_lead and not v_closes_opp then
      raise exception 'Nothing to reopen: this pursuit is already active' using errcode = '23514';
    end if;
    if length(coalesce(v_detail,'')) < 3 then
      raise exception 'Record why the pursuit is reopened (at least 3 characters)' using errcode = '23514';
    end if;
    begin
      v_next_at := (v_input->>'next_follow_up_at')::timestamptz;
      v_effective := coalesce((v_input->>'effective_date')::date, v_today);
    exception when others then
      raise exception 'Enter valid dates' using errcode = '22023';
    end;
    if v_effective > v_today then raise exception 'The effective date cannot be in the future' using errcode = '23514'; end if;
    if v_next_at is null or not isfinite(v_next_at) then
      raise exception 'Choose the next follow-up date and time' using errcode = '23514';
    end if;
    if v_closes_opp and v_next_action is null then
      raise exception 'Enter the next action for the reopened opportunity' using errcode = '23514';
    end if;

    if v_has_lead then v_prior := v_prior || jsonb_build_object('lead_status', l.status, 'lead_reason', l.disqualified_reason); end if;
    if v_has_opp then v_prior := v_prior || jsonb_build_object('stage_key', o.stage_key, 'opportunity_status', o.status, 'outcome_reason', o.outcome_reason,
      'lost_at', o.lost_at, 'deferred_until', o.deferred_until); end if;

    -- Close the deferral's own review reminder; the new follow-up replaces it.
    update sales.tasks set status = 'cancelled', completed_at = now(), outcome = 'Pursuit reopened: ' || v_detail
    where workspace_id = v_ws and status = 'open'
      and ((v_closes_lead and lead_id = l.id) or (v_closes_opp and opportunity_id = o.id));

    if v_closes_lead and l.status in ('disqualified','duplicate') then
      update sales.leads set
        status = case
          when v_target.prior_state->>'lead_status' in ('new','contact_attempted','contacted','qualified','converted') then v_target.prior_state->>'lead_status'
          when converted_opportunity_id is not null then 'converted'
          when first_customer_reply_at is not null then 'contacted'
          when first_response_at is not null then 'contact_attempted' else 'new' end,
        disqualified_reason = null, no_next_action_reason = null
      where id = l.id;
    end if;

    if v_closes_opp then
      select * into v_stage from core.opportunity_stages
        where workspace_id = v_ws and is_active and reporting_group = 'open'
          and key = coalesce(nullif(v_input->>'stage_key',''), v_target.prior_state->>'stage_key');
      if not found then
        if nullif(v_input->>'stage_key','') is not null then raise exception 'Choose an active open stage' using errcode = '23514'; end if;
        select * into v_stage from core.opportunity_stages where workspace_id = v_ws and is_active and reporting_group = 'open' order by position limit 1;
      end if;
      update sales.opportunities set stage_key = v_stage.key, status = 'open', lost_at = null, deferred_until = null,
        outcome_reason = null, next_action = v_next_action, next_action_due_at = v_next_at
      where id = o.id;
      insert into sales.opportunity_stage_events (workspace_id, opportunity_id, from_stage_key, to_stage_key, is_backward, reason, actor_id)
      values (v_ws, o.id, o.stage_key, v_stage.key, true, 'Reopened: ' || v_detail, auth.uid());
    end if;

    insert into sales.tasks (workspace_id, title, due_at, assignee_id, lead_id, opportunity_id, contact_id, account_id, project_id, created_by)
    values (v_ws,
      coalesce(case when v_closes_opp then v_next_action end, 'Follow up with ' || coalesce(nullif(l.raw_name,''), nullif(l.raw_company,''), 'customer')),
      v_next_at, coalesce(case when v_closes_opp then o.owner_id end, case when v_has_lead then l.owner_id end, auth.uid()),
      case when v_closes_lead then l.id end, case when v_closes_opp then o.id end,
      coalesce(case when v_has_opp then o.contact_id end, case when v_has_lead then l.contact_id end),
      case when v_has_opp then o.account_id end, case when v_has_opp then o.project_id end, auth.uid())
    returning id into v_task;

    v_reopens := v_target.id;
    v_subject := 'Pursuit reopened';
    v_reason_text := v_detail;

  ----------------------------------------------------------------------------
  -- correct: a superseding reason for an earlier outcome; one outcome, not two.
  ----------------------------------------------------------------------------
  else
    if length(coalesce(nullif(btrim(v_input->>'correction_note'),''),'')) < 3 then
      raise exception 'Record why the outcome is corrected (at least 3 characters)' using errcode = '23514';
    end if;
    if v_target.outcome_type = 'rejected' and (v_code = 'duplicate') <> (v_target.reason_code = 'duplicate') then
      raise exception 'Reopen and close again to change between duplicate and another rejection' using errcode = '23514';
    end if;
    v_closes_lead := v_target.closes_lead; v_closes_opp := v_target.closes_opportunity;
    v_corrects := v_target.id;
    v_quoted := v_target.quoted_value; v_quoted_cur := v_target.quoted_currency;
    v_est := v_target.estimated_value; v_est_cur := v_target.estimated_currency;
    v_task := v_target.review_task_id;
    v_prior := jsonb_build_object('correction_note', btrim(v_input->>'correction_note'),
      'reason_code', v_target.reason_code, 'effective_date', v_target.effective_date, 'review_date', v_target.review_date);
    -- Current-state columns follow the correction only while that outcome is still held.
    if not exists(select 1 from sales.pursuit_outcome_events where reopens_event_id = v_target.id)
       and (select id from sales.current_pursuit_outcome(v_target.lead_id, v_target.opportunity_id)) = v_target.id then
      if v_has_lead and v_closes_lead and l.status in ('disqualified','duplicate') then
        update sales.leads set disqualified_reason = v_reason_text,
          duplicate_of_lead_id = case when v_code = 'duplicate' then coalesce(v_dup, duplicate_of_lead_id) else duplicate_of_lead_id end
        where id = l.id;
      end if;
      if v_has_opp and v_closes_opp and o.status in ('lost','deferred') then
        update sales.opportunities set outcome_reason = v_reason_text,
          lost_at = case when o.status = 'lost' then (v_effective::timestamp + interval '12 hours') at time zone 'Asia/Kuala_Lumpur' else lost_at end,
          deferred_until = case when o.status = 'deferred' then v_review else deferred_until end
        where id = o.id;
      end if;
      if v_target.outcome_type = 'deferred' and v_target.review_task_id is not null then
        update sales.tasks set due_at = (v_review::timestamp + interval '10 hours') at time zone 'Asia/Kuala_Lumpur'
        where id = v_target.review_task_id and status = 'open';
      end if;
    end if;
    v_subject := 'Outcome reason corrected: ' || v_label;
    v_reason_text := v_reason_text || ' (' || btrim(v_input->>'correction_note') || ')';
  end if;

  v_result := jsonb_build_object('event_id', v_event, 'action', p_action, 'outcome_type', v_type,
    'lead_id', case when v_has_lead then l.id end, 'opportunity_id', case when v_has_opp then o.id end,
    'closes_lead', v_closes_lead, 'closes_opportunity', v_closes_opp, 'task_id', v_task);
  insert into sales.pursuit_outcome_events (id, workspace_id, lead_id, opportunity_id, closes_lead, closes_opportunity, outcome_type,
    corrects_event_id, reopens_event_id, reason_code, reason_detail, effective_date, review_date, competitor_name, competitor_relationship,
    competitor_relationship_detail, competitor_evidence, quoted_value, quoted_currency, estimated_value, estimated_currency,
    duplicate_of_lead_id, review_task_id, prior_state, request_id, command, result, actor_id)
  values (v_event, v_ws, case when v_has_lead then l.id end, case when v_has_opp then o.id end, v_closes_lead, v_closes_opp, v_type,
    v_corrects, v_reopens, v_code, v_detail, v_effective, v_review, v_comp_name, v_comp_rel, v_comp_rel_detail, v_comp_evidence,
    v_quoted, v_quoted_cur, v_est, v_est_cur, v_dup, v_task, v_prior, p_request_id, v_command, v_result, auth.uid());

  insert into sales.activities (workspace_id, kind, subject, body, occurred_at, actor_id, lead_id, opportunity_id, contact_id, account_id, project_id, request_id, metadata)
  values (v_ws, case when v_has_opp then 'stage_change' else 'note' end, v_subject, v_reason_text, now(), auth.uid(),
    case when v_has_lead then l.id end, case when v_has_opp then o.id end,
    coalesce(case when v_has_opp then o.contact_id end, case when v_has_lead then l.contact_id end),
    case when v_has_opp then o.account_id end, case when v_has_opp then o.project_id end, p_request_id,
    jsonb_build_object('event', 'pursuit_outcome', 'outcome_event_id', v_event, 'action', p_action, 'outcome_type', v_type,
      'reason_code', v_code, 'effective_date', v_effective, 'review_date', v_review));
  perform audit.emit(v_ws, 'pursuit.' || p_action, 'sales', 'pursuit_outcome_events', v_event, v_prior, v_result, v_reason_text,
    jsonb_build_object('lead_id', case when v_has_lead then l.id end, 'opportunity_id', case when v_has_opp then o.id end));
  -- The bypass lasts for this command only, not the rest of the caller's transaction.
  perform set_config('tile.pursuit_outcome', '', true);
  return v_result;
end $$;
revoke all on function api.pursuit_outcome_command(text,jsonb,uuid) from public, anon;
grant execute on function api.pursuit_outcome_command(text,jsonb,uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- 5. Read models
------------------------------------------------------------------------------
-- One row per outcome (loss, rejection, deferral). The reason shown is the
-- latest correction; reopened_at marks a later reopen without hiding the row.
create view api.pursuit_outcome_history with (security_invoker = true) as
select e.id, e.workspace_id, e.lead_id, e.opportunity_id, e.pursuit_key, e.closes_lead, e.closes_opportunity, e.outcome_type,
  coalesce(c.reason_code, e.reason_code) as reason_code,
  case when c.id is not null then c.reason_detail else e.reason_detail end as reason_detail,
  coalesce(c.effective_date, e.effective_date) as effective_date,
  date_trunc('week', coalesce(c.effective_date, e.effective_date)::timestamp)::date as effective_week,
  case when c.id is not null then c.review_date else e.review_date end as review_date,
  case when c.id is not null then c.competitor_name else e.competitor_name end as competitor_name,
  case when c.id is not null then c.competitor_relationship else e.competitor_relationship end as competitor_relationship,
  case when c.id is not null then c.competitor_relationship_detail else e.competitor_relationship_detail end as competitor_relationship_detail,
  case when c.id is not null then c.competitor_evidence else e.competitor_evidence end as competitor_evidence,
  e.quoted_value, e.quoted_currency, e.estimated_value, e.estimated_currency,
  case when c.id is not null then c.duplicate_of_lead_id else e.duplicate_of_lead_id end as duplicate_of_lead_id,
  e.actor_id, e.recorded_at,
  e.effective_date as original_effective_date, e.reason_code as original_reason_code,
  c.id as latest_correction_id, c.actor_id as corrected_by, c.recorded_at as corrected_at,
  rp.id as reopened_by_event_id, rp.recorded_at as reopened_at, rp.actor_id as reopened_by, rp.reason_detail as reopen_reason
from sales.pursuit_outcome_events e
left join lateral (select x.* from sales.pursuit_outcome_events x where x.corrects_event_id = e.id
  order by x.seq desc limit 1) c on true
left join lateral (select x.* from sales.pursuit_outcome_events x where x.reopens_event_id = e.id
  order by x.seq limit 1) rp on true
where e.corrects_event_id is null and e.outcome_type <> 'reopened';
grant select on api.pursuit_outcome_history to authenticated;
grant all on api.pursuit_outcome_history to service_role;
comment on view api.pursuit_outcome_history is
  'Pursuit outcomes with their effective (latest corrected) reason and week (Monday, Asia/Kuala_Lumpur business date). A reopened outcome stays in its week.';

-- Weekly outcomes. Loss events and distinct lost pursuits are separate measures
-- (TILE-3 R6.1a / R6.1b); rejection and deferral are never counted as losses.
create function api.report_pursuit_outcomes(p_from date default null, p_to date default null)
returns table (week_start date, outcome_type text, reason_code text, reason_label text, events bigint, pursuits bigint,
  reopened_later bigint, lost_quoted_value numeric, lost_estimated_unquoted_value numeric, value_unknown bigint, value_not_myr bigint)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform core.require_permission('report.read');
  return query
  select h.effective_week, h.outcome_type, h.reason_code, r.label,
    count(*), count(distinct h.pursuit_key),
    count(*) filter (where h.reopened_at is not null),
    coalesce(sum(h.quoted_value) filter (where h.outcome_type = 'lost' and h.quoted_currency = 'MYR'), 0),
    coalesce(sum(h.estimated_value) filter (where h.outcome_type = 'lost' and h.quoted_value is null and h.estimated_currency = 'MYR'), 0),
    count(*) filter (where h.outcome_type = 'lost' and h.quoted_value is null and h.estimated_value is null),
    count(*) filter (where h.outcome_type = 'lost' and (h.quoted_currency <> 'MYR' or (h.quoted_value is null and h.estimated_currency <> 'MYR')))
  from api.pursuit_outcome_history h
  join core.outcome_reasons r on r.outcome_type = h.outcome_type and r.key = h.reason_code
  where (p_from is null or h.effective_date >= p_from) and (p_to is null or h.effective_date <= p_to)
  group by h.effective_week, h.outcome_type, h.reason_code, r.label, r.position
  order by h.effective_week, h.outcome_type, r.position;
end $$;
revoke all on function api.report_pursuit_outcomes(date,date) from public, anon;
grant execute on function api.report_pursuit_outcomes(date,date) to authenticated, service_role;
