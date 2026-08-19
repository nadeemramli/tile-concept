import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { getOpportunityDetail, listOpportunities, nextQuoteNumber, type PipelineView as View } from "@/server/queries/opportunities";
import { getMembers, getStages } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PipelineView } from "@/features/pipeline/components/pipeline-view";

export const metadata: Metadata = { title: "Pipeline" };

const VIEWS: View[] = ["open", "overdue", "missing-next-action", "won", "lost", "quotes", "all"];

export default async function PipelinePage({ searchParams }: PageProps<"/sales/pipeline">) {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const view = (VIEWS.includes(sp.view as View) ? sp.view : "open") as View;
  const oppId = typeof sp.opportunity === "string" ? sp.opportunity : null;
  const [rows, stages, members, detail, quoteNo] = await Promise.all([listOpportunities(view), getStages(), getMembers(), oppId ? getOpportunityDetail(oppId) : Promise.resolve(null), nextQuoteNumber()]);
  return (
    <PageBody className="max-w-none">
      <PageHeader title="Pipeline" description="Every active opportunity has a stage, owner, next action and due date. Won/Lost/Deferred and backward moves require a reason." />
      <PipelineView rows={rows} stages={stages} members={members} view={view} detail={detail} suggestedQuoteNumber={quoteNo} />
    </PageBody>
  );
}
