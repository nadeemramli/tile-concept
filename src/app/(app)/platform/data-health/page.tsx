import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { MetricCard } from "@/components/patterns/metric-card";
import { getDataHealthSummary, listDataQualityIssues, listIntegrations } from "@/server/queries/platform";
import { DataHealthTabs } from "@/features/platform/components/data-health";

export const metadata: Metadata = { title: "Data Health" };

export default async function DataHealthPage() {
  const session = await requireSession();
  if (!hasPermission(session, "audit.read")) return <PermissionDenied permission="audit.read" roleLabel={session.roleLabel} />;
  const [summary, issues, integrations] = await Promise.all([getDataHealthSummary(), listDataQualityIssues(), listIntegrations()]);
  return (
    <PageBody>
      <PageHeader title="Data Health" description="Exception queues: duplicates, unmapped fields, unknown units, overlapping prices, stale snapshots, failed connectors, and review backlog." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard compact label="Open issues" value={summary.openIssues} tone={summary.openIssues ? "warning" : "neutral"} info={{ definition: "Data-quality issues with status open.", grain: "Issue", source: "ingest.data_quality_issues" }} />
        <MetricCard compact label="High severity" value={summary.highIssues} tone={summary.highIssues ? "destructive" : "neutral"} info={{ definition: "Open issues marked high severity.", grain: "Issue", source: "ingest.data_quality_issues" }} />
        <MetricCard compact label="Duplicate candidates" value={summary.duplicates} tone={summary.duplicates ? "info" : "neutral"} href="/sales/identity-review" info={{ definition: "Suggested identity matches awaiting a human decision.", grain: "Candidate pair", source: "identity.identity_match_candidates" }} />
        <MetricCard compact label="Unreviewed products" value={summary.unreviewed} tone={summary.unreviewed ? "warning" : "neutral"} href="/merchandise/catalog?view=unreviewed" info={{ definition: "Products whose attributes have not been reviewed.", grain: "Product", source: "merch.products" }} />
        <MetricCard compact label="Conflicted prices" value={summary.conflicted} tone={summary.conflicted ? "destructive" : "neutral"} href="/merchandise/pricing?state=conflicted" info={{ definition: "Prices blocked by an overlapping current price.", grain: "Price", source: "merch.variant_prices" }} />
        <MetricCard compact label="Connectors failing" value={summary.connectorsFailed} tone={summary.connectorsFailed ? "destructive" : "neutral"} href="/platform/integrations" info={{ definition: "Integration connections in failed or degraded state.", grain: "Connection", source: "ingest.integration_connections" }} />
      </div>
      <DataHealthTabs issues={issues} integrations={integrations} counts={{ duplicates: summary.duplicates, unreviewed: summary.unreviewed, conflicted: summary.conflicted, pendingReviews: summary.pendingReviews }} />
    </PageBody>
  );
}
