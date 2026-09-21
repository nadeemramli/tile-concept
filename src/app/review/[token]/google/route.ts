import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hashFeedbackToken } from "@/features/feedback/token";
import { googleDestination } from "@/features/feedback/google-destination";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashFeedbackToken(token);
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("get_feedback_by_token", { p_token_hash: tokenHash }).maybeSingle();
  const reviewUrl = data?.review_url ?? (data?.benefit_status === "not_offered" ? process.env.TC_GOOGLE_REVIEW_URL?.trim() : undefined);
  if (error || !reviewUrl) return NextResponse.redirect(new URL(`/review/${encodeURIComponent(token)}`, request.url));
  const destination = googleDestination(reviewUrl);
  if (!destination) return NextResponse.redirect(new URL(`/review/${encodeURIComponent(token)}`, request.url));
  await admin.rpc("log_feedback_customer_event", { p_token_hash: tokenHash, p_event_type: "google_handoff_opened" });
  return NextResponse.redirect(destination, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
