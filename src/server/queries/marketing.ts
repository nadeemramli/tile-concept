import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { rangeFor, dayStartUtc, dayEndUtc } from "@/features/marketing/lib/time";

export type ContentView = "inbox" | "accepted" | "scheduled" | "completed" | "declined" | "all";

const INBOX = ["nominated", "under_review", "needs_info"];
const CLOSED = ["declined", "deferred", "cancelled"];

export interface PermissionRecord {
  id: string;
  status: string;
  granted_by_name: string | null;
  granted_at: string | null;
  permitted_capture: string[];
  permitted_uses: string[];
  restrictions: string | null;
  expires_at: string | null;
  evidence_storage_path: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  recorded_by: string | null;
  updated_at: string | null;
}

export interface ContentOpportunityRow {
  id: string;
  status: string;
  readiness_state: string;
  priority: string;
  story_angle: string | null;
  nomination_reason: string | null;
  content_types: string[];
  products_used: string[];
  site_notes: string | null;
  interview_subjects: string | null;
  special_requirements: string | null;
  target_window_start: string | null;
  target_window_end: string | null;
  project_id: string | null;
  project_name: string | null;
  project_area: string | null;
  contact_id: string | null;
  contact_name: string | null;
  account_id: string | null;
  account_name: string | null;
  opportunity_id: string | null;
  nominated_by: string | null;
  customer_owner_id: string | null;
  marketing_owner_id: string | null;
  created_at: string;
  updated_at: string;
  permission: PermissionRecord | null;
  booking_status: string | null;
  booking_starts_at: string | null;
  booking_id: string | null;
  output_count: number;
}

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

function mapPermission(p: Rec | null | undefined): PermissionRecord | null {
  if (!p) return null;
  return {
    id: p.id as string,
    status: (str(p.status) ?? "not_requested") as string,
    granted_by_name: str(p.granted_by_name),
    granted_at: str(p.granted_at),
    permitted_capture: arr(p.permitted_capture),
    permitted_uses: arr(p.permitted_uses),
    restrictions: str(p.restrictions),
    expires_at: str(p.expires_at),
    evidence_storage_path: str(p.evidence_storage_path),
    revoked_at: str(p.revoked_at),
    revocation_reason: str(p.revocation_reason),
    recorded_by: str(p.recorded_by),
    updated_at: str(p.updated_at),
  };
}

const CONTENT_SELECT =
  "*, projects(name, area), contacts(display_name), accounts(name), media_permission_records(*), shoot_bookings(id, status, starts_at), shoot_outputs(id)";

function mapContentRow(o: Rec): ContentOpportunityRow {
  const perms = (o.media_permission_records as Rec[] | null) ?? [];
  const bookings = ((o.shoot_bookings as Rec[] | null) ?? []).slice().sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const live = bookings.find((b) => !["cancelled", "postponed"].includes(String(b.status))) ?? bookings[0];
  return {
    id: o.id as string,
    status: str(o.status) ?? "nominated",
    readiness_state: str(o.readiness_state) ?? "in_progress",
    priority: str(o.priority) ?? "normal",
    story_angle: str(o.story_angle),
    nomination_reason: str(o.nomination_reason),
    content_types: arr(o.content_types),
    products_used: arr(o.products_used),
    site_notes: str(o.site_notes),
    interview_subjects: str(o.interview_subjects),
    special_requirements: str(o.special_requirements),
    target_window_start: str(o.target_window_start),
    target_window_end: str(o.target_window_end),
    project_id: str(o.project_id),
    project_name: (o.projects as { name?: string } | null)?.name ?? null,
    project_area: (o.projects as { area?: string } | null)?.area ?? null,
    contact_id: str(o.contact_id),
    contact_name: (o.contacts as { display_name?: string } | null)?.display_name ?? null,
    account_id: str(o.account_id),
    account_name: (o.accounts as { name?: string } | null)?.name ?? null,
    opportunity_id: str(o.opportunity_id),
    nominated_by: str(o.nominated_by),
    customer_owner_id: str(o.customer_owner_id),
    marketing_owner_id: str(o.marketing_owner_id),
    created_at: (o.created_at as string) ?? "",
    updated_at: (o.updated_at as string) ?? "",
    permission: mapPermission(perms[0]),
    booking_status: live ? str(live.status) : null,
    booking_starts_at: live ? str(live.starts_at) : null,
    booking_id: live ? (live.id as string) : null,
    output_count: ((o.shoot_outputs as Rec[] | null) ?? []).length,
  };
}

export async function listContentOpportunities(view: ContentView): Promise<ContentOpportunityRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("content_opportunities").select(CONTENT_SELECT).order("created_at", { ascending: false }).limit(500);
  switch (view) {
    case "inbox":
      q = q.in("status", INBOX);
      break;
    case "accepted":
      q = q.eq("status", "accepted");
      break;
    case "scheduled":
      q = q.eq("status", "scheduled");
      break;
    case "completed":
      q = q.eq("status", "completed");
      break;
    case "declined":
      q = q.in("status", CLOSED);
      break;
    case "all":
      break;
  }
  const { data } = await q;
  return (data ?? []).map((o) => mapContentRow(o as unknown as Rec));
}

export interface ContentCounts {
  awaiting_review: number;
  permission_missing: number;
  permission_expiring: number;
  ready_to_schedule: number;
  scheduled: number;
  completed: number;
}

/** Counts for the exception strip, over every live nomination. */
export async function getContentCounts(): Promise<ContentCounts> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("content_opportunities").select("id, status, readiness_state, media_permission_records(status, expires_at)").limit(2000);
  const rows = (data ?? []) as unknown as Rec[];
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const counts: ContentCounts = { awaiting_review: 0, permission_missing: 0, permission_expiring: 0, ready_to_schedule: 0, scheduled: 0, completed: 0 };
  for (const r of rows) {
    const status = str(r.status) ?? "";
    const perm = ((r.media_permission_records as Rec[] | null) ?? [])[0];
    const pStatus = perm ? (str(perm.status) ?? "not_requested") : "not_requested";
    const expires = perm ? str(perm.expires_at) : null;
    const approved = pStatus === "approved" || pStatus === "approved_with_restrictions";
    const live = !CLOSED.includes(status);
    if (INBOX.includes(status)) counts.awaiting_review += 1;
    if (live && !approved && status !== "completed") counts.permission_missing += 1;
    if (approved && expires && expires <= in30) counts.permission_expiring += 1;
    if (status === "accepted" && str(r.readiness_state) === "ready" && approved) counts.ready_to_schedule += 1;
    if (status === "scheduled") counts.scheduled += 1;
    if (status === "completed") counts.completed += 1;
  }
  return counts;
}

export interface StatusEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  actor_id: string | null;
  occurred_at: string;
}

export interface OutputRow {
  id: string;
  kind: string;
  state: string;
  storage_path: string | null;
  caption: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  captured_at: string | null;
  uploaded_by: string | null;
  shoot_booking_id: string | null;
  reviews: { id: string; decision: string; reason: string | null; reviewer_id: string | null; reviewed_at: string }[];
}

export interface BookingSummary {
  id: string;
  title: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  coordinator_id: string | null;
  outcome: string | null;
  outcome_reason: string | null;
}

export interface ContentOpportunityDetail extends ContentOpportunityRow {
  status_events: StatusEvent[];
  outputs: OutputRow[];
  bookings: BookingSummary[];
}

function mapOutput(o: Rec): OutputRow {
  return {
    id: o.id as string,
    kind: str(o.kind) ?? "other",
    state: str(o.state) ?? "uploaded",
    storage_path: str(o.storage_path),
    caption: str(o.caption),
    mime_type: str(o.mime_type),
    size_bytes: o.size_bytes === null || o.size_bytes === undefined ? null : Number(o.size_bytes),
    captured_at: str(o.captured_at),
    uploaded_by: str(o.uploaded_by),
    shoot_booking_id: str(o.shoot_booking_id),
    reviews: ((o.content_asset_reviews as Rec[] | null) ?? []).map((r) => ({
      id: r.id as string,
      decision: str(r.decision) ?? "",
      reason: str(r.reason),
      reviewer_id: str(r.reviewer_id),
      reviewed_at: (r.reviewed_at as string) ?? "",
    })),
  };
}

export async function getContentOpportunityDetail(id: string): Promise<ContentOpportunityDetail | null> {
  const supabase = await createServerSupabase();
  const [{ data: row }, { data: events }, { data: outputs }, { data: bookings }] = await Promise.all([
    supabase.from("content_opportunities").select(CONTENT_SELECT).eq("id", id).maybeSingle(),
    supabase.from("content_opportunity_status_events").select("*").eq("content_opportunity_id", id).order("occurred_at", { ascending: false }),
    supabase.from("shoot_outputs").select("*, content_asset_reviews(*)").eq("content_opportunity_id", id).order("created_at", { ascending: false }),
    supabase.from("shoot_bookings").select("id, title, status, starts_at, ends_at, coordinator_id, outcome, outcome_reason").eq("content_opportunity_id", id).order("starts_at"),
  ]);
  if (!row) return null;
  return {
    ...mapContentRow(row as unknown as Rec),
    status_events: ((events ?? []) as unknown as Rec[]).map((e) => ({
      id: e.id as string,
      from_status: str(e.from_status),
      to_status: str(e.to_status) ?? "",
      reason: str(e.reason),
      actor_id: str(e.actor_id),
      occurred_at: (e.occurred_at as string) ?? "",
    })),
    outputs: ((outputs ?? []) as unknown as Rec[]).map(mapOutput),
    bookings: ((bookings ?? []) as unknown as Rec[]).map((b) => ({
      id: b.id as string,
      title: str(b.title),
      status: str(b.status) ?? "",
      starts_at: (b.starts_at as string) ?? "",
      ends_at: (b.ends_at as string) ?? "",
      coordinator_id: str(b.coordinator_id),
      outcome: str(b.outcome),
      outcome_reason: str(b.outcome_reason),
    })),
  };
}

/* -------------------------------------------------------------- calendar -- */

export interface Participant {
  user_id: string | null;
  name: string | null;
  role: string;
  status: string;
}

export interface CalendarBooking {
  id: string;
  content_opportunity_id: string;
  title: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  coordinator_id: string | null;
  outcome: string | null;
  outcome_reason: string | null;
  notes: string | null;
  project_id: string | null;
  project_name: string | null;
  project_area: string | null;
  contact_id: string | null;
  contact_name: string | null;
  account_id: string | null;
  account_name: string | null;
  story_angle: string | null;
  content_types: string[];
  readiness_state: string | null;
  priority: string | null;
  permission_status: string | null;
  permission_expires_at: string | null;
  participants: Participant[];
  site_count: number;
  output_count: number;
}

function mapBooking(b: Rec): CalendarBooking {
  const raw = b.participants;
  const participants: Participant[] = Array.isArray(raw)
    ? (raw as Rec[]).map((p) => ({ user_id: str(p.user_id), name: str(p.name), role: str(p.role) ?? "crew", status: str(p.status) ?? "assigned" }))
    : [];
  return {
    id: b.id as string,
    content_opportunity_id: (b.content_opportunity_id as string) ?? "",
    title: str(b.title),
    status: str(b.status) ?? "tentative",
    starts_at: (b.starts_at as string) ?? "",
    ends_at: (b.ends_at as string) ?? "",
    all_day: Boolean(b.all_day),
    timezone: str(b.timezone) ?? "Asia/Kuala_Lumpur",
    coordinator_id: str(b.coordinator_id),
    outcome: str(b.outcome),
    outcome_reason: str(b.outcome_reason),
    notes: str(b.notes),
    project_id: str(b.project_id),
    project_name: str(b.project_name),
    project_area: str(b.project_area),
    contact_id: str(b.contact_id),
    contact_name: str(b.contact_name),
    account_id: str(b.account_id),
    account_name: str(b.account_name),
    story_angle: str(b.story_angle),
    content_types: arr(b.content_types),
    readiness_state: str(b.readiness_state),
    priority: str(b.priority),
    permission_status: str(b.permission_status),
    permission_expires_at: str(b.permission_expires_at),
    participants,
    site_count: Number(b.site_count ?? 0),
    output_count: Number(b.output_count ?? 0),
  };
}

export async function listCalendarBookings(view: "month" | "week" | "day" | "agenda", anchor: string): Promise<CalendarBooking[]> {
  const supabase = await createServerSupabase();
  const { from, to } = rangeFor(view, anchor);
  const { data } = await supabase
    .from("shoot_calendar")
    .select("*")
    .gte("starts_at", dayStartUtc(from))
    .lte("starts_at", dayEndUtc(to))
    .order("starts_at");
  return ((data ?? []) as unknown as Rec[]).map(mapBooking);
}

/** The next seven days, for the side agenda — independent of the visible range. */
export async function listUpcomingBookings(days = 7): Promise<CalendarBooking[]> {
  const supabase = await createServerSupabase();
  const now = new Date().toISOString();
  const until = new Date(Date.now() + days * 86400000).toISOString();
  const { data } = await supabase.from("shoot_calendar").select("*").gte("starts_at", now).lte("starts_at", until).order("starts_at").limit(50);
  return ((data ?? []) as unknown as Rec[]).map(mapBooking);
}

export interface SiteRow {
  id: string;
  project_site_id: string | null;
  site_label: string | null;
  sequence: number;
  travel_buffer_minutes: number;
  notes: string | null;
  address: Record<string, unknown> | null;
}

export interface ChecklistRow {
  id: string;
  item: string;
  is_done: boolean;
  done_by: string | null;
  done_at: string | null;
}

export interface BookingDetail extends CalendarBooking {
  sites: SiteRow[];
  checklists: ChecklistRow[];
  outputs: OutputRow[];
  status_events: { id: string; from_status: string | null; to_status: string; previous_starts_at: string | null; previous_ends_at: string | null; reason: string | null; actor_id: string | null; occurred_at: string }[];
}

export async function getBookingDetail(id: string): Promise<BookingDetail | null> {
  const supabase = await createServerSupabase();
  const { data: booking } = await supabase.from("shoot_calendar").select("*").eq("id", id).maybeSingle();
  if (!booking) return null;
  const [{ data: sites }, { data: checklists }, { data: outputs }, { data: events }] = await Promise.all([
    supabase.from("shoot_locations").select("*, project_sites(label, address)").eq("shoot_booking_id", id).order("sequence"),
    supabase.from("shoot_checklists").select("*").eq("shoot_booking_id", id).order("id"),
    supabase.from("shoot_outputs").select("*, content_asset_reviews(*)").eq("shoot_booking_id", id).order("created_at", { ascending: false }),
    supabase.from("shoot_booking_status_events").select("*").eq("shoot_booking_id", id).order("occurred_at", { ascending: false }),
  ]);
  return {
    ...mapBooking(booking as unknown as Rec),
    sites: ((sites ?? []) as unknown as Rec[]).map((s) => ({
      id: s.id as string,
      project_site_id: str(s.project_site_id),
      site_label: (s.project_sites as { label?: string } | null)?.label ?? null,
      sequence: Number(s.sequence ?? 1),
      travel_buffer_minutes: Number(s.travel_buffer_minutes ?? 0),
      notes: str(s.notes),
      address: ((s.project_sites as { address?: Record<string, unknown> } | null)?.address ?? (s.address as Record<string, unknown> | null)) ?? null,
    })),
    checklists: ((checklists ?? []) as unknown as Rec[]).map((c) => ({
      id: c.id as string,
      item: str(c.item) ?? "",
      is_done: Boolean(c.is_done),
      done_by: str(c.done_by),
      done_at: str(c.done_at),
    })),
    outputs: ((outputs ?? []) as unknown as Rec[]).map(mapOutput),
    status_events: ((events ?? []) as unknown as Rec[]).map((e) => ({
      id: e.id as string,
      from_status: str(e.from_status),
      to_status: str(e.to_status) ?? "",
      previous_starts_at: str(e.previous_starts_at),
      previous_ends_at: str(e.previous_ends_at),
      reason: str(e.reason),
      actor_id: str(e.actor_id),
      occurred_at: (e.occurred_at as string) ?? "",
    })),
  };
}

export interface SchedulableOpportunity {
  id: string;
  label: string;
  project_id: string | null;
  project_name: string | null;
  contact_name: string | null;
  permission_status: string | null;
  readiness_state: string;
  target_window_start: string | null;
  target_window_end: string | null;
}

/** Nominations that may be booked: accepted or already scheduled. */
export async function listSchedulableOpportunities(): Promise<SchedulableOpportunity[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("content_opportunities")
    .select("id, status, readiness_state, story_angle, target_window_start, target_window_end, project_id, projects(name), contacts(display_name), media_permission_records(status)")
    .in("status", ["accepted", "scheduled", "needs_info", "under_review", "nominated"])
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as Rec[]).map((o) => {
    const project = (o.projects as { name?: string } | null)?.name ?? null;
    return {
      id: o.id as string,
      label: project ?? str(o.story_angle) ?? "Content opportunity",
      project_id: str(o.project_id),
      project_name: project,
      contact_name: (o.contacts as { display_name?: string } | null)?.display_name ?? null,
      permission_status: ((o.media_permission_records as Rec[] | null) ?? [])[0]?.status as string | null,
      readiness_state: str(o.readiness_state) ?? "in_progress",
      target_window_start: str(o.target_window_start),
      target_window_end: str(o.target_window_end),
    };
  });
}

export async function listProjectSites(projectId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("project_sites").select("id, label, address").eq("project_id", projectId).order("label");
  return ((data ?? []) as unknown as Rec[]).map((s) => ({ id: s.id as string, label: str(s.label) ?? "Site", address: (s.address as Record<string, unknown> | null) ?? null }));
}
