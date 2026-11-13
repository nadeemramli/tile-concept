import { describe, expect, it } from "vitest";
import { addWeeks, currentWeekStart, formatWeek, isWeekStart, klToday, parseWeekParam, weekEndOf, weekStartOf } from "./week";

describe("Kuala Lumpur forecast weeks", () => {
  it("rolls to the new week at Monday 00:00 local time, which is Sunday 16:00 UTC", () => {
    expect(currentWeekStart(new Date("2026-11-01T15:59:59Z"))).toBe("2026-10-26");
    expect(currentWeekStart(new Date("2026-11-01T16:00:00Z"))).toBe("2026-11-02");
  });

  it("uses the local date, not the UTC date", () => {
    expect(klToday(new Date("2026-10-28T16:30:00Z"))).toBe("2026-10-29");
    expect(klToday(new Date("2026-10-28T15:59:00Z"))).toBe("2026-10-28");
  });

  it("runs Monday to Sunday", () => {
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekEndOf("2026-11-02")).toBe("2026-11-08");
  });

  it("crosses month and year boundaries", () => {
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
    expect(addWeeks("2026-12-28", 1)).toBe("2027-01-04");
    expect(addWeeks("2026-11-02", -1)).toBe("2026-10-26");
    expect(formatWeek("2026-11-02")).toBe("2 – 8 Nov 2026");
    expect(formatWeek("2026-10-26")).toBe("26 Oct – 1 Nov 2026");
    expect(formatWeek("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
  });

  it("accepts only a real Monday from the URL", () => {
    const now = new Date("2026-10-29T04:00:00Z");
    expect(isWeekStart("2026-11-02")).toBe(true);
    expect(isWeekStart("2026-11-03")).toBe(false);
    expect(isWeekStart("2026-02-30")).toBe(false);
    expect(parseWeekParam("2026-11-02", now)).toBe("2026-11-02");
    expect(parseWeekParam("2026-11-03", now)).toBe("2026-10-26");
    expect(parseWeekParam(undefined, now)).toBe("2026-10-26");
    expect(parseWeekParam(["2026-11-02"], now)).toBe("2026-10-26");
  });
});
