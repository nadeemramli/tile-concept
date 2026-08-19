import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getWalkInCounts, listPurchases, listVisits } from "@/server/queries/walkins";
import { WalkinsClient } from "@/features/walkins/components/walkins-client";

export const metadata: Metadata = { title: "Walk-ins & Purchases" };

export default async function WalkinsPage({ searchParams }: PageProps<"/sales/walk-ins">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const tab = sp.tab === "purchases" || (typeof sp.purchase === "string" && sp.tab !== "visits") ? "purchases" : "visits";
  const [visits, purchases, counts] = await Promise.all([listVisits(), listPurchases(), getWalkInCounts()]);
  return (
    <PageBody>
      <PageHeader title="Walk-ins & Purchases" description="The showroom ledger that replaces the walk-in spreadsheet: every visit resolves to an identity; purchases keep document, amount, payments and repeat status." />
      <WalkinsClient tab={tab} visits={visits} purchases={purchases} counts={counts} />
    </PageBody>
  );
}
