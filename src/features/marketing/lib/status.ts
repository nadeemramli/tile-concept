import { CalendarCheck, CalendarClock, CalendarX, CameraOff, CheckCheck, CircleDashed, CircleHelp, Clock, FileCheck2, FileWarning, Hourglass, Pause, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, Sparkles, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";
import type { StatusMap, StatusTone } from "@/lib/domain/status-maps";

/**
 * Marketing-local status maps. Colour never carries a state on its own, so each
 * entry also names an icon (PRD §9.2) — several booking states share a tone.
 */
export interface MarketingStatusMeta {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  hint?: string;
}

export const BOOKING_STATUS: Record<string, MarketingStatusMeta> = {
  proposed: { label: "Proposed window", tone: "neutral", icon: CircleDashed, hint: "A window the customer suggested. Nothing is held yet." },
  tentative: { label: "Tentative hold", tone: "warning", icon: CalendarClock, hint: "Internal hold. Crew capacity is not committed." },
  standby: { label: "Standby", tone: "ai", icon: Hourglass, hint: "Held in reserve behind another booking." },
  customer_confirmation_pending: { label: "Awaiting customer", tone: "info", icon: Clock, hint: "Waiting for the customer to confirm the date." },
  confirmed: { label: "Confirmed", tone: "success", icon: CalendarCheck, hint: "Crew capacity is committed." },
  completed: { label: "Completed", tone: "success", icon: CheckCheck },
  partially_completed: { label: "Partly completed", tone: "warning", icon: CircleHelp },
  postponed: { label: "Postponed", tone: "warning", icon: Pause },
  cancelled: { label: "Cancelled", tone: "destructive", icon: CalendarX },
};

/** Statuses a booking can be created or moved into (outcomes are recorded separately). */
export const SCHEDULABLE_STATUSES = ["proposed", "tentative", "standby", "customer_confirmation_pending", "confirmed"] as const;
export const OUTCOMES = ["completed", "partially_completed", "postponed", "cancelled"] as const;
export const CLOSED_STATUSES = new Set(["completed", "partially_completed", "postponed", "cancelled"]);

export const PERMISSION_STATUS: Record<string, MarketingStatusMeta> = {
  not_requested: { label: "Not requested", tone: "neutral", icon: ShieldQuestion },
  requested: { label: "Requested", tone: "info", icon: ShieldQuestion },
  verbal_pending_written: { label: "Verbal, written pending", tone: "warning", icon: ShieldAlert },
  approved: { label: "Approved", tone: "success", icon: ShieldCheck },
  approved_with_restrictions: { label: "Approved with restrictions", tone: "success", icon: ShieldAlert },
  declined: { label: "Declined", tone: "destructive", icon: ShieldX },
  revoked: { label: "Revoked", tone: "destructive", icon: ShieldX },
  expired: { label: "Expired", tone: "destructive", icon: ShieldX },
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
  in_progress: { label: "In progress", tone: "neutral", icon: CircleDashed },
  substantially_complete: { label: "Substantially complete", tone: "info", icon: CircleHelp },
  ready: { label: "Ready to shoot", tone: "success", icon: CheckCheck },
  delayed: { label: "Delayed", tone: "warning", icon: Clock },
  inaccessible: { label: "Inaccessible", tone: "destructive", icon: CameraOff },
  completed: { label: "Completed", tone: "success", icon: CheckCheck },
};

export const READINESS_OPTIONS = ["in_progress", "substantially_complete", "ready", "delayed", "inaccessible", "completed"] as const;

export const CONTENT_STATUS: Record<string, MarketingStatusMeta> = {
  nominated: { label: "Nominated", tone: "info", icon: Sparkles },
  under_review: { label: "Under review", tone: "info", icon: UserCheck },
  needs_info: { label: "Needs info", tone: "warning", icon: CircleHelp },
  accepted: { label: "Accepted", tone: "success", icon: CheckCheck },
  deferred: { label: "Deferred", tone: "neutral", icon: Pause },
  declined: { label: "Declined", tone: "destructive", icon: CalendarX },
  scheduled: { label: "Scheduled", tone: "ai", icon: CalendarClock },
  completed: { label: "Completed", tone: "success", icon: CheckCheck },
  cancelled: { label: "Cancelled", tone: "destructive", icon: CalendarX },
};

export const OUTPUT_STATE: Record<string, MarketingStatusMeta> = {
  uploaded: { label: "Uploaded", tone: "neutral", icon: FileCheck2 },
  reviewing: { label: "Reviewing", tone: "info", icon: Clock },
  usable: { label: "Usable", tone: "success", icon: CheckCheck },
  restricted: { label: "Restricted", tone: "warning", icon: ShieldAlert },
  rejected: { label: "Rejected", tone: "destructive", icon: FileWarning },
  archived: { label: "Archived", tone: "neutral", icon: CircleDashed },
  permission_review_required: { label: "Permission review required", tone: "destructive", icon: TriangleAlert },
};

export const PRIORITY: StatusMap = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "info" },
  high: { label: "High", tone: "warning" },
};

export const CONTENT_TYPES = [
  { value: "before_after", label: "Before / after" },
  { value: "walkthrough", label: "Completed walkthrough" },
  { value: "testimonial", label: "Testimonial or interview" },
  { value: "process", label: "Installation / process" },
  { value: "short_form", label: "Short-form social" },
  { value: "showcase", label: "Product or workmanship showcase" },
] as const;

export const CAPTURE_TYPES = [
  { value: "photo", label: "Photography" },
  { value: "video", label: "Video" },
  { value: "interview", label: "Interview / voice" },
  { value: "drone", label: "Drone / exterior" },
] as const;

export const PERMITTED_USES = [
  { value: "website", label: "Website" },
  { value: "social", label: "Social media" },
  { value: "print", label: "Print" },
  { value: "showroom", label: "Showroom display" },
  { value: "advertising", label: "Paid advertising" },
  { value: "case_study", label: "Case study" },
] as const;

export const PARTICIPANT_ROLES = ["coordinator", "crew", "standby", "interviewer", "salesperson", "customer"] as const;
export const OUTPUT_KINDS = ["photo", "video", "interview_notes", "other"] as const;
export const PRODUCT_INTEREST_OPTIONS = ["wall_panel", "tile", "cut_tile", "mosaic", "finishing", "accessory"] as const;

export function meta(map: Record<string, MarketingStatusMeta>, value: string | null | undefined): MarketingStatusMeta {
  if (!value) return { label: "—", tone: "neutral", icon: CircleDashed };
  return map[value] ?? { label: value.replace(/_/g, " "), tone: "neutral", icon: CircleDashed };
}

/** Label-only map for the shared StatusPill (which takes a StatusMap). */
export function toStatusMap(map: Record<string, MarketingStatusMeta>): StatusMap {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { label: v.label, tone: v.tone }]));
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
