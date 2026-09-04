import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { FeedbackTrackingTable } from "@/features/feedback/components/feedback-tracking-table";
import { listFeedbackRequests } from "@/server/queries/feedback";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Customer feedback" };

export default async function FeedbackPage() {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const requests = await listFeedbackRequests();
  return (
    <PageBody>
      <PageHeader title="Customer feedback" description="Private feedback confirmation and voluntary Google handoffs. A handoff click is never counted as a posted review."><Button asChild variant="outline"><Link href="/sales/walk-ins?tab=purchases">Choose a purchase</Link></Button></PageHeader>
      <FeedbackTrackingTable requests={requests} />
    </PageBody>
  );
}
