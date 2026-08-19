import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getMemberMap } from "@/server/queries/reference";
import type { AppSession } from "@/server/session";
import type { TaskRow } from "@/features/tasks/types";
import type { TaskView } from "@/features/tasks/schema";

export async function listTasks(view: TaskView, session: AppSession): Promise<TaskRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from("tasks")
    .select("id, title, description, status, priority, due_at, assignee_id, created_by, contact_id, account_id, opportunity_id, lead_id, project_id, completed_at, outcome, created_at")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(500);
  const now = new Date().toISOString();
  if (view === "mine") q = q.eq("status", "open").eq("assignee_id", session.userId);
  else if (view === "overdue") q = q.eq("status", "open").lt("due_at", now);
  else if (view === "done") q = q.in("status", ["done", "cancelled"]).order("completed_at", { ascending: false });
  else q = q.eq("status", "open");
  const { data } = await q;
  const rows = data ?? [];
  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter((x): x is string => !!x)));
  const oppIds = Array.from(new Set(rows.map((r) => r.opportunity_id).filter((x): x is string => !!x)));
  const [members, contacts, opps] = await Promise.all([
    getMemberMap(),
    contactIds.length ? supabase.from("contacts").select("id, display_name").in("id", contactIds) : Promise.resolve({ data: [] as { id: string | null; display_name: string | null }[] }),
    oppIds.length ? supabase.from("opportunities").select("id, name").in("id", oppIds) : Promise.resolve({ data: [] as { id: string | null; name: string | null }[] }),
  ]);
  const cMap = new Map((contacts.data ?? []).map((c) => [String(c.id), c.display_name ?? ""]));
  const oMap = new Map((opps.data ?? []).map((o) => [String(o.id), o.name ?? ""]));
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    description: r.description,
    status: String(r.status ?? "open"),
    priority: String(r.priority ?? "normal"),
    due_at: r.due_at,
    assignee_id: r.assignee_id,
    assignee_name: r.assignee_id ? (members.get(r.assignee_id)?.full_name ?? null) : null,
    created_by: r.created_by,
    contact_id: r.contact_id,
    contact_name: r.contact_id ? (cMap.get(r.contact_id) ?? null) : null,
    account_id: r.account_id,
    opportunity_id: r.opportunity_id,
    opportunity_name: r.opportunity_id ? (oMap.get(r.opportunity_id) ?? null) : null,
    lead_id: r.lead_id,
    project_id: r.project_id,
    completed_at: r.completed_at,
    outcome: r.outcome,
    created_at: String(r.created_at),
  }));
}

export async function getTaskCounts(session: AppSession) {
  const supabase = await createServerSupabase();
  const now = new Date().toISOString();
  const head = () => supabase.from("tasks").select("id", { count: "exact", head: true });
  const [mine, overdue, open, doneWeek] = await Promise.all([
    head().eq("status", "open").eq("assignee_id", session.userId),
    head().eq("status", "open").lt("due_at", now),
    head().eq("status", "open"),
    head().eq("status", "done").gte("completed_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
  ]);
  return { mine: mine.count ?? 0, overdue: overdue.count ?? 0, open: open.count ?? 0, doneWeek: doneWeek.count ?? 0 };
}
