import type { StatusMap } from "@/lib/domain/status-maps";

/**
 * Stock-local status presentation (PRD §7.7, §17).
 *
 * Each availability state keeps its own label and tone. "Out" is a fact, and
 * "unknown" or "ask supplier" are the absence of one — collapsing any of them
 * into a shared pill (or into zero) would make an unanswered question look
 * like a confirmed shortage.
 */
export const AVAILABILITY_STATUS: StatusMap = {
  available: { label: "Available", tone: "success", hint: "The supplier or SQL Account confirmed stock on the date shown." },
  low: { label: "Low", tone: "warning", hint: "Confirmed but limited — check before promising a quantity." },
  out: { label: "Out of stock", tone: "destructive", hint: "Confirmed as no stock, as at the date shown." },
  made_to_order: { label: "Made to order", tone: "info", hint: "Not stocked; produced on order. Ask for the lead time." },
  ask_supplier: { label: "Ask supplier", tone: "ai", hint: "Nobody has confirmed anything yet — call before quoting." },
  unknown: { label: "Unknown", tone: "neutral", hint: "No update has ever been recorded for this line." },
};

/** Kept for callers that want the sentence without the pill. Same text as the map's hints. */
export const AVAILABILITY_EXPLAINER: Record<string, string> = Object.fromEntries(Object.entries(AVAILABILITY_STATUS).map(([k, v]) => [k, v.hint ?? ""]));

export const SOURCE_KIND: StatusMap = {
  in_house: { label: "In-house", tone: "info", hint: "Mirrored read-only from SQL Account, the authority for in-house stock." },
  supplier: { label: "Supplier", tone: "neutral", hint: "Entered by a stock coordinator after asking the supplier. Evidence with an age, not a live feed." },
};

export const FRESHNESS_STATUS: StatusMap = {
  fresh: { label: "Fresh", tone: "success", hint: "Updated inside the supplier's freshness policy. Safe to quote from." },
  aging: { label: "Aging", tone: "warning", hint: "Past the fresh window but not yet stale. Worth a check before promising." },
  stale: { label: "Stale", tone: "destructive", hint: "Older than the policy allows. Chase the supplier; do not quote from it." },
  unknown: { label: "Never updated", tone: "neutral", hint: "No snapshot has ever been recorded for this supplier." },
};

export const MAPPING_STATUS: StatusMap = {
  mapped: { label: "Mapped", tone: "success", hint: "The SQL Account item is linked to a product variant, so its snapshots reach the catalog." },
  unmapped: { label: "Unmapped", tone: "warning", hint: "Snapshots arrive but cannot reach a product until someone links the item to a variant." },
  ignored: { label: "Ignored", tone: "neutral", hint: "Deliberately not linked, for example a service line or an obsolete code." },
};

export const CASE_STATUS: StatusMap = {
  open: { label: "Open", tone: "warning", hint: "A physical count or app figure disagrees with the source. Nobody is on it yet." },
  investigating: { label: "Investigating", tone: "info", hint: "Someone is working out which figure is right." },
  resolved: { label: "Resolved", tone: "success", hint: "The cause was found and recorded." },
  accepted: { label: "Accepted", tone: "neutral", hint: "The variance is known and tolerated, with a note." },
};

export const CHANNEL_LABEL: Record<string, string> = {
  call: "Phone call",
  whatsapp: "WhatsApp",
  email: "Email",
  portal: "Supplier portal",
  visit: "Site visit",
};

export const CHANNEL_HINT: Record<string, string> = {
  call: "Heard on the phone. Note who said it.",
  whatsapp: "Read in a WhatsApp message. Attach the screenshot as evidence.",
  email: "Read in an email. Attach it as evidence.",
  portal: "Seen on the supplier's own portal or price list.",
  visit: "Seen in person at the supplier or warehouse.",
};
