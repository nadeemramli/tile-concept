"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";

const setTargetSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  amount: z.coerce.number().nonnegative(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function setSalesTargetAction(input: unknown): Promise<ActionResult> {
  const parsed = setTargetSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a year and target amount.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  try {
    await requirePermission("settings.manage");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("set_sales_target", { p_year: v.year, p_amount: v.amount, p_notes: v.notes || undefined });
    if (error) return fail(error);
    revalidatePath("/");
    return ok(undefined, "Annual target saved.");
  } catch (e) {
    return fail(e);
  }
}
