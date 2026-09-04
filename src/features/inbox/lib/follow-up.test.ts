import { describe, expect, it } from "vitest";
import { FOLLOW_UP_OPTIONS, followUpDueAt, followUpTaskTitle } from "./follow-up";

describe("followUpDueAt", () => {
  it("lands on 09:00 Asia/Kuala_Lumpur on the target day", () => {
    // 2026-09-04T10:00Z is 18:00 in KL; 3 days later at 09:00 KL is 01:00 UTC.
    expect(followUpDueAt(3, new Date("2026-09-04T10:00:00Z"))).toBe("2026-09-07T01:00:00.000Z");
  });

  it("uses the KL calendar day, not the UTC one, around midnight", () => {
    // 16:30Z is already 00:30 the NEXT day in KL, so "tomorrow" is Sep 6 KL.
    expect(followUpDueAt(1, new Date("2026-09-04T16:30:00Z"))).toBe("2026-09-06T01:00:00.000Z");
  });

  it("defaults to the 3-day option", () => {
    expect(FOLLOW_UP_OPTIONS.find((o) => o.emphasized)?.days).toBe(3);
  });
});

describe("followUpTaskTitle", () => {
  it("prefers the name, then company, then a masked phone, and never comes out empty", () => {
    expect(followUpTaskTitle({ raw_name: "Aisha", raw_company: null, raw_phone_normalized: null })).toBe("Follow up with Aisha");
    expect(followUpTaskTitle({ raw_name: null, raw_company: "Acme Sdn Bhd", raw_phone_normalized: null })).toBe("Follow up with Acme Sdn Bhd");
    const masked = followUpTaskTitle({ raw_name: null, raw_company: null, raw_phone_normalized: "+60123456789" });
    expect(masked).toContain("Follow up with ");
    expect(masked).not.toContain("123456");
    expect(followUpTaskTitle({ raw_name: null, raw_company: null, raw_phone_normalized: null })).toBe("Follow up with lead");
  });
});
