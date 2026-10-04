import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { listProjects } from "@/server/queries/projects";
import { getMembers } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { ProjectsView } from "@/features/crm/components/projects-table";

export const metadata: Metadata = { title: "Project registration" };

export default async function ProjectsPage() {
  const session = await requireSession();
  if (!hasPermission(session, "projects.read")) return <PermissionDenied permission="projects.read" roleLabel={session.roleLabel} />;
  const [projects, members] = await Promise.all([listProjects(), getMembers()]);
  return (
    <PageBody>
      <PageHeader title="Project registration" description="Register quickly, enrich together. All company projects stay visible; salespeople can claim, assign and follow up." />
      <ProjectsView projects={projects} members={members} />
    </PageBody>
  );
}
