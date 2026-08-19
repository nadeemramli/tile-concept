import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getBrands, getCategories, getMemberMap, getUnits } from "@/server/queries/reference";
import { getSuppliers } from "@/server/queries/catalog";

export interface PriceListRow {
  id: string;
  name: string;
  price_type: string;
  currency: string;
  status: string;
  market: string | null;
  tax_inclusive: boolean;
  supplier: string | null;
  brand: string | null;
  category: string | null;
  owner_name: string | null;
  owner_id: string | null;
  source_ref: string | null;
  counts: { current: number; draft: number; scheduled: number; conflicted: number; superseded: number; expired: number };
}

export async function listPriceLists(): Promise<PriceListRow[]> {
  const supabase = await createServerSupabase();
  const [{ data: lists }, { data: prices }, suppliers, brands, categories, members] = await Promise.all([
    supabase.from("price_lists").select("*").order("name"),
    supabase.from("variant_prices").select("price_list_id, state"),
    getSuppliers(),
    getBrands(),
    getCategories(),
    getMemberMap(),
  ]);
  return (lists ?? []).map((l) => {
    const mine = (prices ?? []).filter((p) => p.price_list_id === l.id);
    const count = (s: string) => mine.filter((p) => p.state === s).length;
    return {
      id: l.id!,
      name: l.name ?? "",
      price_type: l.price_type ?? "",
      currency: l.currency ?? "MYR",
      status: l.status ?? "draft",
      market: l.market,
      tax_inclusive: !!l.tax_inclusive,
      supplier: l.supplier_id ? (suppliers.find((s) => s.id === l.supplier_id)?.name ?? null) : null,
      brand: l.brand_id ? (brands.find((b) => b.id === l.brand_id)?.name ?? null) : null,
      category: l.category_id ? (categories.find((c) => c.id === l.category_id)?.label ?? null) : null,
      owner_name: l.owner_id ? (members.get(l.owner_id)?.full_name ?? null) : null,
      owner_id: l.owner_id,
      source_ref: l.source_ref,
      counts: { current: count("current"), draft: count("draft"), scheduled: count("scheduled"), conflicted: count("conflicted"), superseded: count("superseded"), expired: count("expired") },
    };
  });
}

export interface PriceRow {
  id: string;
  price_list_id: string;
  price_list_name: string;
  price_type: string;
  variant_id: string;
  product_id: string | null;
  product_name: string;
  product_code: string | null;
  sku: string | null;
  brand: string | null;
  amount: number;
  currency: string;
  unit_id: string | null;
  unit_code: string | null;
  min_quantity: number;
  valid_from: string;
  valid_to: string | null;
  state: string;
  review_state: string;
  source_ref: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  imported_at: string | null;
  notes: string | null;
  created_at: string | null;
}

export async function listPrices(opts: { listId?: string; state?: string; variantId?: string; limit?: number }): Promise<PriceRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("variant_prices").select("*").order("valid_from", { ascending: false }).limit(opts.limit ?? 1000);
  if (opts.listId) q = q.eq("price_list_id", opts.listId);
  if (opts.state) q = q.eq("state", opts.state);
  if (opts.variantId) q = q.eq("variant_id", opts.variantId);
  const { data: prices } = await q;
  if (!prices || prices.length === 0) return [];
  const variantIds = [...new Set(prices.map((p) => p.variant_id!))];
  const [{ data: variants }, { data: lists }, units, brands, members] = await Promise.all([
    supabase.from("product_variants").select("id, product_id, sku").in("id", variantIds),
    supabase.from("price_lists").select("id, name, price_type"),
    getUnits(),
    getBrands(),
    getMemberMap(),
  ]);
  const productIds = [...new Set((variants ?? []).map((v) => v.product_id!))];
  const { data: products } = productIds.length ? await supabase.from("products").select("id, name, code, brand_id").in("id", productIds) : { data: [] as { id: string | null; name: string | null; code: string | null; brand_id: string | null }[] };
  const vMap = new Map((variants ?? []).map((v) => [v.id!, v]));
  const pMap = new Map((products ?? []).map((p) => [p.id!, p]));
  const lMap = new Map((lists ?? []).map((l) => [l.id!, l]));
  const uMap = new Map(units.map((u) => [u.id, u]));
  const bMap = new Map(brands.map((b) => [b.id, b.name]));
  return prices.map((pr) => {
    const v = vMap.get(pr.variant_id!);
    const p = v?.product_id ? pMap.get(v.product_id) : undefined;
    return {
      id: pr.id!,
      price_list_id: pr.price_list_id!,
      price_list_name: lMap.get(pr.price_list_id!)?.name ?? "",
      price_type: lMap.get(pr.price_list_id!)?.price_type ?? "",
      variant_id: pr.variant_id!,
      product_id: v?.product_id ?? null,
      product_name: p?.name ?? "",
      product_code: p?.code ?? null,
      sku: v?.sku ?? null,
      brand: p?.brand_id ? (bMap.get(p.brand_id) ?? null) : null,
      amount: Number(pr.amount),
      currency: pr.currency ?? "MYR",
      unit_id: pr.unit_id,
      unit_code: pr.unit_id ? (uMap.get(pr.unit_id)?.code ?? null) : null,
      min_quantity: Number(pr.min_quantity ?? 1),
      valid_from: pr.valid_from!,
      valid_to: pr.valid_to,
      state: pr.state ?? "draft",
      review_state: pr.review_state ?? "unreviewed",
      source_ref: pr.source_ref,
      approved_by_name: pr.approved_by ? (members.get(pr.approved_by)?.full_name ?? null) : null,
      approved_at: pr.approved_at,
      imported_at: pr.imported_at,
      notes: pr.notes,
      created_at: pr.created_at,
    };
  });
}

export async function getPriceList(id: string) {
  const lists = await listPriceLists();
  return lists.find((l) => l.id === id) ?? null;
}

/** Previous current price for the same exact scope (list + variant + unit + min qty) — for the compare-before-publish dialog. */
export async function getPreviousCurrentPrice(price: { id: string; price_list_id: string; variant_id: string; unit_id: string | null; min_quantity: number }) {
  const supabase = await createServerSupabase();
  let q = supabase.from("variant_prices").select("id, amount, currency, valid_from, valid_to, state, source_ref, approved_at").eq("price_list_id", price.price_list_id).eq("variant_id", price.variant_id).eq("min_quantity", price.min_quantity).in("state", ["current", "scheduled"]).neq("id", price.id);
  q = price.unit_id ? q.eq("unit_id", price.unit_id) : q.is("unit_id", null);
  const { data } = await q.order("valid_from", { ascending: false }).limit(1);
  const row = data?.[0];
  return row ? { id: row.id!, amount: Number(row.amount), currency: row.currency ?? "MYR", valid_from: row.valid_from!, valid_to: row.valid_to, state: row.state!, source_ref: row.source_ref, approved_at: row.approved_at } : null;
}

export async function getPriceApprovalEvents(priceId: string) {
  const supabase = await createServerSupabase();
  const [{ data }, members] = await Promise.all([supabase.from("price_approval_events").select("*").eq("variant_price_id", priceId).order("occurred_at", { ascending: false }), getMemberMap()]);
  return (data ?? []).map((e) => ({ id: e.id!, action: e.action!, reason: e.reason, occurred_at: e.occurred_at!, actor_name: e.actor_id ? (members.get(e.actor_id)?.full_name ?? null) : null }));
}
