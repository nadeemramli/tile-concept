import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelative } from "@/lib/format";
import { followUpRelative } from "./follow-up-time";

const NOW = Date.parse("2026-10-29T08:00:00.000Z");
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Both sides of every wording boundary: just now, seconds, minutes, hours, days, months, years.
const OFFSETS = [0, 1, 44_999, 45_000, 51 * SECOND, 52 * SECOND, 59 * SECOND, 89_500, 149_499, 149_500, 59 * MINUTE, 90 * MINUTE, 23 * HOUR, 36 * HOUR, 3 * DAY, 45 * DAY, 400 * DAY]
  .flatMap((ms) => [ms, -ms]);

afterEach(() => vi.useRealTimers());

describe("Projects follow-up relative time (TILE-90)", () => {
  it.each(OFFSETS)("offset %i ms: the same wording as formatRelative at that moment", (offset) => {
    const value = new Date(NOW + offset).toISOString();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    expect(followUpRelative(value, NOW)).toBe(formatRelative(value));
  });

  it("is measured from the reference time it is given, not the current clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + 10 * MINUTE);
    const value = new Date(NOW - 51 * SECOND).toISOString();
    expect(followUpRelative(value, NOW)).toBe("51 seconds ago");
    expect(followUpRelative(value, NOW + 1_000)).toBe("52 seconds ago");
  });

  it("shows the shared dash for a missing or unparseable value", () => {
    for (const value of [null, undefined, "", "not-a-date"]) {
      expect(followUpRelative(value, NOW)).toBe("—");
      expect(followUpRelative(value, NOW)).toBe(formatRelative(value));
    }
  });
});
