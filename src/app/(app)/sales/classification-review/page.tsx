import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { MetricCard } from "@/components/patterns/metric-card";
import { getClassificationQueue } from "@/server/queries/classification";
import { ClassificationQueue } from "@/features/classification/components/classification-queue";

export const metadata: Metadata = { title: "Classification Review" };

export default async function ClassificationReviewPage() {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const rows = await getClassificationQueue();
  const count = (state: string) => rows.filter((r) => r.state === state).length;
  const SOURCE = "api.classification_queue (sales.leads, sales.opportunities)";
  return (
    <PageBody>
      <PageHeader
        title="Classification Review"
        description="Pursuits whose buyer role, project use, work type or GLC involvement still needs a person: a conflicting source, values flagged as missing at qualification, or work past qualification that is not fully classified. Open a row to correct it on the inquiry or opportunity."
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard label="Conflicting source" value={count("conflict")} tone={count("conflict") ? "destructive" : "neutral"} info={{ definition: "A later source disagreed with a recorded value. The recorded value stands until someone decides.", grain: "Pursuit", source: SOURCE }} />
        <MetricCard label="Missing, flagged" value={count("missing_flagged")} tone={count("missing_flagged") ? "warning" : "neutral"} info={{ definition: "Qualified with some values still Unknown, and flagged with a reason.", grain: "Pursuit", source: SOURCE }} />
        <MetricCard label="Not reviewed" value={count("unreviewed")} info={{ definition: "Opportunities, or qualified inquiries, never classified. Includes records from before classification existed.", grain: "Pursuit", source: SOURCE }} />
        <MetricCard label="In your view" value={rows.length} info={{ definition: "Pursuits listed below. Your role decides whose records you see.", grain: "Pursuit", source: SOURCE }} />
      </div>
      <ClassificationQueue rows={rows} />
    </PageBody>
  );
}
