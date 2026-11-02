import { describe, expect, it } from "vitest";
import { enquiryDateInput, enquiryDateIso } from "./enquiry-date";
describe("Kuala Lumpur enquiry dates", () => {
  it("converts historical local time with an explicit +08 offset", () => {
    expect(enquiryDateIso("2026-10-24T13:10")).toBe("2026-10-24T05:10:00.000Z");
    expect(enquiryDateIso("2026-10-24T00:05")).toBe("2026-10-23T16:05:00.000Z");
  });
  it("preserves seconds and milliseconds when opening and saving an existing date", () => {
    const iso = "2026-10-24T05:10:37.123Z";
    expect(enquiryDateInput(iso)).toBe("2026-10-24T13:10:37.123");
    expect(enquiryDateIso(enquiryDateInput(iso))).toBe(iso);
  });
  it.each(["", "wrong", "2026-02-30T13:10", "2026-10-24T25:00", "2026-10-24T13:10Z"])("rejects invalid input %s", (input) => {
    expect(enquiryDateIso(input)).toBeNull();
  });
});
