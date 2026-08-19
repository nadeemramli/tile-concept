import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getAuditFor, getOpportunitiesFor, getPurchasesFor, getTimeline, type AuditRow, type OpportunitySummary, type PurchaseSummary } from "@/server/queries/contacts";
import type { TimelineItem } from "@/components/patterns/timeline";

export interface ProjectListRow {
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
  const { data } = await supabase.from("projects").select("id, name, project_type, status, area, account_id, primary_contact_id, owner_id, expected_completion, created_at, accounts(name), contacts(display_name)").order("created_at", { ascending: false }).limit(1000);
  const rows = data ?? [];
  const ids = rows.map((p) => p.id!);
  const { data: opps } = ids.length ? await supabase.from("opportunities").select("project_id").in("project_id", ids) : { data: [] };
  const om = new Map<string, number>();
  for (const o of opps ?? []) if (o.project_id) om.set(o.project_id, (om.get(o.project_id) ?? 0) + 1);
  return rows.map((p) => ({
    id: p.id!,
    name: p.name ?? "",
    project_type: p.project_type,
    status: p.status ?? "planning",
    area: p.area,
    account_id: p.account_id,
    account_name: (p.accounts as unknown as { name: string } | null)?.name ?? null,
    contact_id: p.primary_contact_id,
    contact_name: (p.contacts as unknown as { display_name: string } | null)?.display_name ?? null,
    owner_id: p.owner_id,
    expected_completion: p.expected_completion,
    created_at: p.created_at!,
    opportunities_count: om.get(p.id!) ?? 0,
  }));
}

export interface ProjectDetail {
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
  const { data: p } = await supabase.from("projects").select("*, accounts(name), contacts(display_name)").eq("id", id).maybeSingle();
  if (!p) return null;
  const [{ data: sites }, opportunities, purchases, { data: tasks }, timeline, audit] = await Promise.all([
    supabase.from("project_sites").select("id, label, address, access_notes").eq("project_id", id).order("created_at"),
    getOpportunitiesFor({ project_id: id }),
    getPurchasesFor({ project_id: id }),
    supabase.from("tasks").select("id, title, status, due_at, assignee_id, priority").eq("project_id", id).order("due_at", { ascending: true, nullsFirst: false }).limit(50),
    getTimeline("project", id),
    getAuditFor([id]),
  ]);
  return {
    id: p.id!,
    name: p.name ?? "",
    project_type: p.project_type,
    status: p.status ?? "planning",
    area: p.area,
    account_id: p.account_id,
    account_name: (p.accounts as unknown as { name: string } | null)?.name ?? null,
    contact_id: p.primary_contact_id,
    contact_name: (p.contacts as unknown as { display_name: string } | null)?.display_name ?? null,
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
