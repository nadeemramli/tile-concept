"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";
import { getStages } from "@/server/queries/reference";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { addSiteSchema, createProjectOpportunitySchema, updateProjectSchema } from "@/features/crm/schema";

export async function createProjectOpportunityAction(input: unknown): Promise<ActionResult<{ project_id: string; opportunity_id: string | null }>> {
  const parsed = createProjectOpportunitySchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .insert({
      workspace_id: session.workspaceId,
      name: v.project_name,
      project_type: v.project_type,
      status: "planning",
      area: v.area ?? null,
      account_id: v.account_id ?? null,
      primary_contact_id: v.contact_id ?? null,
      owner_id: v.owner_id ?? session.userId,
      expected_start: v.expected_start ?? null,
      expected_completion: v.expected_completion ?? null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (pErr || !project?.id) return fail(pErr ?? "Could not create project");

  let opportunityId: string | null = null;
  if (v.create_opportunity) {
    const stages = await getStages();
    const first = stages.find((s) => s.reporting_group === "open");
    if (!first) return fail("No open stage configured");
    const { data: opp, error: oErr } = await supabase
      .from("opportunities")
      .insert({
        workspace_id: session.workspaceId,
        name: v.opportunity_name ?? v.project_name,
        account_id: v.account_id ?? null,
        contact_id: v.contact_id ?? null,
        project_id: project.id,
        stage_key: first.key,
        status: "open",
        owner_id: v.owner_id ?? session.userId,
        source_channel: v.source_channel ?? null,
        estimated_value: v.estimated_value ?? null,
        product_interest: v.product_interest,
        next_action: v.next_action ?? "Follow up",
        next_action_due_at: v.next_action_due_at ? new Date(v.next_action_due_at).toISOString() : new Date(Date.now() + 2 * 86400000).toISOString(),
        created_by: session.userId,
      })
      .select("id")
      .single();
    if (oErr || !opp?.id) return fail(oErr ?? "Could not create opportunity");
    opportunityId = opp.id;
    await supabase.from("opportunity_stage_events").insert({ workspace_id: session.workspaceId, opportunity_id: opp.id, from_stage_key: null, to_stage_key: first.key, actor_id: session.userId });
    await supabase.from("activities").insert({ workspace_id: session.workspaceId, kind: "system", subject: "Opportunity created", actor_id: session.userId, contact_id: v.contact_id ?? null, account_id: v.account_id ?? null, project_id: project.id, opportunity_id: opp.id });
  }
  revalidatePath("/sales/projects");
  revalidatePath("/sales/pipeline");
  if (v.contact_id) revalidatePath(`/sales/contacts/${v.contact_id}`);
  if (v.account_id) revalidatePath(`/sales/accounts/${v.account_id}`);
  return ok({ project_id: project.id, opportunity_id: opportunityId }, opportunityId ? "Project and opportunity created." : "Project created.");
}

export async function updateProjectAction(input: unknown): Promise<ActionResult> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("projects")
    .update({ name: v.name, project_type: v.project_type, status: v.status, area: v.area ?? null, owner_id: v.owner_id ?? null, expected_start: v.expected_start ?? null, expected_completion: v.expected_completion ?? null, notes: v.notes ?? null })
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
