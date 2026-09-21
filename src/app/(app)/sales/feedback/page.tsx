import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { FeedbackTrackingTable } from "@/features/feedback/components/feedback-tracking-table";
import { listFeedbackRequests } from "@/server/queries/feedback";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Customer feedback" };

export default async function FeedbackPage({ searchParams }: PageProps<"/sales/feedback">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const page = Math.max(1, Math.min(1000000, Math.floor(Number(sp.page) || 1)));
  const requests = await listFeedbackRequests(page);
  return (
    <PageBody>
      <PageHeader title="Customer feedback" description="Private feedback, WhatsApp handoffs and reported or verified Google reviews. A handoff click is never counted as a posted review."><Button asChild variant="outline"><Link href="/sales/walk-ins">Choose a walk-in</Link></Button></PageHeader>
      <FeedbackTrackingTable requests={requests.rows} />
      <div className="flex items-center justify-between text-sm"><span>{requests.total} requests · page {page}</span><div className="flex gap-2">{page > 1 ? <Button asChild variant="outline"><Link href={`/sales/feedback?page=${page - 1}`}>Previous</Link></Button> : null}{page * 25 < requests.total ? <Button asChild variant="outline"><Link href={`/sales/feedback?page=${page + 1}`}>Next</Link></Button> : null}</div></div>
    </PageBody>
  );
}
