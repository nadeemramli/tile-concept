import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { getDefinitionsFor, runReport } from "@/server/queries/reports";
import { reportBySlug, REPORTS } from "@/features/reports/registry";
import { GovernanceHeader } from "@/features/reports/components/governance-header";
import { ReportView } from "@/features/reports/components/report-view";

export async function generateMetadata({ params }: PageProps<"/insights/reports/[report]">): Promise<Metadata> {
  const { report } = await params;
  return { title: reportBySlug(report)?.title ?? "Report" };
}

export function generateStaticParams() {
  return REPORTS.map((r) => ({ report: r.slug }));
}

export default async function ReportPage({ params, searchParams }: PageProps<"/insights/reports/[report]">) {
  const session = await requireSession();
  if (!hasPermission(session, "report.read")) return <PermissionDenied permission="report.read" roleLabel={session.roleLabel} />;

  const { report: slug } = await params;
  const def = reportBySlug(slug);
  if (!def) notFound();

  const sp = await searchParams;
  const from = typeof sp.from === "string" && sp.from ? sp.from : undefined;
  const to = typeof sp.to === "string" && sp.to ? sp.to : undefined;

  const [definitions, result] = await Promise.all([getDefinitionsFor(def.metricKey), runReport(def, from, to)]);

  const filters = def.ranged
    ? from || to
      ? `Created between ${from ?? "the beginning"} and ${to ?? "today"}${session.permissions.includes("sales.read_all") ? "" : "; limited to your scope"}`
      : `All time${session.permissions.includes("sales.read_all") ? "" : "; limited to your scope"}`
    : "None — current state of the workspace";

  return (
    <PageBody>
      <div>
        <Link href="/insights/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" aria-hidden /> All reports
        </Link>
      </div>
      <PageHeader title={def.title} description={def.question} eyebrow="Governed report" />
      <GovernanceHeader report={def} definitions={definitions} computedAt={result.computedAt} filters={filters} />
      <ReportView report={def} rows={result.rows} currency={session.currency} error={result.error} />
    </PageBody>
  );
}
