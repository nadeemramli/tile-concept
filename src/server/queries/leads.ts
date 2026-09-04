import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap } from "@/server/queries/reference";
import { endOfTodayKualaLumpur } from "@/lib/format";
import type { AppSession } from "@/server/session";
import type { InboxCounts, IntakeEventRow, LeadRow } from "@/features/inbox/types";
import type { LeadView } from "@/features/inbox/schema";
import type { TimelineItem } from "@/components/patterns/timeline";

const LEAD_COLUMNS =
  "id, status, source_channel, source_detail, contact_id, account_id, raw_name, raw_phone, raw_phone_normalized, raw_email, raw_company, interest, product_interest, location_id, owner_id, assigned_at, first_response_due_at, first_response_at, contact_attempts, qualified_at, disqualified_reason, converted_opportunity_id, duplicate_of_lead_id, notes, created_at, updated_at";

type RawLead = Record<string, unknown>;
type Supa = Awaited<ReturnType<typeof createServerSupabase>>;

interface LeadFollowUp {
  id: string;
  due_at: string;
}

function mapLead(r: RawLead, ownerName: string | null, followUp: LeadFollowUp | null = null): LeadRow {
  return {
    id: String(r.id),
    status: String(r.status ?? "new"),
    source_channel: String(r.source_channel ?? "other"),
    source_detail: (r.source_detail as string | null) ?? null,
    contact_id: (r.contact_id as string | null) ?? null,
    account_id: (r.account_id as string | null) ?? null,
    raw_name: (r.raw_name as string | null) ?? null,
    raw_phone: (r.raw_phone as string | null) ?? null,
    raw_phone_normalized: (r.raw_phone_normalized as string | null) ?? null,
    raw_email: (r.raw_email as string | null) ?? null,
    raw_company: (r.raw_company as string | null) ?? null,
    interest: (r.interest as string | null) ?? null,
    product_interest: (r.product_interest as string[] | null) ?? [],
    location_id: (r.location_id as string | null) ?? null,
    owner_id: (r.owner_id as string | null) ?? null,
    owner_name: ownerName,
    assigned_at: (r.assigned_at as string | null) ?? null,
    first_response_due_at: (r.first_response_due_at as string | null) ?? null,
    first_response_at: (r.first_response_at as string | null) ?? null,
    contact_attempts: Number(r.contact_attempts ?? 0),
    qualified_at: (r.qualified_at as string | null) ?? null,
    disqualified_reason: (r.disqualified_reason as string | null) ?? null,
    converted_opportunity_id: (r.converted_opportunity_id as string | null) ?? null,
    duplicate_of_lead_id: (r.duplicate_of_lead_id as string | null) ?? null,
    next_follow_up_at: followUp?.due_at ?? null,
    next_follow_up_task_id: followUp?.id ?? null,
    notes: (r.notes as string | null) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at ?? r.created_at),
  };
}

const ACTIVE = ["new", "contact_attempted", "contacted", "qualified"];

/**
 * Earliest open follow-up task per lead, in one bounded query. PostgREST has no
 * group-by, so the min() per lead happens here: tasks arrive ordered by due_at
 * and the first row per lead wins. RLS on sales.tasks scopes rows to the viewer
 * (own, created, or unassigned tasks unless sales.read_all), so a rep sees
 * their own follow-ups while managers see them all — intended.
 */
async function getOpenLeadFollowUps(supabase: Supa): Promise<Map<string, LeadFollowUp>> {
  const { data } = await supabase
    .from("tasks")
    .select("id, lead_id, due_at")
    .eq("status", "open")
    .not("lead_id", "is", null)
    .not("due_at", "is", null)
    .order("due_at", { ascending: true })
    .limit(1000);
  const map = new Map<string, LeadFollowUp>();
  for (const t of data ?? []) {
    if (!t.lead_id || map.has(String(t.lead_id))) continue;
    map.set(String(t.lead_id), { id: String(t.id), due_at: String(t.due_at) });
  }
  return map;
}

export async function listLeads(view: LeadView, session: AppSession): Promise<LeadRow[]> {
  const supabase = await createServerSupabase();
  const [followUps, members] = await Promise.all([getOpenLeadFollowUps(supabase), getMemberMap()]);
  let q = supabase.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(500);
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const now = new Date().toISOString();
  switch (view) {
    case "new":
      q = q.eq("status", "new");
      break;
    case "unassigned":
      q = q.is("owner_id", null).in("status", ["new", "contact_attempted", "contacted"]);
      break;
    case "mine":
      q = q.eq("owner_id", session.userId).in("status", ACTIVE);
      break;
    case "no-response":
      q = q.eq("status", "new").is("first_response_at", null);
      break;
    case "follow-up":
      q = q.in("status", ["new", "contact_attempted", "contacted"]).lt("first_response_due_at", now).is("first_response_at", null);
      break;
    case "follow-ups-due": {
      // Only leads whose earliest open task is due today (KL) or earlier — a
      // bounded id list, never the full 500-row scan.
      const dueEnd = Date.parse(endOfTodayKualaLumpur());
      const dueLeadIds = [...followUps.entries()].filter(([, f]) => Date.parse(f.due_at) <= dueEnd).map(([leadId]) => leadId);
      if (dueLeadIds.length === 0) return [];
      q = q.in("id", dueLeadIds.slice(0, 500));
      break;
    }
    case "duplicates":
      q = q.or("status.eq.duplicate,duplicate_of_lead_id.not.is.null");
      break;
    case "qualified":
      q = q.in("status", ["qualified", "converted"]);
      break;
    case "disqualified":
      q = q.eq("status", "disqualified");
      break;
    case "aging":
      q = q.in("status", ["new", "contact_attempted"]).lt("created_at", twoDaysAgo);
      break;
    case "all":
    default:
      break;
  }
  const { data } = await q;
  return (data ?? []).map((r) => mapLead(r as RawLead, r.owner_id ? (members.get(r.owner_id)?.full_name ?? null) : null, followUps.get(String(r.id)) ?? null));
}

export async function getLead(id: string): Promise<LeadRow | null> {
  const supabase = await createServerSupabase();
  const [{ data }, members, { data: openTasks }] = await Promise.all([
    supabase.from("leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle(),
    getMemberMap(),
    supabase.from("tasks").select("id, due_at").eq("lead_id", id).eq("status", "open").not("due_at", "is", null).order("due_at", { ascending: true }).limit(1),
  ]);
  if (!data) return null;
  const t = openTasks?.[0];
  return mapLead(data as RawLead, data.owner_id ? (members.get(data.owner_id)?.full_name ?? null) : null, t ? { id: String(t.id), due_at: String(t.due_at) } : null);
}

export async function getInboxCounts(session: AppSession): Promise<InboxCounts> {
  const supabase = await createServerSupabase();
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const now = new Date().toISOString();
  const head = () => supabase.from("leads").select("id", { count: "exact", head: true });
  const [n, u, m, nr, fu, d, a, ft] = await Promise.all([
    head().eq("status", "new"),
    head().is("owner_id", null).in("status", ["new", "contact_attempted", "contacted"]),
    head().eq("owner_id", session.userId).in("status", ACTIVE),
    head().eq("status", "new").is("first_response_at", null),
    head().in("status", ["new", "contact_attempted", "contacted"]).lt("first_response_due_at", now).is("first_response_at", null),
    head().or("status.eq.duplicate,duplicate_of_lead_id.not.is.null"),
    head().in("status", ["new", "contact_attempted"]).lt("created_at", twoDaysAgo),
    // Distinct-lead count so the card matches the "Follow-ups due" view rows.
    supabase.from("tasks").select("lead_id").eq("status", "open").not("lead_id", "is", null).lte("due_at", endOfTodayKualaLumpur()).limit(1000),
  ]);
  return {
    new: n.count ?? 0,
    unassigned: u.count ?? 0,
    mine: m.count ?? 0,
    noResponse: nr.count ?? 0,
    followUp: fu.count ?? 0,
    duplicates: d.count ?? 0,
    aging: a.count ?? 0,
    followUpsDue: new Set((ft.data ?? []).map((t) => String(t.lead_id))).size,
  };
}

export async function getLeadIntakeEvents(leadId: string): Promise<IntakeEventRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("intake_events")
    .select("id, source_channel, provider, external_id, received_at, payload, raw_text, status")
    .eq("lead_id", leadId)
    .order("received_at", { ascending: false });
  return (data ?? []).map((e) => ({
    id: String(e.id),
    source_channel: String(e.source_channel ?? "other"),
    provider: e.provider ?? null,
    external_id: e.external_id ?? null,
    received_at: String(e.received_at),
    payload: (e.payload as Record<string, unknown>) ?? {},
    raw_text: e.raw_text ?? null,
    status: String(e.status ?? "received"),
  }));
}

export async function getLeadTimeline(leadId: string): Promise<TimelineItem[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc("entity_timeline", { p_entity_type: "lead", p_entity_id: leadId, p_limit: 100 });
  return (data ?? []).map((a) => ({
    id: String(a.id),
    kind: String(a.kind ?? "note"),
    channel: a.channel,
    subject: a.subject,
    body: a.body,
    occurred_at: String(a.occurred_at),
    actor_name: a.actor_name,
    metadata: (a.metadata as Record<string, unknown> | null) ?? null,
  }));
}

export async function getLinkedContactSummary(contactId: string | null) {
  if (!contactId) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("contacts").select("id, display_name, lifecycle_state, customer_type").eq("id", contactId).maybeSingle();
  if (!data) return null;
  return { id: String(data.id), display_name: String(data.display_name ?? ""), lifecycle_state: data.lifecycle_state ?? "new", customer_type: data.customer_type ?? null };
}
