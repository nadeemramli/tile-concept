"use server";

import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { getVariantHistory, type SnapshotHistoryRow } from "@/server/queries/stock";
import { uuid } from "@/lib/zod";

/** Snapshot history for one variant, loaded when its drawer opens. */
export async function getSnapshotHistoryAction(variantId: string): Promise<ActionResult<SnapshotHistoryRow[]>> {
  try {
    await requirePermission("stock.read");
    const parsed = uuid().safeParse(variantId);
    if (!parsed.success) return fail("Invalid product variant");
    return ok(await getVariantHistory(parsed.data));
  } catch (e) {
    return fail(e);
  }
}
