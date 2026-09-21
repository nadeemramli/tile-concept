"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { spendSchema } from "@/features/marketing/spend-schema";

export async function recordSpendAction(input: unknown): Promise<ActionResult<string>> {
  try {
    await requirePermission("marketing.spend.write");
    const parsed = spendSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the expense details");
    const { request_id, action, ...values } = parsed.data;
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("record_marketing_spend", { p_action: action, p_input: values, p_request_id: request_id });
    if (error) return fail(error);
    revalidatePath("/marketing/spend"); revalidatePath("/insights/reports/funnel");
    return ok(data);
  } catch (error) { return fail(error); }
}
