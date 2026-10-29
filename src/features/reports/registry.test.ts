import { describe, expect, it } from "vitest";
import { GRAINS, REPORTS, reportRowKey, resolveGrain } from "./registry";

describe("report registry", () => {
  it("has unique slugs and a first column on every report", () => {
    const slugs = REPORTS.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const r of REPORTS) expect(r.columns.length).toBeGreaterThan(0);
  });

  it("only offers grains it can resolve, with the default among them", () => {
    for (const r of REPORTS.filter((r) => r.grain)) {
      expect(r.grain!.options).toContain(r.grain!.default);
      for (const g of r.grain!.options) expect(GRAINS).toContain(g);
      // A grained report must render its bucket, or the grain toggle changes nothing visible.
      expect(r.columns.some((c) => c.format === "period")).toBe(true);
    }
  });

  it("explains every column of the walk-in collection reports", () => {
    for (const slug of ["walkins-by-person", "walkins-period"] as const) {
      const def = REPORTS.find((r) => r.slug === slug)!;
      for (const c of def.columns) expect(c.description, `${slug}.${c.key}`).toBeTruthy();
    }
  });

  it("falls back to the default grain for unknown or missing requests", () => {
    const period = REPORTS.find((r) => r.slug === "walkins-period")!;
    expect(resolveGrain(period, undefined)).toBe("week");
    expect(resolveGrain(period, "fortnight")).toBe("week");
    expect(resolveGrain(period, "day")).toBe("day");
    const walkins = REPORTS.find((r) => r.slug === "walkins")!;
    expect(resolveGrain(walkins, "day")).toBeUndefined();
  });

  it("keys per-person rows by period and person so two people on one day never collide", () => {
    const def = REPORTS.find((r) => r.slug === "walkins-by-person")!;
    const a = reportRowKey(def, { period_start: "2026-03-09", person_id: "p1" });
    const b = reportRowKey(def, { period_start: "2026-03-09", person_id: null });
    expect(a).not.toBe(b);
  });
});
