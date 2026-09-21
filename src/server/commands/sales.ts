"use server";

import { revalidatePath } from "next/cache";
import { saleCommandSchema, receiptSchema, type SaleCommand } from "@/features/sales/schema";
import { createServerSupabase } from "@/lib/supabase/server";
import { fail, ok } from "@/server/action-result";
import { requirePermission } from "@/server/session";

export async function saleCommandAction(command: SaleCommand) {
  const parsed = saleCommandSchema.safeParse(command);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the sale details.");
  try {
    await requirePermission("purchase.write");
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("sale_command", { p_action: parsed.data.action, p_input: parsed.data.input, p_request_id: parsed.data.request_id });
    if (error) return fail(error);
    for (const path of ["/sales/record-sale", "/sales/inbox", "/sales/walk-ins", "/sales/contacts", "/reports", "/"]) revalidatePath(path);
    return ok(data, "Sale record updated.");
  } catch (e) { return fail(e); }
}

export async function prepareSaleReceiptAction(input: unknown) {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a PDF, JPG or PNG up to 5 MB.");
  try {
    await requirePermission("purchase.write");
    const db = await createServerSupabase();
    const r = parsed.data;
    const { data, error } = await db.rpc("prepare_sale_receipt", { p_purchase_id: r.purchase_id, p_receipt_id: r.receipt_id, p_name: r.name, p_type: r.type, p_size: r.size });
    if (error) return fail(error);
    return ok(data);
  } catch (e) { return fail(e); }
}
