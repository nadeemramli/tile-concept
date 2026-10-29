import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap } from "@/server/queries/reference";
import type { ClassificationValues } from "@/features/classification/taxonomy";

export type PursuitSubject = { lead_id: string } | { opportunity_id: string };

type EventValues = Partial<ClassificationValues> & { classification_state?: string | null };

export interface ClassificationEvent {
  id: string;
  basis: string;
  before: EventValues | null;
  after: EventValues;
  reason: string | null;
  source: Record<string, unknown> | null;
  actor_name: string | null;
  occurred_at: string;
}

export interface InquiryArrival {
  arrived_at: string;
  recorded_at: string | null;
  basis: string;
  precision: string;
  note: string | null;
}

export interface PursuitClassification {
  lead_id: string | null;
  opportunity_id: string | null;
  owner_id: string | null;
  values: ClassificationValues;
  state: string;
  basis: string;
  note: string | null;
  flagged_at: string | null;
  conflict: Record<string, { recorded?: string; proposed?: string; source?: string; source_value?: string; at?: string }> | null;
  version: number;
  updated_at: string | null;
  /** The customer's own type: shown as a suggestion only, never applied to the pursuit. */
  contact_customer_type: string | null;
  /** Present when the pursuit has an inquiry. */
  arrival: InquiryArrival | null;
  history: ClassificationEvent[];
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function values(r: Row): ClassificationValues {
  return {
    buyer_role: str(r.buyer_role) ?? "unknown",
    project_use: str(r.project_use) ?? "unknown",
    work_type: str(r.work_type) ?? "unknown",
    glc_involvement: str(r.glc_involvement) ?? "unknown",
    glc_party_role: str(r.glc_party_role),
  };
}

function arrivalOf(r: Row): InquiryArrival {
  return {
    arrived_at: String(r.created_at),
    recorded_at: str(r.recorded_at),
    basis: str(r.arrival_basis) ?? "legacy",
    precision: str(r.arrival_precision) ?? "unknown",
    note: str(r.arrival_note),
  };
}

const COLUMNS =
  "id, owner_id, contact_id, buyer_role, project_use, work_type, glc_involvement, glc_party_role, classification_state, classification_basis, classification_note, classification_flagged_at, classification_conflict, classification_version, classification_updated_at";

/** The classification of one pursuit, read as the signed-in user (RLS decides visibility). */
export async function getPursuitClassification(subject: PursuitSubject): Promise<PursuitClassification | null> {
  const supabase = await createServerSupabase();
  let row: Row | null = null;
  let leadId: string | null = null;
  let opportunityId: string | null = null;
  let arrival: InquiryArrival | null = null;
  if ("lead_id" in subject) {
    const { data, error } = await supabase
      .from("leads")
      .select(`${COLUMNS}, converted_opportunity_id, created_at, recorded_at, arrival_basis, arrival_precision, arrival_note`)
      .eq("id", subject.lead_id)
      .maybeSingle();
    if (error) throw new Error("Unable to load the classification. Please retry.");
    if (!data) return null;
    row = data as Row;
    leadId = String(data.id);
    opportunityId = data.converted_opportunity_id ?? null;
    arrival = arrivalOf(data as Row);
  } else {
    const { data, error } = await supabase.from("opportunities").select(`${COLUMNS}, lead_id`).eq("id", subject.opportunity_id).maybeSingle();
    if (error) throw new Error("Unable to load the classification. Please retry.");
    if (!data) return null;
    row = data as Row;
    opportunityId = String(data.id);
    leadId = data.lead_id ?? null;
  }
  if (leadId && !arrival) {
    const { data } = await supabase.from("leads").select("created_at, recorded_at, arrival_basis, arrival_precision, arrival_note").eq("id", leadId).maybeSingle();
    if (data) arrival = arrivalOf(data as Row);
  }

  const historyQuery = supabase
    .from("classification_events")
    .select("id, basis, before_values, after_values, reason, source_values, actor_id, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(50);
  const [{ data: events }, members, contact] = await Promise.all([
    leadId ? historyQuery.eq("lead_id", leadId) : historyQuery.eq("opportunity_id", opportunityId!),
    getMemberMap(),
    row.contact_id ? supabase.from("contacts").select("customer_type").eq("id", String(row.contact_id)).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return {
    lead_id: leadId,
    opportunity_id: opportunityId,
    owner_id: str(row.owner_id),
    values: values(row),
    state: str(row.classification_state) ?? "unreviewed",
    basis: str(row.classification_basis) ?? "legacy",
    note: str(row.classification_note),
    flagged_at: str(row.classification_flagged_at),
    conflict: (row.classification_conflict as PursuitClassification["conflict"]) ?? null,
    version: Number(row.classification_version ?? 0),
    updated_at: str(row.classification_updated_at),
    contact_customer_type: (contact.data as { customer_type: string | null } | null)?.customer_type ?? null,
    arrival,
    history: (events ?? []).map((e) => ({
      id: String(e.id),
      basis: String(e.basis),
      before: (e.before_values as EventValues | null) ?? null,
      after: (e.after_values as EventValues) ?? {},
      reason: e.reason ?? null,
      source: (e.source_values as Record<string, unknown> | null) ?? null,
      actor_name: e.actor_id ? members.get(e.actor_id)?.full_name ?? null : null,
      occurred_at: String(e.occurred_at),
    })),
  };
}

export interface ClassificationQueueRow {
  subject_type: "inquiry" | "opportunity";
  subject_id: string;
  lead_id: string | null;
  opportunity_id: string | null;
  title: string;
  pursuit_status: string;
  owner_id: string | null;
  owner_name: string | null;
  arrived_at: string;
  values: ClassificationValues;
  state: string;
  basis: string;
  note: string | null;
  flagged_at: string | null;
  conflict: Record<string, { recorded?: string; proposed?: string; source?: string }> | null;
  href: string;
}

/** Where a queue row is corrected: the inquiry drawer or the opportunity drawer. */
export function queueHref(row: { subject_type: string; lead_id: string | null; opportunity_id: string | null }): string {
  return row.subject_type === "opportunity" && row.opportunity_id
    ? `/sales/pipeline?opportunity=${row.opportunity_id}`
    : `/sales/inbox?view=all&lead=${row.lead_id}`;
}

export async function getClassificationQueue(): Promise<ClassificationQueueRow[]> {
  const supabase = await createServerSupabase();
  const [{ data, error }, members] = await Promise.all([
    supabase.from("classification_queue").select("*").order("arrived_at", { ascending: false }).limit(500),
    getMemberMap(),
  ]);
  if (error) throw new Error("Unable to load Classification Review. Please retry.");
  return (data ?? []).map((r) => {
    const base = {
      subject_type: (r.subject_type === "opportunity" ? "opportunity" : "inquiry") as ClassificationQueueRow["subject_type"],
      lead_id: r.lead_id ?? null,
      opportunity_id: r.opportunity_id ?? null,
    };
    return {
      ...base,
      subject_id: String(r.subject_id),
      title: r.title ?? "Untitled",
      pursuit_status: r.pursuit_status ?? "",
      owner_id: r.owner_id ?? null,
      owner_name: r.owner_id ? members.get(r.owner_id)?.full_name ?? null : null,
      arrived_at: String(r.arrived_at),
      values: values(r as Row),
      state: r.classification_state ?? "unreviewed",
      basis: r.classification_basis ?? "legacy",
      note: r.classification_note ?? null,
      flagged_at: r.classification_flagged_at ?? null,
      conflict: (r.classification_conflict as ClassificationQueueRow["conflict"]) ?? null,
      href: queueHref(base),
    };
  });
}
