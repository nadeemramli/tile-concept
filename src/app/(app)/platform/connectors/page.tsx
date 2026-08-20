import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { listConnectors, listFieldMappings, listIntakeEvents, listReconciliation, listRoutingRules } from "@/server/queries/connectors";
import { getMembers } from "@/server/queries/reference";
import { ConnectorsClient } from "@/features/connectors/components/connectors-client";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Connectors" };

export default async function ConnectorsPage() {
  const session = await requireSession();
  if (!hasPermission(session, "settings.manage")) return <PermissionDenied permission="settings.manage" roleLabel={session.roleLabel} />;

  const [connectors, mappings, rules, reconciliation, events, members] = await Promise.all([
    listConnectors(),
    listFieldMappings(),
    listRoutingRules(),
    listReconciliation(),
    listIntakeEvents(),
    getMembers(),
  ]);

  return (
    <PageBody>
      <PageHeader
        title="Connectors"
        description="Inbound lead connectors: what is configured, how provider questions map onto lead fields, who gets the lead, and whether everything a provider sent became a lead or a documented duplicate."
      />
      <ConnectorsClient
        connectors={connectors}
        mappings={mappings}
        rules={rules}
        reconciliation={reconciliation}
        events={events}
        members={members.map((m) => ({ user_id: m.user_id, full_name: m.full_name }))}
        canManage={hasPermission(session, "settings.manage")}
        canAssign={hasPermission(session, "sales.assign")}
        demoMode={publicEnv.appMode === "demo"}
      />
    </PageBody>
  );
}
