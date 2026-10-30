import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPETITOR_EVIDENCE, COMPETITOR_RELATIONSHIPS, OUTCOME_REASONS, type OutcomeType } from "@/lib/domain/outcome-reasons";
import { GLOSSARY } from "@/lib/domain/glossary";
import { LOSS_REASON, REJECTION_REASON, DEFERRAL_REASON } from "@/lib/domain/status-maps";

const MIGRATION = path.resolve(__dirname, "../../../supabase/migrations/20261029163000_pursuit_outcomes.sql");

/** The rows `core.outcome_reasons` is seeded with, read from the migration itself. */
function sqlReasons() {
  const sql = readFileSync(MIGRATION, "utf8");
  const block = sql.slice(sql.indexOf("insert into core.outcome_reasons"), sql.indexOf("alter table core.outcome_reasons"));
  const row = /\('(lost|rejected|deferred)','([a-z_]+)','((?:[^']|'')*)','((?:[^']|'')*)',(true|false),(true|false),(\d+)\)/g;
  return [...block.matchAll(row)].map((m) => ({
    type: m[1] as OutcomeType,
    key: m[2],
    label: m[3].replace(/''/g, "'"),
    hint: m[4].replace(/''/g, "'"),
    requiresDetail: m[5] === "true",
    isCompetitor: m[6] === "true",
    position: Number(m[7]),
  }));
}

describe("outcome reason taxonomy", () => {
  it("matches core.outcome_reasons exactly: keys, order, labels, hints and rules", () => {
    const fromSql = sqlReasons();
    expect(fromSql.length).toBe(21);
    const fromTs = (Object.keys(OUTCOME_REASONS) as OutcomeType[]).flatMap((type) =>
      OUTCOME_REASONS[type].map((r, i) => ({ type, key: r.key, label: r.label, hint: r.hint, requiresDetail: r.requiresDetail, isCompetitor: r.isCompetitor, position: i + 1 })),
    );
    expect(fromTs).toEqual(fromSql);
  });

  it("keeps Unknown explicit and makes Other require an explanation in every set", () => {
    for (const reasons of Object.values(OUTCOME_REASONS)) {
      expect(reasons.find((r) => r.key === "unknown")?.requiresDetail).toBe(false);
      expect(reasons.find((r) => r.key === "other")?.requiresDetail).toBe(true);
    }
  });

  it("separates qualification rejection, spam and duplicate from sales loss", () => {
    const lost = OUTCOME_REASONS.lost.map((r) => r.key);
    expect(lost).not.toContain("spam");
    expect(lost).not.toContain("duplicate");
    expect(OUTCOME_REASONS.rejected.map((r) => r.key)).toEqual(expect.arrayContaining(["spam", "duplicate", "test", "not_buying"]));
  });

  it("offers timing both as a deferral and as a genuine loss", () => {
    expect(OUTCOME_REASONS.deferred.some((r) => r.key === "timing")).toBe(true);
    expect(OUTCOME_REASONS.lost.some((r) => r.key === "timing")).toBe(true);
  });

  it("keeps competitor wording neutral and provisional", () => {
    const text = [...COMPETITOR_RELATIONSHIPS, ...COMPETITOR_EVIDENCE, ...OUTCOME_REASONS.lost].map((r) => `${r.label} ${r.hint}`).join(" ").toLowerCase();
    expect(COMPETITOR_RELATIONSHIPS.map((r) => r.key)).toEqual(["unknown", "none_reported", "reported"]);
    expect(COMPETITOR_RELATIONSHIPS.find((r) => r.key === "reported")?.label).toMatch(/provisional/i);
    // The undefined term may be quoted, but no option asserts a referral or customer relationship as its meaning.
    expect(OUTCOME_REASONS.lost.some((r) => r.key.includes("friendly"))).toBe(false);
    expect(text).not.toMatch(/refers? work to and from/);
    expect(text).toMatch(/not recorded as a referral partner or as a customer relationship/);
  });

  it("feeds the same lists to the status maps and Help & glossary", () => {
    expect(Object.keys(LOSS_REASON)).toEqual(OUTCOME_REASONS.lost.map((r) => r.key));
    expect(Object.keys(REJECTION_REASON)).toEqual(OUTCOME_REASONS.rejected.map((r) => r.key));
    expect(Object.keys(DEFERRAL_REASON)).toEqual(OUTCOME_REASONS.deferred.map((r) => r.key));
    const sales = GLOSSARY.find((g) => g.domain === "Sales")!;
    const ids = sales.entries.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["pursuit-outcome", "loss-reason", "rejection-reason", "deferral-reason", "competitor-relationship"]));
    expect(sales.entries.find((e) => e.id === "loss-reason")?.map).toBe(LOSS_REASON);
  });
});
