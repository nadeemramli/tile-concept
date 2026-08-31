/**
 * Normalized intake for n8n running on the Tile Concept Hetzner server.
 *
 * n8n fetches provider forms, maps them to this stable contract, signs the raw
 * request, posts it here, then uses notification_text for the WhatsApp group.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { PRODUCT_INTERESTS } from "@/features/inbox/schema";
import { buildIdempotencyKey, isFreshTimestamp, takeToken, verifyTimestampedSignature } from "@/integrations/signature";
import { acceptIntake, resolveIntakeWorkspaceId } from "@/integrations/intake";
import { AUTOMATION_SOURCES, buildAutomationSourceDetail, buildLeadAlertText, buildLeadInboxUrl, sourceChannelFor } from "@/integrations/automation-intake";
import { buildLeadWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    submission_id: z.string().trim().min(1).max(200),
    source: z.enum(AUTOMATION_SOURCES),
    name: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(60).optional(),
    email: z.string().trim().email().max(200).optional(),
    company: z.string().trim().max(200).optional(),
    message: z.string().trim().max(4000).optional(),
    interest: z.string().trim().max(500).optional(),
    area: z.string().trim().max(120).optional(),
    product_interest: z.array(z.enum(PRODUCT_INTERESTS)).max(12).optional(),
    occurred_at: z.string().datetime({ offset: true }).optional(),
    source_detail: z.string().trim().max(500).optional(),
    form_id: z.string().trim().max(200).optional(),
    form_name: z.string().trim().max(200).optional(),
    campaign_id: z.string().trim().max(200).optional(),
    campaign_name: z.string().trim().max(200).optional(),
    ad_id: z.string().trim().max(200).optional(),
    ad_name: z.string().trim().max(200).optional(),
    page_id: z.string().trim().max(200).optional(),
    page_name: z.string().trim().max(200).optional(),
    consent_version: z.string().trim().max(60).optional(),
  })
  .refine((body) => Boolean(body.phone || body.email), { message: "phone_or_email_required", path: ["phone"] });

export async function POST(request: NextRequest) {
  const secret = process.env.N8N_INTAKE_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "connector_not_configured" }, { status: 503 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!takeToken(`automation:${ip}`, 120, 2)) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const raw = await request.text();
  const timestamp = request.headers.get("x-tc-timestamp");
  const signature = request.headers.get("x-tc-signature");
  if (!isFreshTimestamp(timestamp)) return NextResponse.json({ ok: false, error: "stale_or_missing_timestamp" }, { status: 401 });
  if (!verifyTimestampedSignature(secret, raw, timestamp, signature)) return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const phoneIssue = parsed.error.issues.some((issue) => issue.message === "phone_or_email_required");
    return NextResponse.json(
      { ok: false, error: phoneIssue ? "phone_or_email_required" : "invalid_body", issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
      { status: 400 },
    );
  }

  const body = parsed.data;
  try {
    const workspaceId = await resolveIntakeWorkspaceId();
    if (!workspaceId) return NextResponse.json({ ok: false, error: "workspace_not_configured" }, { status: 503 });

    const sourceDetail = buildAutomationSourceDetail(body);
    const result = await acceptIntake({
      workspaceId,
      sourceChannel: sourceChannelFor(body.source),
      provider: body.source,
      externalId: body.submission_id,
      idempotencyKey: buildIdempotencyKey({ submissionId: body.submission_id, phone: body.phone, email: body.email, provider: body.source }),
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
        source_detail: sourceDetail,
      },
      occurredAt: body.occurred_at ?? null,
      formRef: sourceDetail,
      rawText: body.message ?? null,
    });

    const leadUrl = result.lead_id ? buildLeadInboxUrl(publicEnv.appUrl, result.lead_id) : null;
    const whatsappUrl = buildWhatsAppUrl(
      body.phone,
      buildLeadWhatsAppMessage({ name: body.name, interest: body.interest, source: body.source }),
    );
    const notificationText = leadUrl
      ? buildLeadAlertText({ source: body.source, name: body.name, interest: body.interest, leadUrl, whatsappUrl })
      : null;

    return NextResponse.json(
      { ok: true, lead_id: result.lead_id, duplicate: result.duplicate, matched_contact_id: result.matched_contact_id ?? null, lead_url: leadUrl, whatsapp_url: whatsappUrl, notification_text: notificationText },
      { status: result.duplicate ? 200 : 202 },
    );
  } catch (error) {
    console.error("automation intake failed", error);
    return NextResponse.json({ ok: false, error: "intake_failed" }, { status: 500 });
  }
}
