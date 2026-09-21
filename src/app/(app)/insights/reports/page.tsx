import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { Card } from "@/components/ui/card";
import { TonePill } from "@/components/patterns/status-pill";
import { listReports } from "@/server/queries/reports";
import { PII_LABEL, QUALITY_TONE } from "@/features/reports/registry";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsIndexPage() {
  const session = await requireSession();
  if (!hasPermission(session, "report.read")) return <PermissionDenied permission="report.read" roleLabel={session.roleLabel} />;
  const reports = await listReports();

  return (
    <PageBody>
      <PageHeader
        title="Reports"
        description="Marketing and showroom performance, with clear metric definitions and customer journey drilldowns."
      />

      <Link href="/insights/reports/funnel" className="rounded-xl border border-primary/30 bg-primary/5 p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center justify-between font-semibold">Marketing & showroom dashboard <ArrowRight className="size-4" aria-hidden /></span>
        <p className="mt-2 text-sm text-muted-foreground">Marketing spend, MER, inquiry-to-sale and showroom conversion, team activity and purchase history.</p>
      </Link>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => {
          const quality = r.definitions[0]?.quality ?? "monitored";
          const pii = r.definitions[0]?.pii_class ?? "aggregate";
          return (
            <Link key={r.slug} href={`/insights/reports/${r.slug}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full gap-2 px-4 py-3 transition-colors hover:bg-accent/40">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
                    {r.title}
                  </span>
                  <TonePill tone={QUALITY_TONE[quality] ?? "info"} label={quality} />
                </div>
                <p className="text-sm text-muted-foreground">{r.question}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <div>
                    <dt className="inline">Grain: </dt>
                    <dd className="inline text-foreground">{r.definitions[0]?.grain ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="inline">Period: </dt>
                    <dd className="inline text-foreground">{r.ranged ? "Date range" : "Point-in-time"}</dd>
                  </div>
                  <div className="col-span-2 truncate">
                    <dt className="inline">Privacy: </dt>
                    <dd className="inline text-foreground">{PII_LABEL[pii] ?? pii}</dd>
                  </div>
                </dl>
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-info">
                  Open report <ArrowRight className="size-3" aria-hidden />
                </span>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Definitions live in the database (`reporting.metric_definitions`) so the app, an export and any future warehouse agree on
        what each number means. Exports are aggregate-only.
      </p>
    </PageBody>
  );
}
