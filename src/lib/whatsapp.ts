import { normalizePhone } from "@/lib/identity/normalize";

interface WhatsAppLead {
  name?: string | null;
  interest?: string | null;
  source?: string | null;
}

interface FeedbackHandoff {
  firstName?: string | null;
  secureLink: string;
}

/** A short, editable first message. Opening WhatsApp never records a response automatically. */
export function buildLeadWhatsAppMessage(lead: WhatsAppLead): string {
  const firstName = lead.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName}` : "Hi";
  const source = lead.source?.trim() ? ` about your ${lead.source.trim()} enquiry` : " about your enquiry";
  const interest = lead.interest?.trim() ? ` regarding ${lead.interest.trim()}` : "";
  return `${greeting}, thank you for contacting Tile Concept${source}${interest}. How can I help with your tile selection?`;
}

export function buildWhatsAppUrl(phone: string | null | undefined, message: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

export function buildFeedbackWhatsAppMessage({ firstName, secureLink }: FeedbackHandoff): string {
  const greeting = firstName?.trim() ? `Hi ${firstName.trim().split(/\s+/)[0]}` : "Hi";
  return `${greeting}, thank you for visiting Tile Concept. Your private feedback draft and optional photos are here:\n${secureLink}\n\nPlease check or edit your words. If you want, use the Google button to leave an honest review from your own account. A Google review is optional and does not affect your purchase.`;
}
