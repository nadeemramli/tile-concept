/**
 * TikTok lead-generation webhook (PRD §11.2).
 *
 * Same contract as the Meta route: verify the signature over the raw body,
 * accept durably through api.accept_intake, then acknowledge. Nothing
 * downstream happens inside the request.
 *
 * Required environment:
 *   TIKTOK_APP_SECRET       verifies the signature header over the raw body
 *   TIKTOK_VERIFY_TOKEN     answers the GET subscription challenge (optional)
 *   TC_INTAKE_WORKSPACE_ID  workspace to write into (optional when single)
 *
 * TikTok's signature header name has varied across API versions, so both
 * documented spellings are accepted and verified identically. Confirm the exact
 * header and body envelope against the developer console during rollout
 * (PRD §11.2 lists this as an implementation-time check).
 */
import { NextResponse, type NextRequest } from "next/server";
import { buildIdempotencyKey, takeToken, verifySignature } from "@/integrations/signature";
import { acceptIntake, mapProviderPayload, resolveIntakeWorkspaceId } from "@/integrations/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const verifyToken = process.env.TIKTOK_VERIFY_TOKEN;
  if (!verifyToken) return NextResponse.json({ ok: false, error: "connector_not_configured" }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get("challenge") ?? searchParams.get("hub.challenge");
  const token = searchParams.get("verify_token") ?? searchParams.get("hub.verify_token");
  if (token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ ok: false, error: "verification_failed" }, { status: 403 });
}

interface TikTokLead {
  lead_id?: string;
  form_id?: string;
  page_id?: string;
  create_time?: number;
  field_data?: { name?: string; values?: string[] }[];
  answers?: { field_name?: string; value?: string }[];
}

export async function POST(request: NextRequest) {
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "connector_not_configured" }, { status: 503 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!takeToken(`tiktok:${ip}`, 60, 2)) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const raw = await request.text();
  const presented =
    request.headers.get("x-tt-signature") ??
    request.headers.get("x-tiktok-signature") ??
    request.headers.get("x-hub-signature-256");
  if (!verifySignature(secret, raw, presented)) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let body: { data?: TikTokLead[]; leads?: TikTokLead[]; lead?: TikTokLead };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const leads = body.data ?? body.leads ?? (body.lead ? [body.lead] : []);

  try {
    const workspaceId = await resolveIntakeWorkspaceId();
    if (!workspaceId) return NextResponse.json({ ok: false, error: "workspace_not_configured" }, { status: 503 });

    let accepted = 0;
    for (const lead of leads) {
      const payload = lead as unknown as Record<string, unknown>;
      const { fields, unmapped } = await mapProviderPayload(workspaceId, "tiktok", payload, lead.form_id ?? null);
      await acceptIntake({
        workspaceId,
        sourceChannel: "tiktok",
        provider: "tiktok",
        externalId: lead.lead_id ?? "",
        idempotencyKey: buildIdempotencyKey({
          submissionId: lead.lead_id,
          phone: fields.phone,
          email: fields.email,
          provider: "tiktok",
          occurredAtMs: lead.create_time ? lead.create_time * 1000 : undefined,
        }),
        payload: { ...payload, __unmapped: unmapped },
        fields,
        occurredAt: lead.create_time ? new Date(lead.create_time * 1000).toISOString() : null,
        formRef: lead.form_id ?? null,
      });
      accepted += 1;
    }
    return NextResponse.json({ ok: true, accepted }, { status: 200 });
  } catch (e) {
    console.error("tiktok webhook failed", e);
    return NextResponse.json({ ok: false, error: "intake_failed" }, { status: 500 });
  }
}
