"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { changeStageSchema, reassignSchema, updateOpportunitySchema, createOpportunitySchema, archiveOpportunitySchema, opportunityPhotoSchema } from "@/features/pipeline/schema";

function revalidateOpp(contactId?: string | null, accountId?: string | null, projectId?: string | null) {
  revalidatePath("/sales/pipeline");
  if (contactId) revalidatePath(`/sales/contacts/${contactId}`);
  if (accountId) revalidatePath(`/sales/accounts/${accountId}`);
  if (projectId) revalidatePath(`/sales/projects/${projectId}`);
}

export async function changeStageAction(input: unknown): Promise<ActionResult> {
  const parsed = changeStageSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("change_opportunity_stage", {
    p_opportunity_id: v.opportunity_id,
    p_to_stage_key: v.to_stage_key,
    p_reason: v.reason,
    p_next_action: v.next_action,
    p_next_action_due_at: v.next_action_due_at ? new Date(v.next_action_due_at).toISOString() : undefined,
    p_outcome_date: v.outcome_date,
  });
  if (error) return fail(error);
  const { data: o } = await supabase.from("opportunities").select("contact_id, account_id, project_id").eq("id", v.opportunity_id).maybeSingle();
  revalidateOpp(o?.contact_id, o?.account_id, o?.project_id);
  revalidatePath("/");
  return ok(undefined, "Stage updated.");
}

/** datetime-local is entered in showroom time, independent of the server timezone. */
function showroomTime(value?: string) {
  return value ? new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+08:00`).toISOString() : undefined;
}

async function command(action: string, input: Record<string, unknown>, requestId: string): Promise<ActionResult<{ opportunity_id: string | null; project_id: string | null }>> {
  await requireSession();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("opportunity_command", { p_action: action, p_input: input as Json, p_request_id: requestId });
  if (error || !data) return fail(error ?? "Opportunity was not saved");
  const result = data as { opportunity_id: string | null; project_id: string | null };
  const { data: o } = result.opportunity_id ? await supabase.from("opportunities").select("contact_id,account_id,project_id").eq("id",result.opportunity_id).maybeSingle() : { data: null };
  revalidateOpp(o?.contact_id, o?.account_id, result.project_id);
  revalidatePath("/sales/projects");
  revalidatePath("/");
  return ok(result, `Opportunity ${action === "create" ? "created" : action === "edit" ? "updated" : action === "archive" ? "archived" : action === "restore" ? "restored" : "reassigned"}.`);
}

export async function createOpportunityAction(input: unknown) {
  const parsed = createOpportunitySchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const { request_id, ...v } = parsed.data;
  return command("create", { ...v, next_action_due_at: showroomTime(v.next_action_due_at) }, request_id);
}

export async function updateOpportunityAction(input: unknown): Promise<ActionResult> {
  const parsed = updateOpportunitySchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const { request_id, ...v } = parsed.data;
  const result = await command("edit", { ...v, next_action_due_at: showroomTime(v.next_action_due_at) }, request_id);
  return result.ok ? ok(undefined, result.message) : result;
}

export async function reassignOpportunityAction(input: unknown): Promise<ActionResult> {
  const parsed = reassignSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form");
  const { request_id, opportunity_id, ...v } = parsed.data;
  const result = await command("reassign", { ...v, id: opportunity_id }, request_id);
  return result.ok ? ok(undefined, result.message) : result;
}

export async function archiveOpportunityAction(input: unknown): Promise<ActionResult> {
  const parsed = archiveOpportunitySchema.safeParse(input);
  if (!parsed.success) return fail("A reason is required", parsed.error.flatten().fieldErrors);
  const { request_id, action, ...v } = parsed.data;
  const result = await command(action, v, request_id);
  return result.ok ? ok(undefined, result.message) : result;
}

export async function opportunityPhotoAction(input: unknown): Promise<ActionResult<{ path: string }>> {
  const parsed = opportunityPhotoSchema.safeParse(input);
  if (!parsed.success) return fail("Check the photo and remark", parsed.error.flatten().fieldErrors);
  await requireSession();
  const { action, opportunity_id, photo_id, ...v } = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("opportunity_photo_command", { p_action: action, p_opportunity_id: opportunity_id, p_photo_id: photo_id, p_input: v });
  if (error || !data) return fail(error ?? "Photo could not be saved");
  revalidateOpp();
  return ok({ path: data }, action === "remove" ? "Photo removed." : "Photo saved.");
}
