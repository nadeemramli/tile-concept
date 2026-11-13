"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const input = z.object({
  result: z.uuid(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  previous: z.string().regex(/^\d*$/),
  action: z.enum(["compare", "unclear", "approve"]),
  quantity: z.string().optional(),
  price: z.string().optional(),
  note: z.string().trim().max(500),
});

export async function recordProofReview(_previous: string, form: FormData) {
  const parsed = input.safeParse(Object.fromEntries(form));
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !parsed.success) return "failed";
  const session = await requireSession();
  if (!session.permissions.includes("admin.coordinate")) return "failed";
  const { result, version, previous, action, quantity, price, note } = parsed.data;
  if (action === "compare" && (!/^\d{1,11}(\.\d{1,3})?$/.test(quantity ?? "")
    || !/^\d{1,10}(\.\d{1,4})?$/.test(price ?? ""))) return "failed";
  if (action !== "compare" && !note) return "failed";
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_synthetic_proof_review", {
    p_result: result, p_version: version, p_previous: previous, p_action: action,
    ...(action === "compare" && { p_quantity: Number(quantity), p_price: Number(price) }),
    ...(note && { p_note: note }),
  });
  if (error?.code === "40001") return "stale";
  if (error) return "failed";
  revalidatePath("/admin/proof-review");
  return "";
}
