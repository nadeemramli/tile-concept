"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission, requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import {
  bookingSchema,
  checklistAddSchema,
  checklistToggleSchema,
  conflictSchema,
  contentStatusSchema,
  nominateSchema,
  outcomeSchema,
  outputReviewSchema,
  outputSchema,
  permissionSchema,
  readinessSchema,
  signedUrlSchema,
} from "@/features/marketing/schema";

function revalidateMarketing(projectId?: string | null, contactId?: string | null) {
  revalidatePath("/marketing/content-opportunities");
  revalidatePath("/marketing/shoot-calendar");
  revalidatePath("/");
  if (projectId) revalidatePath(`/sales/projects/${projectId}`);
  if (contactId) revalidatePath(`/sales/contacts/${contactId}`);
}

export async function nominateContentOpportunityAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = nominateSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  try {
    await requirePermission("marketing.write");
  } catch (e) {
    return fail(e);
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("nominate_content_opportunity", {
    p_project_id: v.project_id,
    p_content_types: v.content_types,
    p_story_angle: v.story_angle,
    p_nomination_reason: v.nomination_reason,
    p_readiness_state: v.readiness_state,
    p_target_window_start: v.target_window_start,
    p_target_window_end: v.target_window_end,
    p_priority: v.priority,
    p_products_used: v.products_used,
    p_site_notes: v.site_notes,
    p_interview_subjects: v.interview_subjects,
    p_special_requirements: v.special_requirements,
    p_opportunity_id: v.opportunity_id,
    p_purchase_id: v.purchase_id,
  });
  if (error) return fail(error);
  revalidateMarketing(v.project_id);
  return ok({ id: data as unknown as string }, "Project nominated for content.");
}

export async function setContentStatusAction(input: unknown): Promise<ActionResult> {
  const parsed = contentStatusSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_content_opportunity_status", {
    p_id: v.id,
    p_status: v.status,
    p_reason: v.reason,
    p_marketing_owner_id: v.marketing_owner_id,
  });
  if (error) return fail(error);
  revalidateMarketing();
  return ok(undefined, "Nomination updated.");
}

export async function setReadinessAction(input: unknown): Promise<ActionResult> {
  const parsed = readinessSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_project_readiness", { p_id: v.id, p_readiness: v.readiness_state, p_note: v.note });
  if (error) return fail(error);
  revalidateMarketing();
  return ok(undefined, "Readiness updated.");
}

export async function recordPermissionAction(input: unknown): Promise<ActionResult> {
  const parsed = permissionSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_media_permission", {
    p_content_opportunity_id: v.content_opportunity_id,
    p_status: v.status,
    p_granted_by_name: v.granted_by_name,
    p_permitted_capture: v.permitted_capture,
    p_permitted_uses: v.permitted_uses,
    p_restrictions: v.restrictions,
    p_expires_at: v.expires_at,
    p_evidence_storage_path: v.evidence_storage_path,
    p_granted_at: v.granted_at ? new Date(v.granted_at).toISOString() : undefined,
    p_revocation_reason: v.revocation_reason,
  });
  if (error) return fail(error);
  revalidateMarketing();
  return ok(undefined, "Media permission recorded.");
}

export interface ShootConflict {
  kind: string;
  severity: string;
  detail: string;
  booking_id: string | null;
  user_id: string | null;
}

/** Read-only conflict preview so the UI can explain before anyone confirms. */
export async function checkConflictsAction(input: unknown): Promise<ActionResult<ShootConflict[]>> {
  const parsed = conflictSchema.safeParse(input);
  if (!parsed.success) return fail("Check the times");
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("shoot_conflicts", {
    p_starts_at: v.starts_at,
    p_ends_at: v.ends_at,
    p_participant_ids: v.participant_ids,
    p_booking_id: v.booking_id,
    p_buffer_minutes: v.buffer_minutes,
  });
  if (error) return fail(error);
  return ok((data ?? []) as unknown as ShootConflict[]);
}

export async function upsertBookingAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upsert_shoot_booking", {
    p_content_opportunity_id: v.content_opportunity_id,
    p_starts_at: v.starts_at,
    p_ends_at: v.ends_at,
    p_status: v.status,
    p_title: v.title,
    p_booking_id: v.booking_id,
    p_participants: v.participants.filter((p) => p.user_id || p.external_name),
    p_sites: v.sites.filter((s) => s.project_site_id),
    p_notes: v.notes,
    p_reason: v.reason,
    p_override: v.override,
    p_all_day: v.all_day,
  });
  if (error) return fail(error);
  revalidateMarketing();
  return ok({ id: data as unknown as string }, v.booking_id ? "Booking updated." : "Booking created.");
}

export async function recordOutcomeAction(input: unknown): Promise<ActionResult> {
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_shoot_outcome", {
    p_booking_id: v.booking_id,
    p_outcome: v.outcome,
    p_reason: v.reason,
    p_follow_up: v.follow_up,
  });
  if (error) return fail(error);
  revalidateMarketing();
  revalidatePath("/sales/tasks");
  return ok(undefined, "Outcome recorded.");
}

export async function registerOutputAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = outputSchema.safeParse(input);
  if (!parsed.success) return fail("Check the upload", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("register_shoot_output", {
    p_content_opportunity_id: v.content_opportunity_id,
    p_kind: v.kind,
    p_storage_path: v.storage_path,
    p_shoot_booking_id: v.shoot_booking_id,
    p_caption: v.caption,
    p_mime_type: v.mime_type,
    p_size_bytes: v.size_bytes,
    p_captured_at: v.captured_at ? new Date(v.captured_at).toISOString() : undefined,
  });
  if (error) return fail(error);
  revalidateMarketing();
  return ok({ id: data as unknown as string }, "Output added.");
}

export async function reviewOutputAction(input: unknown): Promise<ActionResult> {
  const parsed = outputReviewSchema.safeParse(input);
  if (!parsed.success) return fail("Check the decision", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("review_shoot_output", { p_output_id: v.output_id, p_decision: v.decision, p_reason: v.reason });
  if (error) return fail(error);
  revalidateMarketing();
  return ok(undefined, `Asset marked ${v.decision}.`);
}

export async function toggleChecklistAction(input: unknown): Promise<ActionResult> {
  const parsed = checklistToggleSchema.safeParse(input);
  if (!parsed.success) return fail("Check the item");
  const v = parsed.data;
  let session;
  try {
    session = await requirePermission("marketing.write");
  } catch (e) {
    return fail(e);
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("shoot_checklists")
    .update({ is_done: v.is_done, done_by: v.is_done ? session.userId : null, done_at: v.is_done ? new Date().toISOString() : null })
    .eq("id", v.id);
  if (error) return fail(error);
  revalidatePath("/marketing/shoot-calendar");
  return ok(undefined, v.is_done ? "Checked off." : "Unchecked.");
}

export async function addChecklistItemAction(input: unknown): Promise<ActionResult> {
  const parsed = checklistAddSchema.safeParse(input);
  if (!parsed.success) return fail("Check the item", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  try {
    await requirePermission("marketing.write");
  } catch (e) {
    return fail(e);
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("shoot_checklists").insert({ shoot_booking_id: v.shoot_booking_id, item: v.item, is_done: false });
  if (error) return fail(error);
  revalidatePath("/marketing/shoot-calendar");
  return ok(undefined, "Check added.");
}

/**
 * Short-lived link to a private object. Buckets are private (PRD §13.1), so
 * evidence and assets are never served from a public URL.
 */
export async function createSignedUrlAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  const parsed = signedUrlSchema.safeParse(input);
  if (!parsed.success) return fail("Unknown file");
  const v = parsed.data;
  await requireSession();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage.from(v.bucket).createSignedUrl(v.path, 300);
  if (error || !data) return fail(error ?? "Could not create a link");
  return ok({ url: data.signedUrl });
}

export interface ProjectOption {
  id: string;
  name: string;
  area: string | null;
  status: string | null;
  contact_name: string | null;
  account_name: string | null;
  already_nominated: boolean;
}

/** Project search for the nomination dialog. */
export async function searchProjectsAction(query: string): Promise<ActionResult<ProjectOption[]>> {
  await requireSession();
  const supabase = await createServerSupabase();
  let q = supabase.from("projects").select("id, name, area, status, contacts(display_name), accounts(name)").order("created_at", { ascending: false }).limit(20);
  const term = query.trim();
  if (term.length >= 2) q = q.ilike("name", `%${term}%`);
  const { data, error } = await q;
  if (error) return fail(error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const ids = rows.map((r) => r.id as string);
  const nominated = new Set<string>();
  if (ids.length) {
    const { data: existing } = await supabase.from("content_opportunities").select("project_id").in("project_id", ids);
    for (const e of existing ?? []) if (e.project_id) nominated.add(e.project_id);
  }
  return ok(
    rows.map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "Project",
      area: (r.area as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      contact_name: (r.contacts as { display_name?: string } | null)?.display_name ?? null,
      account_name: (r.accounts as { name?: string } | null)?.name ?? null,
      already_nominated: nominated.has(r.id as string),
    })),
  );
}

export interface SiteOption {
  id: string;
  label: string;
}

export async function listProjectSitesAction(projectId: string): Promise<ActionResult<SiteOption[]>> {
  await requireSession();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("project_sites").select("id, label").eq("project_id", projectId).order("label");
  if (error) return fail(error);
  return ok((data ?? []).map((s) => ({ id: s.id as string, label: (s.label as string) ?? "Site" })));
}
