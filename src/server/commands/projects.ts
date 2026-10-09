"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { addSiteSchema, createProjectOpportunitySchema, updateProjectSchema } from "@/features/crm/schema";

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

export async function updateProjectAction(input: unknown): Promise<ActionResult> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("projects")
    .update({ name: v.name, project_type: v.project_type, status: v.status, follow_up_contact_id: v.follow_up_contact_id ?? null, product_specification: v.product_specification || null, area: v.area ?? null, owner_id: v.owner_id ?? null, expected_start: v.expected_start ?? null, expected_completion: v.expected_completion ?? null, notes: v.notes ?? null })
    .eq("id", v.id);
  if (error) return fail(error);
  revalidatePath(`/sales/projects/${v.id}`);
  revalidatePath("/sales/projects");
  return ok(undefined, "Project updated.");
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
