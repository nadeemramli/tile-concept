import { formatDistanceToNowStrict } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelative } from "./format";

const NOW = Date.parse("2026-10-29T08:00:00.000Z");

// The implementation before `now` became a parameter, kept here as the oracle.
function previousFormatRelative(value: string) {
  const d = new Date(value);
  const diff = d.getTime() - Date.now();
  if (Math.abs(diff) < 45_000) return "just now";
  const s = formatDistanceToNowStrict(d, { addSuffix: false });
  return diff < 0 ? `${s} ago` : `in ${s}`;
}

const OFFSETS_MS = [0, 1_000, 44_999, 45_000, 57_000, 58_000, 59_499, 59_500, 90_000, 3_599_000, 3_600_000, 86_400_000, 30 * 86_400_000, 400 * 86_400_000];

describe("formatRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("without a reference time, matches the previous implementation for past and future times", () => {
    for (const ms of OFFSETS_MS) {
      for (const value of [new Date(NOW - ms).toISOString(), new Date(NOW + ms).toISOString()]) {
        expect(formatRelative(value), value).toBe(previousFormatRelative(value));
      }
    }
  });

  it("with a reference time, measures from it rather than the clock", () => {
    const value = new Date(NOW - 57_000).toISOString();
    vi.setSystemTime(NOW + 1_000);
    expect(formatRelative(value)).toBe("58 seconds ago");
    expect(formatRelative(value, NOW)).toBe("57 seconds ago");
    expect(formatRelative(new Date(NOW - 44_500).toISOString(), NOW)).toBe("just now");
    expect(formatRelative(new Date(NOW + 120_000).toISOString(), NOW)).toBe("in 2 minutes");
  });

  it("keeps the dash for missing and unparseable values", () => {
    expect(formatRelative(null, NOW)).toBe("—");
    expect(formatRelative(undefined)).toBe("—");
    expect(formatRelative("not-a-date", NOW)).toBe("—");
  });
});
