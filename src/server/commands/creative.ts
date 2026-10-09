"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createCreativeSchema, creativeCommandSchema } from "@/features/creative/schema";
import type { CreativeCommandInput, CreateCreativeInput } from "@/features/creative/schema";
import type { CreativeCommandResult, CreativeDetail, CreativeList, CreativeOptions } from "@/features/creative/types";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { requirePermission } from "@/server/session";
import { getCreativeDetail, getCreativeList, getCreativeOptions } from "@/server/queries/creative";
import type { Json } from "@/lib/supabase/database.types";

async function mutate(action: string, id: string | undefined, revision: number | undefined, requestId: string, data: Json): Promise<ActionResult<CreativeCommandResult>> {
  // DB checks the specific approver/publisher role and target workspace.
  await requirePermission("marketing.read");
  const db = await createServerSupabase();
  const { data: result, error } = await db.rpc("creative_command", { p_action: action, p_id: id, p_expected_revision: revision, p_request_id: requestId, p_data: data });
  if (error) return fail(error);
  revalidatePath("/marketing/creative"); revalidatePath("/marketing/content-opportunities"); revalidatePath("/marketing/shoot-calendar");
  return ok(result as unknown as CreativeCommandResult);
}
export async function createCreativeAction(input: CreateCreativeInput): Promise<ActionResult<CreativeCommandResult>> {
  try { const { request_id, ...data } = createCreativeSchema.parse(input); return await mutate("create", undefined, undefined, request_id, data); } catch (e) { return fail(e); }
}
export async function creativeCommandAction(input: CreativeCommandInput): Promise<ActionResult<CreativeCommandResult>> {
  try { const { action, id, expected_revision, request_id, data } = creativeCommandSchema.parse(input); return await mutate(action, id, expected_revision, request_id, data); } catch (e) { return fail(e); }
}
export async function getCreativeDetailAction(id: string): Promise<ActionResult<CreativeDetail | null>> { try { return ok(await getCreativeDetail(id)); } catch(e) { return fail(e); } }
export async function searchCreativeOptionsAction(search: string): Promise<ActionResult<CreativeOptions>> { try { return ok(await getCreativeOptions(search)); } catch(e) { return fail(e); } }
export async function getRelatedCreativesAction(input: {content_opportunity_id?: string; shoot_booking_id?: string}): Promise<ActionResult<CreativeList>> { try { return ok(await getCreativeList({...input,condition:"all",page_size:5})); } catch(e) { return fail(e); } }
