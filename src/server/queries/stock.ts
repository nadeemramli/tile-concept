import "server-only";

import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap, getUnits } from "@/server/queries/reference";
import { getSuppliers } from "@/server/queries/catalog";

/**
 * Stock read models (PRD §7.7).
 *
 * Two authorities live side by side and must never be blended: SQL Account is
 * the in-house fact, mirrored read-only; supplier updates are timestamped
 * evidence. Every row therefore keeps its source, unit, "as of" and freshness
 * SLA so the UI can show how much to trust it.
 */

export type AvailabilityState = "available" | "low" | "out" | "made_to_order" | "ask_supplier" | "unknown";

export interface AvailabilityRow {
  key: string;
  source_kind: "in_house" | "supplier";
  variant_id: string | null;
  product_id: string | null;
  product_code: string | null;
  product_name: string;
  source_name: string;
  location_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  availability: AvailabilityState;
  /** Null whenever the state is non-numeric — never coerce it to zero. */
  quantity: number | null;
  on_hand: number | null;
  allocated: number | null;
  unit_code: string | null;
  as_of: string | null;
  expected_replenishment: string | null;
  source_channel: string | null;
  sla_minutes: number;
  is_authoritative: boolean;
  evidence_storage_path: string | null;
  notes: string | null;
  brand_id: string | null;
  category_id: string | null;
}

const AVAILABILITY_STATES: AvailabilityState[] = ["available", "low", "out", "made_to_order", "ask_supplier", "unknown"];

function toState(value: string | null | undefined): AvailabilityState {
  return AVAILABILITY_STATES.includes(value as AvailabilityState) ? (value as AvailabilityState) : "unknown";
}

/** A numeric quantity only means something for these states. */
export function hasNumericQuantity(state: AvailabilityState) {
  return state === "available" || state === "low";
}

export interface StockFilters {
  category?: string;
  brand?: string;
  supplier?: string;
  sourceKind?: string;
  freshness?: string;
  availability?: string;
  q?: string;
}

export async function listAvailability(filters: StockFilters = {}): Promise<AvailabilityRow[]> {
  const supabase = await createServerSupabase();
  const [{ data }, { data: products }] = await Promise.all([
    supabase.from("stock_availability").select("*").limit(2000),
    supabase.from("products").select("id, brand_id, category_id"),
  ]);
  const productMeta = new Map((products ?? []).map((p) => [p.id!, { brand_id: p.brand_id, category_id: p.category_id }]));

  let rows: AvailabilityRow[] = (data ?? []).map((r, i) => {
    const state = toState(r.availability);
    const meta = r.product_id ? productMeta.get(r.product_id) : undefined;
    return {
      key: `${r.source_kind}-${r.variant_id ?? r.product_id ?? i}-${r.supplier_id ?? r.location_name ?? i}`,
      source_kind: r.source_kind === "in_house" ? "in_house" : "supplier",
      variant_id: r.variant_id,
      product_id: r.product_id,
      product_code: r.product_code,
      product_name: r.product_name ?? "Unknown product",
      source_name: r.source_name ?? "—",
      location_name: r.location_name,
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      availability: state,
      // The view can carry a number alongside a non-numeric state; drop it so
      // "out" or "ask supplier" can never render as a quantity.
      quantity: hasNumericQuantity(state) && r.quantity !== null ? Number(r.quantity) : null,
      on_hand: r.on_hand === null ? null : Number(r.on_hand),
      allocated: r.allocated === null ? null : Number(r.allocated),
      unit_code: r.unit_code,
      as_of: r.as_of,
      expected_replenishment: r.expected_replenishment,
      source_channel: r.source_channel,
      sla_minutes: r.sla_minutes ?? 4320,
      is_authoritative: !!r.is_authoritative,
      evidence_storage_path: r.evidence_storage_path,
      notes: r.notes,
      brand_id: meta?.brand_id ?? null,
      category_id: meta?.category_id ?? null,
    };
  });

  if (filters.category) rows = rows.filter((r) => r.category_id === filters.category);
  if (filters.brand) rows = rows.filter((r) => r.brand_id === filters.brand);
  if (filters.supplier) rows = rows.filter((r) => r.supplier_id === filters.supplier);
  if (filters.sourceKind) rows = rows.filter((r) => r.source_kind === filters.sourceKind);
  if (filters.availability) rows = rows.filter((r) => r.availability === filters.availability);
  if (filters.freshness) rows = rows.filter((r) => freshnessBand(r.as_of, r.sla_minutes) === filters.freshness);
  if (filters.q?.trim()) {
    const term = filters.q.trim().toLowerCase();
    rows = rows.filter((r) => `${r.product_code ?? ""} ${r.product_name} ${r.supplier_name ?? ""} ${r.source_name}`.toLowerCase().includes(term));
  }
  return rows.sort((a, b) => (a.product_name ?? "").localeCompare(b.product_name ?? "") || a.source_kind.localeCompare(b.source_kind));
}

/** Mirrors freshnessOf() in the FreshnessBadge so filtering and display agree. */
export function freshnessBand(asOf: string | null, slaMinutes: number): "fresh" | "aging" | "stale" | "unknown" {
  if (!asOf) return "unknown";
  const ageMin = (Date.now() - new Date(asOf).getTime()) / 60_000;
  if (ageMin <= slaMinutes) return "fresh";
  if (ageMin <= slaMinutes * 3) return "aging";
  return "stale";
}

export interface StaleSupplierRow {
  supplier_id: string;
  supplier_name: string;
  last_update_at: string | null;
  fresh_hours: number;
  aging_hours: number;
  snapshot_count: number;
  freshness: "fresh" | "aging" | "stale" | "unknown";
}

export const listStaleSuppliers = cache(async (): Promise<StaleSupplierRow[]> => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("stale_supplier_queue").select("*");
  return (data ?? [])
    .map((r) => ({
      supplier_id: r.supplier_id!,
      supplier_name: r.supplier_name ?? "Supplier",
      last_update_at: r.last_update_at,
      fresh_hours: r.fresh_hours ?? 72,
      aging_hours: r.aging_hours ?? 168,
      snapshot_count: Number(r.snapshot_count ?? 0),
      freshness: (r.freshness ?? "unknown") as StaleSupplierRow["freshness"],
    }))
    .sort((a, b) => {
      const rank = { stale: 0, unknown: 1, aging: 2, fresh: 3 } as const;
      return rank[a.freshness] - rank[b.freshness] || a.supplier_name.localeCompare(b.supplier_name);
    });
});

export interface SnapshotHistoryRow {
  id: string;
  captured_at: string | null;
  source: string;
  availability: AvailabilityState;
  quantity: number | null;
  unit_code: string | null;
  submitted_by_name: string | null;
  source_channel: string | null;
  notes: string | null;
  evidence_storage_path: string | null;
  expected_replenishment: string | null;
}

/** Full history for one variant across every supplier, newest first. */
export async function getVariantHistory(variantId: string) {
  const supabase = await createServerSupabase();
  const [{ data: supplierSnaps }, { data: inHouse }, suppliers, units, members] = await Promise.all([
    supabase.from("supplier_availability_snapshots").select("*").eq("variant_id", variantId).order("captured_at", { ascending: false }).limit(50),
    supabase.from("inventory_snapshots").select("*").eq("variant_id", variantId).order("captured_at", { ascending: false }).limit(50),
    getSuppliers(),
    getUnits(),
    getMemberMap(),
  ]);
  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const unitMap = new Map(units.map((u) => [u.id, u.code]));

  const supplierRows: SnapshotHistoryRow[] = (supplierSnaps ?? []).map((s) => ({
    id: s.id!,
    captured_at: s.captured_at,
    source: s.supplier_id ? (supplierMap.get(s.supplier_id) ?? "Supplier") : "Supplier",
    availability: toState(s.availability),
    quantity: hasNumericQuantity(toState(s.availability)) && s.quantity !== null ? Number(s.quantity) : null,
    unit_code: s.unit_id ? (unitMap.get(s.unit_id) ?? null) : null,
    submitted_by_name: s.submitted_by ? (members.get(s.submitted_by)?.full_name ?? null) : null,
    source_channel: s.source_channel,
    notes: s.notes,
    evidence_storage_path: s.evidence_storage_path,
    expected_replenishment: s.expected_replenishment,
  }));

  const inHouseRows: SnapshotHistoryRow[] = (inHouse ?? []).map((s) => {
    const qty = s.available ?? s.on_hand;
    const state: AvailabilityState = qty === null ? "unknown" : Number(qty) <= 0 ? "out" : Number(qty) < 10 ? "low" : "available";
    return {
      id: s.id!,
      captured_at: s.source_timestamp ?? s.captured_at,
      source: "SQL Account",
      availability: state,
      quantity: hasNumericQuantity(state) && qty !== null ? Number(qty) : null,
      unit_code: s.unit_id ? (unitMap.get(s.unit_id) ?? null) : null,
      submitted_by_name: null,
      source_channel: `checkpoint ${s.checkpoint ?? "—"}`,
      notes: s.external_item_code ? `Item code ${s.external_item_code}` : null,
      evidence_storage_path: null,
      expected_replenishment: null,
    };
  });

  return [...supplierRows, ...inHouseRows].sort((a, b) => (b.captured_at ?? "").localeCompare(a.captured_at ?? ""));
}

export interface MappingRow {
  id: string;
  external_item_code: string;
  status: string;
  variant_id: string | null;
  variant_label: string | null;
  source_name: string;
  snapshot_count: number;
}

export async function listItemMappings(): Promise<MappingRow[]> {
  const supabase = await createServerSupabase();
  const [{ data: mappings }, { data: sources }, { data: variants }, { data: products }, { data: snaps }] = await Promise.all([
    supabase.from("inventory_item_mappings").select("*").order("external_item_code"),
    supabase.from("inventory_sources").select("id, name, key"),
    supabase.from("product_variants").select("id, sku, product_id"),
    supabase.from("products").select("id, name, code"),
    supabase.from("inventory_snapshots").select("external_item_code"),
  ]);
  const sourceMap = new Map((sources ?? []).map((s) => [s.id!, s.name ?? s.key ?? "Source"]));
  const productMap = new Map((products ?? []).map((p) => [p.id!, p]));
  const variantMap = new Map(
    (variants ?? []).map((v) => {
      const p = v.product_id ? productMap.get(v.product_id) : undefined;
      return [v.id!, `${p?.code ?? v.sku ?? "?"} · ${p?.name ?? "Unknown"}`];
    }),
  );
  const counts = new Map<string, number>();
  for (const s of snaps ?? []) if (s.external_item_code) counts.set(s.external_item_code, (counts.get(s.external_item_code) ?? 0) + 1);

  return (mappings ?? []).map((m) => ({
    id: m.id!,
    external_item_code: m.external_item_code ?? "—",
    status: m.status ?? "unmapped",
    variant_id: m.variant_id,
    variant_label: m.variant_id ? (variantMap.get(m.variant_id) ?? null) : null,
    source_name: m.source_id ? (sourceMap.get(m.source_id) ?? "Source") : "Source",
    snapshot_count: counts.get(m.external_item_code ?? "") ?? 0,
  }));
}

export interface InHouseSnapshotRow {
  id: string;
  location_name: string | null;
  external_item_code: string | null;
  product_label: string | null;
  on_hand: number | null;
  allocated: number | null;
  available: number | null;
  unit_code: string | null;
  source_timestamp: string | null;
  checkpoint: string | null;
}

export async function listInHouseSnapshots(): Promise<InHouseSnapshotRow[]> {
  const supabase = await createServerSupabase();
  const [{ data: snaps }, { data: locations }, { data: variants }, { data: products }, units] = await Promise.all([
    supabase.from("inventory_snapshots").select("*").order("captured_at", { ascending: false }).limit(200),
    supabase.from("inventory_locations").select("id, name"),
    supabase.from("product_variants").select("id, product_id, sku"),
    supabase.from("products").select("id, name, code"),
    getUnits(),
  ]);
  const locMap = new Map((locations ?? []).map((l) => [l.id!, l.name ?? "—"]));
  const productMap = new Map((products ?? []).map((p) => [p.id!, p]));
  const variantMap = new Map((variants ?? []).map((v) => [v.id!, v]));
  const unitMap = new Map(units.map((u) => [u.id, u.code]));

  return (snaps ?? []).map((s) => {
    const v = s.variant_id ? variantMap.get(s.variant_id) : undefined;
    const p = v?.product_id ? productMap.get(v.product_id) : undefined;
    return {
      id: s.id!,
      location_name: s.location_id ? (locMap.get(s.location_id) ?? null) : null,
      external_item_code: s.external_item_code,
      product_label: p ? `${p.code ?? ""} ${p.name ?? ""}`.trim() : null,
      on_hand: s.on_hand === null ? null : Number(s.on_hand),
      allocated: s.allocated === null ? null : Number(s.allocated),
      available: s.available === null ? null : Number(s.available),
      unit_code: s.unit_id ? (unitMap.get(s.unit_id) ?? null) : null,
      source_timestamp: s.source_timestamp,
      checkpoint: s.checkpoint,
    };
  });
}

export interface ReconciliationRow {
  id: string;
  variant_id: string | null;
  variant_label: string | null;
  source_name: string | null;
  expected: number | null;
  observed: number | null;
  variance: number | null;
  status: string;
  notes: string | null;
  opened_at: string | null;
  resolved_at: string | null;
}

export async function listReconciliationCases(): Promise<ReconciliationRow[]> {
  const supabase = await createServerSupabase();
  const [{ data: cases }, { data: sources }, { data: variants }, { data: products }] = await Promise.all([
    supabase.from("stock_reconciliation_cases").select("*").order("opened_at", { ascending: false }).limit(200),
    supabase.from("inventory_sources").select("id, name"),
    supabase.from("product_variants").select("id, product_id, sku"),
    supabase.from("products").select("id, name, code"),
  ]);
  const sourceMap = new Map((sources ?? []).map((s) => [s.id!, s.name ?? "Source"]));
  const productMap = new Map((products ?? []).map((p) => [p.id!, p]));
  const variantMap = new Map((variants ?? []).map((v) => [v.id!, v]));

  return (cases ?? []).map((c) => {
    const v = c.variant_id ? variantMap.get(c.variant_id) : undefined;
    const p = v?.product_id ? productMap.get(v.product_id) : undefined;
    const expected = c.expected === null ? null : Number(c.expected);
    const observed = c.observed === null ? null : Number(c.observed);
    return {
      id: c.id!,
      variant_id: c.variant_id,
      variant_label: p ? `${p.code ?? ""} ${p.name ?? ""}`.trim() : (v?.sku ?? null),
      source_name: c.source_id ? (sourceMap.get(c.source_id) ?? null) : null,
      expected,
      observed,
      variance: expected !== null && observed !== null ? observed - expected : null,
      status: c.status ?? "open",
      notes: c.notes,
      opened_at: c.opened_at,
      resolved_at: c.resolved_at,
    };
  });
}

export interface SqlConnector {
  id: string;
  name: string;
  status: string;
  environment: string;
  direction: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  business_purpose: string | null;
  checkpoint: string | null;
  sla_minutes: number;
}

export async function getSqlConnector(): Promise<SqlConnector | null> {
  const supabase = await createServerSupabase();
  const { data: conn } = await supabase.from("integration_connections").select("*").eq("provider", "sql_account").limit(1).maybeSingle();
  if (!conn) return null;
  const [{ data: checkpoint }, { data: source }] = await Promise.all([
    supabase.from("connector_checkpoints").select("cursor, updated_at").eq("connection_id", conn.id!).limit(1).maybeSingle(),
    supabase.from("inventory_sources").select("freshness_sla_minutes").eq("key", "sql_account").maybeSingle(),
  ]);
  return {
    id: conn.id!,
    name: conn.name ?? "SQL Account",
    status: conn.status ?? "not_configured",
    environment: conn.environment ?? "demo",
    direction: conn.direction ?? "pull",
    last_attempt_at: conn.last_attempt_at,
    last_success_at: conn.last_success_at,
    last_error: conn.last_error,
    business_purpose: conn.business_purpose,
    checkpoint: checkpoint?.cursor ?? null,
    sla_minutes: source?.freshness_sla_minutes ?? 240,
  };
}

/** Variant picker options for the quick-entry and mapping forms. */
export const getVariantOptions = cache(async () => {
  const supabase = await createServerSupabase();
  const [{ data: variants }, { data: products }] = await Promise.all([
    supabase.from("product_variants").select("id, sku, product_id, is_default").eq("status", "active").limit(1000),
    supabase.from("products").select("id, name, code, code_key, brand_id"),
  ]);
  const productMap = new Map((products ?? []).map((p) => [p.id!, p]));
  return (variants ?? [])
    .map((v) => {
      const p = v.product_id ? productMap.get(v.product_id) : undefined;
      return {
        id: v.id!,
        product_id: v.product_id,
        sku: v.sku,
        code: p?.code ?? v.sku ?? "",
        code_key: p?.code_key ?? "",
        name: p?.name ?? "Unknown product",
        label: `${p?.code ?? v.sku ?? "?"} · ${p?.name ?? "Unknown"}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
});

export interface StockCounts {
  staleSuppliers: number;
  unmapped: number;
  openCases: number;
  noAvailability: number;
  outLines: number;
}

export async function getStockCounts(rows: AvailabilityRow[]): Promise<StockCounts> {
  const supabase = await createServerSupabase();
  const [stale, { count: unmapped }, { count: openCases }, { data: activeProducts }] = await Promise.all([
    listStaleSuppliers(),
    supabase.from("inventory_item_mappings").select("id", { count: "exact", head: true }).eq("status", "unmapped"),
    supabase.from("stock_reconciliation_cases").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("products").select("id").eq("status", "active"),
  ]);
  const covered = new Set(rows.map((r) => r.product_id).filter(Boolean));
  return {
    staleSuppliers: stale.filter((s) => s.freshness === "stale" || s.freshness === "unknown").length,
    unmapped: unmapped ?? 0,
    openCases: openCases ?? 0,
    noAvailability: (activeProducts ?? []).filter((p) => !covered.has(p.id!)).length,
    outLines: rows.filter((r) => r.availability === "out").length,
  };
}
