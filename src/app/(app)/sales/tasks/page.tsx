import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getTaskCounts, listTasks } from "@/server/queries/tasks";
import { getMembers } from "@/server/queries/reference";
import { TASK_VIEWS, type TaskView } from "@/features/tasks/schema";
import { TasksClient } from "@/features/tasks/components/tasks-client";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/sales/tasks">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const viewParam = typeof sp.view === "string" ? sp.view : "mine";
  const view: TaskView = (TASK_VIEWS as readonly string[]).includes(viewParam) ? (viewParam as TaskView) : "mine";
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const [tasks, counts, members] = await Promise.all([listTasks(view, session), getTaskCounts(session), getMembers()]);
  return (
    <PageBody>
      <PageHeader title="Tasks" description="Next actions and follow-ups ordered by urgency. Completing a task writes the outcome to the linked record’s timeline." />
      <TasksClient view={view} tasks={tasks} counts={counts} members={members} prefill={{ contact_id: str("contact_id"), opportunity_id: str("opportunity_id"), lead_id: str("lead_id"), account_id: str("account_id"), project_id: str("project_id") }} />
    </PageBody>
  );
}
