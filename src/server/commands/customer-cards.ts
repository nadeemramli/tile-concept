"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { transferCustomerCardSchema } from "@/features/crm/schema";

/**
 * Hand a contact or account card to another salesperson. The database checks
 * sales.assign, requires the reason, refuses anyone without sales.write as the
 * new PIC, and audits actor, old and new PIC and time.
 */
export async function transferCustomerCardAction(input: unknown): Promise<ActionResult> {
  const parsed = transferCustomerCardSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("transfer_customer_card", { p_card: v.card, p_id: v.id, p_owner_id: v.owner_id, p_reason: v.reason });
  if (error) return fail(error);
  revalidatePath(v.card === "contact" ? `/sales/contacts/${v.id}` : `/sales/accounts/${v.id}`);
  revalidatePath("/sales/accounts");
  return ok(undefined, "PIC transferred.");
}
