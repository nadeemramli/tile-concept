import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { PursuitOutcome } from "@/features/outcomes/types";

const COLUMNS =
  "id, lead_id, opportunity_id, closes_lead, closes_opportunity, outcome_type, reason_code, reason_detail, effective_date, review_date, competitor_name, competitor_relationship, competitor_relationship_detail, competitor_evidence, quoted_value, quoted_currency, estimated_value, estimated_currency, actor_id, recorded_at, original_reason_code, original_effective_date, corrected_by, corrected_at, reopened_at, reopened_by, reopen_reason";

/**
 * Outcome history for one inquiry or opportunity, newest first. Each row is an
 * outcome with its effective (latest corrected) reason; a later reopen is a
 * marker on the row, never a removal. View rows are all-nullable, so they are
 * narrowed here.
 */
export async function getPursuitOutcomes(target: { leadId?: string | null; opportunityId?: string | null }): Promise<PursuitOutcome[]> {
  const filters = [target.leadId && `lead_id.eq.${target.leadId}`, target.opportunityId && `opportunity_id.eq.${target.opportunityId}`].filter(Boolean);
  if (!filters.length) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("pursuit_outcome_history").select(COLUMNS).or(filters.join(",")).order("recorded_at", { ascending: false });
  if (error) throw new Error("Unable to load outcome history.");
  const rows = data ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.actor_id, r.corrected_by, r.reopened_by]).filter((v): v is string => !!v))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("user_id, full_name").in("user_id", ids) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const who = (id: string | null) => (id ? name.get(id) ?? "A former member" : null);
  const num = (v: number | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    id: r.id!,
    lead_id: r.lead_id,
    opportunity_id: r.opportunity_id,
    closes_lead: !!r.closes_lead,
    closes_opportunity: !!r.closes_opportunity,
    outcome_type: r.outcome_type as PursuitOutcome["outcome_type"],
    reason_code: r.reason_code!,
    reason_detail: r.reason_detail,
    effective_date: r.effective_date!,
    review_date: r.review_date,
    competitor_name: r.competitor_name,
    competitor_relationship: r.competitor_relationship,
    competitor_relationship_detail: r.competitor_relationship_detail,
    competitor_evidence: r.competitor_evidence,
    quoted_value: num(r.quoted_value),
    quoted_currency: r.quoted_currency,
    estimated_value: num(r.estimated_value),
    estimated_currency: r.estimated_currency,
    recorded_by: who(r.actor_id),
    recorded_at: r.recorded_at!,
    original_reason_code: r.original_reason_code!,
    original_effective_date: r.original_effective_date!,
    corrected_by: who(r.corrected_by),
    corrected_at: r.corrected_at,
    reopened_at: r.reopened_at,
    reopened_by: who(r.reopened_by),
    reopen_reason: r.reopen_reason,
  }));
}
