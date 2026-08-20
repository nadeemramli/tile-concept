import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getLocations, getMemberMap } from "@/server/queries/reference";
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

export async function listVisits(limit = 500): Promise<VisitRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("visits")
    .select("id, occurred_at, location_id, staff_user_id, contact_id, account_id, lead_id, opportunity_id, customer_type, origin_area, renovation_area, inquiry_source, purpose, quotation_ref, quotation_amount, is_new_customer, notes")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
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

export async function getVisit(id: string): Promise<VisitRow | null> {
  const all = await listVisits(500);
  const hit = all.find((v) => v.id === id);
  if (hit) return hit;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("visits").select("id").eq("id", id).maybeSingle();
  return data ? (await listVisits(5000)).find((v) => v.id === id) ?? null : null;
}

export async function listPurchases(limit = 500): Promise<PurchaseRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("purchases")
    .select("id, purchased_at, external_ref, contact_id, account_id, opportunity_id, project_id, visit_id, amount, currency, purchase_source, location_id, salesperson_id, is_repeat, status, notes")
    .order("purchased_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
  const ids = rows.map((r) => String(r.id));
  const [names, members, locations, pays, items] = await Promise.all([
    nameMaps(uniq(rows.map((r) => r.contact_id)), uniq(rows.map((r) => r.account_id))),
    getMemberMap(),
    getLocations(),
    ids.length ? supabase.from("purchase_payments").select("id, purchase_id, method, amount, reference").in("purchase_id", ids) : Promise.resolve({ data: [] as never[] }),
    ids.length ? supabase.from("purchase_items").select("id, purchase_id, description, quantity, unit, unit_price, line_total, position").in("purchase_id", ids).order("position") : Promise.resolve({ data: [] as never[] }),
  ]);
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  const payBy = new Map<string, PurchaseRow["payments"]>();
  for (const p of (pays.data ?? []) as { id: string | null; purchase_id: string | null; method: string | null; amount: number | null; reference: string | null }[]) {
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
  return (await listPurchases(500)).find((p) => p.id === id) ?? null;
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
    supabase.from("purchases").select("id", { count: "exact", head: true }).gte("purchased_at", weekAgo).neq("status", "voided"),
    supabase.from("purchases").select("id", { count: "exact", head: true }).gte("purchased_at", weekAgo).eq("is_repeat", true).neq("status", "voided"),
  ]);
  return { visitsToday: vt.count ?? 0, visits7d: vw.count ?? 0, purchases7d: pw.count ?? 0, repeat7d: rep.count ?? 0 };
}
