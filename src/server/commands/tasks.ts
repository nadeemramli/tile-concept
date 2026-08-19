"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { newTaskSchema, updateTaskSchema, type NewTaskInput } from "@/features/tasks/schema";

const blank = (v: string | undefined | null) => (v && v.length > 0 ? v : null);

function revalidate() {
  revalidatePath("/sales/tasks");
  revalidatePath("/");
}

export async function createTaskAction(input: NewTaskInput): Promise<ActionResult<{ id: string }>> {
  const parsed = newTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Check the task details.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const v = parsed.data;
  try {
    const session = await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        workspace_id: session.workspaceId,
        title: v.title,
        description: blank(v.description),
        priority: v.priority,
        due_at: v.due_at ? new Date(v.due_at).toISOString() : null,
        assignee_id: blank(v.assignee_id) ?? session.userId,
        contact_id: blank(v.contact_id),
        account_id: blank(v.account_id),
        opportunity_id: blank(v.opportunity_id),
        lead_id: blank(v.lead_id),
        project_id: blank(v.project_id),
        created_by: session.userId,
      })
      .select("id")
      .single();
    if (error || !data) return fail(error ?? "Could not create task");
    revalidate();
    return ok({ id: String(data.id) }, "Task created.");
  } catch (e) {
    return fail(e);
  }
}

export async function completeTaskAction(input: { task_id: string; outcome?: string }): Promise<ActionResult> {
  try {
    const session = await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data: t } = await supabase.from("tasks").select("id, title, contact_id, account_id, opportunity_id, lead_id, project_id").eq("id", input.task_id).maybeSingle();
    if (!t) return fail("Task not found");
    const { error } = await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), outcome: blank(input.outcome) }).eq("id", input.task_id);
    if (error) return fail(error);
    await supabase.from("activities").insert({
      workspace_id: session.workspaceId,
      kind: "task_outcome",
      subject: `Task done: ${t.title}`,
      body: blank(input.outcome),
      actor_id: session.userId,
      contact_id: t.contact_id,
      account_id: t.account_id,
      opportunity_id: t.opportunity_id,
      lead_id: t.lead_id,
      project_id: t.project_id,
      metadata: { task_id: input.task_id },
    });
    revalidate();
    return ok(undefined, "Task completed.");
  } catch (e) {
    return fail(e);
  }
}

export async function reopenTaskAction(taskId: string): Promise<ActionResult> {
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("tasks").update({ status: "open", completed_at: null, outcome: null }).eq("id", taskId);
    if (error) return fail(error);
    revalidate();
    return ok(undefined, "Task reopened.");
  } catch (e) {
    return fail(e);
  }
}

export async function cancelTaskAction(taskId: string): Promise<ActionResult> {
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("tasks").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", taskId);
    if (error) return fail(error);
    revalidate();
    return ok(undefined, "Task cancelled.");
  } catch (e) {
    return fail(e);
  }
}

export async function updateTaskAction(input: z.input<typeof updateTaskSchema>): Promise<ActionResult> {
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Check the task details.");
  const v = parsed.data;
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const patch: { due_at?: string | null; assignee_id?: string | null; priority?: string; title?: string } = {};
    if (v.due_at !== undefined) patch.due_at = v.due_at ? new Date(v.due_at).toISOString() : null;
    if (v.assignee_id !== undefined) patch.assignee_id = blank(v.assignee_id);
    if (v.priority) patch.priority = v.priority;
    if (v.title) patch.title = v.title;
    const { error } = await supabase.from("tasks").update(patch).eq("id", v.task_id);
    if (error) return fail(error);
    revalidate();
    return ok(undefined, "Task updated.");
  } catch (e) {
    return fail(e);
  }
}
