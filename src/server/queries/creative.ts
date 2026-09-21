import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { creativeCalendarSchema, creativeFiltersSchema } from "@/features/creative/schema";
import type { CreativeCalendar, CreativeCalendarFilters, CreativeDetail, CreativeFilters, CreativeList, CreativeOptions } from "@/features/creative/types";
import type { Json } from "@/lib/supabase/database.types";
import { uuid } from "@/lib/zod";

async function query<T>(mode: string, filters: Json = {}, id?: string): Promise<T> {
  await requirePermission("marketing.read");
  const db = await createServerSupabase();
  const { data, error } = await db.rpc("creative_query", { p_mode: mode, p_filters: filters, ...(id ? { p_id: id } : {}) });
  if (error) throw new Error(error.message);
  // RPC owns this JSON contract. Never turn errors into empty work or zero totals.
  return data as unknown as T;
}
export async function getCreativeList(filters: CreativeFilters = {}): Promise<CreativeList> { return query("list", creativeFiltersSchema.parse(filters)); }
export async function getCreativeDetail(id: string): Promise<CreativeDetail | null> { return query("detail", {}, uuid().parse(id)); }
export async function getCreativeCalendar(filters: CreativeCalendarFilters): Promise<CreativeCalendar> { return query("calendar", creativeCalendarSchema.parse(filters)); }
export async function getCreativeOptions(search = ""): Promise<CreativeOptions> { return query("options", { search: search.trim().slice(0, 200) }); }
