import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, hasPermission } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { periodInput, reportPeriodSchema } from "@/features/reports/funnel-schema";
import { getSpend } from "@/server/queries/funnel";
import { SpendWorkspace } from "@/features/marketing/spend-workspace";
export const metadata: Metadata = { title: "Marketing Spend" };
export default async function SpendPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "marketing.spend.read")) return <PermissionDenied permission="marketing.spend.read" roleLabel={session.roleLabel} />;
  const parsed = reportPeriodSchema.safeParse(periodInput(await searchParams));
  if (!parsed.success) return <PageBody><PageHeader title="Check the date range" description={parsed.error.issues[0]?.message} /><Link href="/marketing/spend" className="underline">Reset dates</Link></PageBody>;
  const data = await getSpend(parsed.data);
  return <SpendWorkspace data={data} period={parsed.data} canWrite={hasPermission(session, "marketing.spend.write")} canReview={hasPermission(session, "marketing.spend.review")} canReport={hasPermission(session, "report.read")} />;
}
