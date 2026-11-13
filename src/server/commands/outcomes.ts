"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@/lib/supabase/database.types";
import { createServerSupabase } from "@/lib/supabase/server";
import { pursuitOutcomeSchema, type PursuitOutcomeInput } from "@/features/outcomes/schema";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";

const MESSAGES = {
  lose: "Loss recorded. Outstanding reminders were resolved; reopening later keeps this outcome in history.",
  reject: "Inquiry rejected at qualification. It is not counted as a sales loss.",
  defer: "Deferred. A review reminder is set for the review date.",
  reopen: "Reopened. The earlier outcome stays in history and the new follow-up is scheduled.",
  correct: "Reason corrected. The original reason and who recorded it are kept.",
} as const;

/** Loss, rejection, deferral, reopen and reason correction for inquiries and opportunities. */
export async function recordPursuitOutcomeAction(input: PursuitOutcomeInput): Promise<ActionResult<{ event_id: string }>> {
  const parsed = pursuitOutcomeSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Check the outcome details", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const { action, request_id, ...rest } = parsed.data;
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("pursuit_outcome_command", { p_action: action, p_input: rest as Json, p_request_id: request_id });
    if (error || !data) return fail(error ?? "The outcome was not saved");
    const result = data as { event_id: string; lead_id: string | null; opportunity_id: string | null };
    for (const path of ["/sales/inbox", "/sales/pipeline", "/sales/tasks", "/", "/insights/reports", "/sales/contacts", "/sales/accounts", "/sales/projects"]) revalidatePath(path);
    return ok({ event_id: result.event_id }, MESSAGES[action]);
  } catch (error) {
    return fail(error);
  }
}
