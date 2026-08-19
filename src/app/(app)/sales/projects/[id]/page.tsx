import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { getProjectDetail } from "@/server/queries/projects";
import { getMembers, getStages } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { TASK_STATUS } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime, formatRelative, isOverdue, titleCase } from "@/lib/format";
import { Timeline } from "@/components/patterns/timeline";
import { FactList } from "@/components/patterns/record-drawer";
import { ProjectActions } from "@/features/crm/components/project-actions";
import { AuditList, OpportunitiesList, PurchasesList, SectionCard } from "@/features/crm/components/detail-sections";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: PageProps<"/sales/projects/[id]">) {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const { id } = await params;
  const [project, members, stages] = await Promise.all([getProjectDetail(id), getMembers(), getStages()]);
  if (!project) notFound();
  const memberNames = new Map(members.map((m) => [m.user_id, m.full_name]));
  const stageLabels = new Map(stages.map((s) => [s.key, s.label]));
  const statusTone = project.status === "completed" ? "success" : project.status === "active" ? "info" : project.status === "on_hold" ? "warning" : project.status === "cancelled" ? "destructive" : "neutral";

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <Link href="/sales/projects" className="hover:underline">
            Projects
          </Link>
        }
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TonePill tone={statusTone} label={titleCase(project.status)} />
            {project.project_type && <span>{titleCase(project.project_type)}</span>}
            {project.area && <span>· {project.area}</span>}
            {project.account_id && (
              <Link href={`/sales/accounts/${project.account_id}`} className="hover:underline">
                · {project.account_name}
              </Link>
            )}
            {project.contact_id && (
              <Link href={`/sales/contacts/${project.contact_id}`} className="hover:underline">
                · {project.contact_name}
              </Link>
            )}
          </span>
        }
      >
        <ProjectActions project={project} members={members} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Opportunities" count={project.opportunities.length}>
            <OpportunitiesList items={project.opportunities} stageLabels={stageLabels} memberNames={memberNames} />
          </SectionCard>
          <SectionCard title="Sites" count={project.sites.length}>
            {project.sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No site recorded.</p>
            ) : (
              <ul className="divide-y text-sm">
                {project.sites.map((s) => (
                  <li key={s.id} className="py-2">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{[s.address.line1, s.address.city, s.address.state].filter(Boolean).join(", ") || "Address not recorded"}</div>
                    {s.access_notes && <div className="text-xs text-muted-foreground">Access: {s.access_notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Purchases" count={project.purchases.length}>
            <PurchasesList items={project.purchases} />
          </SectionCard>
          <SectionCard title="Tasks" count={project.tasks.length}>
            {project.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks.</p>
            ) : (
              <ul className="divide-y text-sm">
                {project.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-1.5">
                    <Link href={`/sales/tasks?task=${t.id}`} className="flex-1 truncate hover:underline">
                      {t.title}
                    </Link>
                    <span className={cn("tnum text-xs", isOverdue(t.due_at) && t.status === "open" ? "text-destructive" : "text-muted-foreground")}>{t.due_at ? formatRelative(t.due_at) : "—"}</span>
                    <span className="text-xs text-muted-foreground">{memberNames.get(t.assignee_id ?? "") ?? "—"}</span>
                    <StatusPill map={TASK_STATUS} value={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Timeline" count={project.timeline.length}>
            <Timeline items={project.timeline} />
          </SectionCard>
        </div>
        <div className="space-y-4">
          <SectionCard title="Facts">
            <FactList
              className="sm:grid-cols-1"
              items={[
                { label: "Owner", value: memberNames.get(project.owner_id ?? "") ?? "—" },
                { label: "Expected start", value: formatDate(project.expected_start) },
                { label: "Expected completion", value: formatDate(project.expected_completion) },
                { label: "Created by", value: memberNames.get(project.created_by ?? "") ?? "—" },
                { label: "Created", value: formatDateTime(project.created_at) },
                { label: "Record id", value: project.id, mono: true },
              ]}
            />
            {project.notes && <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{project.notes}</p>}
          </SectionCard>
          <SectionCard title="Audit" count={project.audit.length}>
            <AuditList items={project.audit} memberNames={memberNames} />
          </SectionCard>
        </div>
      </div>
    </PageBody>
  );
}
