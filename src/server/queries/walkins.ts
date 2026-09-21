import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getLocations, getMemberMap } from "@/server/queries/reference";
import type { Database } from "@/lib/supabase/database.types";
import type { OpenOpportunityRef, PurchaseRow, VisitRow } from "@/features/walkins/types";

async function nameMaps(contactIds: string[], accountIds: string[]) {
  const supabase = await createServerSupabase();
  const [contacts, accounts] = await Promise.all([
    contactIds.length ? supabase.from("contacts").select("id, display_name").in("id", contactIds) : Promise.resolve({ data: [] as { id: string | null; display_name: string | null }[] }),
    accountIds.length ? supabase.from("accounts").select("id, name").in("id", accountIds) : Promise.resolve({ data: [] as { id: string | null; name: string | null }[] }),
  ]);
  return {
    contact: new Map((contacts.data ?? []).map((c) => [String(c.id), c.display_name ?? ""])),
    account: new Map((accounts.data ?? []).map((a) => [String(a.id), a.name ?? ""])),
  };
}

const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)));

type VisitRecord = Database["api"]["Views"]["visits"]["Row"];

async function hydrateVisits(rows: VisitRecord[]): Promise<VisitRow[]> {
  const [names, members, locations] = await Promise.all([nameMaps(uniq(rows.map((r) => r.contact_id)), []), getMemberMap(), getLocations()]);
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  return rows.map((r) => ({
    id: String(r.id),
    occurred_at: String(r.occurred_at),
    location_id: r.location_id,
    location_name: r.location_id ? (locMap.get(r.location_id) ?? null) : null,
    staff_user_id: r.staff_user_id,
    staff_name: r.staff_user_id ? (members.get(r.staff_user_id)?.full_name ?? null) : null,
    contact_id: r.contact_id,
    contact_name: r.contact_id ? (names.contact.get(r.contact_id) ?? null) : null,
    account_id: r.account_id,
    lead_id: r.lead_id,
    inquiry_link_state: r.inquiry_link_state ?? "legacy",
    inquiry_link_reason: r.inquiry_link_reason,
    inquiry_link_version: r.inquiry_link_version ?? 0,
    opportunity_id: r.opportunity_id,
    customer_type: r.customer_type,
    origin_area: r.origin_area,
    renovation_area: r.renovation_area,
    inquiry_source: r.inquiry_source,
    purpose: r.purpose,
    quotation_ref: r.quotation_ref,
    quotation_amount: r.quotation_amount === null ? null : Number(r.quotation_amount),
    is_new_customer: r.is_new_customer,
    notes: r.notes,
  }));
}

export async function listVisits(limit = 500): Promise<VisitRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("visits").select("*").order("occurred_at", { ascending: false }).order("id").limit(limit);
  if (error) throw error;
  return hydrateVisits(data ?? []);
}

export async function getVisitPage(requestedPage: number, needsLinking: boolean) {
  const supabase = await createServerSupabase();
  let totalQuery = supabase.from("visits").select("id", { count: "exact", head: true });
  if (needsLinking) totalQuery = totalQuery.eq("inquiry_link_state", "needs_linking");
  const { count, error: countError } = await totalQuery;
  if (countError) throw countError;
  const total = count ?? 0;
  const page = Math.min(Math.max(1, requestedPage), Math.max(1, Math.ceil(total / 25)));
  let query = supabase.from("visits").select("*").order("occurred_at", { ascending: false }).order("id").range((page - 1) * 25, page * 25 - 1);
  if (needsLinking) query = query.eq("inquiry_link_state", "needs_linking");
  const { data, error } = await query;
  if (error) throw error;
  return { rows: await hydrateVisits(data ?? []), total, page };
}

export async function getVisit(id: string): Promise<VisitRow | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("visits").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? (await hydrateVisits([data]))[0] : null;
}

export async function getVisitLinkHistory(id: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("activities").select("id, occurred_at, body")
    .eq("visit_id", id).eq("subject", "Visit inquiry link corrected").order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: String(r.id), occurred_at: String(r.occurred_at), reason: r.body ?? "" }));
}

export async function listPurchases(limit = 500, filter?: { visitIds?: string[]; id?: string }): Promise<PurchaseRow[]> {
  const supabase = await createServerSupabase();
  if (filter?.visitIds?.length === 0) return [];
  const rows: Database["api"]["Views"]["purchases"]["Row"][] = [];
  // Visit drawers must also find older purchases outside the recent ledger.
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from("purchases").select("*").order("purchased_at", { ascending: false }).order("id");
    if (filter?.visitIds) query = query.in("visit_id", filter.visitIds);
    if (filter?.id) query = query.eq("id", filter.id);
    query = filter ? query.range(offset, offset + 499) : query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!filter || (data?.length ?? 0) < 500) break;
  }
  const ids = rows.map((r) => String(r.id));
  const [names, members, locations, pays, items, balances] = await Promise.all([
    nameMaps(uniq(rows.map((r) => r.contact_id)), uniq(rows.map((r) => r.account_id))),
    getMemberMap(),
    getLocations(),
    ids.length ? supabase.from("purchase_payments").select("id, purchase_id, method, amount, reference, review_state, direction").in("purchase_id", ids) : Promise.resolve({ data: [] as never[], error: null }),
    ids.length ? supabase.from("purchase_items").select("id, purchase_id, description, quantity, unit, unit_price, line_total, position").in("purchase_id", ids).order("position") : Promise.resolve({ data: [] as never[], error: null }),
    ids.length ? supabase.from("sale_balances").select("id,collections").in("id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  if (pays.error || items.error || balances.error) throw pays.error ?? items.error ?? balances.error;
  const collectionById = new Map((balances.data ?? []).map(b => [b.id, Number(b.collections ?? 0)]));
  const payBy = new Map<string, PurchaseRow["payments"]>();
  for (const p of (pays.data ?? []) as { id: string | null; purchase_id: string | null; method: string | null; amount: number | null; reference: string | null; review_state: string | null; direction: string | null }[]) {
    const k = String(p.purchase_id);
    (payBy.get(k) ?? payBy.set(k, []).get(k)!).push({ id: String(p.id), method: String(p.method ?? "other"), amount: Number(p.amount ?? 0), reference: p.reference });
  }
  const itemBy = new Map<string, PurchaseRow["items"]>();
  for (const it of (items.data ?? []) as { id: string | null; purchase_id: string | null; description: string | null; quantity: number | null; unit: string | null; unit_price: number | null; line_total: number | null }[]) {
    const k = String(it.purchase_id);
    (itemBy.get(k) ?? itemBy.set(k, []).get(k)!).push({ id: String(it.id), description: String(it.description ?? ""), quantity: Number(it.quantity ?? 0), unit: it.unit, unit_price: it.unit_price === null ? null : Number(it.unit_price), line_total: it.line_total === null ? null : Number(it.line_total) });
  }
  return rows.map((r) => {
    const id = String(r.id);
    const payments = payBy.get(id) ?? [];
    return {
      id,
      financial_state: r.financial_state ?? "legacy_unclassified",
      collections: collectionById.get(id) ?? 0,
      purchased_at: String(r.purchased_at),
      external_ref: r.external_ref,
      contact_id: r.contact_id,
      contact_name: r.contact_id ? (names.contact.get(r.contact_id) ?? null) : null,
      account_id: r.account_id,
      account_name: r.account_id ? (names.account.get(r.account_id) ?? null) : null,
      opportunity_id: r.opportunity_id,
      project_id: r.project_id,
      visit_id: r.visit_id,
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? "MYR"),
      purchase_source: r.purchase_source,
      location_id: r.location_id,
      location_name: r.location_id ? (locMap.get(r.location_id) ?? null) : null,
      salesperson_id: r.salesperson_id,
      salesperson_name: r.salesperson_id ? (members.get(r.salesperson_id)?.full_name ?? null) : null,
      is_repeat: !!r.is_repeat,
      status: String(r.status ?? "recorded"),
      notes: r.notes,
      payment_methods: Array.from(new Set(payments.map((p) => p.method))),
      payments,
      items: itemBy.get(id) ?? [],
    };
  });
}

export async function getPurchase(id: string): Promise<PurchaseRow | null> {
  return (await listPurchases(1, { id }))[0] ?? null;
}

export async function getOpenOpportunitiesForContact(contactId: string): Promise<OpenOpportunityRef[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("opportunities").select("id, name, stage_key, project_id").eq("contact_id", contactId).eq("status", "open").order("created_at", { ascending: false }).limit(20);
  return (data ?? []).map((o) => ({ id: String(o.id), name: String(o.name ?? ""), stage_key: String(o.stage_key ?? ""), project_id: o.project_id }));
}

export async function getWalkInCounts() {
  const supabase = await createServerSupabase();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [vt, vw, pw, rep] = await Promise.all([
    supabase.from("visits").select("id", { count: "exact", head: true }).gte("occurred_at", dayStart.toISOString()),
    supabase.from("visits").select("id", { count: "exact", head: true }).gte("occurred_at", weekAgo),
    supabase.from("purchases").select("id", { count: "exact", head: true }).gte("purchased_at", weekAgo).in("status", ["recorded", "corrected"]).eq("financial_state", "confirmed"),
    supabase.from("purchases").select("id", { count: "exact", head: true }).gte("purchased_at", weekAgo).eq("is_repeat", true).in("status", ["recorded", "corrected"]).eq("financial_state", "confirmed"),
  ]);
  return { visitsToday: vt.count ?? 0, visits7d: vw.count ?? 0, purchases7d: pw.count ?? 0, repeat7d: rep.count ?? 0 };
}
