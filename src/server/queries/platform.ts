import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getLocations, getMemberMap, getStages } from "@/server/queries/reference";

export interface AuditFilters {
  action?: string;
  table?: string;
  actor?: string;
  from?: string;
  to?: string;
  objectId?: string;
}

export interface AuditRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  object_schema: string | null;
  object_table: string | null;
  object_id: string | null;
  reason: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  href: string | null;
}

export function auditHref(table: string | null, id: string | null): string | null {
  if (!table || !id) return null;
  switch (table) {
    case "contacts":
      return `/sales/contacts/${id}`;
    case "accounts":
      return `/sales/accounts/${id}`;
    case "opportunities":
      return `/sales/pipeline?opportunity=${id}`;
    case "products":
      return `/merchandise/catalog/${id}`;
    case "leads":
      return `/sales/inbox?lead=${id}`;
    case "projects":
      return `/sales/projects/${id}`;
    case "purchases":
      return `/sales/walk-ins?purchase=${id}`;
    case "visits":
      return `/sales/walk-ins?visit=${id}`;
    case "tasks":
      return `/sales/tasks?task=${id}`;
    default:
      return null;
  }
}

export async function listAuditEvents(filters: AuditFilters): Promise<AuditRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase.from("audit_events").select("id, occurred_at, actor_id, action, object_schema, object_table, object_id, reason, before_data, after_data, metadata").order("occurred_at", { ascending: false }).limit(500);
  if (filters.action) q = q.ilike("action", `%${filters.action}%`);
  if (filters.table) q = q.eq("object_table", filters.table);
  if (filters.actor) q = q.eq("actor_id", filters.actor);
  if (filters.objectId) q = q.eq("object_id", filters.objectId);
  if (filters.from) q = q.gte("occurred_at", new Date(filters.from).toISOString());
  if (filters.to) {
    const end = new Date(filters.to);
    end.setDate(end.getDate() + 1);
    q = q.lt("occurred_at", end.toISOString());
  }
  const [{ data }, members] = await Promise.all([q, getMemberMap()]);
  return (data ?? []).map((a) => ({
    id: a.id!,
    occurred_at: a.occurred_at!,
    actor_id: a.actor_id,
    actor_name: a.actor_id ? (members.get(a.actor_id)?.full_name ?? null) : null,
    action: a.action ?? "",
    object_schema: a.object_schema,
    object_table: a.object_table,
    object_id: a.object_id,
    reason: a.reason,
    before_data: (a.before_data as Record<string, unknown> | null) ?? null,
    after_data: (a.after_data as Record<string, unknown> | null) ?? null,
    metadata: (a.metadata as Record<string, unknown> | null) ?? null,
    href: auditHref(a.object_table, a.object_id),
  }));
}

export async function getAuditTables(): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("audit_events").select("object_table").order("object_table").limit(2000);
  return [...new Set((data ?? []).map((r) => r.object_table).filter((t): t is string => !!t))].sort();
}

export interface IssueRow {
  id: string;
  issue_type: string;
  severity: string;
  summary: string;
  object_type: string | null;
  object_id: string | null;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
  href: string | null;
}

export async function listDataQualityIssues(): Promise<IssueRow[]> {
  const supabase = await createServerSupabase();
  const [{ data }, members] = await Promise.all([supabase.from("data_quality_issues").select("*").order("created_at", { ascending: false }).limit(500), getMemberMap()]);
  return (data ?? []).map((i) => ({
    id: i.id!,
    issue_type: i.issue_type ?? "",
    severity: i.severity ?? "medium",
    summary: i.summary ?? "",
    object_type: i.object_type,
    object_id: i.object_id,
    status: i.status ?? "open",
    assigned_to: i.assigned_to,
    assigned_name: i.assigned_to ? (members.get(i.assigned_to)?.full_name ?? null) : null,
    details: (i.details as Record<string, unknown>) ?? {},
    created_at: i.created_at!,
    resolved_at: i.resolved_at,
    href: auditHref(i.object_type === "contact" ? "contacts" : i.object_type === "product" ? "products" : i.object_type === "variant_price" ? null : null, i.object_id),
  }));
}

export async function getDataHealthSummary() {
  const supabase = await createServerSupabase();
  const [{ count: openIssues }, { count: highIssues }, { count: dups }, { count: unreviewed }, { count: conflicted }, { count: connectorsFailed }, { count: pendingReviews }] = await Promise.all([
    supabase.from("data_quality_issues").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("data_quality_issues").select("id", { count: "exact", head: true }).eq("status", "open").eq("severity", "high"),
    supabase.from("identity_match_candidates").select("id", { count: "exact", head: true }).eq("status", "suggested"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("review_state", "unreviewed").neq("status", "archived"),
    supabase.from("variant_prices").select("id", { count: "exact", head: true }).eq("state", "conflicted"),
    supabase.from("integration_connections").select("id", { count: "exact", head: true }).in("status", ["failed", "degraded"]),
    supabase.from("review_items").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return { openIssues: openIssues ?? 0, highIssues: highIssues ?? 0, duplicates: dups ?? 0, unreviewed: unreviewed ?? 0, conflicted: conflicted ?? 0, connectorsFailed: connectorsFailed ?? 0, pendingReviews: pendingReviews ?? 0 };
}

export interface IntegrationRow {
  id: string;
  provider: string;
  name: string;
  environment: string;
  direction: string;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  business_purpose: string | null;
  scopes: string[];
  credential_ref: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  config: Record<string, unknown>;
}

export async function listIntegrations(): Promise<IntegrationRow[]> {
  const supabase = await createServerSupabase();
  const [{ data }, members] = await Promise.all([supabase.from("integration_connections").select("*").order("provider"), getMemberMap()]);
  return (data ?? []).map((c) => ({
    id: c.id!,
    provider: c.provider ?? "",
    name: c.name ?? "",
    environment: c.environment ?? "demo",
    direction: c.direction ?? "pull",
    status: c.status ?? "not_configured",
    owner_id: c.owner_id,
    owner_name: c.owner_id ? (members.get(c.owner_id)?.full_name ?? null) : null,
    business_purpose: c.business_purpose,
    scopes: (c.scopes as string[] | null) ?? [],
    credential_ref: c.credential_ref,
    last_attempt_at: c.last_attempt_at,
    last_success_at: c.last_success_at,
    last_error: c.last_error,
    config: (c.config as Record<string, unknown>) ?? {},
  }));
}

// ---------------------------------------------------------------- settings

export async function listUsers() {
  const supabase = await createServerSupabase();
  const [{ data: memberships }, { data: profiles }, locations] = await Promise.all([supabase.from("memberships").select("*").order("created_at"), supabase.from("profiles").select("user_id, full_name, email"), getLocations()]);
  const pMap = new Map((profiles ?? []).map((p) => [p.user_id!, p]));
  return (memberships ?? []).map((m) => ({
    id: m.id!,
    user_id: m.user_id!,
    full_name: pMap.get(m.user_id!)?.full_name ?? "—",
    email: pMap.get(m.user_id!)?.email ?? "—",
    role_key: m.role_key ?? "",
    status: m.status ?? "active",
    default_location_id: m.default_location_id,
    default_location: m.default_location_id ? (locations.find((l) => l.id === m.default_location_id)?.name ?? null) : null,
    created_at: m.created_at!,
  }));
}

export async function listInvites() {
  const supabase = await createServerSupabase();
  const [{ data }, members] = await Promise.all([supabase.from("membership_invites").select("*").order("created_at", { ascending: false }), getMemberMap()]);
  return (data ?? []).map((i) => ({
    id: i.id!,
    email: i.email ?? "",
    role_key: i.role_key ?? "",
    status: i.status ?? "pending",
    created_at: i.created_at!,
    accepted_at: i.accepted_at,
    invited_by_name: i.invited_by ? (members.get(i.invited_by)?.full_name ?? null) : null,
    default_location_id: i.default_location_id,
  }));
}

export async function getRolesMatrix() {
  const supabase = await createServerSupabase();
  const [{ data: roles }, { data: perms }] = await Promise.all([supabase.from("roles").select("key, label, description, rank").order("rank"), supabase.from("role_permissions").select("role_key, permission")]);
  const permissions = [...new Set((perms ?? []).map((p) => p.permission!))].sort();
  return {
    roles: (roles ?? []).map((r) => ({ key: r.key!, label: r.label!, description: r.description })),
    permissions,
    has: new Set((perms ?? []).map((p) => `${p.role_key}:${p.permission}`)),
  };
}

export async function getWorkspace() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("workspaces").select("*").limit(1).maybeSingle();
  return data ? { id: data.id!, name: data.name ?? "", slug: data.slug ?? "", timezone: data.timezone ?? "Asia/Kuala_Lumpur", default_currency: data.default_currency ?? "MYR" } : null;
}

export async function listAllLocations() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("business_locations").select("*").order("name");
  return (data ?? []).map((l) => ({ id: l.id!, code: l.code ?? "", name: l.name ?? "", kind: l.kind ?? "showroom", is_active: !!l.is_active, address: (l.address as Record<string, string>) ?? {} }));
}

export async function listStagesAdmin() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("opportunity_stages").select("*").order("position");
  return (data ?? []).map((s) => ({ id: s.id!, key: s.key ?? "", label: s.label ?? "", position: s.position ?? 0, reporting_group: s.reporting_group ?? "open", requires_reason: !!s.requires_reason, requires_next_action: !!s.requires_next_action, is_active: !!s.is_active }));
}

export async function listSharedViews() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("saved_views").select("*").is("user_id", null).order("surface").order("position");
  return (data ?? []).map((v) => ({ id: v.id!, surface: v.surface ?? "", name: v.name ?? "", filters: (v.filters as Record<string, unknown>) ?? {}, position: v.position ?? 0, is_default: !!v.is_default }));
}

export async function listFeatureFlags() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("feature_flags").select("*").order("key");
  return (data ?? []).map((f) => ({ key: f.key ?? "", enabled: !!f.enabled, updated_at: f.updated_at }));
}

export { getStages };
