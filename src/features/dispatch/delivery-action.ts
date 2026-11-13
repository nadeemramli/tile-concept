"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const delivery = z.object({
  revision: z.uuid(), allocation: z.uuid(),
  quantity: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).transform(Number),
  pic: z.string().trim().max(120), reason: z.string().trim().max(500),
});

export async function recordDelivery(_previous: string, form: FormData): Promise<string> {
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1") return "denied";
  const session = await requireSession();
  if (!session.permissions.includes("delivery.read_own")) return "denied";
  const parsed = delivery.safeParse(Object.fromEntries(form));
  if (!parsed.success) return "details";
  const { revision, allocation, quantity, pic, reason } = parsed.data;
  const file = form.get("proof");
  const proof = file instanceof File && file.size ? file : undefined;
  if (quantity > 0 && !pic) return "details";
  if ((quantity > 0 && !proof) || (proof && (proof.size > 700 * 1024 ||
      !["application/pdf", "image/jpeg", "image/png"].includes(proof.type)))) return "proof";

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_synthetic_delivery", {
    p_revision: revision, p_allocation: allocation, p_delivered: quantity,
    p_pic: pic || undefined, p_reason: reason || undefined,
    p_proof_name: proof?.name, p_proof_type: proof?.type,
    p_proof_base64: proof && Buffer.from(await proof.arrayBuffer()).toString("base64"),
  });
  if (error?.code === "40001") return "stale";
  if (error?.code === "23505") return "recorded";
  if (error?.code === "23514") return "quantity";
  if (error?.code === "22023") return error.message.includes("proof") ? "proof" : "details";
  if (error?.code === "TP001") return "pickup";
  if (error?.code === "42501") return "denied";
  if (error) return "failed";
  revalidatePath("/admin/my-deliveries");
  return "";
}
