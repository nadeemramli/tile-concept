import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { TimelineItem } from "@/components/patterns/timeline";

export interface ContactPointRow {
  id: string;
  kind: string;
  normalized_value: string;
  is_primary: boolean;
  label: string | null;
  source: string | null;
}

export interface ContactListRow {
  id: string;
  display_name: string;
  customer_type: string | null;
  lifecycle_state: string;
  original_acquisition_source: string | null;
  is_provisional: boolean;
  merged_into_contact_id: string | null;
  created_at: string;
  primary_phone: string | null;
  primary_email: string | null;
  account_id: string | null;
  account_name: string | null;
  open_opportunities: number;
  last_activity_at: string | null;
}

export async function listContacts(opts: { includeMerged?: boolean } = {}): Promise<ContactListRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from("contacts")
    .select("id, display_name, customer_type, lifecycle_state, original_acquisition_source, is_provisional, merged_into_contact_id, created_at")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!opts.includeMerged) q = q.is("merged_into_contact_id", null);
  const { data: contacts } = await q;
  const rows = contacts ?? [];
  const ids = rows.map((c) => c.id!).filter(Boolean);
  if (ids.length === 0) return [];

  const [{ data: points }, { data: rels }, { data: opps }, { data: acts }] = await Promise.all([
    supabase.from("contact_points").select("contact_id, kind, normalized_value, is_primary, created_at").in("contact_id", ids),
    supabase.from("account_contact_relationships").select("contact_id, account_id, is_primary, accounts(name)").in("contact_id", ids),
    supabase.from("opportunities").select("contact_id").eq("status", "open").in("contact_id", ids),
    supabase.from("activities").select("contact_id, occurred_at").in("contact_id", ids).order("occurred_at", { ascending: false }).limit(5000),
  ]);

  const phone = new Map<string, string>();
  const email = new Map<string, string>();
  for (const p of (points ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
    if (!p.contact_id) continue;
    if ((p.kind === "phone" || p.kind === "whatsapp") && !phone.has(p.contact_id)) phone.set(p.contact_id, p.normalized_value ?? "");
    if (p.kind === "email" && !email.has(p.contact_id)) email.set(p.contact_id, p.normalized_value ?? "");
  }
  const acct = new Map<string, { id: string; name: string }>();
  for (const r of (rels ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
    if (!r.contact_id || acct.has(r.contact_id)) continue;
    const name = (r.accounts as unknown as { name: string } | null)?.name ?? "";
    acct.set(r.contact_id, { id: r.account_id!, name });
  }
  const openOpps = new Map<string, number>();
  for (const o of opps ?? []) if (o.contact_id) openOpps.set(o.contact_id, (openOpps.get(o.contact_id) ?? 0) + 1);
  const lastAct = new Map<string, string>();
  for (const a of acts ?? []) if (a.contact_id && !lastAct.has(a.contact_id)) lastAct.set(a.contact_id, a.occurred_at!);

  return rows.map((c) => ({
    id: c.id!,
    display_name: c.display_name ?? "",
    customer_type: c.customer_type,
    lifecycle_state: c.lifecycle_state ?? "new",
    original_acquisition_source: c.original_acquisition_source,
    is_provisional: !!c.is_provisional,
    merged_into_contact_id: c.merged_into_contact_id,
    created_at: c.created_at!,
    primary_phone: phone.get(c.id!) ?? null,
    primary_email: email.get(c.id!) ?? null,
    account_id: acct.get(c.id!)?.id ?? null,
    account_name: acct.get(c.id!)?.name ?? null,
    open_opportunities: openOpps.get(c.id!) ?? 0,
    last_activity_at: lastAct.get(c.id!) ?? null,
  }));
}

export interface ContactDetail {
  id: string;
  display_name: string;
  given_name: string | null;
  family_name: string | null;
  customer_type: string | null;
  preferred_language: string | null;
  lifecycle_state: string;
  original_acquisition_source: string | null;
  original_acquisition_at: string | null;
  notes: string | null;
  is_provisional: boolean;
  merged_into_contact_id: string | null;
  merged_into_name: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  points: ContactPointRow[];
  relationships: { id: string; account_id: string; account_name: string; role: string | null; is_primary: boolean }[];
  projects: { id: string; name: string; status: string; project_type: string | null; area: string | null; expected_completion: string | null }[];
  opportunities: OpportunitySummary[];
  purchases: PurchaseSummary[];
  visits: { id: string; occurred_at: string; purpose: string | null; location_name: string | null; is_new_customer: boolean | null; notes: string | null }[];
  quotes: QuoteSummary[];
  consents: { id: string; channel: string; purpose: string; status: string; recorded_at: string; evidence: string | null }[];
  external_identities: { id: string; provider: string; external_id: string; first_seen_at: string }[];
  timeline: TimelineItem[];
  audit: AuditRow[];
}

export interface OpportunitySummary {
  id: string;
  name: string;
  stage_key: string;
  status: string;
  estimated_value: number | null;
  currency: string;
  next_action: string | null;
  next_action_due_at: string | null;
  owner_id: string | null;
  expected_close_date: string | null;
}

export interface PurchaseSummary {
  id: string;
  purchased_at: string;
  external_ref: string | null;
  amount: number;
  currency: string;
  is_repeat: boolean;
  status: string;
  purchase_source: string | null;
  payments: string[];
}

export interface QuoteSummary {
  id: string;
  quote_number: string | null;
  status: string;
  opportunity_id: string;
  opportunity_name: string;
  current_version_no: number;
  versions: { id: string; version_no: number; issued_at: string | null; valid_until: string | null; total_amount: number | null; currency: string; external_ref: string | null }[];
  external_docs: { document_type: string; document_number: string; system: string }[];
}

export interface AuditRow {
  id: string;
  occurred_at: string;
  action: string;
  actor_id: string | null;
  reason: string | null;
  object_table: string | null;
}

export async function getTimeline(entityType: string, id: string, limit = 100): Promise<TimelineItem[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc("entity_timeline", { p_entity_type: entityType, p_entity_id: id, p_limit: limit });
  return (data ?? []).map((a) => ({ ...a, metadata: a.metadata as Record<string, unknown> | null })) as TimelineItem[];
}

export async function getAuditFor(objectIds: string[], limit = 20): Promise<AuditRow[]> {
  if (objectIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("audit_events").select("id, occurred_at, action, actor_id, reason, object_table").in("object_id", objectIds).order("occurred_at", { ascending: false }).limit(limit);
  return (data ?? []).map((a) => ({ id: a.id!, occurred_at: a.occurred_at!, action: a.action!, actor_id: a.actor_id, reason: a.reason, object_table: a.object_table }));
}

export async function getPurchasesFor(filter: { contact_id?: string; account_id?: string; opportunity_id?: string; project_id?: string }): Promise<PurchaseSummary[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("purchases").select("id, purchased_at, external_ref, amount, currency, is_repeat, status, purchase_source").order("purchased_at", { ascending: false }).limit(200);
  if (filter.contact_id) q = q.eq("contact_id", filter.contact_id);
  if (filter.account_id) q = q.eq("account_id", filter.account_id);
  if (filter.opportunity_id) q = q.eq("opportunity_id", filter.opportunity_id);
  if (filter.project_id) q = q.eq("project_id", filter.project_id);
  const { data } = await q;
  const rows = data ?? [];
  const ids = rows.map((p) => p.id!);
  const { data: pays } = ids.length ? await supabase.from("purchase_payments").select("purchase_id, method").in("purchase_id", ids) : { data: [] };
  const payMap = new Map<string, string[]>();
  for (const p of pays ?? []) if (p.purchase_id) payMap.set(p.purchase_id, [...(payMap.get(p.purchase_id) ?? []), p.method ?? "other"]);
  return rows.map((p) => ({
    id: p.id!,
    purchased_at: p.purchased_at!,
    external_ref: p.external_ref,
    amount: Number(p.amount ?? 0),
    currency: p.currency ?? "MYR",
    is_repeat: !!p.is_repeat,
    status: p.status ?? "recorded",
    purchase_source: p.purchase_source,
    payments: payMap.get(p.id!) ?? [],
  }));
}

export async function getOpportunitiesFor(filter: { contact_id?: string; account_id?: string; project_id?: string }): Promise<OpportunitySummary[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("opportunities").select("id, name, stage_key, status, estimated_value, currency, next_action, next_action_due_at, owner_id, expected_close_date").order("created_at", { ascending: false }).limit(200);
  if (filter.contact_id) q = q.eq("contact_id", filter.contact_id);
  if (filter.account_id) q = q.eq("account_id", filter.account_id);
  if (filter.project_id) q = q.eq("project_id", filter.project_id);
  const { data } = await q;
  return (data ?? []).map((o) => ({
    id: o.id!,
    name: o.name ?? "",
    stage_key: o.stage_key ?? "",
    status: o.status ?? "open",
    estimated_value: o.estimated_value === null || o.estimated_value === undefined ? null : Number(o.estimated_value),
    currency: o.currency ?? "MYR",
    next_action: o.next_action,
    next_action_due_at: o.next_action_due_at,
    owner_id: o.owner_id,
    expected_close_date: o.expected_close_date,
  }));
}

export async function getQuotesForOpportunities(oppIds: string[], oppNames: Map<string, string>): Promise<QuoteSummary[]> {
  if (oppIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data: quotes } = await supabase.from("quotes").select("id, quote_number, status, opportunity_id, current_version_no").in("opportunity_id", oppIds).order("created_at", { ascending: false });
  const qs = quotes ?? [];
  const qids = qs.map((q) => q.id!);
  const [{ data: versions }, { data: docs }] = await Promise.all([
    qids.length ? supabase.from("quote_versions").select("id, quote_id, version_no, issued_at, valid_until, total_amount, currency, external_ref").in("quote_id", qids).order("version_no", { ascending: false }) : Promise.resolve({ data: [] }),
    qids.length ? supabase.from("external_document_links").select("object_id, document_type, document_number, system").eq("object_type", "quote").in("object_id", qids) : Promise.resolve({ data: [] }),
  ]);
  return qs.map((q) => ({
    id: q.id!,
    quote_number: q.quote_number,
    status: q.status ?? "draft",
    opportunity_id: q.opportunity_id!,
    opportunity_name: oppNames.get(q.opportunity_id!) ?? "",
    current_version_no: q.current_version_no ?? 0,
    versions: (versions ?? [])
      .filter((v) => v.quote_id === q.id)
      .map((v) => ({ id: v.id!, version_no: v.version_no ?? 0, issued_at: v.issued_at, valid_until: v.valid_until, total_amount: v.total_amount === null || v.total_amount === undefined ? null : Number(v.total_amount), currency: v.currency ?? "MYR", external_ref: v.external_ref })),
    external_docs: (docs ?? []).filter((d) => d.object_id === q.id).map((d) => ({ document_type: d.document_type ?? "", document_number: d.document_number ?? "", system: d.system ?? "" })),
  }));
}

export async function getContactDetail(id: string): Promise<ContactDetail | null> {
  const supabase = await createServerSupabase();
  const { data: c } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  if (!c) return null;

  const [{ data: points }, { data: rels }, { data: projects }, opportunities, purchases, { data: visits }, { data: consents }, { data: ext }, timeline, audit, merged] = await Promise.all([
    supabase.from("contact_points").select("id, kind, normalized_value, is_primary, label, source").eq("contact_id", id).order("is_primary", { ascending: false }),
    supabase.from("account_contact_relationships").select("id, account_id, role, is_primary, accounts(name)").eq("contact_id", id),
    supabase.from("projects").select("id, name, status, project_type, area, expected_completion").eq("primary_contact_id", id).order("created_at", { ascending: false }),
    getOpportunitiesFor({ contact_id: id }),
    getPurchasesFor({ contact_id: id }),
    supabase.from("visits").select("id, occurred_at, purpose, is_new_customer, notes, business_locations(name)").eq("contact_id", id).order("occurred_at", { ascending: false }).limit(50),
    supabase.from("consent_records").select("id, channel, purpose, status, recorded_at, evidence").eq("contact_id", id).order("recorded_at", { ascending: false }),
    supabase.from("external_identities").select("id, provider, external_id, first_seen_at").eq("contact_id", id),
    getTimeline("contact", id),
    getAuditFor([id]),
    c.merged_into_contact_id ? supabase.from("contacts").select("display_name").eq("id", c.merged_into_contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const quotes = await getQuotesForOpportunities(opportunities.map((o) => o.id), new Map(opportunities.map((o) => [o.id, o.name])));

  return {
    id: c.id!,
    display_name: c.display_name ?? "",
    given_name: c.given_name,
    family_name: c.family_name,
    customer_type: c.customer_type,
    preferred_language: c.preferred_language,
    lifecycle_state: c.lifecycle_state ?? "new",
    original_acquisition_source: c.original_acquisition_source,
    original_acquisition_at: c.original_acquisition_at,
    notes: c.notes,
    is_provisional: !!c.is_provisional,
    merged_into_contact_id: c.merged_into_contact_id,
    merged_into_name: (merged.data as { display_name: string | null } | null)?.display_name ?? null,
    archived_at: c.archived_at,
    created_by: c.created_by,
    created_at: c.created_at!,
    updated_at: c.updated_at!,
    points: (points ?? []).map((p) => ({ id: p.id!, kind: p.kind!, normalized_value: p.normalized_value!, is_primary: !!p.is_primary, label: p.label, source: p.source })),
    relationships: (rels ?? []).map((r) => ({ id: r.id!, account_id: r.account_id!, account_name: (r.accounts as unknown as { name: string } | null)?.name ?? "", role: r.role, is_primary: !!r.is_primary })),
    projects: (projects ?? []).map((p) => ({ id: p.id!, name: p.name!, status: p.status!, project_type: p.project_type, area: p.area, expected_completion: p.expected_completion })),
    opportunities,
    purchases,
    visits: (visits ?? []).map((v) => ({ id: v.id!, occurred_at: v.occurred_at!, purpose: v.purpose, location_name: (v.business_locations as unknown as { name: string } | null)?.name ?? null, is_new_customer: v.is_new_customer, notes: v.notes })),
    quotes,
    consents: (consents ?? []).map((x) => ({ id: x.id!, channel: x.channel!, purpose: x.purpose!, status: x.status!, recorded_at: x.recorded_at!, evidence: x.evidence })),
    external_identities: (ext ?? []).map((e) => ({ id: e.id!, provider: e.provider!, external_id: e.external_id!, first_seen_at: e.first_seen_at! })),
    timeline,
    audit,
  };
}

export async function searchAccounts(q: string, limit = 10) {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("accounts").select("id, name, account_type").is("merged_into_account_id", null).ilike("name", `%${q}%`).order("name").limit(limit);
  return (data ?? []).map((a) => ({ id: a.id!, name: a.name!, account_type: a.account_type }));
}

export async function searchContacts(q: string, limit = 10) {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("contacts").select("id, display_name, customer_type").is("merged_into_contact_id", null).ilike("display_name", `%${q}%`).order("display_name").limit(limit);
  return (data ?? []).map((c) => ({ id: c.id!, name: c.display_name!, customer_type: c.customer_type }));
}
