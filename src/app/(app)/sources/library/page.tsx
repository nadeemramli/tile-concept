import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { MetricCard } from "@/components/patterns/metric-card";
import { getSourceAssetDetail, getSourceCounts, getSourceRefs, listSourceAssets } from "@/server/queries/sources";
import { LibraryClient } from "@/features/sources/components/library-client";
import { UploadButton } from "@/features/sources/components/upload-dialog";

export const metadata: Metadata = { title: "Source Library" };

export default async function SourceLibraryPage({ searchParams }: PageProps<"/sources/library">) {
  const session = await requireSession();
  if (!hasPermission(session, "source.import")) return <PermissionDenied permission="source.import" roleLabel={session.roleLabel} />;

  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const assetId = str("asset");

  const [rows, counts, refs, allRows, detail] = await Promise.all([
    listSourceAssets({ kind: str("kind"), supplier: str("supplier"), status: str("status"), q: str("q") }),
    getSourceCounts(),
    getSourceRefs(),
    listSourceAssets(),
    assetId ? getSourceAssetDetail(assetId) : Promise.resolve(null),
  ]);

  const supplierNames = [...new Set(allRows.map((r) => r.supplier_name).filter((s): s is string => Boolean(s)))].sort();
  const canWrite = hasPermission(session, "source.import");

  return (
    <PageBody>
      <PageHeader
        title="Source Library"
        description="Supplier price lists, catalogue extracts and stock notes — stored privately, fingerprinted, and versioned. Extraction proposes; a human publishes."
      >
        <UploadButton suppliers={refs.suppliers} brands={refs.brands} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard
          compact
          label="Awaiting parse"
          value={counts.awaitingProcessing}
          tone={counts.awaitingProcessing ? "info" : "neutral"}
          info={{ definition: "Sources uploaded or still processing, with no completed extraction.", grain: "Source asset", source: "ingest.source_assets" }}
        />
        <MetricCard
          compact
          label="Rows to review"
          value={counts.pendingReviews}
          tone={counts.pendingReviews ? "warning" : "neutral"}
          href="/sources/review"
          info={{ definition: "Extracted rows waiting for a human decision. Nothing publishes automatically.", grain: "Review item", source: "ingest.review_items" }}
        />
        <MetricCard
          compact
          label="Failed jobs"
          value={counts.failedJobs}
          tone={counts.failedJobs ? "destructive" : "neutral"}
          info={{ definition: "Import jobs that ended failed or dead-lettered. The original and its error are kept.", grain: "Ingestion job", source: "ingest.ingestion_jobs" }}
        />
        <MetricCard
          compact
          label="Needs manual entry"
          value={counts.needsManual}
          tone={counts.needsManual ? "warning" : "neutral"}
          href="/sources/review?conflicts=1"
          info={{
            definition: "Scanned pages and images with no text layer.",
            grain: "Review item",
            source: "ingest.review_items",
            caveat: "OCR runs in the background worker (PRD §12.5); until it ships these are entered by hand.",
          }}
        />
      </div>

      <LibraryClient rows={rows} detail={detail} suppliers={refs.suppliers} brands={refs.brands} supplierNames={supplierNames} canWrite={canWrite} />
    </PageBody>
  );
}
