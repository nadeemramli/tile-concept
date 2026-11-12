"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

export async function receiveOriginalDo(_previous: string, form: FormData) {
  const document = form.get("document");
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || typeof document !== "string" || !document.trim()) {
    return "failed";
  }
  const session = await requireSession();
  if (!session.permissions.includes("admin.coordinate")) return "failed";

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("receive_synthetic_original_do", { p_document: document });
  if (error) return "failed";
  revalidatePath("/admin/dispatch");
  return "";
}
