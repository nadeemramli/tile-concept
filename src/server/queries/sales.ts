import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getSaleWorkspace(input: { id?: string; lead?: string; visit?: string; page?: number }) {
  const db = await createServerSupabase();
  const { data: sale, error } = input.id ? await db.from("purchases").select("*").eq("id", input.id).maybeSingle() : { data: null, error: null };
  if (error) throw error;
  const leadId = sale?.lead_id ?? input.lead;
  const visitId = sale?.visit_id ?? input.visit;
  const [{ data: lead, error: le }, { data: visit, error: ve }] = await Promise.all([
    leadId ? db.from("leads").select("id, raw_name, contact_id").eq("id", leadId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    visitId ? db.from("visits").select("id,contact_id,lead_id,occurred_at").eq("id", visitId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (le || ve) throw le ?? ve;
  const contactId = sale?.contact_id ?? lead?.contact_id ?? visit?.contact_id;
  const page = Math.max(1, Math.min(input.page ?? 1, 100000));
  let list = db.from("purchases").select("id,external_ref,financial_state,purchased_at,status", { count: "exact" }).order("purchased_at", { ascending: false }).order("id").range((page - 1) * 25, page * 25 - 1);
  if (contactId) list = list.eq("contact_id", contactId);
  else if (leadId) list = list.eq("lead_id", leadId);
  else if (visitId) list = list.eq("visit_id", visitId);
  const [history, events, payments, receipts, balance, customer, inquiries] = await Promise.all([
    list,
    sale?.id ? db.from("sale_events").select("*").eq("purchase_id", sale.id).order("created_at") : Promise.resolve({ data: [], error: null }),
    sale?.id ? db.from("purchase_payments").select("*").eq("purchase_id", sale.id).order("created_at") : Promise.resolve({ data: [], error: null }),
    sale?.id ? db.from("sale_receipts").select("*").eq("purchase_id", sale.id).order("created_at") : Promise.resolve({ data: [], error: null }),
    sale?.id ? db.from("sale_balances").select("*").eq("id", sale.id).single() : Promise.resolve({ data: null, error: null }),
    contactId ? db.from("contacts").select("display_name").eq("id", contactId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    contactId ? db.from("leads").select("id,raw_name,source_channel,created_at").eq("contact_id", contactId).neq("status", "duplicate").order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [history, events, payments, receipts, balance, customer, inquiries]) if (r.error) throw r.error;
  const paths = (receipts.data ?? []).map(r => r.object_path).filter((p): p is string => !!p);
  const signed = paths.length ? await db.storage.from("sales-receipts").createSignedUrls(paths, 300) : { data: [] };
  const urls = new Map((signed.data ?? []).map(r => [r.path, r.signedUrl]));
  return { sale, lead, visit, contactId, customerName: customer.data?.display_name ?? lead?.raw_name ?? "Customer", history: history.data ?? [], total: history.count ?? 0, page,
    events: events.data ?? [], payments: payments.data ?? [], receipts: (receipts.data ?? []).map(r => ({ ...r, url: urls.get(r.object_path ?? "") ?? null })), balance: balance.data, inquiries: inquiries.data ?? [] };
}
export type SaleWorkspace = Awaited<ReturnType<typeof getSaleWorkspace>>;
