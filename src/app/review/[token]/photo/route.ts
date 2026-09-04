import { NextResponse } from "next/server";
import { loadFeedbackMediaByToken } from "@/server/queries/feedback";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { admin, media, tokenHash } = await loadFeedbackMediaByToken(token);
  if (!media) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await admin.storage.from(media.bucket_id).download(media.object_path);
  if (error || !data) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  await admin.rpc("log_feedback_customer_event", { p_token_hash: tokenHash, p_event_type: "photo_downloaded" });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": media.mime_type,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="tile-concept-feedback-photo"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

