"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission, requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { addSiteSchema, createProjectOpportunitySchema, updateProjectSchema, registerProjectSchema, assignProjectSchema, followUpProjectSchema } from "@/features/crm/schema";

export async function createProjectOpportunityAction(input: unknown): Promise<ActionResult<{ project_id: string; opportunity_id: string | null }>> {
  const parsed = createProjectOpportunitySchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("opportunity_command", { p_action: "create", p_request_id: v.request_id,
    p_input: { ...v, create_project: true, name: v.opportunity_name || v.project_name, currency: "MYR",
      next_action_due_at: v.next_action_due_at ? new Date(`${v.next_action_due_at}+08:00`).toISOString() : undefined } });
  if (error || !data) return fail(error ?? "Could not create project");
  const result = data as { project_id: string; opportunity_id: string | null };
  revalidatePath("/sales/projects");
  revalidatePath("/sales/pipeline");
  if (v.contact_id) revalidatePath(`/sales/contacts/${v.contact_id}`);
  if (v.account_id) revalidatePath(`/sales/accounts/${v.account_id}`);
  return ok(result, result.opportunity_id ? "Project and opportunity created." : "Project created.");
}

async function projectCommand(action: "create" | "edit" | "assign" | "follow_up", input: Record<string, unknown>, requestId: string): Promise<ActionResult<{ project_id: string; version: number }>> {
  try {
    await requirePermission(action === "assign" || action === "follow_up" ? "projects.follow_up" : "projects.write");
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("project_command", { p_action: action, p_input: input as import("@/lib/supabase/database.types").Json, p_request_id: requestId });
    if (error || !data) return fail(error ?? "Could not save project");
    const result = data as { project_id: string; version: number };
    revalidatePath("/sales/projects"); revalidatePath(`/sales/projects/${result.project_id}`);
    revalidatePath("/sales/accounts", "layout"); revalidatePath("/sales/contacts", "layout");
    return ok(result, action === "create" ? "Project registered. Add details whenever they are available." : action === "assign" ? "Project handler updated." : action === "follow_up" ? "Follow-up recorded." : "Project updated.");
  } catch (e) { return fail(e); }
}

export async function registerProjectAction(input: unknown): Promise<ActionResult<{ project_id: string; version: number }>> {
  const parsed = registerProjectSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const { request_id, ...data } = parsed.data;
  return projectCommand("create", data, request_id);
}
export async function updateProjectAction(input: unknown): Promise<ActionResult<{ project_id: string; version: number }>> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const { request_id, ...data } = parsed.data;
  return projectCommand("edit", data, request_id);
}
export async function assignProjectAction(input: unknown): Promise<ActionResult<{ project_id: string; version: number }>> {
  const parsed = assignProjectSchema.safeParse(input);
  if (!parsed.success) return fail("Check the assignment", parsed.error.flatten().fieldErrors);
  const { request_id, ...data } = parsed.data;
  return projectCommand("assign", data, request_id);
}
export async function followUpProjectAction(input: unknown): Promise<ActionResult<{ project_id: string; version: number }>> {
  const parsed = followUpProjectSchema.safeParse(input);
  if (!parsed.success) return fail("Check the follow-up", parsed.error.flatten().fieldErrors);
  const { request_id, ...data } = parsed.data;
  const due = data.next_action_due_at ? new Date(`${data.next_action_due_at}+08:00`) : null;
  if (due && Number.isNaN(due.getTime())) return fail("Enter a valid next-action date.");
  return projectCommand("follow_up", { ...data, next_action_due_at: due?.toISOString() }, request_id);
}
export async function searchProjectIdentitiesAction(kind: "account" | "contact", query: string, accountId?: string) {
  await requirePermission("projects.write");
  const db = await createServerSupabase();
  const { data, error } = await db.rpc("project_identity_search", { p_kind: kind, p_query: query, p_account_id: accountId });
  if (error) throw error;
  return data ?? [];
}

export async function addProjectSiteAction(input: unknown): Promise<ActionResult> {
  const parsed = addSiteSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("project_sites").insert({ workspace_id: session.workspaceId, project_id: v.project_id, label: v.label, address: { line1: v.line1 ?? "", city: v.city ?? "", state: v.state ?? "", country: "MY" }, access_notes: v.access_notes ?? null });
  if (error) return fail(error);
  revalidatePath(`/sales/projects/${v.project_id}`);
  return ok(undefined, "Site added.");
}
