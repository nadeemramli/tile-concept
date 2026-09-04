import type { Metadata } from "next";
import { CustomerFeedbackCard } from "@/features/feedback/components/customer-feedback-card";
import { loadCustomerFeedbackByToken } from "@/server/queries/feedback";

export const metadata: Metadata = { title: "Your Tile Concept feedback", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CustomerFeedbackPage({ params }: PageProps<"/review/[token]">) {
  const { token } = await params;
  const feedback = await loadCustomerFeedbackByToken(token);
  if (!feedback) {
    return <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4"><div className="max-w-md rounded-xl border bg-card p-6 text-center"><h1 className="font-semibold">This private link is unavailable</h1><p className="mt-2 text-sm text-muted-foreground">It may have expired or been revoked. Please contact Tile Concept if you still want to check your feedback.</p></div></main>;
  }
  return <main className="min-h-dvh bg-muted/30 px-4 py-8 sm:py-12"><CustomerFeedbackCard token={token} feedback={feedback} /></main>;
}

