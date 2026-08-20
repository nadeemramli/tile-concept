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
  available: { label: "Available", tone: "success" },
  low: { label: "Low", tone: "warning" },
  out: { label: "Out of stock", tone: "destructive" },
  made_to_order: { label: "Made to order", tone: "info" },
  ask_supplier: { label: "Ask supplier", tone: "ai" },
  unknown: { label: "Unknown", tone: "neutral" },
};

export const AVAILABILITY_EXPLAINER: Record<string, string> = {
  available: "The supplier or SQL Account confirmed stock on the date shown.",
  low: "Confirmed but limited — check before promising a quantity.",
  out: "Confirmed as no stock, as at the date shown.",
  made_to_order: "Not stocked; produced on order. Ask for the lead time.",
  ask_supplier: "Nobody has confirmed anything yet — call before quoting.",
  unknown: "No update has ever been recorded for this line.",
};

export const SOURCE_KIND: StatusMap = {
  in_house: { label: "In-house", tone: "info" },
  supplier: { label: "Supplier", tone: "neutral" },
};

export const FRESHNESS_STATUS: StatusMap = {
  fresh: { label: "Fresh", tone: "success" },
  aging: { label: "Aging", tone: "warning" },
  stale: { label: "Stale", tone: "destructive" },
  unknown: { label: "Never updated", tone: "neutral" },
};

export const MAPPING_STATUS: StatusMap = {
  mapped: { label: "Mapped", tone: "success" },
  unmapped: { label: "Unmapped", tone: "warning" },
  ignored: { label: "Ignored", tone: "neutral" },
};

export const CASE_STATUS: StatusMap = {
  open: { label: "Open", tone: "warning" },
  investigating: { label: "Investigating", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  accepted: { label: "Accepted", tone: "neutral" },
};

export const CHANNEL_LABEL: Record<string, string> = {
  call: "Phone call",
  whatsapp: "WhatsApp",
  email: "Email",
  portal: "Supplier portal",
  visit: "Site visit",
};
