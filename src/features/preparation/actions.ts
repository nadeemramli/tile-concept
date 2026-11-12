"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const quantity = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).transform(Number);

export async function recordPreparation(_previous: string, form: FormData): Promise<string> {
  const session = await requireSession();
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !session.permissions.includes("preparation.read")) {
    return "denied";
  }
  const request = z.object({
    line: z.uuid(),
    version: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().max(2147483647)),
    request: z.uuid(),
    quantity,
    shortage: quantity,
    allocation: z.uuid().optional(),
  }).safeParse({
    line: form.get("line"),
    version: form.get("version"),
    request: form.get("request"),
    quantity: form.get("quantity"),
    shortage: form.get("shortage") ?? "0",
    allocation: form.get("allocation") ?? undefined,
  });
  if (!request.success) return "invalid";
  const { line, version, request: id, quantity: amount, shortage, allocation } = request.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_preparation", {
    p_line_id: line, p_version: version, p_request_id: id,
    p_quantity: amount, p_shortage: shortage, p_allocation_id: allocation,
  });
  if (error) {
    if (error.code === "40001" || error.code === "P0001" || error.code === "23505") return "stale";
    if (error.code === "23514") return "limit";
    if (error.code === "42501") return "denied";
    if (error.code === "22023") return "invalid";
    return "failed";
  }
  revalidatePath("/admin/preparation");
  return "";
}
