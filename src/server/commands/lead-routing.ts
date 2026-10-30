"use server";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok } from "@/server/action-result";
import { routingStateSchema, saveRoutingSchema, type RoutingState } from "@/features/lead-routing/schema";

export async function saveLeadRoutingAction(input: unknown) {
  const parsed = saveRoutingSchema.safeParse(input);
  if (!parsed.success) return fail<RoutingState>(parsed.error.issues[0]?.message ?? "Check the routing rules.");
  try {
    await requirePermission("settings.manage");
    const db = await createServerSupabase();
    const {data, error} = await db.rpc("save_lead_routing", {p_config: parsed.data.config, p_expected_version: parsed.data.version});
    if (error) return fail<RoutingState>(error);
    const saved = routingStateSchema.parse(data);
    revalidatePath("/platform/settings");
    return ok(saved, "Lead routing saved. Rules apply to new inquiries.");
  } catch (error) { return fail<RoutingState>(error); }
}

export async function beginTelegramLinkAction() {
  try {
    await requirePermission("sales.write");
    const token = randomBytes(24).toString("base64url");
    const db = await createServerSupabase();
    const {error} = await db.rpc("begin_telegram_link", {p_token_hash: createHash("sha256").update(token).digest("hex")});
    if (error) return fail<{url:string}>(error);
    return ok({url: `https://t.me/tileconcept_leads_bot?start=tc_${token}`});
  } catch (error) { return fail<{url:string}>(error); }
}

export async function unlinkTelegramAction() {
  try {
    await requirePermission("sales.write");
    const db = await createServerSupabase();
    const {error} = await db.rpc("unlink_my_telegram");
    if (error) return fail(error);
    revalidatePath("/sales/inbox/telegram");
    return ok(undefined, "Telegram account disconnected.");
  } catch (error) { return fail(error); }
}
