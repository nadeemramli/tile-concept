"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const move = z.object({
  allocation: z.uuid(),
  version: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().max(2147483647)),
  trip: z.union([z.uuid(), z.literal("")]),
});

export async function moveDraft(_previous: string, form: FormData): Promise<string> {
  const session = await requireSession();
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !session.permissions.includes("admin.coordinate")) {
    return "failed";
  }
  const parsed = move.safeParse({
    allocation: form.get("allocation"), version: form.get("version"), trip: form.get("trip"),
  });
  if (!parsed.success) return "invalid";
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("move_synthetic_dispatch_draft", {
    p_allocation_id: parsed.data.allocation,
    p_version: parsed.data.version,
    p_trip_id: parsed.data.trip || undefined,
  });
  if (error?.code === "40001") return "conflict";
  if (error?.code === "55000") return "recorded";
  if (error?.code === "22023") return "invalid";
  if (error) return "failed";
  revalidatePath("/admin/dispatch");
  return "";
}
