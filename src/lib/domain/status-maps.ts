/**
 * Single source of truth for status presentation. Tone maps to the semantic
 * roles + neutral; components never hardcode status colors.
 *
 * Every entry also carries a `hint`: one or two plain sentences that say what
 * the state means, what it blocks or unlocks, and what to do. `StatusPill`
 * shows it on hover and focus, and Help & glossary lists it, so the wording
 * lives here and nowhere else.
 */
export type StatusTone = "neutral" | "success" | "warning" | "destructive" | "info" | "ai";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  hint?: string;
}

export type StatusMap = Record<string, StatusMeta>;

export const LEAD_STATUS: StatusMap = {
  won: { label: "Closed sale", tone: "success", hint: "At least one confirmed documented sale retains positive net revenue. Deposits and opportunity creation alone do not close an inquiry." },
  new: { label: "New", tone: "info", hint: "Just arrived and nobody has reached out yet. The first-response clock is running." },
  contact_attempted: { label: "Contact attempted", tone: "warning", hint: "Someone tried to reach the customer but has not spoken to them yet." },
  contacted: { label: "Contacted", tone: "info", hint: "A conversation happened. The first-response clock has stopped." },
  qualified: { label: "Qualified", tone: "success", hint: "A real need with a budget and timing. Ready to convert into a project and opportunity." },
  disqualified: { label: "Lost", tone: "neutral", hint: "Closed without a sale, with a recorded reason. History remains searchable; reopen when the customer returns." },
  converted: { label: "Opportunity created", tone: "info", hint: "A project and opportunity were created. This does not mean a purchase was recorded." },
  duplicate: { label: "Duplicate", tone: "neutral", hint: "The same person already had a lead or contact. This one is linked, not deleted." },
};

export const OPPORTUNITY_STATUS: StatusMap = {
  open: { label: "Open", tone: "info", hint: "Still being worked. Counts toward open pipeline value." },
  won: { label: "Won", tone: "success", hint: "Closed with a sale. A reason is recorded when the stage is set." },
  lost: { label: "Lost", tone: "destructive", hint: "Closed without a sale. The reason is required and kept." },
  deferred: { label: "Deferred", tone: "neutral", hint: "Parked by the customer, not lost. Leaves open pipeline until reopened." },
};

export const STAGE_GROUP_TONE: Record<string, StatusTone> = { open: "info", won: "success", lost: "destructive", deferred: "neutral" };

export const TASK_STATUS: StatusMap = {
  open: { label: "Open", tone: "info", hint: "Still to do. Overdue once the due date passes." },
  done: { label: "Done", tone: "success", hint: "Completed. The outcome was appended to the linked record's timeline." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "No longer needed. Kept in history, not counted as work." },
};

export const TASK_PRIORITY: StatusMap = {
  low: { label: "Low", tone: "neutral", hint: "Do when convenient." },
  normal: { label: "Normal", tone: "info", hint: "Ordinary follow-up." },
  high: { label: "High", tone: "warning", hint: "Do before normal tasks today." },
  urgent: { label: "Urgent", tone: "destructive", hint: "Drop other work; a customer or deadline is waiting." },
};

export const LIFECYCLE_STATE: StatusMap = {
  new: { label: "New", tone: "info", hint: "No purchase recorded in the app yet." },
  active: { label: "Active", tone: "success", hint: "Bought within the last 12 months." },
  repeat: { label: "Repeat", tone: "ai", hint: "More than one purchase recorded in the app. Derived from app data only, not from SQL Account." },
  lapsed: { label: "Lapsed", tone: "warning", hint: "Bought before, but nothing for over 12 months." },
  reactivated: { label: "Reactivated", tone: "success", hint: "Lapsed, then bought again." },
};

export const CANDIDATE_CONFIDENCE: StatusMap = {
  high: { label: "High", tone: "success", hint: "An exact phone or email match. Still needs a person to confirm; nothing is merged automatically." },
  medium: { label: "Medium", tone: "warning", hint: "Similar name plus one supporting detail such as company or registration number." },
  low: { label: "Low", tone: "neutral", hint: "Name similarity only. Names alone are never enough to merge." },
};

export const CANDIDATE_STATUS: StatusMap = {
  suggested: { label: "Suggested", tone: "warning", hint: "The system thinks these two records may be the same person. Waiting for a decision." },
  confirmed: { label: "Merged", tone: "success", hint: "A sales manager confirmed the merge. Records moved to the surviving contact; reversible from here." },
  rejected: { label: "Rejected", tone: "neutral", hint: "Marked as not the same person. Becomes negative evidence so the pair is not suggested again." },
  superseded: { label: "Superseded", tone: "neutral", hint: "A newer suggestion or merge replaced this one, so it no longer needs a decision." },
};

export const PRODUCT_STATUS: StatusMap = {
  draft: { label: "Draft", tone: "neutral", hint: "Being set up. Not shown as sellable and cannot carry a published price." },
  active: { label: "Active", tone: "success", hint: "Sellable. Prices and stock can be attached." },
  discontinued: { label: "Discontinued", tone: "warning", hint: "No longer supplied. Existing prices stay for history; do not quote it." },
  archived: { label: "Archived", tone: "neutral", hint: "Hidden from daily lists. Kept for records and old purchases." },
};

export const REVIEW_STATE: StatusMap = {
  unreviewed: { label: "Unreviewed", tone: "warning", hint: "Imported or parsed but no person has confirmed the attributes and source yet. Do not rely on it for a quote." },
  reviewed: { label: "Reviewed", tone: "success", hint: "A catalog operator confirmed the attributes and provenance." },
  conflicted: { label: "Conflicted", tone: "destructive", hint: "Two sources disagree, or a published price overlaps another for the same scope. Blocked until resolved." },
  rejected: { label: "Rejected", tone: "neutral", hint: "Reviewed and refused, with a reason. Kept as evidence, not used." },
};

export const PRICE_STATE: StatusMap = {
  draft: { label: "Draft", tone: "neutral", hint: "Entered but not in force. Only drafts can be edited; publishing makes a new version." },
  scheduled: { label: "Scheduled", tone: "info", hint: "Published with a future start date. Becomes current on that date." },
  current: { label: "Current", tone: "success", hint: "The price in force today for this list, variant, basis and minimum quantity." },
  superseded: { label: "Superseded", tone: "neutral", hint: "Replaced by a newer published price. Never edited or deleted, so history stays intact." },
  expired: { label: "Expired", tone: "warning", hint: "Its end date passed and nothing replaced it. Quote only after a new price is published." },
  conflicted: { label: "Conflicted", tone: "destructive", hint: "Overlaps a current or scheduled price for the same scope. Resolve with an audited override or a date change." },
};

export const PURCHASE_STATUS: StatusMap = {
  draft: { label: "Pending evidence", tone: "warning", hint: "Saved sale details awaiting uploaded evidence and confirmation. Excluded from revenue and closed inquiries." },
  recorded: { label: "Recorded", tone: "success", hint: "Captured as entered at the counter." },
  corrected: { label: "Corrected", tone: "warning", hint: "The amount or payment was changed after recording, with a reason and an audit entry." },
  voided: { label: "Voided", tone: "destructive", hint: "Cancelled after recording. Kept for the audit trail; excluded from totals." },
};

export const CONNECTOR_STATUS: StatusMap = {
  not_configured: { label: "Not configured", tone: "neutral", hint: "No credentials or endpoint yet. Nothing is being received." },
  paused: { label: "Paused", tone: "warning", hint: "Deliberately stopped. Submissions are not accepted until resumed." },
  healthy: { label: "Healthy", tone: "success", hint: "Last read succeeded inside the freshness policy." },
  degraded: { label: "Degraded", tone: "warning", hint: "Working, but the last read is older than the policy allows or some items failed." },
  failed: { label: "Failed", tone: "destructive", hint: "The last read failed. Leads may be missing until it is fixed." },
};

export const ISSUE_SEVERITY: StatusMap = {
  low: { label: "Low", tone: "neutral", hint: "Cosmetic or informational. Fix when convenient." },
  medium: { label: "Medium", tone: "warning", hint: "Affects trust in a record. Fix this week." },
  high: { label: "High", tone: "destructive", hint: "Blocks quoting, publishing or lead intake. Fix now." },
};

export const ISSUE_STATUS: StatusMap = {
  open: { label: "Open", tone: "warning", hint: "Nobody has looked at it yet." },
  acknowledged: { label: "Acknowledged", tone: "info", hint: "Someone owns it and is working on it." },
  resolved: { label: "Resolved", tone: "success", hint: "Fixed, with a note on what was done." },
  ignored: { label: "Ignored", tone: "neutral", hint: "Judged not worth fixing, with a note. Can be reopened." },
};

export const ISSUE_TYPE: StatusMap = {
  duplicate_contact: { label: "Duplicate contact", tone: "warning", hint: "Two contacts may be the same person. Decide in Identity Review; nothing is merged automatically." },
  unmapped_field: { label: "Unmapped field", tone: "warning", hint: "A source sent a field the app does not recognise. Map it in Lead Connectors or the SQL tab." },
  unknown_unit: { label: "Unknown unit", tone: "warning", hint: "A price or stock figure arrived with a unit the app cannot interpret. Units are never guessed." },
  overlapping_price: { label: "Overlapping price", tone: "destructive", hint: "Two current prices cover the same scope. Resolve with an audited override or a date change." },
  stale_snapshot: { label: "Stale snapshot", tone: "warning", hint: "A supplier or SQL Account figure is older than its freshness policy. Chase an update." },
  sql_mismatch: { label: "SQL mismatch", tone: "destructive", hint: "The app and SQL Account disagree on a figure. Open a reconciliation case." },
  failed_webhook: { label: "Failed webhook", tone: "destructive", hint: "A lead submission could not be processed. Replay it from the intake log once fixed." },
  ocr_low_confidence: { label: "OCR low confidence", tone: "warning", hint: "A parsed value scored below the confidence band. Confirm it in Imports & OCR Review." },
};

export const SOURCE_CHANNEL: StatusMap = {
  tiktok: { label: "TikTok", tone: "ai", hint: "Came in through a TikTok lead form." },
  meta: { label: "Meta", tone: "info", hint: "Came in through a Facebook or Instagram lead form." },
  website: { label: "Website", tone: "info", hint: "Submitted the enquiry form on the website." },
  whatsapp: { label: "WhatsApp", tone: "success", hint: "Messaged the business on WhatsApp." },
  dm: { label: "DM", tone: "neutral", hint: "Direct message on a social platform." },
  call: { label: "Call", tone: "neutral", hint: "Phoned the showroom or a salesperson." },
  email: { label: "Email", tone: "neutral", hint: "Emailed the business." },
  referral: { label: "Referral", tone: "success", hint: "Introduced by an existing customer or partner." },
  walk_in: { label: "Walk-in", tone: "warning", hint: "Visited a showroom without a prior enquiry." },
  other: { label: "Other", tone: "neutral", hint: "A source not covered by the list. Check the source detail." },
};

export const APP_MODE: StatusMap = {
  demo: { label: "Demo", tone: "ai", hint: "Synthetic data in a shared workspace. Anything entered is reset on a schedule." },
  shadow: { label: "Shadow", tone: "info", hint: "Real intake is received and recorded but nothing is sent to customers or written back to other systems." },
  live: { label: "Live", tone: "warning", hint: "Real customers and real records. Every action is audited." },
};

export const PRICE_LIST_STATUS: StatusMap = {
  draft: { label: "Draft", tone: "neutral", hint: "Being set up. Prices in it cannot become current yet." },
  active: { label: "Active", tone: "success", hint: "Prices published into this list can be in force." },
  archived: { label: "Archived", tone: "neutral", hint: "Retired. Its prices stay for history and are never quoted." },
};

export const APPROVAL_ACTION: StatusMap = {
  approved: { label: "Approved", tone: "success", hint: "Published without conflict." },
  rejected: { label: "Rejected", tone: "destructive", hint: "The draft was refused with a reason and kept as evidence." },
  override: { label: "Override", tone: "warning", hint: "Published over an overlapping price, with a reason. The older price was superseded." },
  superseded: { label: "Superseded", tone: "neutral", hint: "This price was replaced by an override." },
};

export const MEMBER_STATUS: StatusMap = {
  active: { label: "Active", tone: "success", hint: "Can sign in and act under their role." },
  suspended: { label: "Suspended", tone: "warning", hint: "Cannot sign in. Records they created stay attributed to them." },
};

export const INVITE_STATUS: StatusMap = {
  pending: { label: "Pending", tone: "info", hint: "Sent, not yet accepted." },
  accepted: { label: "Accepted", tone: "success", hint: "The person joined and has a membership." },
  revoked: { label: "Revoked", tone: "neutral", hint: "Withdrawn before it was accepted." },
  expired: { label: "Expired", tone: "neutral", hint: "Not accepted in time. Send a new invitation." },
};

export const FEEDBACK_REQUEST_STATUS: StatusMap = {
  awaiting_customer: { label: "Awaiting customer", tone: "warning", hint: "The private link was prepared. The customer has not confirmed their feedback yet." },
  confirmed: { label: "Confirmed", tone: "success", hint: "The customer confirmed their private feedback. A Google handoff may follow; a click is never counted as a review." },
  declined: { label: "Declined", tone: "neutral", hint: "The customer chose not to give feedback. Nothing further is sent." },
  expired: { label: "Expired", tone: "destructive", hint: "The 7-day private link lapsed before the customer answered." },
  revoked: { label: "Revoked", tone: "destructive", hint: "Staff withdrew the request. The link no longer works." },
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
