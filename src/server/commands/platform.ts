"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { uuid } from "@/lib/zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { publicEnv } from "@/lib/env";
import { ROLES } from "@/lib/rbac/matrix";
import type { Json } from "@/lib/supabase/database.types";

// ------------------------------------------------------------- data health

export async function updateIssueStatusAction(id: string, status: "acknowledged" | "resolved" | "ignored" | "open", note?: string): Promise<ActionResult> {
  try {
    const session = await requirePermission("audit.read");
    const supabase = await createServerSupabase();
    const { data: existing } = await supabase.from("data_quality_issues").select("details").eq("id", id).maybeSingle();
    const details = { ...((existing?.details as Record<string, unknown>) ?? {}) };
    if (note?.trim()) {
      const notes = Array.isArray(details.notes) ? (details.notes as unknown[]) : [];
      details.notes = [...notes, { at: new Date().toISOString(), by: session.userId, status, note: note.trim() }];
    }
    const { error } = await supabase
      .from("data_quality_issues")
      .update({
        status,
        details: details as never,
        resolved_by: status === "resolved" ? session.userId : null,
        resolved_at: status === "resolved" ? new Date().toISOString() : null,
        assigned_to: status === "acknowledged" ? session.userId : undefined,
      })
      .eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/data-health");
    return ok(undefined, `Issue ${status}`);
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------- integrations

export async function toggleIntegrationAction(id: string, pause: boolean): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { data: row } = await supabase.from("integration_connections").select("credential_ref, last_success_at").eq("id", id).maybeSingle();
    const resumed = row?.credential_ref ? "healthy" : "not_configured";
    const { error } = await supabase.from("integration_connections").update({ status: pause ? "paused" : resumed }).eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/integrations");
    return ok(undefined, pause ? "Connector paused" : "Connector resumed");
  } catch (e) {
    return fail(e);
  }
}

export async function updateIntegrationAction(id: string, input: { owner_id?: string | null; business_purpose?: string | null }): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("integration_connections").update({ owner_id: input.owner_id || null, business_purpose: input.business_purpose?.trim() || null }).eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/integrations");
    return ok(undefined, "Connector updated");
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------- users

const roleEnum = z.enum(ROLES);

export async function changeMemberRoleAction(membershipId: string, role: string): Promise<ActionResult> {
  try {
    const session = await requirePermission("settings.manage");
    const parsed = roleEnum.safeParse(role);
    if (!parsed.success) return fail("Unknown role");
    const supabase = await createServerSupabase();
    const { data: m } = await supabase.from("memberships").select("user_id").eq("id", membershipId).maybeSingle();
    if (m?.user_id === session.userId && parsed.data !== "admin") return fail("You cannot remove your own administrator role.");
    const { error } = await supabase.from("memberships").update({ role_key: parsed.data }).eq("id", membershipId);
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, "Role updated");
  } catch (e) {
    return fail(e);
  }
}

export async function setMemberStatusAction(membershipId: string, status: "active" | "suspended"): Promise<ActionResult> {
  try {
    const session = await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { data: m } = await supabase.from("memberships").select("user_id").eq("id", membershipId).maybeSingle();
    if (m?.user_id === session.userId && status === "suspended") return fail("You cannot suspend yourself.");
    const { error } = await supabase.from("memberships").update({ status }).eq("id", membershipId);
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, status === "suspended" ? "Membership suspended" : "Membership reactivated");
  } catch (e) {
    return fail(e);
  }
}

export async function setMemberLocationAction(membershipId: string, locationId: string | null): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("memberships").update({ default_location_id: locationId || null }).eq("id", membershipId);
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, "Default location updated");
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------- invites

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  full_name: z.string().trim().max(120).optional().or(z.literal("")),
  role_key: roleEnum,
  default_location_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
});

async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return host ? `${proto}://${host}` : publicEnv.appUrl;
}

export async function inviteUserAction(input: z.input<typeof inviteSchema>): Promise<ActionResult<{ emailSent: boolean }>> {
  try {
    const session = await requirePermission("settings.manage");
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { error: insErr } = await supabase
      .from("membership_invites")
      .upsert({ workspace_id: session.workspaceId, email: d.email.toLowerCase(), role_key: d.role_key, default_location_id: d.default_location_id, invited_by: session.userId, status: "pending", accepted_at: null }, { onConflict: "workspace_id,email" });
    if (insErr) return fail(insErr);

    let emailSent = false;
    try {
      const admin = createAdminSupabase();
      const origin = await siteOrigin();
      const { error: invErr } = await admin.auth.admin.inviteUserByEmail(d.email, {
        redirectTo: `${origin}/auth/confirm?next=/auth/set-password`,
        data: d.full_name ? { full_name: d.full_name } : undefined,
      });
      if (invErr) {
        revalidatePath("/platform/settings");
        return { ok: true, data: { emailSent: false }, message: `Invite recorded, but the email could not be sent: ${invErr.message}. The user can also sign in via an email link once their account exists.` };
      }
      emailSent = true;
    } catch (e) {
      revalidatePath("/platform/settings");
      return { ok: true, data: { emailSent: false }, message: `Invite recorded; email not sent (${e instanceof Error ? e.message : "admin client unavailable"}).` };
    }
    revalidatePath("/platform/settings");
    return ok({ emailSent }, `Invitation sent to ${d.email}`);
  } catch (e) {
    return fail(e);
  }
}

export async function revokeInviteAction(id: string): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("membership_invites").update({ status: "revoked" }).eq("id", id).eq("status", "pending");
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, "Invite revoked");
  } catch (e) {
    return fail(e);
  }
}

export async function resendInviteAction(id: string): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { data: inv } = await supabase.from("membership_invites").select("email, status").eq("id", id).maybeSingle();
    if (!inv?.email || inv.status !== "pending") return fail("Invite is not pending");
    const admin = createAdminSupabase();
    const origin = await siteOrigin();
    const { error } = await admin.auth.admin.inviteUserByEmail(inv.email, { redirectTo: `${origin}/auth/confirm?next=/auth/set-password` });
    if (error) return fail(error);
    return ok(undefined, `Invitation re-sent to ${inv.email}`);
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------- workspace / locations / stages / views / flags

export async function updateWorkspaceAction(id: string, input: { name: string; timezone: string; default_currency: string }): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const parsed = z.object({ name: z.string().trim().min(2), timezone: z.string().trim().min(3), default_currency: z.string().trim().length(3).toUpperCase() }).safeParse(input);
    if (!parsed.success) return fail("Check the fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("workspaces").update(parsed.data).eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, "Workspace updated");
  } catch (e) {
    return fail(e);
  }
}

const locationSchema = z.object({
  id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2),
  kind: z.enum(["showroom", "office", "warehouse", "site", "other"]),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(120).optional().or(z.literal("")),
});

export async function upsertLocationAction(input: z.input<typeof locationSchema>): Promise<ActionResult> {
  try {
    const session = await requirePermission("settings.manage");
    const parsed = locationSchema.safeParse(input);
    if (!parsed.success) return fail("Check the fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const address = { city: d.city || undefined, state: d.state || undefined, country: "MY" };
    const { error } = d.id
      ? await supabase.from("business_locations").update({ code: d.code, name: d.name, kind: d.kind, address }).eq("id", d.id)
      : await supabase.from("business_locations").insert({ workspace_id: session.workspaceId, code: d.code, name: d.name, kind: d.kind, address });
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, d.id ? "Location updated" : "Location added");
  } catch (e) {
    return fail(e);
  }
}

export async function setLocationActiveAction(id: string, active: boolean): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("business_locations").update({ is_active: active }).eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, active ? "Location activated" : "Location deactivated");
  } catch (e) {
    return fail(e);
  }
}

const stageSchema = z.object({
  label: z.string().trim().min(2),
  reporting_group: z.enum(["open", "won", "lost", "deferred"]),
  requires_reason: z.boolean(),
  requires_next_action: z.boolean(),
  is_active: z.boolean(),
});

export async function updateStageAction(id: string, input: z.input<typeof stageSchema>): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const parsed = stageSchema.safeParse(input);
    if (!parsed.success) return fail("Check the fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("opportunity_stages").update(parsed.data).eq("id", id);
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    revalidatePath("/sales/pipeline");
    return ok(undefined, "Stage updated");
  } catch (e) {
    return fail(e);
  }
}

export async function moveStageAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { data: stages } = await supabase.from("opportunity_stages").select("id, position").order("position");
    const list = stages ?? [];
    const idx = list.findIndex((s) => s.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return fail("Cannot move further");
    const a = list[idx];
    const b = list[swapIdx];
    // three-step swap to respect the unique (workspace_id, position) index
    const tmp = -1 * (Date.now() % 100000) - 1;
    const e1 = await supabase.from("opportunity_stages").update({ position: tmp }).eq("id", a.id!);
    if (e1.error) return fail(e1.error);
    const e2 = await supabase.from("opportunity_stages").update({ position: a.position! }).eq("id", b.id!);
    if (e2.error) return fail(e2.error);
    const e3 = await supabase.from("opportunity_stages").update({ position: b.position! }).eq("id", a.id!);
    if (e3.error) return fail(e3.error);
    revalidatePath("/platform/settings");
    revalidatePath("/sales/pipeline");
    return ok(undefined, "Stage order updated");
  } catch (e) {
    return fail(e);
  }
}

const viewSchema = z.object({
  id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  surface: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(60),
  filters: z.string().trim().optional().or(z.literal("")),
  position: z.union([z.number(), z.string()]).optional().transform((v) => (v === undefined || v === "" ? 0 : Number(v))),
  is_default: z.boolean().default(false),
});

export async function upsertSharedViewAction(input: z.input<typeof viewSchema>): Promise<ActionResult> {
  try {
    const session = await requirePermission("settings.manage");
    const parsed = viewSchema.safeParse(input);
    if (!parsed.success) return fail("Check the fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    let filters: Json = {};
    if (d.filters) {
      try {
        filters = JSON.parse(d.filters);
      } catch {
        return fail("Filters must be valid JSON");
      }
    }
    const supabase = await createServerSupabase();
    const { error } = d.id
      ? await supabase.from("saved_views").update({ surface: d.surface, name: d.name, filters, position: d.position, is_default: d.is_default }).eq("id", d.id)
      : await supabase.from("saved_views").insert({ workspace_id: session.workspaceId, user_id: null, surface: d.surface, name: d.name, filters, position: d.position, is_default: d.is_default });
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, d.id ? "View updated" : "View added");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSharedViewAction(id: string): Promise<ActionResult> {
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("saved_views").delete().eq("id", id).is("user_id", null);
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, "View deleted");
  } catch (e) {
    return fail(e);
  }
}

export async function setFeatureFlagAction(key: string, enabled: boolean): Promise<ActionResult> {
  try {
    const session = await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("feature_flags").upsert({ workspace_id: session.workspaceId, key, enabled, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,key" });
    if (error) return fail(error);
    revalidatePath("/platform/settings");
    return ok(undefined, `${key} ${enabled ? "enabled" : "disabled"}`);
  } catch (e) {
    return fail(e);
  }
}
