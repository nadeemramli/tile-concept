"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { mapItemSchema, openCaseSchema, resolveCaseSchema, supplierUpdateSchema, type MapItemInput, type OpenCaseInput, type ResolveCaseInput, type SupplierUpdateInput } from "@/features/stock/schema";

const PATH = "/merchandise/stock";

export async function recordSupplierAvailabilityAction(input: SupplierUpdateInput): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission("stock.write");
    const parsed = supplierUpdateSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("record_supplier_availability", {
      p_supplier_id: d.supplier_id,
      p_availability: d.availability,
      p_variant_id: d.variant_id || undefined,
      p_product_id: d.product_id || undefined,
      p_quantity: d.quantity ?? undefined,
      p_unit_id: d.unit_id || undefined,
      p_expected_replenishment: d.expected_replenishment || undefined,
      p_source_channel: d.source_channel,
      p_evidence_storage_path: d.evidence_storage_path || undefined,
      p_notes: d.notes || undefined,
    });
    if (error) return fail(error);
    revalidatePath(PATH);
    return ok({ id: data as string }, "Supplier update recorded");
  } catch (e) {
    return fail(e);
  }
}

export async function flagStaleSuppliersAction(): Promise<ActionResult<{ flagged: number }>> {
  try {
    await requirePermission("stock.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("flag_stale_suppliers");
    if (error) return fail(error);
    const flagged = Number(data ?? 0);
    revalidatePath(PATH);
    revalidatePath("/platform/data-health");
    return ok({ flagged }, flagged === 0 ? "Every supplier is inside its freshness policy" : `${flagged} supplier${flagged === 1 ? "" : "s"} flagged for follow-up`);
  } catch (e) {
    return fail(e);
  }
}

export async function mapInventoryItemAction(input: MapItemInput): Promise<ActionResult> {
  try {
    await requirePermission("stock.write");
    const parsed = mapItemSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("map_inventory_item", {
      p_mapping_id: d.mapping_id,
      // p_variant_id has no default in SQL but is discarded when ignoring, so
      // an ignore passes the nil uuid rather than a real variant.
      p_variant_id: d.ignore ? "00000000-0000-0000-0000-000000000000" : (d.variant_id as string),
      p_unit_id: d.unit_id || undefined,
      p_ignore: d.ignore,
    });
    if (error) return fail(error);
    revalidatePath(PATH);
    return ok(undefined, d.ignore ? "Item code ignored" : "Item code mapped — existing snapshots back-filled");
  } catch (e) {
    return fail(e);
  }
}

export async function openReconciliationCaseAction(input: OpenCaseInput): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePermission("stock.write");
    const parsed = openCaseSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("open_reconciliation_case", {
      p_variant_id: d.variant_id,
      p_source_id: d.source_id,
      p_expected: d.expected,
      p_observed: d.observed,
      p_notes: d.notes || undefined,
    });
    if (error) return fail(error);
    revalidatePath(PATH);
    return ok({ id: data as string }, "Discrepancy recorded — SQL Account is unchanged");
  } catch (e) {
    return fail(e);
  }
}

export async function resolveReconciliationCaseAction(input: ResolveCaseInput): Promise<ActionResult> {
  try {
    await requirePermission("stock.write");
    const parsed = resolveCaseSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("resolve_reconciliation_case", { p_case_id: d.case_id, p_status: d.status, p_notes: d.notes });
    if (error) return fail(error);
    revalidatePath(PATH);
    return ok(undefined, "Case updated");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Demo-only: replays what the local SQL Account connector would deliver, so the
 * mapping, snapshot and freshness path can be exercised before the real
 * read-only connector exists. Never available outside demo mode.
 */
export async function simulateConnectorPullAction(): Promise<ActionResult<{ rows: number }>> {
  try {
    await requirePermission("settings.manage");
    if ((process.env.NEXT_PUBLIC_APP_MODE ?? "demo") !== "demo") {
      return fail("A simulated pull is only available in demo mode");
    }
    const supabase = await createServerSupabase();
    const [{ data: mappings }, { data: snaps }] = await Promise.all([
      supabase.from("inventory_item_mappings").select("external_item_code, variant_id, status").eq("status", "mapped"),
      supabase.from("inventory_snapshots").select("external_item_code, on_hand, allocated, available").order("captured_at", { ascending: false }).limit(200),
    ]);
    const latest = new Map<string, { on_hand: number | null; allocated: number | null; available: number | null }>();
    for (const s of snaps ?? []) {
      if (s.external_item_code && !latest.has(s.external_item_code)) {
        latest.set(s.external_item_code, { on_hand: s.on_hand === null ? null : Number(s.on_hand), allocated: s.allocated === null ? null : Number(s.allocated), available: s.available === null ? null : Number(s.available) });
      }
    }
    const checkpoint = `sim-${new Date().toISOString()}`;
    let rows = 0;
    for (const m of mappings ?? []) {
      if (!m.external_item_code) continue;
      const prev = latest.get(m.external_item_code) ?? { on_hand: 100, allocated: 0, available: 100 };
      const drift = Math.round((Math.random() - 0.45) * 12);
      const onHand = Math.max(0, (prev.on_hand ?? 100) + drift);
      const allocated = Math.max(0, Math.min(onHand, prev.allocated ?? 0));
      const { error } = await supabase.rpc("record_inventory_snapshot", {
        p_source_key: "sql_account",
        p_external_item_code: m.external_item_code,
        p_on_hand: onHand,
        p_allocated: allocated,
        p_available: onHand - allocated,
        p_location_code: "WH-01",
        p_checkpoint: checkpoint,
      });
      if (error) return fail(error);
      rows += 1;
    }
    revalidatePath(PATH);
    return ok({ rows }, `Simulated pull recorded ${rows} snapshot${rows === 1 ? "" : "s"} (demo mode only)`);
  } catch (e) {
    return fail(e);
  }
}
