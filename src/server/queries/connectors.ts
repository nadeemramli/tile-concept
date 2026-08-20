import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap } from "@/server/queries/reference";

export interface ConnectorRow {
  id: string;
  provider: string;
  name: string;
  environment: string;
  direction: string;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  credential_ref: string | null;
  scopes: string[];
  business_purpose: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  checkpoint: string | null;
  checkpoint_at: string | null;
  runs_7d: number;
  failed_7d: number;
}

export interface FieldMappingRow {
  id: string;
  provider: string;
  form_ref: string | null;
  source_field: string;
  target_field: string;
  version: number;
  created_at: string;
}

export interface RoutingRuleRow {
  id: string;
  position: number;
  match_source_channel: string | null;
  match_product_interest: string | null;
  match_location_id: string | null;
  assign_to: string | null;
  assign_to_name: string | null;
  is_active: boolean;
}

export interface ReconciliationRow {
  provider: string;
  source_channel: string;
  day: string;
  received: number;
  processed: number;
  deduplicated: number;
  failed: number;
  unlinked: number;
}

export interface IntakeEventRow {
  id: string;
  received_at: string;
  occurred_at: string | null;
  provider: string | null;
  source_channel: string;
  external_id: string | null;
  idempotency_key: string;
  status: string;
  lead_id: string | null;
  payload: Record<string, unknown>;
  raw_text: string | null;
}

export async function listConnectors(): Promise<ConnectorRow[]> {
  const supabase = await createServerSupabase();
  const [{ data }, members] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("id, provider, name, environment, direction, status, owner_id, credential_ref, scopes, business_purpose, last_attempt_at, last_success_at, last_error")
      .order("provider"),
    getMemberMap(),
  ]);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id!).filter(Boolean);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: checkpoints }, { data: runs }] = await Promise.all([
    supabase.from("connector_checkpoints").select("connection_id, cursor, updated_at").in("connection_id", ids),
    supabase.from("sync_runs").select("connection_id, status, started_at").in("connection_id", ids).gte("started_at", since),
  ]);

  return rows.map((r) => {
    const cp = (checkpoints ?? []).find((c) => c.connection_id === r.id);
    const myRuns = (runs ?? []).filter((x) => x.connection_id === r.id);
    return {
      id: r.id!,
      provider: r.provider ?? "",
      name: r.name ?? "",
      environment: r.environment ?? "demo",
      direction: r.direction ?? "pull",
      status: r.status ?? "not_configured",
      owner_id: r.owner_id,
      owner_name: r.owner_id ? (members.get(r.owner_id)?.full_name ?? null) : null,
      credential_ref: r.credential_ref,
      scopes: r.scopes ?? [],
      business_purpose: r.business_purpose,
      last_attempt_at: r.last_attempt_at,
      last_success_at: r.last_success_at,
      last_error: r.last_error,
      checkpoint: cp?.cursor ?? null,
      checkpoint_at: cp?.updated_at ?? null,
      runs_7d: myRuns.length,
      failed_7d: myRuns.filter((x) => x.status === "failed").length,
    };
  });
}

export async function listFieldMappings(): Promise<FieldMappingRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("field_mappings").select("id, provider, form_ref, source_field, target_field, version, created_at").order("provider").order("source_field");
  return (data ?? []).map((m) => ({
    id: m.id!,
    provider: m.provider ?? "",
    form_ref: m.form_ref,
    source_field: m.source_field ?? "",
    target_field: m.target_field ?? "ignore",
    version: m.version ?? 1,
    created_at: m.created_at ?? "",
  }));
}

export async function listRoutingRules(): Promise<RoutingRuleRow[]> {
  const supabase = await createServerSupabase();
  const [{ data }, members] = await Promise.all([
    supabase.from("routing_rules").select("id, position, match_source_channel, match_product_interest, match_location_id, assign_to, is_active").order("position"),
    getMemberMap(),
  ]);
  return (data ?? []).map((r) => ({
    id: r.id!,
    position: r.position ?? 100,
    match_source_channel: r.match_source_channel,
    match_product_interest: r.match_product_interest,
    match_location_id: r.match_location_id,
    assign_to: r.assign_to,
    assign_to_name: r.assign_to ? (members.get(r.assign_to)?.full_name ?? null) : null,
    is_active: r.is_active ?? true,
  }));
}

export async function listReconciliation(): Promise<ReconciliationRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("intake_reconciliation").select("provider, source_channel, day, received, processed, deduplicated, failed, unlinked").order("day", { ascending: false }).limit(120);
  return (data ?? []).map((r) => ({
    provider: r.provider ?? "unknown",
    source_channel: r.source_channel ?? "",
    day: r.day ?? "",
    received: r.received ?? 0,
    processed: r.processed ?? 0,
    deduplicated: r.deduplicated ?? 0,
    failed: r.failed ?? 0,
    unlinked: r.unlinked ?? 0,
  }));
}

export async function listIntakeEvents(filters: { provider?: string; status?: string } = {}): Promise<IntakeEventRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from("intake_events")
    .select("id, received_at, occurred_at, provider, source_channel, external_id, idempotency_key, status, lead_id, payload, raw_text")
    .order("received_at", { ascending: false })
    .limit(200);
  if (filters.provider) q = q.eq("provider", filters.provider);
  if (filters.status) q = q.eq("status", filters.status);
  const { data } = await q;
  return (data ?? []).map((e) => ({
    id: e.id!,
    received_at: e.received_at ?? "",
    occurred_at: e.occurred_at,
    provider: e.provider,
    source_channel: e.source_channel ?? "",
    external_id: e.external_id,
    idempotency_key: e.idempotency_key ?? "",
    status: e.status ?? "received",
    lead_id: e.lead_id,
    payload: (e.payload as Record<string, unknown>) ?? {},
    raw_text: e.raw_text,
  }));
}
