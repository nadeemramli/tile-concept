/**
 * Single source of truth for status presentation. Tone maps to the semantic
 * roles + neutral; components never hardcode status colors.
 */
export type StatusTone = "neutral" | "success" | "warning" | "destructive" | "info" | "ai";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

export type StatusMap = Record<string, StatusMeta>;

export const LEAD_STATUS: StatusMap = {
  new: { label: "New", tone: "info" },
  contact_attempted: { label: "Contact attempted", tone: "warning" },
  contacted: { label: "Contacted", tone: "info" },
  qualified: { label: "Qualified", tone: "success" },
  disqualified: { label: "Disqualified", tone: "neutral" },
  converted: { label: "Converted", tone: "success" },
  duplicate: { label: "Duplicate", tone: "neutral" },
};

export const OPPORTUNITY_STATUS: StatusMap = {
  open: { label: "Open", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "destructive" },
  deferred: { label: "Deferred", tone: "neutral" },
};

export const STAGE_GROUP_TONE: Record<string, StatusTone> = { open: "info", won: "success", lost: "destructive", deferred: "neutral" };

export const TASK_STATUS: StatusMap = {
  open: { label: "Open", tone: "info" },
  done: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const TASK_PRIORITY: StatusMap = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "info" },
  high: { label: "High", tone: "warning" },
  urgent: { label: "Urgent", tone: "destructive" },
};

export const LIFECYCLE_STATE: StatusMap = {
  new: { label: "New", tone: "info" },
  active: { label: "Active", tone: "success" },
  repeat: { label: "Repeat", tone: "ai" },
  lapsed: { label: "Lapsed", tone: "warning" },
  reactivated: { label: "Reactivated", tone: "success" },
};

export const CANDIDATE_CONFIDENCE: StatusMap = {
  high: { label: "High", tone: "success" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "neutral" },
};

export const CANDIDATE_STATUS: StatusMap = {
  suggested: { label: "Suggested", tone: "warning" },
  confirmed: { label: "Merged", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

export const PRODUCT_STATUS: StatusMap = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  discontinued: { label: "Discontinued", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

export const REVIEW_STATE: StatusMap = {
  unreviewed: { label: "Unreviewed", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "success" },
  conflicted: { label: "Conflicted", tone: "destructive" },
  rejected: { label: "Rejected", tone: "neutral" },
};

export const PRICE_STATE: StatusMap = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  current: { label: "Current", tone: "success" },
  superseded: { label: "Superseded", tone: "neutral" },
  expired: { label: "Expired", tone: "warning" },
  conflicted: { label: "Conflicted", tone: "destructive" },
};

export const PURCHASE_STATUS: StatusMap = {
  recorded: { label: "Recorded", tone: "success" },
  corrected: { label: "Corrected", tone: "warning" },
  voided: { label: "Voided", tone: "destructive" },
};

export const CONNECTOR_STATUS: StatusMap = {
  not_configured: { label: "Not configured", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  failed: { label: "Failed", tone: "destructive" },
};

export const ISSUE_SEVERITY: StatusMap = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "destructive" },
};

export const ISSUE_STATUS: StatusMap = {
  open: { label: "Open", tone: "warning" },
  acknowledged: { label: "Acknowledged", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  ignored: { label: "Ignored", tone: "neutral" },
};

export const SOURCE_CHANNEL: StatusMap = {
  tiktok: { label: "TikTok", tone: "ai" },
  meta: { label: "Meta", tone: "info" },
  website: { label: "Website", tone: "info" },
  whatsapp: { label: "WhatsApp", tone: "success" },
  dm: { label: "DM", tone: "neutral" },
  call: { label: "Call", tone: "neutral" },
  email: { label: "Email", tone: "neutral" },
  referral: { label: "Referral", tone: "success" },
  walk_in: { label: "Walk-in", tone: "warning" },
  other: { label: "Other", tone: "neutral" },
};

export const APP_MODE: StatusMap = {
  demo: { label: "Demo", tone: "ai" },
  shadow: { label: "Shadow", tone: "info" },
  live: { label: "Live", tone: "warning" },
};

export function statusMeta(map: StatusMap, value: string | null | undefined): StatusMeta {
  if (!value) return { label: "—", tone: "neutral" };
  return map[value] ?? { label: value.replace(/_/g, " "), tone: "neutral" };
}

/** Badge classes per tone — subtle wash + readable text in both themes. */
export const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  destructive: "bg-destructive/12 text-destructive border-destructive/25",
  info: "bg-info/12 text-info border-info/25",
  ai: "bg-ai/12 text-ai border-ai/25",
};

export const TONE_DOT_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  ai: "bg-ai",
};
