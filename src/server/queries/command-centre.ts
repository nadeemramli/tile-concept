import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { AppSession } from "@/server/session";

export interface CommandCentreSummary {
  aging_leads: number;
  unassigned_leads: number;
  no_response_leads: number;
  overdue_followups: number;
  missing_next_action: number;
  open_opportunities: number;
  open_value: number;
  won_30d: number;
  lost_30d: number;
  quotes_expiring: number;
  my_open_tasks: number;
  my_overdue_tasks: number;
  lead_followups_due: number;
  duplicate_candidates: number;
  visits_today: number;
  purchases_7d: number;
  purchase_amount_7d: number;
  products_without_price: number;
  price_conflicts: number;
  unreviewed_products: number;
  open_data_issues: number;
  pending_reviews: number;
  connectors_failed: number;
  content_opps_pending: number;
  shoots_next_7d: number;
  generated_at: string;
}

export async function getCommandCentreSummary(): Promise<CommandCentreSummary | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("command_centre_summary");
  if (error || !data) return null;
  return data as unknown as CommandCentreSummary;
}

export interface SalesScorecard {
  year: number;
  target: number | null;
  currency: string;
  collected: number;
  pipeline: number;
  segments: { segment: string; value: number }[];
  generated_at: string;
}

export async function getSalesScorecard(): Promise<SalesScorecard | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("sales_scorecard", { p_year: undefined });
  if (error || !data) return null;
  const d = data as unknown as SalesScorecard;
  return {
    ...d,
    target: d.target === null ? null : Number(d.target),
    collected: Number(d.collected),
    pipeline: Number(d.pipeline),
    segments: (d.segments ?? []).map((s) => ({ segment: s.segment, value: Number(s.value) })),
  };
}

export interface AttentionItem {
  id: string;
  title: string;
  detail?: string;
  href?: string;
  tone?: "warning" | "destructive" | "info";
}

/** Items surfaced in the top-bar notification popover. */
export async function getAttentionItems(session: AppSession): Promise<AttentionItem[]> {
  if (!session.permissions.includes("sales.read")) return [];
  const s = await getCommandCentreSummary();
  if (!s) return [];
  const items: AttentionItem[] = [];
  if (s.my_overdue_tasks > 0) items.push({ id: "tasks", title: `${s.my_overdue_tasks} overdue task${s.my_overdue_tasks > 1 ? "s" : ""}`, href: "/sales/tasks?view=overdue", tone: "destructive" });
  if (s.lead_followups_due > 0) items.push({ id: "lead-followups", title: `${s.lead_followups_due} lead follow-up${s.lead_followups_due > 1 ? "s" : ""} due`, href: "/sales/inbox?view=follow-ups-due", tone: "warning" });
  if (s.overdue_followups > 0) items.push({ id: "followups", title: `${s.overdue_followups} opportunit${s.overdue_followups > 1 ? "ies" : "y"} with overdue next action`, href: "/sales/pipeline?view=overdue", tone: "warning" });
  if (s.unassigned_leads > 0 && session.permissions.includes("sales.assign")) items.push({ id: "unassigned", title: `${s.unassigned_leads} unassigned inquir${s.unassigned_leads > 1 ? "ies" : "y"}`, href: "/sales/inbox?view=unassigned", tone: "warning" });
  if (s.no_response_leads > 0) items.push({ id: "noresponse", title: `${s.no_response_leads} new inquir${s.no_response_leads > 1 ? "ies" : "y"} without a response`, href: "/sales/inbox?view=no-response", tone: "warning" });
  if (s.duplicate_candidates > 0) items.push({ id: "dups", title: `${s.duplicate_candidates} possible duplicate${s.duplicate_candidates > 1 ? "s" : ""} to review`, href: "/sales/identity-review", tone: "info" });
  if (s.quotes_expiring > 0) items.push({ id: "quotes", title: `${s.quotes_expiring} quote${s.quotes_expiring > 1 ? "s" : ""} expiring within 7 days`, href: "/sales/pipeline?view=quotes", tone: "info" });
  return items;
}

export async function getRecentActivity(limit = 12) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("activities")
    .select("id, kind, channel, subject, body, occurred_at, actor_id, contact_id, account_id, opportunity_id, lead_id, purchase_id, metadata")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getMyWork(userId: string, limit = 10) {
  const supabase = await createServerSupabase();
  const [{ data: tasks }, { data: opps }] = await Promise.all([
    supabase.from("tasks").select("id, title, due_at, priority, status, opportunity_id, contact_id").eq("status", "open").eq("assignee_id", userId).order("due_at", { ascending: true, nullsFirst: false }).limit(limit),
    supabase.from("opportunities").select("id, name, next_action, next_action_due_at, stage_key, estimated_value, currency").eq("status", "open").eq("owner_id", userId).order("next_action_due_at", { ascending: true, nullsFirst: false }).limit(limit),
  ]);
  return { tasks: tasks ?? [], opportunities: opps ?? [] };
}
