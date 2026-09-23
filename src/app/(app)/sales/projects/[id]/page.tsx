import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { getProjectDetail } from "@/server/queries/projects";
import { getMembers, getStages } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { StatusPill } from "@/components/patterns/status-pill";
import { TASK_STATUS } from "@/lib/domain/status-maps";
import { PROJECT_STATUS } from "@/features/crm/project-status";
import { formatDate, formatDateTime, formatRelative, isOverdue, titleCase } from "@/lib/format";
import { Timeline } from "@/components/patterns/timeline";
import { FactList } from "@/components/patterns/record-drawer";
import { ProjectActions } from "@/features/crm/components/project-actions";
import { AuditList, OpportunitiesList, PurchasesList, SectionCard } from "@/features/crm/components/detail-sections";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: PageProps<"/sales/projects/[id]">) {
  const session = await requireSession();
  if (!hasPermission(session, "projects.read")) return <PermissionDenied permission="projects.read" roleLabel={session.roleLabel} />;
  const canReadSales = hasPermission(session, "sales.read");
  const { id } = await params;
  const [project, members, stages] = await Promise.all([getProjectDetail(id), getMembers(), getStages()]);
  if (!project) notFound();
  const memberNames = new Map(members.map((m) => [m.user_id, m.full_name]));
  const stageLabels = new Map(stages.map((s) => [s.key, s.label]));

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
            <StatusPill map={PROJECT_STATUS} value={project.status} />
            {project.project_type && <span>{titleCase(project.project_type)}</span>}
            {project.area && <span>· {project.area}</span>}
            {project.account_id && canReadSales && (
              <Link href={`/sales/accounts/${project.account_id}`} className="hover:underline">
                · {project.account_name}
              </Link>
            )}
            {!canReadSales && <span>{[project.account_name, project.contact_name].filter(Boolean).join(" · ")}</span>}
            {project.contact_id && canReadSales && (
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
          <SectionCard title="Project follow-up">
            <FactList items={[
              { label: "Internal project handler", value: memberNames.get(project.owner_id ?? "") ?? "Unassigned — available for pickup" },
              { label: "Last follow-up by", value: memberNames.get(project.last_follow_up_by ?? "") ?? "No follow-up recorded" },
              { label: "Last follow-up", value: formatDateTime(project.last_follow_up_at) },
              { label: "Next action", value: project.next_action ?? "No next action set" },
              { label: "Next action due", value: formatDateTime(project.next_action_due_at) },
              { label: "Registered by", value: memberNames.get(project.created_by ?? "") ?? "—" },
            ]} />
          </SectionCard>
          <SectionCard title="Follow-up & handover history" count={project.events.length}>
            {project.events.length === 0 ? <p className="text-sm text-muted-foreground">No project updates recorded yet.</p> : <ul className="divide-y">{project.events.map((event) => <li key={event.id} className="space-y-1 py-3 text-sm">
              <p className="font-medium">{event.kind === "registered" ? "Project registered" : event.kind === "enriched" ? "Project details updated" : event.kind === "assigned" ? `Handler: ${memberNames.get(event.previous_owner_id ?? "") ?? "Unassigned"} → ${memberNames.get(event.owner_id ?? "") ?? "Unassigned"}` : "Follow-up recorded"}</p>
              <p className="text-xs text-muted-foreground">{memberNames.get(event.actor_id) ?? "Staff member"} · {formatDateTime(event.created_at)}</p>
              {event.note && <p className="whitespace-pre-wrap">{event.note}</p>}
              {event.kind === "follow_up" && event.next_action && <p className="text-xs">Next: {event.next_action}{event.next_action_due_at ? ` · ${formatDateTime(event.next_action_due_at)}` : ""}</p>}
            </li>)}</ul>}
          </SectionCard>
          {canReadSales && <SectionCard title="Opportunities" count={project.opportunities.length}>
            <OpportunitiesList items={project.opportunities} stageLabels={stageLabels} memberNames={memberNames} />
          </SectionCard>}
          <SectionCard title="Products / specifications proposed"><p className="whitespace-pre-wrap text-sm">{project.product_specification || "No proposed specifications recorded."}</p></SectionCard>
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
          {canReadSales && <SectionCard title="Sales, invoices & receipts" count={project.purchases.length}>
            <PurchasesList items={project.purchases} />
          </SectionCard>}
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
                { label: "Customer/company PIC", value: project.follow_up_contact_id && canReadSales ? <Link href={`/sales/contacts/${project.follow_up_contact_id}`} className="hover:underline">{project.follow_up_contact_name ?? "Open contact"}</Link> : project.follow_up_contact_name ?? "—" },
                { label: "Internal project handler", value: memberNames.get(project.owner_id ?? "") ?? "—" },
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
