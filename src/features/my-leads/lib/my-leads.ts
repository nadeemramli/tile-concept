import { normalizePhone } from "@/lib/identity/normalize";
import { maskValue } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locale";
import type { LeadView } from "@/features/inbox/schema";
import type { LeadRow } from "@/features/inbox/types";

/**
 * My Leads is a focused, phone-first reading of the Inquiry Inbox: the same
 * `api.inquiry_page` population, always filtered to the signed-in owner, and
 * the same `api.work_inquiry` / `api.annotate_inquiry` commands. Nothing here
 * decides who may read or write a lead; the database does.
 */
export const MY_LEAD_TABS = ["today", "action", "upcoming", "all"] as const;
export type MyLeadTab = (typeof MY_LEAD_TABS)[number];

/** Each tab is an existing inbox view, so counts match the Inquiry Inbox. */
export const TAB_VIEW: Record<MyLeadTab, LeadView> = {
  today: "follow-ups-due",
  action: "needs-action",
  upcoming: "upcoming",
  all: "all",
};

export function parseTab(value: unknown): MyLeadTab {
  return typeof value === "string" && (MY_LEAD_TABS as readonly string[]).includes(value) ? (value as MyLeadTab) : "today";
}

/** The quick actions offered here. Loss, reopening and reassignment stay in the Inquiry Inbox. */
export type QuickAction = "whatsapp_sent" | "customer_replied" | "no_response" | "contact_attempt" | "schedule" | "reschedule" | "complete" | "no_next_action";
export type QuickUpdate = QuickAction | "remark";

type ActionLead = Pick<LeadRow, "status" | "confirmed_sales" | "contact_attempts" | "first_whatsapp_sent_at" | "last_contact_attempt_at" | "first_response_at" | "first_customer_reply_at" | "next_follow_up_task_id" | "no_next_action_reason">;

export function isClosed(lead: Pick<LeadRow, "status" | "confirmed_sales">): boolean {
  return lead.confirmed_sales > 0 || lead.status === "disqualified" || lead.status === "duplicate";
}

/**
 * The one action a salesperson should take next, or null when the inquiry is
 * closed. Never contacted (still `new`, nothing recorded) → record the
 * WhatsApp you sent; an open follow-up →
 * complete it; otherwise make sure a follow-up exists.
 */
export function primaryAction(lead: ActionLead): QuickAction | null {
  if (isClosed(lead)) return null;
  const contacted = lead.status !== "new" || lead.contact_attempts > 0 || !!lead.first_whatsapp_sent_at || !!lead.last_contact_attempt_at
    || !!lead.first_response_at || !!lead.first_customer_reply_at;
  if (!contacted) return "whatsapp_sent";
  if (lead.next_follow_up_task_id) return "complete";
  return "schedule";
}

/** The other updates, never repeating the primary one. */
export function secondaryActions(lead: ActionLead): QuickUpdate[] {
  if (isClosed(lead)) return ["remark"];
  const primary = primaryAction(lead);
  const followUp: QuickAction[] = lead.next_follow_up_task_id ? ["complete", "reschedule"] : ["schedule", ...(lead.no_next_action_reason ? [] : ["no_next_action" as const])];
  const all: QuickUpdate[] = ["whatsapp_sent", "customer_replied", "no_response", "contact_attempt", ...followUp, "remark"];
  return all.filter((a) => a !== primary);
}

export type DueState = "overdue" | "today" | "upcoming" | "none";

const KL_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

function klDay(ms: number) {
  return Math.floor((ms + KL_OFFSET_MS) / DAY_MS);
}

/** Kuala Lumpur calendar days, matching the inbox's due-today boundary. */
export function dueState(nextFollowUpAt: string | null, now: number): DueState {
  if (!nextFollowUpAt) return "none";
  const due = new Date(nextFollowUpAt).getTime();
  if (!Number.isFinite(due)) return "none";
  if (due < now) return "overdue";
  return klDay(due) === klDay(now) ? "today" : "upcoming";
}

export function formatLeadDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(d);
}

export function phoneDigits(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  const digits = normalized?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

/**
 * Links that open the salesperson's own phone or WhatsApp. No message text is
 * prefilled and nothing is sent or recorded by opening them.
 */
export function contactLinks(phone: string | null | undefined): { tel: string; whatsapp: string } | null {
  const digits = phoneDigits(phone);
  return digits ? { tel: `tel:+${digits}`, whatsapp: `https://wa.me/${digits}` } : null;
}

export function maskedPhone(lead: Pick<LeadRow, "raw_phone" | "raw_phone_normalized">): string | null {
  const value = lead.raw_phone_normalized ?? lead.raw_phone;
  return value ? maskValue(value, "phone") : null;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
