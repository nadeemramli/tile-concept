"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const input = z.object({ result: z.uuid(), behalf: z.enum(["0", "1"]), reason: z.string().trim().max(500) });

export async function attachProof(_previous: string, form: FormData): Promise<string> {
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1") return "denied";
  const session = await requireSession();
  const parsed = input.safeParse({ result: form.get("result"), behalf: form.get("behalf"), reason: form.get("reason") ?? "" });
  if (!parsed.success) return "failed";
  const { result, behalf, reason } = parsed.data;
  const allowed = behalf === "1"
    ? session.permissions.includes("admin.coordinate") && ["admin", "business_admin", "management"].includes(session.roleKey)
    : session.permissions.includes("delivery.read_own");
  if (!allowed) return "denied";
  if (behalf === "1" && !reason) return "reason";
  const file = form.get("proof");
  if (!(file instanceof File) || !file.size || file.size > 700 * 1024
      || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return "proof";

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attach_synthetic_delivery_proof", {
    p_result: result, p_name: file.name, p_type: file.type,
    p_base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    ...(behalf === "1" && { p_reason: reason }),
  });
  if (error?.code === "55000") return "stored";
  if (error?.code === "22023") return error.message.includes("proof") ? "proof" : "reason";
  if (error?.code === "42501") return "denied";
  if (error) return "failed";
  revalidatePath("/admin/proof-review");
  revalidatePath("/admin/my-deliveries");
  revalidatePath("/admin/dispatch");
  return "";
}
