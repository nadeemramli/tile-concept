import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { FeedbackCaptureForm } from "@/features/feedback/components/feedback-capture-form";
import { getFeedbackPurchaseContext } from "@/server/queries/feedback";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Request customer feedback" };

export default async function NewFeedbackPage({ searchParams }: PageProps<"/sales/feedback/new">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.write")) return <PermissionDenied permission="sales.write" roleLabel={session.roleLabel} />;
  const purchaseId = (await searchParams).purchase;
  if (typeof purchaseId !== "string") notFound();
  const purchase = await getFeedbackPurchaseContext(purchaseId);
  if (!purchase) notFound();
  return (
    <PageBody className="max-w-3xl">
      <PageHeader title="Request customer feedback" description="An optional post-purchase step. The existing walk-in record is already complete and will not be changed." />
      <FeedbackCaptureForm purchase={purchase} />
    </PageBody>
  );
}
