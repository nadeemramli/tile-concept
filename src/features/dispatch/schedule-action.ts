"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const token = z.string().regex(/^[a-f0-9]{32}$/);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), trip: z.uuid(), token }),
  z.object({ action: z.literal("reorder"), trip: z.uuid(), allocation: z.uuid(), token, direction: z.enum(["-1", "1"]) }),
  z.object({ action: z.literal("acknowledge"), revision: z.uuid() }),
]);

export async function updateSchedule(_previous: string, form: FormData) {
  const parsed = command.safeParse(Object.fromEntries(form));
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !parsed.success) return "failed";
  const session = await requireSession();
  const input = parsed.data;
  const permission = input.action === "acknowledge" ? "delivery.read_own" : "admin.coordinate";
  if (!session.permissions.includes(permission)) return "failed";
  const supabase = await createServerSupabase();
  const { error } = input.action === "acknowledge"
    ? await supabase.rpc("acknowledge_synthetic_schedule", { p_revision: input.revision })
    : input.action === "publish"
      ? await supabase.rpc("publish_synthetic_schedule", { p_trip: input.trip, p_token: input.token })
      : await supabase.rpc("reorder_synthetic_stop", {
          p_trip: input.trip, p_token: input.token, p_allocation: input.allocation, p_direction: Number(input.direction),
        });
  if (error?.code === "40001") return "stale";
  if (error?.code === "55000") return "recorded";
  if (error?.code === "23514") return "notReady";
  if (error) return "failed";
  revalidatePath("/admin/dispatch");
  revalidatePath("/admin/my-deliveries");
  return "";
}
