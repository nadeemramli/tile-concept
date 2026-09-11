import { CalendarCheck, CalendarClock, CalendarX, CameraOff, CheckCheck, CircleDashed, CircleHelp, Clock, FileCheck2, FileWarning, Hourglass, Pause, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, Sparkles, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
import type { StatusMap, StatusTone } from "@/lib/domain/status-maps";
import type { RichHint } from "@/components/patterns/explain";

/**
 * Marketing-local status maps. Colour never carries a state on its own, so each
 * entry also names an icon (PRD §9.2) — several booking states share a tone.
 *
 * Wording rule: the customer's consent to be filmed and featured is always
 * "customer media permission", never bare "permission". The word on its own
 * reads as an access-role problem, which it is not (PRD §7.11).
 */
export interface MarketingStatusMeta {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  hint?: string;
}

/** Deep links into Help & glossary, used by hints that deserve a longer read. */
export const HELP = {
  customerMediaPermission: "/platform/help#customer-media-permission",
  bookingStatus: "/platform/help#booking-status",
  readiness: "/platform/help#project-readiness",
  assetState: "/platform/help#asset-state",
} as const;

export const CUSTOMER_MEDIA_PERMISSION_HINT: RichHint = {
  title: "Customer media permission",
  body: "The customer's documented agreement to be photographed or filmed and to have the material used in marketing. It is recorded on the nomination, separately from sales-contact consent, and has nothing to do with your own access in this app.",
  action: { label: "Read more in Help & glossary", href: HELP.customerMediaPermission },
};

export const BOOKING_STATUS: Record<string, MarketingStatusMeta> = {
  proposed: { label: "Proposed window", tone: "neutral", icon: CircleDashed, hint: "A window the customer suggested. Nothing is held yet." },
  tentative: { label: "Tentative hold", tone: "warning", icon: CalendarClock, hint: "An internal hold on the date. Crew capacity is not committed until a coordinator confirms." },
  standby: { label: "Standby", tone: "ai", icon: Hourglass, hint: "Held in reserve behind another booking. Goes ahead only if that one falls through." },
  customer_confirmation_pending: { label: "Awaiting customer", tone: "info", icon: Clock, hint: "Waiting for the customer to confirm the date." },
  confirmed: { label: "Confirmed", tone: "success", icon: CalendarCheck, hint: "Crew capacity is committed. Clashes were checked when it was confirmed." },
  completed: { label: "Completed", tone: "success", icon: CheckCheck, hint: "The shoot happened as planned. Outputs can be attached." },
  partially_completed: { label: "Partly completed", tone: "warning", icon: CircleHelp, hint: "The crew went but could not capture everything. The reason is on the booking." },
  postponed: { label: "Postponed", tone: "warning", icon: Pause, hint: "Did not go ahead and will be rebooked. The previous slot stays in the history." },
  cancelled: { label: "Cancelled", tone: "destructive", icon: CalendarX, hint: "Will not happen, with a reason recorded. The nomination stays open unless it is also cancelled." },
};

/** Statuses a booking can be created or moved into (outcomes are recorded separately). */
export const SCHEDULABLE_STATUSES = ["proposed", "tentative", "standby", "customer_confirmation_pending", "confirmed"] as const;
export const OUTCOMES = ["completed", "partially_completed", "postponed", "cancelled"] as const;
export const CLOSED_STATUSES = new Set(["completed", "partially_completed", "postponed", "cancelled"]);

export const PERMISSION_STATUS: Record<string, MarketingStatusMeta> = {
  not_requested: {
    label: "Not requested",
    tone: "neutral",
    icon: ShieldQuestion,
    hint: "The customer has not yet been asked whether this project may be photographed and used in marketing. A shoot date can still be held; assets cannot be marked usable. Record the answer on the nomination.",
  },
  requested: { label: "Requested", tone: "info", icon: ShieldQuestion, hint: "The customer has been asked and has not answered yet. Dates can be held; assets wait." },
  verbal_pending_written: {
    label: "Verbal, written pending",
    tone: "warning",
    icon: ShieldAlert,
    hint: "The customer agreed in conversation but written evidence is still outstanding. Not enough on its own to mark assets usable.",
  },
  approved: { label: "Approved", tone: "success", icon: ShieldCheck, hint: "The customer agreed to the recorded capture types and uses. Assets from the shoot can be marked usable." },
  approved_with_restrictions: {
    label: "Approved with restrictions",
    tone: "success",
    icon: ShieldAlert,
    hint: "Approved, with limits written on the record. Read the restrictions before shooting or publishing.",
  },
  declined: { label: "Declined", tone: "destructive", icon: ShieldX, hint: "The customer said no. Do not shoot, and any existing assets go back for permission review." },
  revoked: { label: "Revoked", tone: "destructive", icon: ShieldX, hint: "The customer withdrew an earlier approval, with a reason on record. Assets already marked usable return for review." },
  expired: { label: "Expired", tone: "destructive", icon: ShieldX, hint: "The approval passed its end date. Ask the customer again before marking anything usable." },
};

export const PERMISSION_OPTIONS = [
  "not_requested",
  "requested",
  "verbal_pending_written",
  "approved",
  "approved_with_restrictions",
  "declined",
  "revoked",
  "expired",
] as const;

/** Permission states that allow an asset to be marked usable. */
export const PERMISSION_APPROVED = new Set(["approved", "approved_with_restrictions"]);

export const READINESS_STATE: Record<string, MarketingStatusMeta> = {
  in_progress: { label: "In progress", tone: "neutral", icon: CircleDashed, hint: "Work on site is still going. Too early to shoot." },
  substantially_complete: { label: "Substantially complete", tone: "info", icon: CircleHelp, hint: "Most of the work is done. Confirm the remaining items with the site before booking." },
  ready: { label: "Ready to shoot", tone: "success", icon: CheckCheck, hint: "The salesperson or project owner confirmed the site is finished and presentable." },
  delayed: { label: "Delayed", tone: "warning", icon: Clock, hint: "The finish date slipped. Do not travel until it is confirmed ready." },
  inaccessible: { label: "Inaccessible", tone: "destructive", icon: CameraOff, hint: "The crew cannot get in: occupied, locked, or the customer withdrew access." },
  completed: { label: "Completed", tone: "success", icon: CheckCheck, hint: "The project is finished and handed over." },
};

export const READINESS_OPTIONS = ["in_progress", "substantially_complete", "ready", "delayed", "inaccessible", "completed"] as const;

export const CONTENT_STATUS: Record<string, MarketingStatusMeta> = {
  nominated: { label: "Nominated", tone: "info", icon: Sparkles, hint: "Sales put this project forward. Marketing has not looked at it yet." },
  under_review: { label: "Under review", tone: "info", icon: UserCheck, hint: "Marketing is assessing whether it is worth a shoot." },
  needs_info: { label: "Needs info", tone: "warning", icon: CircleHelp, hint: "Marketing asked Sales a question before deciding. The question is in the status history." },
  accepted: { label: "Accepted", tone: "success", icon: CheckCheck, hint: "Marketing wants it. A shoot can be booked once the site is ready and the customer has given media permission." },
  deferred: { label: "Deferred", tone: "neutral", icon: Pause, hint: "Worth doing, but not now. The reason is recorded." },
  declined: { label: "Declined", tone: "destructive", icon: CalendarX, hint: "Marketing passed on it, with a reason recorded." },
  scheduled: { label: "Scheduled", tone: "ai", icon: CalendarClock, hint: "A shoot booking exists. See the Shoot Calendar." },
  completed: { label: "Completed", tone: "success", icon: CheckCheck, hint: "The shoot happened and outputs are attached." },
  cancelled: { label: "Cancelled", tone: "destructive", icon: CalendarX, hint: "Withdrawn after acceptance, with a reason recorded." },
};

export const OUTPUT_STATE: Record<string, MarketingStatusMeta> = {
  uploaded: { label: "Uploaded", tone: "neutral", icon: FileCheck2, hint: "On file, not reviewed. Cannot be used yet." },
  reviewing: { label: "Reviewing", tone: "info", icon: Clock, hint: "A coordinator is checking it against the customer media permission." },
  usable: { label: "Usable", tone: "success", icon: CheckCheck, hint: "Cleared for the uses the customer permitted. Publishing itself happens outside this app." },
  restricted: { label: "Restricted", tone: "warning", icon: ShieldAlert, hint: "Kept on file but out of use, with a reason." },
  rejected: { label: "Rejected", tone: "destructive", icon: FileWarning, hint: "Taken out of consideration, with a reason. Not deleted." },
  archived: { label: "Archived", tone: "neutral", icon: CircleDashed, hint: "Retired from active use. Kept for records." },
  permission_review_required: {
    label: "Permission review required",
    tone: "destructive",
    icon: TriangleAlert,
    hint: "The customer media permission was declined, revoked or expired after this was filed. It must be reviewed again before any use.",
  },
};

export const PRIORITY: StatusMap = {
  low: { label: "Low", tone: "neutral", hint: "Shoot if capacity allows." },
  normal: { label: "Normal", tone: "info", hint: "Ordinary priority for the content calendar." },
  high: { label: "High", tone: "warning", hint: "Marketing wants this soon; book ahead of normal nominations." },
};

export const CONTENT_TYPES = [
  { value: "before_after", label: "Before / after", hint: "Paired shots of the space before and after the work." },
  { value: "walkthrough", label: "Completed walkthrough", hint: "A guided pass through the finished space, usually video." },
  { value: "testimonial", label: "Testimonial or interview", hint: "The customer speaking on camera or on record. Needs interview consent in the media permission." },
  { value: "process", label: "Installation / process", hint: "Work in progress: cutting, laying, finishing." },
  { value: "short_form", label: "Short-form social", hint: "Vertical clips for TikTok, Reels or Shorts." },
  { value: "showcase", label: "Product or workmanship showcase", hint: "Close-ups of the tiles and finish for the catalog and website." },
] as const;

export const CAPTURE_TYPES = [
  { value: "photo", label: "Photography", hint: "Still images." },
  { value: "video", label: "Video", hint: "Moving images, with or without sound." },
  { value: "interview", label: "Interview / voice", hint: "The customer's voice or words. Needed for testimonials." },
  { value: "drone", label: "Drone / exterior", hint: "Aerial or outside shots, which may show the address." },
] as const;

export const PERMITTED_USES = [
  { value: "website", label: "Website", hint: "The company website and case-study pages." },
  { value: "social", label: "Social media", hint: "Organic posts on the company's own accounts." },
  { value: "print", label: "Print", hint: "Brochures, showroom boards, magazines." },
  { value: "showroom", label: "Showroom display", hint: "Screens and boards inside the showrooms." },
  { value: "advertising", label: "Paid advertising", hint: "Boosted or paid placements. Ask for this explicitly; it is not implied by social." },
  { value: "case_study", label: "Case study", hint: "A written feature that may name the project and area." },
] as const;

export const PARTICIPANT_ROLES = ["coordinator", "crew", "standby", "interviewer", "salesperson", "customer"] as const;

export const PARTICIPANT_ROLE_HINTS: Record<(typeof PARTICIPANT_ROLES)[number], string> = {
  coordinator: "Owns the booking: confirms, reschedules and records the outcome.",
  crew: "On site with equipment. Checked for clashes with other bookings.",
  standby: "Held in reserve. Still checked for clashes so they can step in.",
  interviewer: "Leads the customer conversation on camera or on record.",
  salesperson: "The customer's contact. Confirms readiness and access.",
  customer: "The customer or their representative attending the shoot.",
};

export const OUTPUT_KINDS = ["photo", "video", "interview_notes", "other"] as const;
export const PRODUCT_INTEREST_OPTIONS = ["wall_panel", "tile", "cut_tile", "mosaic", "finishing", "accessory"] as const;

export function meta(map: Record<string, MarketingStatusMeta>, value: string | null | undefined): MarketingStatusMeta {
  if (!value) return { label: "—", tone: "neutral", icon: CircleDashed };
  return map[value] ?? { label: value.replace(/_/g, " "), tone: "neutral", icon: CircleDashed };
}

/** Label + tone + hint map for the shared StatusPill (which takes a StatusMap). */
export function toStatusMap(map: Record<string, MarketingStatusMeta>): StatusMap {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { label: v.label, tone: v.tone, hint: v.hint }]));
}

export const BOOKING_STATUS_MAP = toStatusMap(BOOKING_STATUS);
export const PERMISSION_STATUS_MAP = toStatusMap(PERMISSION_STATUS);
export const READINESS_STATE_MAP = toStatusMap(READINESS_STATE);
export const CONTENT_STATUS_MAP = toStatusMap(CONTENT_STATUS);
export const OUTPUT_STATE_MAP = toStatusMap(OUTPUT_STATE);

/** Calendar chip styling: a tone wash plus a left accent so status reads at a glance. */
export const CHIP_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground border-l-muted-foreground/60",
  success: "bg-success/12 text-success border-l-success",
  warning: "bg-warning/12 text-warning border-l-warning",
  destructive: "bg-destructive/12 text-destructive border-l-destructive",
  info: "bg-info/12 text-info border-l-info",
  ai: "bg-ai/12 text-ai border-l-ai",
};

/** True when an asset may not be published yet. */
export function permissionBlocks(status: string | null | undefined, expiresAt: string | null | undefined): boolean {
  if (!status || !PERMISSION_APPROVED.has(status)) return true;
  if (expiresAt && expiresAt.slice(0, 10) < new Date().toISOString().slice(0, 10)) return true;
  return false;
}

/**
 * One sentence that names the customer media permission state and what it
 * means for this shoot. Used by calendar chips, the agenda and the drawers so
 * the wording is identical everywhere.
 */
export function permissionSentence(status: string | null | undefined, expiresAt: string | null | undefined): string {
  const s = status ?? "not_requested";
  const m = meta(PERMISSION_STATUS, s);
  const lapsed = PERMISSION_APPROVED.has(s) && permissionBlocks(s, expiresAt);
  if (lapsed) return `Customer media permission: ${m.label}, but it expired on ${expiresAt?.slice(0, 10)}. ${PERMISSION_STATUS.expired.hint}`;
  return `Customer media permission: ${m.label}. ${m.hint ?? ""}`.trim();
}

/** Rich hint for a permission state, with the glossary link. */
export function permissionHint(status: string | null | undefined, expiresAt: string | null | undefined): RichHint {
  return {
    title: "Customer media permission",
    body: permissionSentence(status, expiresAt).replace(/^Customer media permission: /, ""),
    action: { label: "What is customer media permission?", href: HELP.customerMediaPermission },
  };
}
