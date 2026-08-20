import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { MetricCard } from "@/components/patterns/metric-card";
import { findProductsByCode, listReviewQueue, listSourceAssets } from "@/server/queries/sources";
import { ReviewClient } from "@/features/sources/components/review-client";

export const metadata: Metadata = { title: "Imports & OCR Review" };

export default async function ReviewPage({ searchParams }: PageProps<"/sources/review">) {
  const session = await requireSession();
  if (!hasPermission(session, "source.import") && !hasPermission(session, "review.approve")) {
    return <PermissionDenied permission="review.approve" roleLabel={session.roleLabel} />;
  }

  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const [items, assets, pendingAll] = await Promise.all([
    listReviewQueue({
      status: str("status") ?? "pending",
      asset: str("asset"),
      itemType: str("type"),
      confidence: str("confidence"),
      conflictsOnly: str("conflicts") === "1",
    }),
    listSourceAssets(),
    listReviewQueue({ status: "pending" }),
  ]);

  const codes = items.map((i) => String(i.proposed?.code ?? "")).filter(Boolean);
  const dupMap = await findProductsByCode(codes);
  const duplicates = Object.fromEntries([...dupMap.entries()]);

  const lowConfidence = pendingAll.filter((i) => i.confidence !== null && i.confidence < 0.8).length;
  const withConflicts = pendingAll.filter((i) => i.conflicts.length > 0).length;
  const needsManual = pendingAll.filter((i) => i.conflicts.some((c) => c.code === "needs_manual")).length;

  return (
    <PageBody className="max-w-[1600px]">
      <PageHeader
        title="Imports & OCR Review"
        description="The document on the left, the proposal on the right. Nothing published this way skipped a human — corrections are yours, not the parser's."
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard
          compact
          label="Pending"
          value={pendingAll.length}
          tone={pendingAll.length ? "warning" : "neutral"}
          info={{ definition: "Extracted rows awaiting a decision.", grain: "Review item", source: "ingest.review_items" }}
        />
        <MetricCard
          compact
          label="Low confidence"
          value={lowConfidence}
          tone={lowConfidence ? "destructive" : "neutral"}
          href="/sources/review?confidence=low"
          info={{ definition: "Pending rows scored below 80%. The score is the parser's own certainty, not a measure of correctness.", grain: "Review item", source: "ingest.review_items" }}
        />
        <MetricCard
          compact
          label="With conflicts"
          value={withConflicts}
          tone={withConflicts ? "warning" : "neutral"}
          href="/sources/review?conflicts=1"
          info={{ definition: "Pending rows flagged as duplicates, formula-derived, or missing a code or price.", grain: "Review item", source: "ingest.review_items" }}
        />
        <MetricCard
          compact
          label="Needs manual entry"
          value={needsManual}
          tone={needsManual ? "warning" : "neutral"}
          info={{
            definition: "Scanned pages with no text layer.",
            grain: "Review item",
            source: "ingest.review_items",
            caveat: "OCR runs in the background worker (PRD §12.5). Nothing is guessed in the meantime.",
          }}
        />
      </div>

      <ReviewClient
        items={items}
        assets={assets.map((a) => ({ id: a.id, name: a.name }))}
        duplicates={duplicates}
        canApprove={hasPermission(session, "review.approve")}
      />
    </PageBody>
  );
}
