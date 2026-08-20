/**
 * Signed website intake (PRD §11.2).
 *
 * Server-to-server only: the website's *server* signs and posts here. The
 * Supabase publishable key is never used for intake and no privileged key is
 * exposed to a browser.
 *
 * Required environment:
 *   INTAKE_WEBSITE_SECRET   shared HMAC secret with the website backend
 *   TC_INTAKE_WORKSPACE_ID  workspace to write into (optional when the stack
 *                           has exactly one workspace)
 *
 * Contract:
 *   POST /api/intake/website
 *   headers: x-tc-timestamp: <unix seconds>
 *            x-tc-signature: sha256=<hex hmac of "<timestamp>.<raw body>">
 *   200/202 { ok, lead_id, duplicate }
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildIdempotencyKey, isFreshTimestamp, takeToken, verifyTimestampedSignature } from "@/integrations/signature";
import { acceptIntake, resolveIntakeWorkspaceId } from "@/integrations/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  submission_id: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  email: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
  interest: z.string().max(500).optional(),
  area: z.string().max(120).optional(),
  product_interest: z.array(z.string().max(40)).max(12).optional(),
  source_url: z.string().max(500).optional(),
  utm_source: z.string().max(120).optional(),
  utm_medium: z.string().max(120).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_content: z.string().max(200).optional(),
  utm_term: z.string().max(200).optional(),
  consent_version: z.string().max(60).optional(),
  occurred_at: z.string().max(40).optional(),
});

export async function POST(request: NextRequest) {
  const secret = process.env.INTAKE_WEBSITE_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "connector_not_configured" }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!takeToken(`website:${ip}`)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  // The signature covers the raw bytes, so read the body as text first.
  const raw = await request.text();
  const timestamp = request.headers.get("x-tc-timestamp");
  const signature = request.headers.get("x-tc-signature");

  if (!isFreshTimestamp(timestamp)) {
    return NextResponse.json({ ok: false, error: "stale_or_missing_timestamp" }, { status: 401 });
  }
  if (!verifyTimestampedSignature(secret, raw, timestamp, signature)) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  }
  const body = parsed.data;
  if (!body.phone && !body.email) {
    return NextResponse.json({ ok: false, error: "phone_or_email_required" }, { status: 400 });
  }

  try {
    const workspaceId = await resolveIntakeWorkspaceId();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspace_not_configured" }, { status: 503 });
    }

    const result = await acceptIntake({
      workspaceId,
      sourceChannel: "website",
      provider: "website",
      externalId: body.submission_id ?? "",
      idempotencyKey: buildIdempotencyKey({
        submissionId: body.submission_id,
        phone: body.phone,
        email: body.email,
        provider: "website",
      }),
      payload: body as unknown as Record<string, unknown>,
      fields: {
        name: body.name,
        phone: body.phone,
        email: body.email,
        company: body.company,
        interest: body.interest ?? body.message,
        area: body.area,
        notes: body.message,
        product_interest: body.product_interest,
        source_detail: body.utm_campaign ?? body.source_url,
      },
      occurredAt: body.occurred_at ?? null,
      formRef: body.source_url ?? null,
      rawText: body.message ?? null,
    });

    return NextResponse.json({ ok: true, lead_id: result.lead_id, duplicate: result.duplicate }, { status: 202 });
  } catch (e) {
    // Never leak internals to a public endpoint; the detail goes to the log.
    console.error("website intake failed", e);
    return NextResponse.json({ ok: false, error: "intake_failed" }, { status: 500 });
  }
}
