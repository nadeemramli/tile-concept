import { describe, expect, it } from "vitest";
import { formatPeriod } from "./period";

describe("formatPeriod", () => {
  it("names the weekday for a daily bucket", () => {
    expect(formatPeriod("2026-03-09", "2026-03-09", "day")).toBe("Mon, 9 Mar 2026");
  });
  it("shows a Monday-to-Sunday range for a weekly bucket", () => {
    expect(formatPeriod("2026-03-09", "2026-03-15", "week")).toBe("9 – 15 Mar 2026");
    expect(formatPeriod("2026-03-30", "2026-04-05", "week")).toBe("30 Mar – 5 Apr 2026");
  });
  it("shows the month for a monthly bucket", () => {
    expect(formatPeriod("2026-03-01", "2026-03-31", "month")).toBe("Mar 2026");
  });
  it("falls back to the start date without a grain", () => {
    expect(formatPeriod("2026-03-09", null)).toBe("9 Mar 2026");
  });
});
