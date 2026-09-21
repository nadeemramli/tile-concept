import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getWalkInCounts, listPurchases, getVisit, getVisitPage, getVisitLinkHistory } from "@/server/queries/walkins";
import { uuid } from "@/lib/zod";
import { WalkinsClient } from "@/features/walkins/components/walkins-client";
import { listFeedbackRequests, getCustomerReviewSummary } from "@/server/queries/feedback";

export const metadata: Metadata = { title: "Walk-ins & Purchases" };

export default async function WalkinsPage({ searchParams }: PageProps<"/sales/walk-ins">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const tab = sp.tab === "purchases" || (typeof sp.purchase === "string" && sp.tab !== "visits") ? "purchases" : "visits";
  const needsLinking = sp.filter === "needs-linking";
  const page = Math.max(1, Math.min(1000000, Number(sp.page) || 1));
  const visitId = uuid().safeParse(sp.visit);
  const [visitPage, recentPurchases, counts, selectedVisit, linkHistory] = await Promise.all([
    getVisitPage(Math.floor(page), needsLinking), tab === "purchases" ? listPurchases() : [], getWalkInCounts(),
    visitId.success ? getVisit(visitId.data) : null,
    visitId.success ? getVisitLinkHistory(visitId.data) : [],
  ]);
  const purchases = tab === "purchases" ? recentPurchases : await listPurchases(500, { visitIds: [...new Set([...visitPage.rows.map((v) => v.id), ...(selectedVisit ? [selectedVisit.id] : [])])] });
  const feedback = await listFeedbackRequests(1, [...new Set([...visitPage.rows.map(v => v.id), ...(selectedVisit ? [selectedVisit.id] : [])])]);
  const customerReview = selectedVisit?.contact_id ? await getCustomerReviewSummary(selectedVisit.contact_id) : null;
  return (
    <PageBody>
      <PageHeader title="Walk-ins & Purchases" description="The showroom ledger that replaces the walk-in spreadsheet: every visit resolves to an identity; purchases keep document, amount, payments and repeat status." />
      <WalkinsClient tab={tab} visits={visitPage.rows} purchases={purchases} counts={counts} selectedVisit={selectedVisit} linkHistory={linkHistory} visitPage={visitPage.page} visitTotal={visitPage.total} needsLinking={needsLinking} feedback={feedback.rows} customerReview={customerReview} />
    </PageBody>
  );
}
