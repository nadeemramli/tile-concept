import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { funnelSchema, historySchema, type ReportPeriod } from "@/features/reports/funnel-schema";
import { spendTotalsSchema } from "@/features/marketing/spend-schema";

export async function getFunnel(period: ReportPeriod, namedHistory: boolean) {
  const db = await createServerSupabase();
  const args = { p_from: period.from, p_to: period.to, p_as_of: period.asof, p_location: period.location || undefined };
  const [dashboard, history, locations] = await Promise.all([
    db.rpc("funnel_dashboard", { ...args, p_spend_basis: "including_tax" }),
    namedHistory ? db.rpc("funnel_history", { ...args, p_kind: period.kind, p_page: period.page, p_staff: period.staff || undefined, p_channel: period.channel || undefined, p_contact: period.contact || undefined }) : Promise.resolve({ data: null, error: null }),
    db.from("business_locations").select("id,name").eq("is_active", true).order("name"),
  ]);
  for (const r of [dashboard, history, locations]) if (r.error) throw r.error;
  const data = funnelSchema.parse(dashboard.data);
  const channelOrder = ["tiktok", "meta", "google_ads", "shared", "walk_in", "other_unknown"];
  data.channels.sort((a, b) => channelOrder.indexOf(a.platform) - channelOrder.indexOf(b.platform));
  return { data, history: namedHistory ? historySchema.parse(history.data) : null,
    locations: (locations.data ?? []).filter((x): x is { id: string; name: string } => !!x.id && !!x.name) };
}
export async function getSpend(period: Pick<ReportPeriod, "from" | "to" | "page">) {
  const db = await createServerSupabase();
  const [list, totals] = await Promise.all([
    db.from("spend_entries").select("*", { count: "exact" }).gte("incurred_on", period.from).lte("incurred_on", period.to)
      .order("incurred_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range((period.page - 1) * 25, period.page * 25 - 1),
    db.rpc("marketing_spend_period", { p_from: period.from, p_to: period.to }),
  ]);
  if (list.error || totals.error) throw list.error ?? totals.error;
  return { rows: list.data ?? [], total: list.count ?? 0, totals: spendTotalsSchema.parse(totals.data) };
}
export type SpendData = Awaited<ReturnType<typeof getSpend>>;
