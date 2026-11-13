import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelative, isOverdue } from "@/lib/format";
import { dueLabel, isDuePast } from "./due";

const NOW = Date.parse("2026-10-29T08:00:00.000Z");
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Both sides of every wording boundary: just now, seconds, minutes, hours, days, months, years.
const OFFSETS = [0, 1, 44_999, 45_000, 59 * SECOND, 89_500, 149_499, 149_500, 150_500, 59 * MINUTE, 90 * MINUTE, 23 * HOUR, 36 * HOUR, 3 * DAY, 45 * DAY, 400 * DAY]
  .flatMap((ms) => [ms, -ms]);

afterEach(() => vi.useRealTimers());

describe("Tasks Due label", () => {
  it.each(OFFSETS)("offset %i ms: same wording and overdue result as the shared formatters at that moment", (offset) => {
    const due = new Date(NOW + offset).toISOString();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    expect(dueLabel(due, NOW)).toBe(formatRelative(due));
    expect(isDuePast(due, NOW)).toBe(isOverdue(due));
  });

  it("is measured from the reference time it is given, not the current clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + 10 * MINUTE);
    const due = new Date(NOW - 149_500).toISOString();
    expect(dueLabel(due, NOW)).toBe("2 minutes ago");
    expect(dueLabel(due, NOW + 1_000)).toBe("3 minutes ago");
  });

  it("treats the exact due instant as not yet overdue, and one millisecond later as overdue", () => {
    const due = new Date(NOW).toISOString();
    expect(isDuePast(due, NOW)).toBe(false);
    expect(isDuePast(due, NOW + 1)).toBe(true);
  });

  it("shows a dash and never overdue for an unparseable value", () => {
    expect(dueLabel("not-a-date", NOW)).toBe("—");
    expect(isDuePast("not-a-date", NOW)).toBe(false);
  });
});
