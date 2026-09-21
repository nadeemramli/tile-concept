import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, hasPermission } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { periodInput, reportPeriodSchema } from "@/features/reports/funnel-schema";
import { getFunnel } from "@/server/queries/funnel";
import { FunnelDashboard } from "@/features/reports/components/funnel-dashboard";
export const metadata: Metadata = { title: "Marketing & Showroom Dashboard" };
export default async function FunnelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "report.read")) return <PermissionDenied permission="report.read" roleLabel={session.roleLabel} />;
  const parsed = reportPeriodSchema.safeParse(periodInput(await searchParams));
  if (!parsed.success) return <PageBody><PageHeader title="Check the reporting period" description={parsed.error.issues[0]?.message} /><Link href="/insights/reports/funnel" className="underline">Reset dates</Link></PageBody>;
  const result = await getFunnel(parsed.data, hasPermission(session, "sales.read_all"));
  return <FunnelDashboard {...result} period={parsed.data} canSpend={hasPermission(session, "marketing.spend.read")} />;
}
