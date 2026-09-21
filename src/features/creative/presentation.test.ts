import { describe, expect, it } from "vitest";
import { creativeCalendarRange, creativeWeekPreset, creativeHref } from "./presentation";

describe("creative date planning", () => {
  it("uses Monday to Sunday for next week across a year boundary", () => {
    expect(creativeWeekPreset("2026-12-31", 1)).toEqual({ from: "2027-01-04", to: "2027-01-11" });
  });
  it("keeps a selected month and year with an exclusive end", () => {
    expect(creativeCalendarRange("2028-02-17", "month")).toEqual({ from: "2028-02-01", to: "2028-03-01" });
    expect(creativeCalendarRange("2026-09-21", "week")).toEqual({ from: "2026-09-21", to: "2026-09-28" });
  });
  it("preserves filters when opening or closing a record", () => {
    const opened = creativeHref("view=calendar&anchor=2027-01-01&owner=person", { creative: "item" });
    expect(opened).toContain("owner=person&creative=item");
    expect(creativeHref(opened.split("?")[1], { creative: null })).toBe("/marketing/creative?view=calendar&anchor=2027-01-01&owner=person");
  });
});
