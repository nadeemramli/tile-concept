"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { packagingSchema, productSchema, variantSchema, type ProductInput } from "@/features/catalog/schema";
import type { Json } from "@/lib/supabase/database.types";

function dimsFrom(d: z.output<typeof productSchema>) {
  const dims: Record<string, number> = {};
  for (const k of ["width_mm", "length_mm", "thickness_mm", "depth_mm", "sheet_width_mm", "sheet_height_mm"] as const) {
    const v = d[k];
    if (v !== null && v !== undefined) dims[k] = v;
  }
  return dims;
}

export async function createProductAction(input: ProductInput): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requirePermission("catalog.write");
    const parsed = productSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { data: product, error } = await supabase
      .from("products")
      .insert({
        workspace_id: session.workspaceId,
        name: d.name,
        code: d.code,
        brand_id: d.brand_id,
        supplier_id: d.supplier_id,
        category_id: d.category_id,
        color: d.color,
        finish: d.finish,
        material: d.material,
        style: d.style,
        description: d.description,
        search_keywords: d.keywords ? d.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [],
        source_ref: d.source_ref,
        status: "active",
        review_state: "unreviewed",
        created_by: session.userId,
      })
      .select("id")
      .single();
    if (error || !product?.id) return fail(error ?? "Could not create product");

    const { data: variant, error: vErr } = await supabase
      .from("product_variants")
      .insert({ workspace_id: session.workspaceId, product_id: product.id, sku: d.sku ?? d.code, name: "Standard", dimensions: dimsFrom(d), selling_unit_id: d.selling_unit_id, is_default: true })
      .select("id")
      .single();
    if (vErr) return fail(vErr);

    const attrs = Object.entries(d.attributes ?? {}).filter(([, v]) => v !== "" && v !== undefined);
    if (attrs.length) {
      const { error: aErr } = await supabase.from("product_attribute_values").insert(
        attrs.map(([attribute_definition_id, value]) => ({
          workspace_id: session.workspaceId,
          product_id: product.id!,
          attribute_definition_id,
          value: coerceAttr(value) as Json,
          source_ref: d.source_ref,
        })),
      );
      if (aErr) return fail(aErr);
    }
    revalidatePath("/merchandise/catalog");
    return ok({ id: product.id }, `Product created${variant ? " with default variant" : ""}`);
  } catch (e) {
    return fail(e);
  }
}

function coerceAttr(value: string): Json {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

export async function updateProductAction(id: string, input: ProductInput): Promise<ActionResult> {
  try {
    await requirePermission("catalog.write");
    const parsed = productSchema.safeParse(input);
    if (!parsed.success) return fail("Check the highlighted fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from("products")
      .update({
        name: d.name,
        code: d.code,
        brand_id: d.brand_id,
        supplier_id: d.supplier_id,
        category_id: d.category_id,
        color: d.color,
        finish: d.finish,
        material: d.material,
        style: d.style,
        description: d.description,
        search_keywords: d.keywords ? d.keywords.split(",").map((s) => s.trim()).filter(Boolean) : [],
        source_ref: d.source_ref,
      })
      .eq("id", id);
    if (error) return fail(error);
    revalidatePath(`/merchandise/catalog/${id}`);
    revalidatePath("/merchandise/catalog");
    return ok(undefined, "Product updated");
  } catch (e) {
    return fail(e);
  }
}

export async function markProductReviewedAction(id: string): Promise<ActionResult> {
  try {
    const session = await requirePermission("catalog.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("products").update({ review_state: "reviewed", reviewed_by: session.userId, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) return fail(error);
    revalidatePath(`/merchandise/catalog/${id}`);
    revalidatePath("/merchandise/catalog");
    return ok(undefined, "Marked as reviewed");
  } catch (e) {
    return fail(e);
  }
}

export async function setProductStatusAction(id: string, status: "active" | "discontinued" | "archived" | "draft"): Promise<ActionResult> {
  try {
    await requirePermission("catalog.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("products").update({ status }).eq("id", id);
    if (error) return fail(error);
    revalidatePath(`/merchandise/catalog/${id}`);
    revalidatePath("/merchandise/catalog");
    return ok(undefined, `Product ${status}`);
  } catch (e) {
    return fail(e);
  }
}

export async function upsertAttributeValueAction(input: { product_id: string; attribute_definition_id: string; value: string; value_id?: string | null; source_ref?: string | null }): Promise<ActionResult> {
  try {
    const session = await requirePermission("catalog.write");
    const supabase = await createServerSupabase();
    const value = coerceAttr(input.value);
    if (input.value_id) {
      const { error } = await supabase.from("product_attribute_values").update({ value, source_ref: input.source_ref ?? null }).eq("id", input.value_id);
      if (error) return fail(error);
    } else {
      const { error } = await supabase.from("product_attribute_values").insert({ workspace_id: session.workspaceId, product_id: input.product_id, attribute_definition_id: input.attribute_definition_id, value, source_ref: input.source_ref ?? null });
      if (error) return fail(error);
    }
    revalidatePath(`/merchandise/catalog/${input.product_id}`);
    return ok(undefined, "Specification saved");
  } catch (e) {
    return fail(e);
  }
}

export async function addVariantAction(input: z.input<typeof variantSchema>): Promise<ActionResult> {
  try {
    const session = await requirePermission("catalog.write");
    const parsed = variantSchema.safeParse(input);
    if (!parsed.success) return fail("Check the fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const dims: Record<string, number> = {};
    for (const k of ["width_mm", "length_mm", "thickness_mm", "depth_mm", "sheet_width_mm", "sheet_height_mm"] as const) if (d[k] != null) dims[k] = d[k]!;
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("product_variants").insert({ workspace_id: session.workspaceId, product_id: d.product_id, sku: d.sku, name: d.name ?? "Variant", dimensions: dims, selling_unit_id: d.selling_unit_id, is_default: false });
    if (error) return fail(error);
    revalidatePath(`/merchandise/catalog/${d.product_id}`);
    return ok(undefined, "Variant added");
  } catch (e) {
    return fail(e);
  }
}

export async function addPackagingAction(input: z.input<typeof packagingSchema>): Promise<ActionResult> {
  try {
    const session = await requirePermission("catalog.write");
    const parsed = packagingSchema.safeParse(input);
    if (!parsed.success) return fail("Check the fields", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    const d = parsed.data;
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("packaging_configurations").insert({ workspace_id: session.workspaceId, variant_id: d.variant_id, pack_label: d.pack_label, pack_unit_id: d.pack_unit_id, quantity_per_pack: d.quantity_per_pack, inner_unit_id: d.inner_unit_id, coverage_per_pack: d.coverage_per_pack, coverage_unit_id: d.coverage_unit_id, moq: d.moq, order_increment: d.order_increment });
    if (error) return fail(error);
    revalidatePath(`/merchandise/catalog/${d.product_id}`);
    return ok(undefined, "Packaging added");
  } catch (e) {
    return fail(e);
  }
}

export async function addAliasAction(input: { product_id: string; alias: string; source?: string }): Promise<ActionResult> {
  try {
    const session = await requirePermission("catalog.write");
    const alias = input.alias.trim();
    if (alias.length < 2) return fail("Alias is too short");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("product_aliases").insert({ workspace_id: session.workspaceId, product_id: input.product_id, alias, source: input.source?.trim() || null });
    if (error) return fail(error);
    revalidatePath(`/merchandise/catalog/${input.product_id}`);
    return ok(undefined, "Alias added");
  } catch (e) {
    return fail(e);
  }
}
