import "server-only";

import type { AppSession } from "@/server/session";
import { getInquiryPage, getLead, getLeadTimeline } from "@/server/queries/leads";
import type { LeadRow } from "@/features/inbox/types";
import { contactLinks, isClosed, maskedPhone, primaryAction, secondaryActions, TAB_VIEW, type MyLeadTab } from "@/features/my-leads/lib/my-leads";
import type { MyLeadCard, MyLeadDetail } from "@/features/my-leads/types";

/** Activity on the phone is a recent excerpt; the full history stays in the Inquiry Inbox. */
const ACTIVITY_LIMIT = 10;
const INTEREST_LIMIT = 160;

function toCard(lead: LeadRow): MyLeadCard {
  const interest = lead.interest?.trim() || null;
  return {
    id: lead.id,
    name: lead.raw_name?.trim() || null,
    company: lead.raw_company?.trim() || null,
    status: lead.confirmed_sales > 0 ? "won" : lead.status,
    sourceChannel: lead.source_channel,
    interest: interest && interest.length > INTEREST_LIMIT ? `${interest.slice(0, INTEREST_LIMIT - 1)}…` : interest,
    nextFollowUpAt: lead.next_follow_up_at,
    noNextActionReason: lead.no_next_action_reason,
    maskedPhone: maskedPhone(lead),
    primary: primaryAction(lead),
  };
}

/**
 * The signed-in member's own inquiries. `owner: "mine"` only narrows the
 * inbox population `api.inquiry_page` already authorizes; it never widens it.
 */
export async function getMyLeads(input: { tab: MyLeadTab; search: string; page: number }) {
  const result = await getInquiryPage({ view: TAB_VIEW[input.tab], search: input.search, owner: "mine", source: "", page: input.page });
  const counts: Record<MyLeadTab, number> = { today: 0, action: 0, upcoming: 0, all: 0 };
  for (const tab of Object.keys(TAB_VIEW) as MyLeadTab[]) counts[tab] = result.viewCounts[TAB_VIEW[tab]] ?? 0;
  return { leads: result.leads.map(toCard), counts, total: result.total, page: result.page, pageSize: result.pageSize };
}

/**
 * One lead for the phone detail, read through the same RLS view and timeline
 * as the inbox drawer. Raw contact points leave the server only for a role
 * that holds contact.reveal (the drawer's rule); everyone else gets the mask.
 */
export async function getMyLeadDetail(leadId: string, session: AppSession): Promise<MyLeadDetail | null> {
  const [lead, timeline] = await Promise.all([getLead(leadId), getLeadTimeline(leadId)]);
  if (!lead) return null;
  const can = (p: string) => session.permissions.includes(p);
  const isOwner = can("sales.read_all") || !lead.owner_id || lead.owner_id === session.userId;
  const rawPhone = lead.raw_phone_normalized ?? lead.raw_phone;
  const links = can("contact.reveal") ? contactLinks(rawPhone) : null;
  return {
    ...toCard(lead),
    ownerId: lead.owner_id,
    ownerName: lead.owner_name,
    contact: links && rawPhone ? { phone: rawPhone, ...links } : null,
    firstWhatsappSentAt: lead.first_whatsapp_sent_at,
    firstCustomerReplyAt: lead.first_customer_reply_at,
    contactAttempts: lead.contact_attempts,
    nextFollowUpTaskId: lead.next_follow_up_task_id,
    openFollowUps: lead.open_follow_ups,
    closed: isClosed(lead),
    secondary: secondaryActions(lead),
    canWrite: can("sales.write") && isOwner,
    activity: timeline.slice(0, ACTIVITY_LIMIT).map((a) => ({
      id: a.id, kind: a.kind, channel: a.channel ?? null, subject: a.subject ?? null,
      body: a.body ?? null, occurredAt: a.occurred_at, actorName: a.actor_name ?? null,
    })),
  };
}
