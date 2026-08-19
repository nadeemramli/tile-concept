import "server-only";

import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBrands, getCategories, getMemberMap, getUnits } from "@/server/queries/reference";

export interface CatalogFilters {
  view?: string; // active | missing-price | unreviewed | all
  category?: string; // category id
  brand?: string; // brand id
  status?: string;
  q?: string;
}

export interface Dimensions {
  width_mm?: number;
  length_mm?: number;
  thickness_mm?: number;
  depth_mm?: number;
  sheet_width_mm?: number;
  sheet_height_mm?: number;
  [k: string]: unknown;
}

export function formatDimensions(d: Dimensions | null | undefined): string {
  if (!d) return "—";
  if (d.sheet_width_mm || d.sheet_height_mm) return `${d.sheet_width_mm ?? "?"}×${d.sheet_height_mm ?? "?"} mm sheet`;
  const parts = [d.width_mm, d.length_mm, d.thickness_mm ?? d.depth_mm].filter((v) => v !== undefined && v !== null);
  return parts.length ? `${parts.join("×")} mm` : "—";
}

export interface CurrentPrice {
  id: string;
  amount: number;
  currency: string;
  unit_code: string | null;
  price_list_name: string;
  price_type: string;
  valid_from: string;
  state: string;
}

export interface CatalogRow {
  id: string;
  code: string | null;
  name: string;
  brand_id: string | null;
  brand: string | null;
  category_id: string | null;
  category: string | null;
  color: string | null;
  finish: string | null;
  material: string | null;
  status: string;
  review_state: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  source_ref: string | null;
  confidence: number | null;
  default_variant_id: string | null;
  dimensions: Dimensions | null;
  dimensions_label: string;
  price: CurrentPrice | null;
  updated_at: string | null;
}

function pickCurrentPrice(rows: { id: string | null; variant_id: string | null; amount: number | null; currency: string | null; unit_code: string | null; price_list_name: string | null; price_type: string | null; valid_from: string | null; state: string | null }[], variantIds: string[]): CurrentPrice | null {
  const cands = rows.filter((r) => r.variant_id && variantIds.includes(r.variant_id) && r.state === "current");
  if (cands.length === 0) return null;
  const retail = cands.find((c) => c.price_type === "retail") ?? cands[0];
  return {
    id: retail.id!,
    amount: Number(retail.amount),
    currency: retail.currency ?? "MYR",
    unit_code: retail.unit_code,
    price_list_name: retail.price_list_name ?? "",
    price_type: retail.price_type ?? "",
    valid_from: retail.valid_from ?? "",
    state: retail.state ?? "current",
  };
}

export async function listProducts(filters: CatalogFilters): Promise<CatalogRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from("products")
    .select("id, code, name, brand_id, category_id, color, finish, material, status, review_state, reviewed_by, reviewed_at, source_ref, confidence, updated_at")
    .order("name")
    .limit(500);

  if (filters.view === "unreviewed") q = q.eq("review_state", "unreviewed").neq("status", "archived");
  else if (filters.view === "all") {
    /* no status filter */
  } else if (filters.view === "missing-price") q = q.eq("status", "active");
  else q = q.eq("status", "active");
  if (filters.category) q = q.eq("category_id", filters.category);
  if (filters.brand) q = q.eq("brand_id", filters.brand);
  if (filters.status) q = q.eq("status", filters.status);

  let aliasProductIds: string[] | null = null;
  if (filters.q && filters.q.trim()) {
    const term = filters.q.trim();
    const key = term.toLowerCase().replace(/[^a-z0-9]/g, "");
    const { data: aliases } = await supabase.from("product_aliases").select("product_id").ilike("alias_key", `%${key}%`);
    aliasProductIds = (aliases ?? []).map((a) => a.product_id!).filter(Boolean);
    const ors = [`name.ilike.%${term}%`, key ? `code_key.ilike.%${key}%` : null, aliasProductIds.length ? `id.in.(${aliasProductIds.join(",")})` : null].filter(Boolean).join(",");
    q = q.or(ors);
  }

  const { data: products } = await q;
  if (!products || products.length === 0) return [];
  const ids = products.map((p) => p.id!);

  const [{ data: variants }, { data: prices }, brands, categories, members] = await Promise.all([
    supabase.from("product_variants").select("id, product_id, dimensions, is_default, created_at").in("product_id", ids),
    supabase.from("current_variant_prices").select("id, variant_id, product_id, amount, currency, unit_code, price_list_name, price_type, valid_from, state").in("product_id", ids),
    getBrands(),
    getCategories(),
    getMemberMap(),
  ]);
  const brandMap = new Map(brands.map((b) => [b.id, b.name]));
  const catMap = new Map(categories.map((c) => [c.id, c.label]));

  const rows: CatalogRow[] = products.map((p) => {
    const vs = (variants ?? []).filter((v) => v.product_id === p.id);
    const def = vs.find((v) => v.is_default) ?? vs[0];
    const price = pickCurrentPrice(prices ?? [], vs.map((v) => v.id!));
    return {
      id: p.id!,
      code: p.code,
      name: p.name ?? "",
      brand_id: p.brand_id,
      brand: p.brand_id ? (brandMap.get(p.brand_id) ?? null) : null,
      category_id: p.category_id,
      category: p.category_id ? (catMap.get(p.category_id) ?? null) : null,
      color: p.color,
      finish: p.finish,
      material: p.material,
      status: p.status ?? "draft",
      review_state: p.review_state ?? "unreviewed",
      reviewed_by: p.reviewed_by,
      reviewed_by_name: p.reviewed_by ? (members.get(p.reviewed_by)?.full_name ?? null) : null,
      reviewed_at: p.reviewed_at,
      source_ref: p.source_ref,
      confidence: p.confidence,
      default_variant_id: def?.id ?? null,
      dimensions: (def?.dimensions as Dimensions | null) ?? null,
      dimensions_label: formatDimensions(def?.dimensions as Dimensions | null),
      price,
      updated_at: p.updated_at,
    };
  });
  return filters.view === "missing-price" ? rows.filter((r) => !r.price) : rows;
}

export const getSuppliers = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("suppliers").select("id, name, status").order("name");
  return (data ?? []).map((s) => ({ id: s.id!, name: s.name!, status: s.status! }));
});

export const getPriceListsRef = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("price_lists").select("id, name, price_type, currency, status").order("name");
  return (data ?? []).map((p) => ({ id: p.id!, name: p.name!, price_type: p.price_type!, currency: p.currency!, status: p.status! }));
});

export interface AttributeRuleWithValue {
  rule_id: string;
  attribute_definition_id: string;
  key: string;
  label: string;
  data_type: string;
  unit: string | null;
  options: unknown;
  is_required: boolean;
  position: number;
  value: unknown;
  value_id: string | null;
  source_ref: string | null;
}

export async function getCategoryAttributeRules(categoryId: string | null) {
  if (!categoryId) return [] as { rule_id: string; attribute_definition_id: string; key: string; label: string; data_type: string; unit: string | null; options: unknown; is_required: boolean; position: number }[];
  const supabase = await createServerSupabase();
  const [{ data: rules }, { data: defs }] = await Promise.all([
    supabase.from("category_attribute_rules").select("id, attribute_definition_id, is_required, position").eq("category_id", categoryId).order("position"),
    supabase.from("attribute_definitions").select("id, key, label, data_type, unit, options"),
  ]);
  const defMap = new Map((defs ?? []).map((d) => [d.id!, d]));
  return (rules ?? [])
    .map((r) => {
      const d = defMap.get(r.attribute_definition_id!);
      if (!d) return null;
      return { rule_id: r.id!, attribute_definition_id: d.id!, key: d.key!, label: d.label!, data_type: d.data_type!, unit: d.unit, options: d.options, is_required: !!r.is_required, position: r.position ?? 0 };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

export async function getProductDetail(id: string) {
  const supabase = await createServerSupabase();
  const { data: p } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!p) return null;

  const [{ data: variants }, brands, categories, units, suppliers, members, rules] = await Promise.all([
    supabase.from("product_variants").select("*").eq("product_id", id).order("is_default", { ascending: false }).order("created_at"),
    getBrands(),
    getCategories(),
    getUnits(),
    getSuppliers(),
    getMemberMap(),
    getCategoryAttributeRules(p.category_id),
  ]);
  const variantIds = (variants ?? []).map((v) => v.id!);
  const [{ data: packaging }, { data: prices }, { data: attrValues }, { data: aliases }, { data: media }, { data: entries }, { data: priceLists }] = await Promise.all([
    variantIds.length ? supabase.from("packaging_configurations").select("*").in("variant_id", variantIds) : Promise.resolve({ data: [] }),
    variantIds.length ? supabase.from("variant_prices").select("*").in("variant_id", variantIds).order("valid_from", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.from("product_attribute_values").select("*").eq("product_id", id),
    supabase.from("product_aliases").select("*").eq("product_id", id).order("created_at"),
    supabase.from("product_media").select("*").eq("product_id", id),
    supabase.from("catalog_entries").select("*").eq("product_id", id),
    supabase.from("price_lists").select("id, name, price_type, currency"),
  ]);
  const auditIds = [id, ...variantIds, ...(prices ?? []).map((x) => x.id!)];
  const { data: audit } = await supabase.from("audit_events").select("id, occurred_at, actor_id, action, object_table, object_id, reason, before_data, after_data").in("object_id", auditIds).order("occurred_at", { ascending: false }).limit(30);

  // possible duplicates: same code_key / alias key, or same brand + name prefix
  const nameWords = (p.name ?? "").split(/\s+/).slice(0, 2).join(" ");
  const dupQ = supabase.from("products").select("id, code, name, brand_id, status").neq("id", id).limit(8);
  const ors: string[] = [];
  if (p.code_key) ors.push(`code_key.eq.${p.code_key}`);
  if (nameWords) ors.push(`name.ilike.${nameWords}%`);
  const { data: dupCandidates } = ors.length ? await dupQ.or(ors.join(",")) : { data: [] as { id: string | null; code: string | null; name: string | null; brand_id: string | null; status: string | null }[] };
  const aliasKeys = (aliases ?? []).map((a) => a.alias_key).filter(Boolean) as string[];
  const { data: aliasDups } = aliasKeys.length ? await supabase.from("product_aliases").select("product_id, alias").in("alias_key", aliasKeys).neq("product_id", id) : { data: [] as { product_id: string | null; alias: string | null }[] };
  const aliasDupIds = (aliasDups ?? []).map((a) => a.product_id!).filter(Boolean);
  const { data: aliasDupProducts } = aliasDupIds.length ? await supabase.from("products").select("id, code, name, brand_id, status").in("id", aliasDupIds) : { data: [] as typeof dupCandidates };
  const dupMap = new Map<string, { id: string; code: string | null; name: string; brand: string | null; status: string; reason: string }>();
  const brandMap = new Map(brands.map((b) => [b.id, b.name]));
  for (const d of dupCandidates ?? []) {
    const reason = p.code_key && d.code && d.code.toLowerCase().replace(/[^a-z0-9]/g, "") === p.code_key ? "Same code" : d.brand_id === p.brand_id ? "Same brand + similar name" : "Similar name";
    if (reason === "Similar name" && d.brand_id !== p.brand_id) continue;
    dupMap.set(d.id!, { id: d.id!, code: d.code, name: d.name ?? "", brand: d.brand_id ? (brandMap.get(d.brand_id) ?? null) : null, status: d.status ?? "", reason });
  }
  for (const d of aliasDupProducts ?? []) dupMap.set(d.id!, { id: d.id!, code: d.code, name: d.name ?? "", brand: d.brand_id ? (brandMap.get(d.brand_id) ?? null) : null, status: d.status ?? "", reason: "Shared alias" });

  const unitMap = new Map(units.map((u) => [u.id, u]));
  const plMap = new Map((priceLists ?? []).map((l) => [l.id!, l]));
  const valueByDef = new Map((attrValues ?? []).filter((v) => !v.variant_id).map((v) => [v.attribute_definition_id!, v]));

  return {
    product: {
      ...p,
      id: p.id!,
      name: p.name ?? "",
      status: p.status ?? "draft",
      review_state: p.review_state ?? "unreviewed",
      brand: p.brand_id ? (brandMap.get(p.brand_id) ?? null) : null,
      category: p.category_id ? (categories.find((c) => c.id === p.category_id)?.label ?? null) : null,
      category_key: p.category_id ? (categories.find((c) => c.id === p.category_id)?.key ?? null) : null,
      supplier: p.supplier_id ? (suppliers.find((s) => s.id === p.supplier_id)?.name ?? null) : null,
      reviewed_by_name: p.reviewed_by ? (members.get(p.reviewed_by)?.full_name ?? null) : null,
      created_by_name: p.created_by ? (members.get(p.created_by)?.full_name ?? null) : null,
    },
    specs: rules.map<AttributeRuleWithValue>((r) => {
      const v = valueByDef.get(r.attribute_definition_id);
      return { ...r, value: v?.value ?? null, value_id: v?.id ?? null, source_ref: v?.source_ref ?? null };
    }),
    variants: (variants ?? []).map((v) => ({
      id: v.id!,
      sku: v.sku,
      name: v.name,
      dimensions: (v.dimensions as Dimensions | null) ?? null,
      dimensions_label: formatDimensions(v.dimensions as Dimensions | null),
      selling_unit: v.selling_unit_id ? (unitMap.get(v.selling_unit_id)?.code ?? null) : null,
      purchase_unit: v.purchase_unit_id ? (unitMap.get(v.purchase_unit_id)?.code ?? null) : null,
      status: v.status ?? "active",
      is_default: !!v.is_default,
      packaging: (packaging ?? [])
        .filter((pk) => pk.variant_id === v.id)
        .map((pk) => ({
          id: pk.id!,
          pack_label: pk.pack_label,
          quantity_per_pack: pk.quantity_per_pack,
          inner_unit: pk.inner_unit_id ? (unitMap.get(pk.inner_unit_id)?.code ?? null) : null,
          coverage_per_pack: pk.coverage_per_pack,
          coverage_unit: pk.coverage_unit_id ? (unitMap.get(pk.coverage_unit_id)?.code ?? null) : null,
          moq: pk.moq,
          order_increment: pk.order_increment,
        })),
    })),
    prices: (prices ?? []).map((pr) => ({
      id: pr.id!,
      variant_id: pr.variant_id!,
      variant_sku: (variants ?? []).find((v) => v.id === pr.variant_id)?.sku ?? null,
      price_list_id: pr.price_list_id!,
      price_list_name: plMap.get(pr.price_list_id!)?.name ?? "",
      price_type: plMap.get(pr.price_list_id!)?.price_type ?? "",
      amount: Number(pr.amount),
      currency: pr.currency ?? "MYR",
      unit_code: pr.unit_id ? (unitMap.get(pr.unit_id)?.code ?? null) : null,
      min_quantity: Number(pr.min_quantity ?? 1),
      valid_from: pr.valid_from!,
      valid_to: pr.valid_to,
      state: pr.state ?? "draft",
      review_state: pr.review_state ?? "unreviewed",
      source_ref: pr.source_ref,
      approved_by_name: pr.approved_by ? (members.get(pr.approved_by)?.full_name ?? null) : null,
      approved_at: pr.approved_at,
      notes: pr.notes,
    })),
    aliases: (aliases ?? []).map((a) => ({ id: a.id!, alias: a.alias!, source: a.source })),
    media: (media ?? []).map((m) => ({ id: m.id!, kind: m.kind!, storage_path: m.storage_path!, caption: m.caption, is_primary: !!m.is_primary, source_ref: m.source_ref })),
    catalogEntries: (entries ?? []).map((e) => ({ id: e.id!, page_ref: e.page_ref, snippet: e.snippet, source_asset_id: e.source_asset_id })),
    audit: (audit ?? []).map((a) => ({ ...a, id: a.id!, actor_name: a.actor_id ? (members.get(a.actor_id)?.full_name ?? null) : null })),
    duplicates: [...dupMap.values()],
    reference: { brands, categories, units, suppliers, priceLists: (priceLists ?? []).map((l) => ({ id: l.id!, name: l.name!, price_type: l.price_type!, currency: l.currency! })) },
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>;

export async function getCompareProducts(ids: string[]) {
  const supabase = await createServerSupabase();
  if (ids.length === 0) return [];
  const [{ data: products }, { data: variants }, { data: prices }, { data: values }, { data: defs }, brands, categories] = await Promise.all([
    supabase.from("products").select("id, code, name, brand_id, category_id, color, finish, material, style, status").in("id", ids),
    supabase.from("product_variants").select("id, product_id, dimensions, is_default").in("product_id", ids),
    supabase.from("current_variant_prices").select("id, variant_id, product_id, amount, currency, unit_code, price_list_name, price_type, valid_from, state").in("product_id", ids),
    supabase.from("product_attribute_values").select("product_id, attribute_definition_id, value").in("product_id", ids).is("variant_id", null),
    supabase.from("attribute_definitions").select("id, key, label, unit"),
    getBrands(),
    getCategories(),
  ]);
  const defMap = new Map((defs ?? []).map((d) => [d.id!, d]));
  return ids
    .map((id) => {
      const p = (products ?? []).find((x) => x.id === id);
      if (!p) return null;
      const vs = (variants ?? []).filter((v) => v.product_id === id);
      const def = vs.find((v) => v.is_default) ?? vs[0];
      const attrs: Record<string, { label: string; value: unknown; unit: string | null }> = {};
      for (const v of (values ?? []).filter((x) => x.product_id === id)) {
        const d = defMap.get(v.attribute_definition_id!);
        if (d) attrs[d.key!] = { label: d.label!, value: v.value, unit: d.unit };
      }
      return {
        id,
        code: p.code,
        name: p.name ?? "",
        brand: brands.find((b) => b.id === p.brand_id)?.name ?? null,
        category: categories.find((c) => c.id === p.category_id)?.label ?? null,
        color: p.color,
        finish: p.finish,
        material: p.material,
        style: p.style,
        dimensions_label: formatDimensions(def?.dimensions as Dimensions | null),
        price: pickCurrentPrice(prices ?? [], vs.map((v) => v.id!)),
        attrs,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}
