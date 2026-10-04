import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getAuditFor, getOpportunitiesFor, getPurchasesFor, getTimeline, type AuditRow, type OpportunitySummary, type PurchaseSummary } from "@/server/queries/contacts";
import type { Database } from "@/lib/supabase/database.types";
import type { TimelineItem } from "@/components/patterns/timeline";

type DirectoryProject = Database["api"]["Views"]["projects"]["Row"] & { account_name: string | null; contact_name: string | null; follow_up_contact_name: string | null };
async function directory(id?: string): Promise<DirectoryProject[]> {
  const db = await createServerSupabase();
  const { data, error } = await db.rpc("project_directory", { p_id: id });
  if (error) throw error;
  return (data ?? []) as unknown as DirectoryProject[];
}

export interface ProjectListRow {
  version: number;
  created_by: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  last_follow_up_at: string | null;
  last_follow_up_by: string | null;
  id: string;
  name: string;
  project_type: string | null;
  status: string;
  area: string | null;
  account_id: string | null;
  account_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  owner_id: string | null;
  expected_completion: string | null;
  created_at: string;
  opportunities_count: number;
}

export async function listProjects(): Promise<ProjectListRow[]> {
  const supabase = await createServerSupabase();
  const rows = await directory();
  const ids = rows.map((p) => p.id!);
  const { data: opps } = ids.length ? await supabase.from("opportunities").select("project_id").is("archived_at", null).in("project_id", ids) : { data: [] };
  const om = new Map<string, number>();
  for (const o of opps ?? []) if (o.project_id) om.set(o.project_id, (om.get(o.project_id) ?? 0) + 1);
  return rows.map((p) => ({
    id: p.id!,
    version: p.version ?? 1,
    next_action: p.next_action, next_action_due_at: p.next_action_due_at,
    last_follow_up_at: p.last_follow_up_at, last_follow_up_by: p.last_follow_up_by,
    name: p.name ?? "",
    project_type: p.project_type,
    status: p.status ?? "planning",
    area: p.area,
    account_id: p.account_id,
    account_name: p.account_name,
    contact_id: p.primary_contact_id,
    contact_name: p.contact_name,
    owner_id: p.owner_id,
    expected_completion: p.expected_completion,
    created_at: p.created_at!,
    created_by: p.created_by,
    opportunities_count: om.get(p.id!) ?? 0,
  }));
}

export interface ProjectDetail {
  version: number;
  next_action: string | null;
  next_action_due_at: string | null;
  last_follow_up_at: string | null;
  last_follow_up_by: string | null;
  events: { id: string; kind: string; note: string | null; actor_id: string; previous_owner_id: string | null; owner_id: string | null; next_action: string | null; next_action_due_at: string | null; created_at: string }[];
  follow_up_contact_id: string | null;
  follow_up_contact_name: string | null;
  product_specification: string | null;
  id: string;
  name: string;
  project_type: string | null;
  status: string;
  area: string | null;
  account_id: string | null;
  account_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  owner_id: string | null;
  expected_start: string | null;
  expected_completion: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  sites: { id: string; label: string; address: Record<string, string>; access_notes: string | null }[];
  opportunities: OpportunitySummary[];
  purchases: PurchaseSummary[];
  tasks: { id: string; title: string; status: string; due_at: string | null; assignee_id: string | null; priority: string }[];
  timeline: TimelineItem[];
  audit: AuditRow[];
}

export async function getProjectDetail(id: string): Promise<ProjectDetail | null> {
  const supabase = await createServerSupabase();
  const [p] = await directory(id);
  if (!p) return null;
  const [{ data: sites }, opportunities, purchases, { data: tasks }, timeline, audit, { data: events }] = await Promise.all([
    supabase.from("project_sites").select("id, label, address, access_notes").eq("project_id", id).order("created_at").order("id"),
    getOpportunitiesFor({ project_id: id }),
    getPurchasesFor({ project_id: id }),
    supabase.from("tasks").select("id, title, status, due_at, assignee_id, priority").eq("project_id", id).order("due_at", { ascending: true, nullsFirst: false }).limit(50),
    getTimeline("project", id),
    getAuditFor([id]),
    supabase.from("project_events").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  return {
    version: p.version ?? 1, next_action: p.next_action, next_action_due_at: p.next_action_due_at,
    last_follow_up_at: p.last_follow_up_at, last_follow_up_by: p.last_follow_up_by,
    events: (events ?? []).map((e) => ({ id: e.id!, kind: e.kind!, note: e.note, actor_id: e.actor_id!, previous_owner_id: e.previous_owner_id, owner_id: e.owner_id, next_action: e.next_action, next_action_due_at: e.next_action_due_at, created_at: e.created_at! })),
    follow_up_contact_id: p.follow_up_contact_id,
    follow_up_contact_name: p.follow_up_contact_name,
    product_specification: p.product_specification,
    id: p.id!,
    name: p.name ?? "",
    project_type: p.project_type,
    status: p.status ?? "planning",
    area: p.area,
    account_id: p.account_id,
    account_name: p.account_name,
    contact_id: p.primary_contact_id,
    contact_name: p.contact_name,
    owner_id: p.owner_id,
    expected_start: p.expected_start,
    expected_completion: p.expected_completion,
    notes: p.notes,
    created_by: p.created_by,
    created_at: p.created_at!,
    sites: (sites ?? []).map((s) => ({ id: s.id!, label: s.label ?? "Site", address: (s.address ?? {}) as Record<string, string>, access_notes: s.access_notes })),
    opportunities,
    purchases,
    tasks: (tasks ?? []).map((t) => ({ id: t.id!, title: t.title!, status: t.status!, due_at: t.due_at, assignee_id: t.assignee_id, priority: t.priority ?? "normal" })),
    timeline,
    audit,
  };
}
