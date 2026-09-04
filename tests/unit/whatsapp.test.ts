import { describe, expect, it } from "vitest";

import { buildFeedbackWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

describe("feedback WhatsApp handoff", () => {
  it("invites an honest, optional review without making a benefit conditional", () => {
    const message = buildFeedbackWhatsAppMessage({
      firstName: "Alya Hassan",
      secureLink: "https://example.test/review/private-token",
    });

    expect(message).toContain("Hi Alya");
    expect(message).toContain("https://example.test/review/private-token");
    expect(message).toContain("honest review");
    expect(message).toContain("Google review is optional");
    expect(message).toContain("does not affect");
    expect(message.toLowerCase()).not.toContain("positive review");
    expect(message.toLowerCase()).not.toContain("five star");
  });

  it("builds an encoded wa.me link for a normalized Malaysian number", () => {
    const url = buildWhatsAppUrl("012-345 6789", "Private feedback link: https://example.test/review/a");

    expect(url).toBe(
      "https://wa.me/60123456789?text=Private%20feedback%20link%3A%20https%3A%2F%2Fexample.test%2Freview%2Fa",
    );
  });
});
