import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getAuditFor, getOpportunitiesFor, getPurchasesFor, getQuotesForOpportunities, getTimeline, type AuditRow, type OpportunitySummary, type PurchaseSummary, type QuoteSummary } from "@/server/queries/contacts";
import type { TimelineItem } from "@/components/patterns/timeline";

export interface AccountListRow {
  id: string;
  name: string;
  account_type: string | null;
  registration_number: string | null;
  owner_id: string | null;
  lifecycle_state: string;
  original_acquisition_source: string | null;
  merged_into_account_id: string | null;
  created_at: string;
  contacts_count: number;
  projects_count: number;
  open_opportunities: number;
}

export async function listAccounts(opts: { includeMerged?: boolean } = {}): Promise<AccountListRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("accounts").select("id, name, account_type, registration_number, owner_id, lifecycle_state, original_acquisition_source, merged_into_account_id, created_at").is("archived_at", null).order("name").limit(1000);
  if (!opts.includeMerged) q = q.is("merged_into_account_id", null);
  const { data } = await q;
  const rows = data ?? [];
  const ids = rows.map((a) => a.id!);
  if (ids.length === 0) return [];
  const [{ data: rels }, { data: projects }, { data: opps }] = await Promise.all([
    supabase.from("account_contact_relationships").select("account_id").in("account_id", ids),
    supabase.from("projects").select("account_id").in("account_id", ids),
    supabase.from("opportunities").select("account_id").eq("status", "open").in("account_id", ids),
  ]);
  const count = (arr: { account_id: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const r of arr ?? []) if (r.account_id) m.set(r.account_id, (m.get(r.account_id) ?? 0) + 1);
    return m;
  };
  const cm = count(rels), pm = count(projects), om = count(opps);
  return rows.map((a) => ({
    id: a.id!,
    name: a.name ?? "",
    account_type: a.account_type,
    registration_number: a.registration_number,
    owner_id: a.owner_id,
    lifecycle_state: a.lifecycle_state ?? "new",
    original_acquisition_source: a.original_acquisition_source,
    merged_into_account_id: a.merged_into_account_id,
    created_at: a.created_at!,
    contacts_count: cm.get(a.id!) ?? 0,
    projects_count: pm.get(a.id!) ?? 0,
    open_opportunities: om.get(a.id!) ?? 0,
  }));
}

export interface AccountDetail {
  id: string;
  name: string;
  account_type: string | null;
  registration_number: string | null;
  website: string | null;
  domain: string | null;
  address: Record<string, string>;
  owner_id: string | null;
  lifecycle_state: string;
  original_acquisition_source: string | null;
  original_acquisition_at: string | null;
  notes: string | null;
  merged_into_account_id: string | null;
  merged_into_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  aliases: { id: string; alias: string; source: string | null }[];
  contacts: { rel_id: string; contact_id: string; display_name: string; role: string | null; is_primary: boolean; customer_type: string | null; primary_phone: string | null }[];
  projects: { id: string; name: string; status: string; project_type: string | null; area: string | null; expected_completion: string | null }[];
  opportunities: OpportunitySummary[];
  purchases: PurchaseSummary[];
  quotes: QuoteSummary[];
  external_identities: { id: string; provider: string; external_id: string; first_seen_at: string }[];
  timeline: TimelineItem[];
  audit: AuditRow[];
}

export async function getAccountDetail(id: string): Promise<AccountDetail | null> {
  const supabase = await createServerSupabase();
  const { data: a } = await supabase.from("accounts").select("*").eq("id", id).maybeSingle();
  if (!a) return null;
  const [{ data: aliases }, { data: rels }, { data: projects }, opportunities, purchases, { data: ext }, timeline, audit, merged] = await Promise.all([
    supabase.from("account_aliases").select("id, alias, source").eq("account_id", id),
    supabase.from("account_contact_relationships").select("id, contact_id, role, is_primary, contacts(display_name, customer_type)").eq("account_id", id),
    supabase.from("projects").select("id, name, status, project_type, area, expected_completion").eq("account_id", id).order("created_at", { ascending: false }),
    getOpportunitiesFor({ account_id: id }),
    getPurchasesFor({ account_id: id }),
    supabase.from("external_identities").select("id, provider, external_id, first_seen_at").eq("account_id", id),
    getTimeline("account", id),
    getAuditFor([id]),
    a.merged_into_account_id ? supabase.from("accounts").select("name").eq("id", a.merged_into_account_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const contactIds = (rels ?? []).map((r) => r.contact_id!).filter(Boolean);
  const { data: points } = contactIds.length ? await supabase.from("contact_points").select("contact_id, kind, normalized_value, is_primary").in("contact_id", contactIds).in("kind", ["phone", "whatsapp"]) : { data: [] };
  const phone = new Map<string, string>();
  for (const p of (points ?? []).sort((x, y) => Number(y.is_primary) - Number(x.is_primary))) if (p.contact_id && !phone.has(p.contact_id)) phone.set(p.contact_id, p.normalized_value ?? "");
  const quotes = await getQuotesForOpportunities(opportunities.map((o) => o.id), new Map(opportunities.map((o) => [o.id, o.name])));
  return {
    id: a.id!,
    name: a.name ?? "",
    account_type: a.account_type,
    registration_number: a.registration_number,
    website: a.website,
    domain: a.domain,
    address: (a.address ?? {}) as Record<string, string>,
    owner_id: a.owner_id,
    lifecycle_state: a.lifecycle_state ?? "new",
    original_acquisition_source: a.original_acquisition_source,
    original_acquisition_at: a.original_acquisition_at,
    notes: a.notes,
    merged_into_account_id: a.merged_into_account_id,
    merged_into_name: (merged.data as { name: string | null } | null)?.name ?? null,
    created_by: a.created_by,
    created_at: a.created_at!,
    updated_at: a.updated_at!,
    aliases: (aliases ?? []).map((x) => ({ id: x.id!, alias: x.alias!, source: x.source })),
    contacts: (rels ?? []).map((r) => {
      const c = r.contacts as unknown as { display_name: string; customer_type: string | null } | null;
      return { rel_id: r.id!, contact_id: r.contact_id!, display_name: c?.display_name ?? "", role: r.role, is_primary: !!r.is_primary, customer_type: c?.customer_type ?? null, primary_phone: phone.get(r.contact_id!) ?? null };
    }),
    projects: (projects ?? []).map((p) => ({ id: p.id!, name: p.name!, status: p.status!, project_type: p.project_type, area: p.area, expected_completion: p.expected_completion })),
    opportunities,
    purchases,
    quotes,
    external_identities: (ext ?? []).map((e) => ({ id: e.id!, provider: e.provider!, external_id: e.external_id!, first_seen_at: e.first_seen_at! })),
    timeline,
    audit,
  };
}
