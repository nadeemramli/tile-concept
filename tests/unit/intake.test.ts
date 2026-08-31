import { describe, expect, it, beforeEach } from "vitest";
import {
  buildIdempotencyKey,
  hmacHex,
  isFreshTimestamp,
  resetRateLimiter,
  signPayload,
  takeToken,
  verifySignature,
  verifyTimestampedSignature,
} from "@/integrations/signature";
import { applyMappings, flatten } from "@/integrations/mapping";
import { buildAutomationSourceDetail, buildLeadAlertText, buildLeadInboxUrl, sourceChannelFor } from "@/integrations/automation-intake";
import { buildLeadWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

const SECRET = "test-secret-value";

describe("signature verification", () => {
  const body = JSON.stringify({ name: "Aisyah", phone: "+60123456789" });

  it("accepts a correct signature", () => {
    expect(verifySignature(SECRET, body, `sha256=${hmacHex(SECRET, body)}`)).toBe(true);
    // bare hex is accepted too
    expect(verifySignature(SECRET, body, hmacHex(SECRET, body))).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifySignature(SECRET, body, `sha256=${hmacHex("other-secret", body)}`)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = `sha256=${hmacHex(SECRET, body)}`;
    const tampered = JSON.stringify({ name: "Aisyah", phone: "+60129999999" });
    expect(verifySignature(SECRET, tampered, signature)).toBe(false);
  });

  it("rejects a missing, malformed, or wrong-length signature", () => {
    expect(verifySignature(SECRET, body, null)).toBe(false);
    expect(verifySignature(SECRET, body, "sha256=not-hex")).toBe(false);
    expect(verifySignature(SECRET, body, "sha256=abcd")).toBe(false);
    expect(verifySignature("", body, `sha256=${hmacHex(SECRET, body)}`)).toBe(false);
  });
});

describe("timestamp freshness", () => {
  const now = 1_700_000_000_000;

  it("accepts a timestamp inside the window, in seconds or milliseconds", () => {
    expect(isFreshTimestamp(String(Math.floor(now / 1000)), now)).toBe(true);
    expect(isFreshTimestamp(String(now), now)).toBe(true);
    expect(isFreshTimestamp(String(Math.floor(now / 1000) - 120), now)).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    expect(isFreshTimestamp(String(Math.floor(now / 1000) - 600), now)).toBe(false);
  });

  it("rejects a missing or non-numeric timestamp", () => {
    expect(isFreshTimestamp(null, now)).toBe(false);
    expect(isFreshTimestamp("yesterday", now)).toBe(false);
  });
});

describe("timestamped signature (website endpoint)", () => {
  const body = JSON.stringify({ submission_id: "abc", phone: "+60123456789" });

  it("accepts a payload signed with its own timestamp", () => {
    const signed = signPayload(SECRET, body, "1700000000");
    expect(verifyTimestampedSignature(SECRET, body, signed.timestamp, signed.signature)).toBe(true);
  });

  it("rejects a swapped timestamp, because the timestamp is inside the signed string", () => {
    const signed = signPayload(SECRET, body, "1700000000");
    expect(verifyTimestampedSignature(SECRET, body, "1700000600", signed.signature)).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    const signed = signPayload(SECRET, body, "1700000000");
    expect(verifyTimestampedSignature(SECRET, body, null, signed.signature)).toBe(false);
  });
});

describe("idempotency key", () => {
  const at = 1_700_000_000_000;

  it("is stable for the same submission id", () => {
    const a = buildIdempotencyKey({ submissionId: "sub-1", provider: "website" });
    const b = buildIdempotencyKey({ submissionId: "sub-1", provider: "website", phone: "+60123456789" });
    expect(a).toBe(b);
  });

  it("differs for different submission ids", () => {
    expect(buildIdempotencyKey({ submissionId: "sub-1", provider: "website" })).not.toBe(buildIdempotencyKey({ submissionId: "sub-2", provider: "website" }));
  });

  it("is stable for the same identity within the same minute, without a submission id", () => {
    const a = buildIdempotencyKey({ provider: "meta", phone: "+60123456789", occurredAtMs: at });
    const b = buildIdempotencyKey({ provider: "meta", phone: "+60123456789", occurredAtMs: at + 5_000 });
    expect(a).toBe(b);
  });

  it("differs once the minute rolls over, so a genuine later enquiry is not swallowed", () => {
    const a = buildIdempotencyKey({ provider: "meta", phone: "+60123456789", occurredAtMs: at });
    const b = buildIdempotencyKey({ provider: "meta", phone: "+60123456789", occurredAtMs: at + 3_600_000 });
    expect(a).not.toBe(b);
  });

  it("differs across providers and identities", () => {
    const at2 = at;
    expect(buildIdempotencyKey({ provider: "meta", phone: "+60123456789", occurredAtMs: at2 })).not.toBe(
      buildIdempotencyKey({ provider: "tiktok", phone: "+60123456789", occurredAtMs: at2 }),
    );
    expect(buildIdempotencyKey({ provider: "meta", phone: "+60123456789", occurredAtMs: at2 })).not.toBe(
      buildIdempotencyKey({ provider: "meta", phone: "+60127777777", occurredAtMs: at2 }),
    );
  });
});

describe("rate limiter", () => {
  beforeEach(() => resetRateLimiter());

  it("allows a burst up to capacity then refuses", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) expect(takeToken("ip-a", 5, 0.5, now)).toBe(true);
    expect(takeToken("ip-a", 5, 0.5, now)).toBe(false);
  });

  it("refills over time and keys are independent", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) takeToken("ip-a", 5, 0.5, now);
    expect(takeToken("ip-a", 5, 0.5, now)).toBe(false);
    expect(takeToken("ip-b", 5, 0.5, now)).toBe(true);
    expect(takeToken("ip-a", 5, 0.5, now + 4000)).toBe(true);
  });
});

describe("provider payload mapping", () => {
  it("flattens Meta-style field_data into key/value pairs", () => {
    const flat = flatten({
      leadgen_id: "123",
      field_data: [
        { name: "full_name", values: ["Aisyah Rahman"] },
        { name: "phone_number", values: ["+60123456789"] },
      ],
    });
    expect(flat.full_name).toBe("Aisyah Rahman");
    expect(flat.phone_number).toBe("+60123456789");
    expect(flat.leadgen_id).toBe("123");
  });

  it("maps provider questions onto canonical fields and keeps unmapped ones", () => {
    const { fields, unmapped } = applyMappings(
      {
        field_data: [
          { name: "full_name", values: ["Aisyah Rahman"] },
          { name: "phone_number", values: ["+60123456789"] },
          { name: "how_did_you_hear", values: ["A friend"] },
        ],
      },
      [
        { source_field: "full_name", target_field: "name" },
        { source_field: "phone_number", target_field: "phone" },
      ],
    );
    expect(fields.name).toBe("Aisyah Rahman");
    expect(fields.phone).toBe("+60123456789");
    // No mapping and no fallback: preserved rather than dropped.
    expect(unmapped.how_did_you_hear).toBe("A friend");
  });

  it("derives product interest from an interest sentence", () => {
    const { fields } = applyMappings({ what_are_you_looking_for: "Wall panel for the living room" }, [
      { source_field: "what_are_you_looking_for", target_field: "interest" },
    ]);
    expect(fields.interest).toBe("Wall panel for the living room");
    expect(fields.product_interest).toContain("wall_panel");
  });

  it("honours an explicit ignore mapping", () => {
    const { fields, unmapped } = applyMappings({ full_name: "Aisyah", internal_ref: "xyz" }, [
      { source_field: "full_name", target_field: "name" },
      { source_field: "internal_ref", target_field: "ignore" },
    ]);
    expect(fields.name).toBe("Aisyah");
    expect(unmapped.internal_ref).toBeUndefined();
  });
});

describe("normalized automation intake", () => {
  it("keeps social reporting stable while preserving the exact Meta platform", () => {
    expect(sourceChannelFor("facebook")).toBe("meta");
    expect(sourceChannelFor("instagram")).toBe("meta");
    expect(sourceChannelFor("threads")).toBe("meta");
    expect(sourceChannelFor("tiktok")).toBe("tiktok");
    expect(
      buildAutomationSourceDetail({
        source: "instagram",
        campaign_name: "Showroom September",
        form_name: "Tile Consultation",
      }),
    ).toBe("Instagram · Campaign: Showroom September · Form: Tile Consultation");
  });

  it("builds a directly addressable inbox URL for n8n alerts", () => {
    expect(buildLeadInboxUrl("https://os.tileconcept.example", "lead-123")).toBe(
      "https://os.tileconcept.example/sales/inbox?view=all&lead=lead-123",
    );
  });

  it("builds a WhatsApp deep link with a pre-filled, editable message", () => {
    const message = buildLeadWhatsAppMessage({ name: "Aisyah Rahman", interest: "kitchen tiles", source: "TikTok" });
    const url = buildWhatsAppUrl("012-345 6789", message);
    expect(message).toContain("Hi Aisyah");
    expect(message).toContain("kitchen tiles");
    expect(url).toMatch(/^https:\/\/wa\.me\/60123456789\?text=/);
    expect(decodeURIComponent(url!.split("text=")[1])).toBe(message);
  });

  it("returns no WhatsApp action when a lead has no valid phone", () => {
    expect(buildWhatsAppUrl(null, "Hello")).toBeNull();
  });

  it("returns alert text that n8n can send to the sales group", () => {
    const text = buildLeadAlertText({
      source: "tiktok",
      name: "Aisyah",
      interest: "mosaic",
      leadUrl: "https://os.tileconcept.example/sales/inbox?lead=lead-123",
      whatsappUrl: "https://wa.me/60123456789",
    });
    expect(text).toContain("New TikTok lead: Aisyah — mosaic");
    expect(text).toContain("Open lead:");
    expect(text).toContain("Message on WhatsApp:");
  });
});
