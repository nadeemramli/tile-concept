import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { FeedbackCaptureForm } from "@/features/feedback/components/feedback-capture-form";
import { getFeedbackWorkbench, getCustomerReviewSummary } from "@/server/queries/feedback";
import { uuid } from "@/lib/zod";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTime, titleCase } from "@/lib/format";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Request customer feedback" };

export default async function NewFeedbackPage({ searchParams }: PageProps<"/sales/feedback/new">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.write")) return <PermissionDenied permission="sales.write" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const id = uuid().safeParse(sp.request ?? sp.visit ?? sp.purchase);
  if (!id.success) notFound();
  const purchase = await getFeedbackWorkbench(sp.request ? { p_request_id: id.data } : sp.visit ? { p_visit_id: id.data } : { p_purchase_id: id.data });
  if (!purchase) notFound();
  const previous = await getCustomerReviewSummary(purchase.contact_id);
  return (
    <PageBody className="max-w-3xl">
      <PageHeader title="Customer feedback & Google review" description="Record the customer’s answers, add agreed photos, then prepare one WhatsApp message. The customer chooses whether to publish on Google." />
      {!process.env.TC_GOOGLE_REVIEW_URL?.trim() ? <Alert><AlertTitle>Google review destination needs setup</AlertTitle><AlertDescription>Ask an administrator to add the showroom’s Google review link before sending. Private feedback works, but the customer cannot open Google from this request yet.</AlertDescription></Alert> : null}
      {previous?.id && previous.id !== purchase.existing_request_id ? <Alert><AlertTitle>A Google review is already recorded for this customer</AlertTitle><AlertDescription>{titleCase(previous.review_outcome ?? "unknown")}{previous.review_outcome_at ? ` · ${formatDateTime(previous.review_outcome_at)}` : ""}. <Link className="underline" href={`/sales/feedback/new?request=${previous.id}`}>Open earlier request</Link></AlertDescription></Alert> : null}
      <FeedbackCaptureForm purchase={purchase} />
    </PageBody>
  );
}
