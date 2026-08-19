"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { priceListSchema, priceSchema, type PriceInput, type PriceListInput } from "@/features/pricing/schema";
import { getPreviousCurrentPrice, getPriceApprovalEvents, listPrices } from "@/server/queries/pricing";

function revalidatePricing(productId?: string | null, listId?: string | null) {
  revalidatePath("/merchandise/pricing");
  revalidatePath("/merchandise/catalog");
  if (listId) revalidatePath(`/merchandise/pricing/${listId}`);
  if (productId) revalidatePath(`/merchandise/catalog/${productId}`);
}

export async function createPriceListAction(input: PriceListInput): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission("price.publish");
    const parsed = priceListSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("price_lists")
      .insert({ workspace_id: session.workspaceId, name: d.name, owner_id: session.userId, price_type: d.price_type, currency: d.currency, market: d.market, tax_inclusive: d.tax_inclusive, supplier_id: d.supplier_id, brand_id: d.brand_id, category_id: d.category_id, status: d.status, source_ref: d.source_ref, notes: d.notes })
      .select("id")
      .single();
    if (error || !data?.id) return fail(error ?? "Could not create price list");
    revalidatePricing();
    return ok({ id: data.id }, "Price list created");
  } catch (e) {
    return fail(e);
  }
}

export async function updatePriceListAction(id: string, input: PriceListInput): Promise<ActionResult> {
  try {
    await requirePermission("price.publish");
    const parsed = priceListSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("price_lists").update({ name: d.name, price_type: d.price_type, currency: d.currency, market: d.market, tax_inclusive: d.tax_inclusive, supplier_id: d.supplier_id, brand_id: d.brand_id, category_id: d.category_id, status: d.status, source_ref: d.source_ref, notes: d.notes }).eq("id", id);
    if (error) return fail(error);
    revalidatePricing(null, id);
    return ok(undefined, "Price list updated");
  } catch (e) {
    return fail(e);
  }
}

export async function addPriceAction(input: PriceInput, productId?: string | null): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission("price.publish");
    const parsed = priceSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("variant_prices")
      .insert({ workspace_id: session.workspaceId, price_list_id: d.price_list_id, variant_id: d.variant_id, amount: d.amount, currency: d.currency, unit_id: d.unit_id, min_quantity: d.min_quantity, valid_from: d.valid_from, valid_to: d.valid_to, state: "draft", review_state: "unreviewed", source_ref: d.source_ref, notes: d.notes, created_by: session.userId })
      .select("id")
      .single();
    if (error || !data?.id) return fail(error ?? "Could not add price");
    await supabase.from("price_approval_events").insert({ workspace_id: session.workspaceId, variant_price_id: data.id, action: "submitted", actor_id: session.userId });
    revalidatePricing(productId, d.price_list_id);
    return ok({ id: data.id }, "Draft price added — publish when reviewed");
  } catch (e) {
    return fail(e);
  }
}

export async function updateDraftPriceAction(id: string, input: PriceInput, productId?: string | null): Promise<ActionResult> {
  try {
    await requirePermission("price.publish");
    const parsed = priceSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("variant_prices").update({ amount: d.amount, currency: d.currency, unit_id: d.unit_id, min_quantity: d.min_quantity, valid_from: d.valid_from, valid_to: d.valid_to, source_ref: d.source_ref, notes: d.notes, state: "draft", review_state: "unreviewed" }).eq("id", id).in("state", ["draft", "conflicted"]);
    if (error) return fail(error);
    revalidatePricing(productId, d.price_list_id);
    return ok(undefined, "Draft updated");
  } catch (e) {
    return fail(e);
  }
}

export type PublishResult = ActionResult<{ conflict?: boolean }>;

export async function publishPriceAction(id: string, override = false, reason?: string, productId?: string | null, listId?: string | null): Promise<PublishResult> {
  try {
    await requirePermission("price.publish");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("publish_price", { p_variant_price_id: id, p_override: override, p_reason: reason ?? undefined });
    if (error) {
      if (/overlapping current price/i.test(error.message)) {
        revalidatePricing(productId, listId);
        return { ok: false, error: "An overlapping current price exists for this exact scope. Override with a reason to supersede it." };
      }
      return fail(error);
    }
    revalidatePricing(productId, listId);
    return ok({}, override ? "Published with override — previous price superseded" : "Price published");
  } catch (e) {
    return fail(e);
  }
}

export async function rejectPriceAction(id: string, reason: string, productId?: string | null, listId?: string | null): Promise<ActionResult> {
  try {
    const session = await requirePermission("price.publish");
    if (!reason.trim()) return fail("A reason is required");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("variant_prices").update({ review_state: "rejected", state: "draft" }).eq("id", id).in("state", ["draft", "conflicted", "scheduled"]);
    if (error) return fail(error);
    await supabase.from("price_approval_events").insert({ workspace_id: session.workspaceId, variant_price_id: id, action: "rejected", actor_id: session.userId, reason });
    revalidatePricing(productId, listId);
    return ok(undefined, "Price rejected");
  } catch (e) {
    return fail(e);
  }
}

/** Read helper for the compare-before-publish dialog and history drawer. */
export async function previewPriceAction(id: string): Promise<ActionResult<{ previous: Awaited<ReturnType<typeof getPreviousCurrentPrice>>; events: Awaited<ReturnType<typeof getPriceApprovalEvents>>; history: Awaited<ReturnType<typeof listPrices>> }>> {
  try {
    await requirePermission("price.read");
    const supabase = await createServerSupabase();
    const { data: row } = await supabase.from("variant_prices").select("id, price_list_id, variant_id, unit_id, min_quantity").eq("id", id).maybeSingle();
    if (!row?.id) return fail("Price not found");
    const [previous, events, history] = await Promise.all([
      getPreviousCurrentPrice({ id: row.id, price_list_id: row.price_list_id!, variant_id: row.variant_id!, unit_id: row.unit_id, min_quantity: Number(row.min_quantity ?? 1) }),
      getPriceApprovalEvents(id),
      listPrices({ variantId: row.variant_id!, limit: 100 }),
    ]);
    return ok({ previous, events, history });
  } catch (e) {
    return fail(e);
  }
}
