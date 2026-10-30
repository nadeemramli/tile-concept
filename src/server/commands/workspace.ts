"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { AREA_PERMISSION, areaHome, isArea, type Area } from "@/lib/workspace/areas";

/**
 * Remember (or clear, with null) the area this member starts in. The database
 * refuses an area the caller cannot enter (42501), so the switcher can never be
 * used to store — let alone obtain — access the role does not have.
 */
export async function setDefaultAreaAction(area: Area | null): Promise<ActionResult<{ area: Area | null }>> {
  if (area !== null && !isArea(area)) return fail("Unknown workspace area.");
  await requireSession();
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_default_area", area ? { p_area: area } : {});
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return ok({ area });
}

/**
 * The chooser's submit: optionally remember the choice, then open the area.
 * Opening is plain navigation; the area's pages check their own permissions.
 */
export async function chooseAreaAction(formData: FormData): Promise<void> {
  const area = formData.get("area");
  const session = await requireSession();
  if (!isArea(area) || !session.permissions.includes(AREA_PERMISSION[area])) redirect("/start");
  if (formData.get("remember") === "on") {
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("set_default_area", { p_area: area });
    if (error) redirect("/start");
    revalidatePath("/", "layout");
  }
  redirect(areaHome(area, session.permissions));
}
