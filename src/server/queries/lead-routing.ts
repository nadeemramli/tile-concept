import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { routingStateSchema } from "@/features/lead-routing/schema";

export async function getLeadRouting() {
  await requirePermission("settings.manage");
  const db = await createServerSupabase();
  const {data, error} = await db.rpc("get_lead_routing");
  if (error) throw new Error("Lead routing settings could not be loaded.");
  return routingStateSchema.parse(data);
}

export async function getMyTelegramLink() {
  const session = await requirePermission("sales.write");
  const db = await createServerSupabase();
  const {data, error} = await db.from("telegram_members").select("linked_at").eq("user_id", session.userId).eq("workspace_id", session.workspaceId).maybeSingle();
  if (error) throw new Error("Telegram connection could not be loaded.");
  return data?.linked_at ?? null;
}
