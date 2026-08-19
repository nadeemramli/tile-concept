import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";

export interface CandidateSide {
  id: string;
  display_name: string;
  customer_type: string | null;
  lifecycle_state: string;
  original_acquisition_source: string | null;
  created_at: string;
  is_provisional: boolean;
  phones: string[];
  emails: string[];
  opportunities: number;
  purchases: number;
}

export interface CandidatePair {
  id: string;
  status: string;
  confidence: string;
  score: number;
  reasons: { code: string; field?: string }[];
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  subject: CandidateSide;
  candidate: CandidateSide;
}

async function loadSides(ids: string[]): Promise<Map<string, CandidateSide>> {
  const supabase = await createServerSupabase();
  if (ids.length === 0) return new Map();
  const [{ data: contacts }, { data: points }, { data: opps }, { data: purchases }] = await Promise.all([
    supabase.from("contacts").select("id, display_name, customer_type, lifecycle_state, original_acquisition_source, created_at, is_provisional").in("id", ids),
    supabase.from("contact_points").select("contact_id, kind, normalized_value, is_primary").in("contact_id", ids),
    supabase.from("opportunities").select("contact_id").in("contact_id", ids),
    supabase.from("purchases").select("contact_id").in("contact_id", ids),
  ]);
  const count = (arr: { contact_id: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const r of arr ?? []) if (r.contact_id) m.set(r.contact_id, (m.get(r.contact_id) ?? 0) + 1);
    return m;
  };
  const om = count(opps), pm = count(purchases);
  const m = new Map<string, CandidateSide>();
  for (const c of contacts ?? []) {
    const pts = (points ?? []).filter((p) => p.contact_id === c.id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    m.set(c.id!, {
      id: c.id!,
      display_name: c.display_name ?? "",
      customer_type: c.customer_type,
      lifecycle_state: c.lifecycle_state ?? "new",
      original_acquisition_source: c.original_acquisition_source,
      created_at: c.created_at!,
      is_provisional: !!c.is_provisional,
      phones: pts.filter((p) => p.kind === "phone" || p.kind === "whatsapp").map((p) => p.normalized_value!),
      emails: pts.filter((p) => p.kind === "email").map((p) => p.normalized_value!),
      opportunities: om.get(c.id!) ?? 0,
      purchases: pm.get(c.id!) ?? 0,
    });
  }
  return m;
}

export async function listCandidates(status: string): Promise<CandidatePair[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("identity_match_candidates").select("*").eq("subject_type", "contact").eq("status", status).order("score", { ascending: false }).limit(300);
  const rows = data ?? [];
  const sides = await loadSides([...new Set(rows.flatMap((r) => [r.subject_id!, r.candidate_id!]))]);
  const empty = (id: string): CandidateSide => ({ id, display_name: "(not visible)", customer_type: null, lifecycle_state: "new", original_acquisition_source: null, created_at: "", is_provisional: false, phones: [], emails: [], opportunities: 0, purchases: 0 });
  return rows.map((r) => ({
    id: r.id!,
    status: r.status ?? "suggested",
    confidence: r.confidence ?? "low",
    score: Number(r.score ?? 0),
    reasons: ((r.reasons ?? []) as { code: string; field?: string }[]),
    decided_by: r.decided_by,
    decided_at: r.decided_at,
    decision_note: r.decision_note,
    created_at: r.created_at!,
    subject: sides.get(r.subject_id!) ?? empty(r.subject_id!),
    candidate: sides.get(r.candidate_id!) ?? empty(r.candidate_id!),
  }));
}

export interface MergeEventRow {
  id: string;
  survivor_id: string;
  survivor_name: string;
  merged_id: string;
  merged_name: string;
  actor_id: string | null;
  reason: string;
  relinked: Record<string, number>;
  occurred_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
}

export async function listMergeEvents(limit = 50): Promise<MergeEventRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("identity_merge_events").select("*").eq("entity_type", "contact").order("occurred_at", { ascending: false }).limit(limit);
  const rows = data ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.survivor_id!, r.merged_id!]))];
  const { data: contacts } = ids.length ? await supabase.from("contacts").select("id, display_name").in("id", ids) : { data: [] };
  const names = new Map((contacts ?? []).map((c) => [c.id!, c.display_name ?? ""]));
  return rows.map((r) => ({
    id: r.id!,
    survivor_id: r.survivor_id!,
    survivor_name: names.get(r.survivor_id!) ?? "",
    merged_id: r.merged_id!,
    merged_name: names.get(r.merged_id!) ?? "",
    actor_id: r.actor_id,
    reason: r.reason ?? "",
    relinked: (r.relinked ?? {}) as Record<string, number>,
    occurred_at: r.occurred_at!,
    reversed_at: r.reversed_at,
    reversed_by: r.reversed_by,
    reversal_reason: r.reversal_reason,
  }));
}
