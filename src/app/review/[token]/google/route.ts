import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { hashFeedbackToken } from "@/features/feedback/token";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashFeedbackToken(token);
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("get_feedback_by_token", { p_token_hash: tokenHash }).maybeSingle();
  if (error || !data?.review_url) return NextResponse.redirect(new URL(`/review/${encodeURIComponent(token)}`, request.url));
  const destination = new URL(data.review_url);
  const host = destination.hostname.toLowerCase();
  const allowed = destination.protocol === "https:" && (host === "g.page" || host === "maps.app.goo.gl" || host === "search.google.com" || host === "google.com" || host.endsWith(".google.com"));
  if (!allowed) return NextResponse.redirect(new URL(`/review/${encodeURIComponent(token)}`, request.url));
  await admin.rpc("log_feedback_customer_event", { p_token_hash: tokenHash, p_event_type: "google_handoff_opened" });
  return NextResponse.redirect(destination, { headers: { "Cache-Control": "no-store" } });
}

