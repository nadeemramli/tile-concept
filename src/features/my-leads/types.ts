import type { QuickAction, QuickUpdate } from "@/features/my-leads/lib/my-leads";

/**
 * What a phone list row needs, and nothing more. The phone number is always
 * masked here: lists never carry a revealable contact point.
 */
export interface MyLeadCard {
  id: string;
  name: string | null;
  company: string | null;
  /** Lead status, or `won` once a confirmed sale exists. */
  status: string;
  sourceChannel: string;
  interest: string | null;
  nextFollowUpAt: string | null;
  noNextActionReason: string | null;
  maskedPhone: string | null;
  primary: QuickAction | null;
}

export interface MyLeadActivity {
  id: string;
  kind: string;
  channel: string | null;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  actorName: string | null;
}

export interface MyLeadDetail extends MyLeadCard {
  ownerId: string | null;
  ownerName: string | null;
  /** Present only for a role with contact.reveal, matching the Inquiry Inbox drawer. */
  contact: { phone: string; tel: string; whatsapp: string } | null;
  firstWhatsappSentAt: string | null;
  firstCustomerReplyAt: string | null;
  contactAttempts: number;
  nextFollowUpTaskId: string | null;
  openFollowUps: number;
  closed: boolean;
  secondary: QuickUpdate[];
  /** sales.write and the same ownership rule `api.work_inquiry` enforces. */
  canWrite: boolean;
  activity: MyLeadActivity[];
}
