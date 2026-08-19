import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { listIntegrations } from "@/server/queries/platform";
import { getMembers } from "@/server/queries/reference";
import { IntegrationCards } from "@/features/platform/components/integrations";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const session = await requireSession();
  if (!hasPermission(session, "audit.read")) return <PermissionDenied permission="audit.read" roleLabel={session.roleLabel} />;
  const [rows, members] = await Promise.all([listIntegrations(), getMembers()]);
  return (
    <PageBody>
      <PageHeader title="Integrations" description="Each connector shows provider, environment, direction, owner, credential reference, freshness and error state. Configuration unlocks per PRD phase once access, scopes and credentials are approved." />
      <IntegrationCards rows={rows} canManage={hasPermission(session, "settings.manage")} members={members.map((m) => ({ user_id: m.user_id, full_name: m.full_name }))} />
    </PageBody>
  );
}
