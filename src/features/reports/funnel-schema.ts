import { z } from "zod";
import { optionalUuid } from "@/lib/zod";

export const PLATFORM_LABELS: Record<string, string> = { tiktok: "TikTok", meta: "Meta · Facebook / Instagram", google_ads: "Google Ads", shared: "Shared marketing costs", walk_in: "Walk-in source", other_unknown: "Other / unknown origin" };
export function reportingToday() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date()); }
export const reportPeriodSchema = z.object({
  from: z.iso.date(), to: z.iso.date(), asof: z.iso.date(), location: optionalUuid(),
  kind: z.enum(["visits", "leads", "sales"]).default("visits"), page: z.coerce.number().int().min(1).max(100000).default(1),
  staff: optionalUuid(), contact: optionalUuid(), channel: z.enum(["tiktok", "meta", "google_ads", "walk_in", "other_unknown"]).optional().or(z.literal("")),
}).refine(x => x.from <= x.to && x.to <= x.asof && x.asof <= reportingToday(), "Choose a period ending on or before the as-of date, no later than today")
  .refine(x => (Date.parse(x.to) - Date.parse(x.from)) / 86400000 <= 366, "Choose a period of at most 367 days");
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;
export function periodInput(params: Record<string, string | string[] | undefined>) {
  const today = reportingToday();
  const scalar = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  return { from: scalar("from") ?? `${today.slice(0, 7)}-01`, to: scalar("to") ?? today, asof: scalar("asof") ?? today,
    location: scalar("location"), kind: scalar("kind"), page: scalar("page") ?? 1, staff: scalar("staff"), contact: scalar("contact"), channel: scalar("channel") };
}
const n = z.number();
export const funnelSchema = z.object({ computed_at: z.string(), summary: z.object({
  revenue: n, collections: n, spend: n, spend_complete: z.boolean(), mer: n.nullable(), leads: n, closed_leads: n,
  online_leads: n, closed_online_leads: n, visits: n, identified_visitors: n, unidentified_visits: n, converted_visits: n,
  linked_visits: n, unclassified_sales: n, unreviewed_payments: n, foreign_sales: n,
}), channels: z.array(z.object({ platform: z.string(), spend: n, covered_days: n, expected_days: n, leads: n,
  whatsapp_sent: n, whatsapp_replied: n, showroom: n, closed: n, replied_and_closed: n, cohort_revenue: n })),
staff: z.array(z.object({ id: z.string().nullable(), name: z.string(), visits: n, customers: n, converted_visits: n, revenue: n, activities: n })), });
export const historySchema = z.object({ total: n, rows: z.array(z.object({ id: z.string(), at_time: z.string(), contact_id: z.string().nullable(), customer: z.string().nullable(), staff: z.string(), staff_id: z.string().nullable(), label: z.string().nullable(), state: z.string(), notes: z.string().nullable(), location: z.string().nullable(), source: z.string().nullable(), sale_count: n, net_sales: n, collections: n })) });
export type FunnelData = z.infer<typeof funnelSchema>;
export type FunnelHistory = z.infer<typeof historySchema>;
export function rate(numerator: number, denominator: number) { return denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : "N/A"; }
