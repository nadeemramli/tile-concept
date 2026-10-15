import "server-only";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolveIntakeWorkspaceId } from "@/integrations/intake";
import { publicEnv } from "@/lib/env";
import { uuid } from "@/lib/zod";
import { buildTelegramCard, telegramCardSchema } from "@/features/lead-routing/telegram-card";
import type { Json } from "@/lib/supabase/database.types";

export const telegramOperationSchema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("pending")}),
  z.object({operation:z.literal("sent"),lead_id:uuid(),token:uuid(),message_id:z.number().int().positive().max(2147483647)}),
  z.object({operation:z.literal("update"),update:z.object({update_id:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).catchall(z.unknown())}),
]);

export async function runTelegramOperation(input:z.infer<typeof telegramOperationSchema>) {
  const ws=await resolveIntakeWorkspaceId();
  if(!ws) throw new Error("workspace_not_configured");
  const db=createAdminSupabase();
  if(input.operation==="pending") {
    const {data,error}=await db.rpc("pending_telegram_cards",{p_workspace_id:ws});
    if(error) throw new Error("telegram_queue_unavailable");
    const cards=z.array(telegramCardSchema).parse(data);
    return {ok:true,cards:cards.map(c=>buildTelegramCard(c,publicEnv.appUrl))};
  }
  if(input.operation==="sent") {
    const {error}=await db.rpc("confirm_telegram_card",{p_workspace_id:ws,p_lead_id:input.lead_id,p_token:input.token,p_message_id:input.message_id});
    if(error) throw new Error("telegram_delivery_not_confirmed");
    return {ok:true};
  }
  const {data,error}=await db.rpc("process_telegram_update",{p_workspace_id:ws,p_update:input.update as Json});
  if(error) throw new Error("telegram_update_failed");
  return {ok:true,result:data};
}
