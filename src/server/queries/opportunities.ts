import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getAuditFor, getPurchasesFor, getQuotesForOpportunities, getTimeline, type AuditRow, type PurchaseSummary, type QuoteSummary } from "@/server/queries/contacts";
import type { TimelineItem } from "@/components/patterns/timeline";

export type PipelineView = "open" | "overdue" | "missing-next-action" | "won" | "lost" | "quotes" | "all";

export interface OpportunityRow {
  id: string;
  name: string;
  stage_key: string;
  status: string;
  account_id: string | null;
  account_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  project_id: string | null;
  owner_id: string | null;
  source_channel: string | null;
  estimated_value: number | null;
  currency: string;
  probability_band: string | null;
  expected_close_date: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  product_interest: string[];
  won_at: string | null;
  lost_at: string | null;
  deferred_until: string | null;
  outcome_reason: string | null;
  competitor: string | null;
  notes: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
  has_quote: boolean;
}

function mapRow(o: Record<string, unknown>): OpportunityRow {
  return {
    id: o.id as string,
    name: (o.name as string) ?? "",
    stage_key: (o.stage_key as string) ?? "",
    status: (o.status as string) ?? "open",
    account_id: (o.account_id as string | null) ?? null,
    account_name: (o.accounts as { name: string } | null)?.name ?? null,
    contact_id: (o.contact_id as string | null) ?? null,
    contact_name: (o.contacts as { display_name: string } | null)?.display_name ?? null,
    project_id: (o.project_id as string | null) ?? null,
    owner_id: (o.owner_id as string | null) ?? null,
    source_channel: (o.source_channel as string | null) ?? null,
    estimated_value: o.estimated_value === null || o.estimated_value === undefined ? null : Number(o.estimated_value),
    currency: (o.currency as string) ?? "MYR",
    probability_band: (o.probability_band as string | null) ?? null,
    expected_close_date: (o.expected_close_date as string | null) ?? null,
    next_action: (o.next_action as string | null) ?? null,
    next_action_due_at: (o.next_action_due_at as string | null) ?? null,
    product_interest: (o.product_interest as string[] | null) ?? [],
    won_at: (o.won_at as string | null) ?? null,
    lost_at: (o.lost_at as string | null) ?? null,
    deferred_until: (o.deferred_until as string | null) ?? null,
    outcome_reason: (o.outcome_reason as string | null) ?? null,
    competitor: (o.competitor as string | null) ?? null,
    notes: (o.notes as string | null) ?? null,
    lead_id: (o.lead_id as string | null) ?? null,
    created_at: o.created_at as string,
    updated_at: o.updated_at as string,
    has_quote: false,
  };
}

const SELECT = "*, accounts(name), contacts(display_name)";

export async function listOpportunities(view: PipelineView): Promise<OpportunityRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("opportunities").select(SELECT).order("next_action_due_at", { ascending: true, nullsFirst: false }).limit(2000);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  switch (view) {
    case "open":
      q = q.eq("status", "open");
      break;
    case "overdue":
      q = q.eq("status", "open").lt("next_action_due_at", new Date().toISOString());
      break;
    case "missing-next-action":
      q = q.eq("status", "open").or("next_action.is.null,next_action_due_at.is.null");
      break;
    case "won":
      q = q.eq("status", "won").gte("won_at", since30);
      break;
    case "lost":
      q = q.eq("status", "lost").gte("lost_at", since30);
      break;
    case "quotes":
      q = q.eq("status", "open").in("stage_key", ["quote_preparing", "quote_sent", "negotiation", "verbal_confirmation"]);
      break;
    case "all":
      break;
  }
  const { data } = await q;
  const rows = (data ?? []).map((o) => mapRow(o as unknown as Record<string, unknown>));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    const { data: quotes } = await supabase.from("quotes").select("opportunity_id").in("opportunity_id", ids);
    const set = new Set((quotes ?? []).map((q) => q.opportunity_id));
    for (const r of rows) r.has_quote = set.has(r.id);
  }
  return rows;
}

export interface OpportunityDetail extends OpportunityRow {
  project_name: string | null;
  quotes: QuoteSummary[];
  stage_events: { id: string; from_stage_key: string | null; to_stage_key: string; is_backward: boolean; reason: string | null; actor_id: string | null; occurred_at: string }[];
  tasks: { id: string; title: string; status: string; due_at: string | null; assignee_id: string | null; priority: string }[];
  purchases: PurchaseSummary[];
  timeline: TimelineItem[];
  audit: AuditRow[];
}

export async function getOpportunityDetail(id: string): Promise<OpportunityDetail | null> {
  const supabase = await createServerSupabase();
  const { data: o } = await supabase.from("opportunities").select(`${SELECT}, projects(name)`).eq("id", id).maybeSingle();
  if (!o) return null;
  const base = mapRow(o as unknown as Record<string, unknown>);
  const [quotes, { data: events }, { data: tasks }, purchases, timeline, audit] = await Promise.all([
    getQuotesForOpportunities([id], new Map([[id, base.name]])),
    supabase.from("opportunity_stage_events").select("id, from_stage_key, to_stage_key, is_backward, reason, actor_id, occurred_at").eq("opportunity_id", id).order("occurred_at", { ascending: false }),
    supabase.from("tasks").select("id, title, status, due_at, assignee_id, priority").eq("opportunity_id", id).order("due_at", { ascending: true, nullsFirst: false }),
    getPurchasesFor({ opportunity_id: id }),
    getTimeline("opportunity", id),
    getAuditFor([id]),
  ]);
  return {
    ...base,
    has_quote: quotes.length > 0,
    project_name: ((o as unknown as { projects: { name: string } | null }).projects)?.name ?? null,
    quotes,
    stage_events: (events ?? []).map((e) => ({ id: e.id!, from_stage_key: e.from_stage_key, to_stage_key: e.to_stage_key!, is_backward: !!e.is_backward, reason: e.reason, actor_id: e.actor_id, occurred_at: e.occurred_at! })),
    tasks: (tasks ?? []).map((t) => ({ id: t.id!, title: t.title!, status: t.status!, due_at: t.due_at, assignee_id: t.assignee_id, priority: t.priority ?? "normal" })),
    purchases,
    timeline,
    audit,
  };
}

export async function nextQuoteNumber(): Promise<string> {
  const supabase = await createServerSupabase();
  const year = new Date().getFullYear();
  const { count } = await supabase.from("quotes").select("id", { count: "exact", head: true }).like("quote_number", `QT-${year}-%`);
  return `QT-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}
