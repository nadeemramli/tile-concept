"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const driver = z.union([z.uuid(), z.literal("")]);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label: z.string().trim().min(1).max(100), date: z.iso.date(), driver }),
  z.object({ action: z.literal("assign"), trip: z.uuid(), token: z.string().regex(/^[a-f0-9]{32}$/), driver }),
]);

export async function saveTrip(_previous: string, form: FormData): Promise<string> {
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1") return "denied";
  const session = await requireSession();
  if (!session.permissions.includes("admin.coordinate") || !["admin", "business_admin"].includes(session.roleKey)) {
    return "denied";
  }
  const parsed = command.safeParse(Object.fromEntries(form));
  if (!parsed.success) return "invalid";
  const input = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = input.action === "create"
    ? await supabase.rpc("create_synthetic_trip", {
        p_label: input.label, p_date: input.date, ...(input.driver && { p_driver: input.driver }),
      })
    : await supabase.rpc("assign_synthetic_trip_driver", {
        p_trip: input.trip, p_token: input.token, ...(input.driver && { p_driver: input.driver }),
      });
  if (error?.code === "23505") return "exists";
  if (error?.code === "22023") return "invalid";
  if (error?.code === "40001") return "stale";
  if (error?.code === "42501") return "denied";
  if (error) return "failed";
  revalidatePath("/admin/dispatch");
  return "";
}

export async function loadSamples(): Promise<string> {
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1") return "denied";
  const session = await requireSession();
  if (!session.permissions.includes("admin.coordinate") || !["admin", "business_admin"].includes(session.roleKey)) {
    return "denied";
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("load_synthetic_fulfilment_samples");
  if (error) return error.code === "42501" ? "denied" : "failed";
  revalidatePath("/admin/preparation");
  revalidatePath("/admin/dispatch");
  return data === 0 ? "none" : "added";
}
