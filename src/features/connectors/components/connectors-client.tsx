"use client";

import { parseAsString, useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectorCards } from "@/features/connectors/components/connector-cards";
import { MappingsTab } from "@/features/connectors/components/mappings-tab";
import { RoutingTab } from "@/features/connectors/components/routing-tab";
import { ReconciliationTab } from "@/features/connectors/components/reconciliation-tab";
import { IntakeLogTab } from "@/features/connectors/components/intake-log-tab";
import type { ConnectorRow, FieldMappingRow, IntakeEventRow, ReconciliationRow, RoutingRuleRow } from "@/server/queries/connectors";

export function ConnectorsClient({
  connectors,
  mappings,
  rules,
  reconciliation,
  events,
  members,
  canManage,
  canAssign,
  demoMode,
}: {
  connectors: ConnectorRow[];
  mappings: FieldMappingRow[];
  rules: RoutingRuleRow[];
  reconciliation: ReconciliationRow[];
  events: IntakeEventRow[];
  members: { user_id: string; full_name: string }[];
  canManage: boolean;
  canAssign: boolean;
  demoMode: boolean;
}) {
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("connectors"));

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v === "connectors" ? null : v)}>
      <TabsList>
        <TabsTrigger value="connectors">Connectors</TabsTrigger>
        <TabsTrigger value="mappings">Field mappings</TabsTrigger>
        <TabsTrigger value="routing">Routing rules</TabsTrigger>
        <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        <TabsTrigger value="log">Intake log</TabsTrigger>
      </TabsList>

      <TabsContent value="connectors" className="mt-4">
        <ConnectorCards connectors={connectors} demoMode={demoMode && canManage} />
      </TabsContent>
      <TabsContent value="mappings" className="mt-4">
        <MappingsTab rows={mappings} canEdit={canManage} />
      </TabsContent>
      <TabsContent value="routing" className="mt-4">
        <RoutingTab rows={rules} members={members} canEdit={canAssign} />
      </TabsContent>
      <TabsContent value="reconciliation" className="mt-4">
        <ReconciliationTab rows={reconciliation} />
      </TabsContent>
      <TabsContent value="log" className="mt-4">
        <IntakeLogTab rows={events} canReplay={canAssign} />
      </TabsContent>
    </Tabs>
  );
}
