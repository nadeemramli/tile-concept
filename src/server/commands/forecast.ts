"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { reviewForecastSchema } from "@/features/forecast/schema";

/** datetime-local is entered in showroom time, independent of the server timezone. */
function showroomTime(value: string) {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+08:00`).toISOString();
}

/** Review an opportunity's forecast. Every field is stated; a blank one is saved as unknown. */
export async function reviewForecastAction(input: unknown): Promise<ActionResult<{ version: number; reviewed_at: string }>> {
  const parsed = reviewForecastSchema.safeParse(input);
  if (!parsed.success) return fail("Check the forecast", parsed.error.flatten().fieldErrors);
  await requireSession();
  const { opportunity_id, request_id, next_action_due_at, ...v } = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("review_opportunity_forecast", {
    p_opportunity_id: opportunity_id,
    p_input: { ...v, next_action_due_at: showroomTime(next_action_due_at), context: "review" } as Json,
    p_request_id: request_id,
  });
  if (error || !data) return fail(error ?? "Forecast was not saved");
  const result = data as { version: number; reviewed_at: string };
  revalidatePath("/sales/pipeline");
  revalidatePath("/sales/pipeline/forecast");
  return ok({ version: result.version, reviewed_at: result.reviewed_at }, "Forecast reviewed.");
}
