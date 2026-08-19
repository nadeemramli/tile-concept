import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { listProjects } from "@/server/queries/projects";
import { getMembers } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { ProjectsView } from "@/features/crm/components/projects-table";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const [projects, members] = await Promise.all([listProjects(), getMembers()]);
  return (
    <PageBody>
      <PageHeader title="Projects" description="The physical or commercial job materials are considered for. Multiple projects per customer; multiple opportunities per project." />
      <ProjectsView projects={projects} members={members} />
    </PageBody>
  );
}
