"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const input = z.object({
  request: z.uuid(),
  result: z.uuid(),
  kind: z.enum(["redelivery", "return"]),
  quantity: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).transform(Number),
  note: z.string().trim().max(500),
});

export async function recordRecovery(_previous: string, form: FormData): Promise<string> {
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1") return "denied";
  const session = await requireSession();
  if (!session.permissions.includes("admin.coordinate") || !["admin", "business_admin"].includes(session.roleKey)) {
    return "denied";
  }
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success || parsed.data.quantity <= 0 || (parsed.data.kind === "return" && !parsed.data.note)) {
    return "invalid";
  }
  const { request, result, kind, quantity, note } = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_synthetic_delivery_recovery", {
    p_request: request, p_result: result, p_kind: kind, p_quantity: quantity,
    ...(note && { p_note: note }),
  });
  if (error?.code === "23514") return "limit";
  if (error?.code === "22023") return "invalid";
  if (error?.code === "P0001") return "conflict";
  if (error?.code === "42501") return "denied";
  if (error) return "failed";
  revalidatePath("/admin/delivery-recovery");
  revalidatePath("/admin/dispatch");
  revalidatePath("/admin/preparation");
  return "";
}
