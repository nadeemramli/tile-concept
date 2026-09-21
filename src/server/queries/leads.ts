import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap } from "@/server/queries/reference";
import type { InboxCounts, IntakeEventRow, LeadRow } from "@/features/inbox/types";
import type { LeadView } from "@/features/inbox/schema";
import type { TimelineItem } from "@/components/patterns/timeline";

type RawLead = Record<string, unknown>;

function inquiryQueryFailed(operation: "inquiry_page" | "inbox_leads" | "intake_events" | "entity_timeline", error: { code?: unknown }, message: string): never {
  // Postgres messages/details can contain customer values. Keep diagnostics to
  // the fixed operation and SQLSTATE/PostgREST code; retain the safe UI message.
  const code = typeof error.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code) ? error.code : "unknown";
  console.error("inquiry_query_failed", { operation, code });
  throw new Error(message);
}

function mapLead(r: RawLead, ownerName: string | null): LeadRow {
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
    next_follow_up_at: (r.next_follow_up_at as string | null) ?? null,
    next_follow_up_task_id: (r.next_follow_up_task_id as string | null) ?? null,
    follow_up_owner_id: (r.follow_up_owner_id as string | null) ?? null,
    open_follow_ups: Number(r.open_follow_ups ?? 0),
    completed_follow_ups: Number(r.completed_follow_ups ?? 0),
    first_sale_at: (r.first_sale_at as string | null) ?? null,
    confirmed_sales: Number(r.confirmed_sales ?? 0),
    recorded_net_sales: Number(r.recorded_net_sales ?? 0),
    first_showroom_at: (r.first_showroom_at as string | null) ?? null,
    showroom_visits: Number(r.showroom_visits ?? 0),
    first_whatsapp_sent_at: (r.first_whatsapp_sent_at as string | null) ?? null,
    first_customer_reply_at: (r.first_customer_reply_at as string | null) ?? null,
    first_whatsapp_reply_at: (r.first_whatsapp_reply_at as string | null) ?? null,
    last_contact_attempt_at: (r.last_contact_attempt_at as string | null) ?? null,
    no_next_action_reason: (r.no_next_action_reason as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at ?? r.created_at),
  };
}

export interface InquiryFilters {
  view: LeadView;
  search: string;
  owner: string;
  source: string;
  page: number;
}

export async function getInquiryPage(filters: InquiryFilters) {
  const supabase = await createServerSupabase();
  const [{ data, error }, members] = await Promise.all([
    supabase.rpc("inquiry_page", {
      p_view: filters.view, p_search: filters.search, p_owner: filters.owner,
      p_source: filters.source, p_page: filters.page, p_size: 25,
    }),
    getMemberMap(),
  ]);
  if (error) inquiryQueryFailed("inquiry_page", error, "Unable to load inquiries. Please retry.");
  const result = data as { rows: RawLead[]; total: number; page: number; page_size: number; counts: Record<string, number> } | null;
  if (!result || !Array.isArray(result.rows)) throw new Error("Invalid inquiry response. Please retry.");
  const c = result.counts;
  const counts: InboxCounts = {
    needsAction: c["needs-action"] ?? 0, replied: c.replied ?? 0,
    upcoming: c.upcoming ?? 0, completed: c["follow-ups-completed"] ?? 0,
    new: c.new ?? 0, waiting: c.waiting ?? 0, contacted: c.contacted ?? 0,
    unassigned: c.unassigned ?? 0, mine: c.mine ?? 0, noResponse: c["no-response"] ?? 0,
    followUp: c["follow-up"] ?? 0, duplicates: c.duplicates ?? 0, aging: c.aging ?? 0,
    followUpsDue: c["follow-ups-due"] ?? 0,
  };
  return {
    leads: result.rows.map((r) => mapLead(r, r.owner_id ? members.get(String(r.owner_id))?.full_name ?? null : null)),
    counts, viewCounts: c, total: result.total, page: result.page, pageSize: result.page_size,
  };
}

export async function getLead(id: string): Promise<LeadRow | null> {
  const supabase = await createServerSupabase();
  const [{ data, error }, members] = await Promise.all([
    supabase.from("inbox_leads").select("*").eq("id", id).maybeSingle(), getMemberMap(),
  ]);
  if (error) inquiryQueryFailed("inbox_leads", error, "Unable to load this inquiry. Please retry.");
  if (!data) return null;
  return mapLead(data as RawLead, data.owner_id ? members.get(data.owner_id)?.full_name ?? null : null);
}

export async function getLeadIntakeEvents(leadId: string): Promise<IntakeEventRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("intake_events")
    .select("id, source_channel, provider, external_id, received_at, payload, raw_text, status")
    .eq("lead_id", leadId)
    .order("received_at", { ascending: false });
  if (error) inquiryQueryFailed("intake_events", error, "Unable to load inquiry source history.");
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
  const { data, error } = await supabase.rpc("entity_timeline", { p_entity_type: "lead", p_entity_id: leadId, p_limit: 100 });
  if (error) inquiryQueryFailed("entity_timeline", error, "Unable to load inquiry activity history.");
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
