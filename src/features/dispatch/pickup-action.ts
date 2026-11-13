"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const input = z.object({
  request: z.uuid(),
  allocation: z.uuid(),
  stage: z.enum(["supplier_ready", "picked_up"]),
  quantity: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).transform(Number),
  note: z.string().trim().max(500),
});

export async function recordPickup(_previous: string, form: FormData): Promise<string> {
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1") return "denied";
  const session = await requireSession();
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success || parsed.data.quantity <= 0) return "invalid";
  const { request, allocation, stage, quantity, note } = parsed.data;
  const staff = session.permissions.includes("admin.coordinate") && ["admin", "business_admin"].includes(session.roleKey);
  const driver = stage === "picked_up" && session.permissions.includes("delivery.read_own");
  if (!staff && !driver) return "denied";
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_synthetic_pickup", {
    p_request: request, p_allocation: allocation, p_stage: stage, p_quantity: quantity,
    ...(note && { p_note: note }),
  });
  if (error?.code === "23514") return "limit";
  if (error?.code === "22023") return "invalid";
  if (error?.code === "P0001") return "conflict";
  if (error?.code === "42501") return "denied";
  if (error) return "failed";
  revalidatePath("/admin/supplier-pickup");
  revalidatePath("/admin/dispatch");
  revalidatePath("/admin/my-deliveries");
  return "";
}
