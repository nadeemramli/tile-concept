import { describe, expect, it } from "vitest";
import { reportPeriodSchema, rate } from "@/features/reports/funnel-schema";
import { spendSchema } from "@/features/marketing/spend-schema";
describe("reporting input boundaries", () => {
  const period = { from: "2026-08-01", to: "2026-08-31", asof: "2026-09-01" };
  it("keeps later cohort outcomes distinct from the business period", () => expect(reportPeriodSchema.parse(period).asof).toBe("2026-09-01"));
  it("refuses outcomes before the cohort finishes", () => expect(reportPeriodSchema.safeParse({ ...period, asof: "2026-08-01" }).success).toBe(false));
  it("refuses invalid calendar dates", () => expect(reportPeriodSchema.safeParse({ ...period, from: "2026-02-30" }).success).toBe(false));
  it("refuses unbounded reporting periods", () => expect(reportPeriodSchema.safeParse({ ...period, from: "2020-01-01" }).success).toBe(false));
  it("never represents a missing denominator as zero conversion", () => { expect(rate(0, 0)).toBe("N/A"); expect(rate(0, 10)).toBe("0.0%"); });
});
describe("explicit cost money", () => {
  const cost = { action: "save", request_id: "11111111-1111-1111-1111-111111111111", before_tax: "100.00", tax: "0" };
  it("accepts explicit zero tax and valid PostgreSQL UUIDs", () => expect(spendSchema.parse(cost).tax).toBe(0));
  it("does not silently interpret empty tax as zero", () => expect(spendSchema.safeParse({ ...cost, tax: "" }).success).toBe(false));
  it("refuses non-finite and fractional-cent costs", () => { for (const before_tax of ["NaN", "Infinity", "2.005", -1]) expect(spendSchema.safeParse({ ...cost, before_tax }).success).toBe(false); });
});
