/**
 * Meta lead-ads webhook (PRD §11.2).
 *
 * Acknowledges only after durable acceptance: the payload is persisted through
 * api.accept_intake, then the route returns 200. No downstream work happens in
 * the request. A provider retry lands on the same idempotency key and produces
 * no second lead.
 *
 * Required environment:
 *   META_APP_SECRET         verifies x-hub-signature-256 over the raw body
 *   META_VERIFY_TOKEN       answers the GET subscription challenge
 *   TC_INTAKE_WORKSPACE_ID  workspace to write into (optional when single)
 *
 * Not yet implemented (needs approved app credentials, PRD §11.2): fetching the
 * full lead via the Graph API using `leadgen_id`. Until then the webhook body
 * itself is the evidence, and anything it does not carry stays unmapped for
 * review rather than being invented.
 */
import { NextResponse, type NextRequest } from "next/server";
import { buildIdempotencyKey, takeToken, verifySignature } from "@/integrations/signature";
import { acceptIntake, mapProviderPayload, resolveIntakeWorkspaceId } from "@/integrations/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) return NextResponse.json({ ok: false, error: "connector_not_configured" }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ ok: false, error: "verification_failed" }, { status: 403 });
}

interface LeadgenValue {
  leadgen_id?: string;
  form_id?: string;
  page_id?: string;
  created_time?: number;
  field_data?: { name?: string; values?: string[] }[];
}

export async function POST(request: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "connector_not_configured" }, { status: 503 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!takeToken(`meta:${ip}`, 60, 2)) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const raw = await request.text();
  if (!verifySignature(secret, raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let body: { entry?: { id?: string; time?: number; changes?: { field?: string; value?: LeadgenValue }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const workspaceId = await resolveIntakeWorkspaceId();
    if (!workspaceId) return NextResponse.json({ ok: false, error: "workspace_not_configured" }, { status: 503 });

    let accepted = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field && change.field !== "leadgen") continue;
        const value = change.value ?? {};
        const payload = value as unknown as Record<string, unknown>;
        const { fields, unmapped } = await mapProviderPayload(workspaceId, "meta", payload, value.form_id ?? null);
        await acceptIntake({
          workspaceId,
          sourceChannel: "meta",
          provider: "meta",
          externalId: value.leadgen_id ?? "",
          idempotencyKey: buildIdempotencyKey({
            submissionId: value.leadgen_id,
            phone: fields.phone,
            email: fields.email,
            provider: "meta",
            occurredAtMs: value.created_time ? value.created_time * 1000 : undefined,
          }),
          // Unmapped questions stay with the raw payload for review.
          payload: { ...payload, __unmapped: unmapped },
          fields,
          occurredAt: value.created_time ? new Date(value.created_time * 1000).toISOString() : null,
          formRef: value.form_id ?? null,
        });
        accepted += 1;
      }
    }
    return NextResponse.json({ ok: true, accepted }, { status: 200 });
  } catch (e) {
    console.error("meta webhook failed", e);
    // A 500 makes Meta retry, which our idempotency key handles safely.
    return NextResponse.json({ ok: false, error: "intake_failed" }, { status: 500 });
  }
}
