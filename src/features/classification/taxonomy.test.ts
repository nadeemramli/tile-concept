import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_DIMENSIONS,
  CLASSIFICATION_OPTIONS,
  CONTACT_CUSTOMER_TYPES,
  UNKNOWN_CLASSIFICATION,
  changedKnownDimensions,
  classificationKey,
  missingDimensions,
} from "./taxonomy";
import { classifyPursuitSchema } from "./schema";
import { newInquirySchema } from "@/features/inbox/schema";
import { walkInSchema } from "@/features/walkins/schema";

const MIGRATION = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261029160000_pursuit_classification.sql"), "utf8");

/** The rows the migration inserts into core.classification_values, parsed back out. */
function sqlRows() {
  const block = MIGRATION.slice(MIGRATION.indexOf("insert into core.classification_values"), MIGRATION.indexOf("create or replace view api.classification_values"));
  const row = /\('(\w+)','(\w+)','((?:[^']|'')*)','((?:[^']|'')*)','(\w+)',(true|false),(true|false),array\[([^\]]*)\](?:::text\[\])?,(\d+)\)/g;
  return [...block.matchAll(row)].map((m) => ({
    dimension: m[1],
    key: m[2],
    label: m[3].replace(/''/g, "'"),
    hint: m[4].replace(/''/g, "'"),
    group: m[5],
    primary: m[6] === "true",
    legacy: m[7] === "true",
    aliases: m[8] ? m[8].split(",").map((a) => a.trim().replace(/^'|'$/g, "")) : [],
    position: Number(m[9]),
  }));
}

describe("classification taxonomy mirrors core.classification_values", () => {
  const rows = sqlRows();

  it("parses every database row", () => {
    expect(rows.length).toBe(CLASSIFICATION_DIMENSIONS.reduce((n, d) => n + CLASSIFICATION_OPTIONS[d].length, 0));
  });

  it.each(CLASSIFICATION_DIMENSIONS)("%s matches key, label, hint, aliases, order and flags", (d) => {
    const db = rows.filter((r) => r.dimension === d).sort((a, b) => a.position - b.position);
    expect(db.map((r) => ({ key: r.key, label: r.label, hint: r.hint, primary: r.primary, legacy: r.legacy, aliases: r.aliases }))).toEqual(
      CLASSIFICATION_OPTIONS[d].map((o) => ({ key: o.key, label: o.label, hint: o.hint, primary: o.primary, legacy: o.legacy, aliases: [...o.aliases] })),
    );
    // Reporting groups never fold one value into another.
    for (const r of db) expect(r.group).toBe(r.key);
  });

  it("keeps end user, contractor, interior designer, other and unknown as the primary buyer roles", () => {
    expect(CLASSIFICATION_OPTIONS.buyer_role.filter((o) => !o.legacy).map((o) => o.key)).toEqual(["end_user", "contractor", "interior_designer", "other", "unknown"]);
    expect(CLASSIFICATION_OPTIONS.buyer_role.filter((o) => o.legacy).map((o) => o.key)).toEqual(["developer", "architect", "retailer"]);
  });

  it("gives every dimension an explicit Unknown and every value a hint", () => {
    for (const d of CLASSIFICATION_DIMENSIONS) {
      expect(CLASSIFICATION_OPTIONS[d].some((o) => o.key === "unknown")).toBe(true);
      for (const o of CLASSIFICATION_OPTIONS[d]) expect(o.hint.trim(), `${d}.${o.key}`).not.toBe("");
    }
  });

  it("never maps one source spelling to two values of a dimension", () => {
    for (const d of CLASSIFICATION_DIMENSIONS) {
      const spellings = CLASSIFICATION_OPTIONS[d].flatMap((o) => o.aliases);
      expect(new Set(spellings).size, d).toBe(spellings.length);
    }
  });

  it("accepts the same person types as identity.contacts_customer_type_check", () => {
    const check = /contacts_customer_type_check check \(customer_type in\s*\(([^)]*)\)\)/.exec(MIGRATION)![1];
    expect([...CONTACT_CUSTOMER_TYPES].sort()).toEqual(check.split(",").map((s) => s.trim().replace(/'/g, "")).sort());
  });
});

describe("classificationKey follows core.classification_key", () => {
  it.each([
    ["buyer_role", "Home Owner", "end_user"],
    ["buyer_role", "homeowner", "end_user"],
    ["buyer_role", "Designer", "interior_designer"],
    ["buyer_role", "ID", "interior_designer"],
    ["buyer_role", "Interior_Designer", "interior_designer"],
    ["buyer_role", "Developer", "developer"],
    ["buyer_role", "Pemilik rumah", null],
    ["buyer_role", "Interior Design firm", null],
    ["buyer_role", "", null],
    ["work_type", "New-Build", "new_build"],
    ["project_use", "Mixed Use", "mixed"],
    ["glc_involvement", "GLC", "yes"],
  ] as const)("%s %j → %j", (d, raw, key) => {
    expect(classificationKey(d, raw)).toBe(key);
  });
});

describe("pursuit completeness", () => {
  it("lists what is still unknown, including the GLC party role only when a GLC is involved", () => {
    expect(missingDimensions(UNKNOWN_CLASSIFICATION)).toEqual(["buyer_role", "project_use", "work_type", "glc_involvement"]);
    const glc = { buyer_role: "contractor", project_use: "commercial", work_type: "renovation", glc_involvement: "yes", glc_party_role: "unknown" };
    expect(missingDimensions(glc)).toEqual(["glc_party_role"]);
    expect(missingDimensions({ ...glc, glc_party_role: "end_client" })).toEqual([]);
  });

  it("treats only a change to a known value as a correction", () => {
    const cur = { buyer_role: "contractor", project_use: "unknown", work_type: "renovation", glc_involvement: "no", glc_party_role: null };
    expect(changedKnownDimensions(cur, { ...cur, project_use: "residential" })).toEqual([]);
    expect(changedKnownDimensions(cur, { ...cur, buyer_role: "interior_designer", work_type: "unknown" })).toEqual(["buyer_role", "work_type"]);
  });
});

describe("shared validation", () => {
  const values = { buyer_role: "contractor", project_use: "commercial", work_type: "renovation", glc_involvement: "no", glc_party_role: null };
  const base = { request_id: "eeeeeeee-2410-0000-0000-000000000001", mode: "correction" as const, expected_version: 1, values };

  it("classifies exactly one of the inquiry or the opportunity", () => {
    expect(classifyPursuitSchema.safeParse({ ...base, lead_id: "eeeeeeee-2410-0000-0000-000000000002" }).success).toBe(true);
    expect(classifyPursuitSchema.safeParse(base).success).toBe(false);
    expect(classifyPursuitSchema.safeParse({ ...base, lead_id: "eeeeeeee-2410-0000-0000-000000000002", opportunity_id: "eeeeeeee-2410-0000-0000-000000000003" }).success).toBe(false);
  });

  it("refuses unlisted values and a GLC party role without a GLC", () => {
    const lead = { lead_id: "eeeeeeee-2410-0000-0000-000000000002" };
    expect(classifyPursuitSchema.safeParse({ ...base, ...lead, values: { ...values, buyer_role: "homeowner" } }).success).toBe(false);
    expect(classifyPursuitSchema.safeParse({ ...base, ...lead, values: { ...values, glc_party_role: "developer" } }).success).toBe(false);
    expect(classifyPursuitSchema.safeParse({ ...base, ...lead, values: { ...values, glc_involvement: "yes", glc_party_role: "developer" } }).success).toBe(true);
  });

  it("lets a raw inquiry save with Unknown values and refuses a future arrival", () => {
    const inquiry = { source_channel: "whatsapp", raw_name: "Synthetic", product_interest: [], buyer_role: "unknown", project_use: "unknown", work_type: "unknown", glc_involvement: "unknown" };
    expect(newInquirySchema.safeParse(inquiry).success).toBe(true);
    expect(newInquirySchema.safeParse({ ...inquiry, arrived_at: "2026-01-05T09:30" }).success).toBe(true);
    expect(newInquirySchema.safeParse({ ...inquiry, arrived_at: "2999-01-05T09:30" }).success).toBe(false);
    expect(newInquirySchema.safeParse({ ...inquiry, buyer_role: "homeowner" }).success).toBe(false);
  });

  it("states a visit's buyer role from the taxonomy, with no invented default", () => {
    const visit = { request_id: "eeeeeeee-2410-0000-0000-000000000001", contact_id: "eeeeeeee-2410-0000-0000-000000000004", occurred_at: "2026-10-01T10:00:00+08:00", purpose: "browse" };
    const parsed = walkInSchema.parse(visit);
    expect(parsed.customer_type).toBeUndefined();
    expect(walkInSchema.safeParse({ ...visit, customer_type: "interior_designer" }).success).toBe(true);
    expect(walkInSchema.safeParse({ ...visit, customer_type: "homeowner" }).success).toBe(false);
  });
});
