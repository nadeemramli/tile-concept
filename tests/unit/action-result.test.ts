import { describe, expect, it } from "vitest";
import { humanizeDbError } from "@/server/action-result";

describe("humanizeDbError", () => {
  it("names the role for a permission-key refusal instead of a generic sentence", () => {
    expect(humanizeDbError("permission denied: marketing.confirm")).toMatch(/marketing coordinators/);
  });

  it("keeps the database's sentence when the key is embedded in it", () => {
    const out = humanizeDbError("permission denied: confirming crew capacity requires marketing.confirm");
    expect(out).toMatch(/^Confirming crew capacity requires marketing\.confirm\./);
    expect(out).toMatch(/marketing coordinators/);
  });

  it("explains ownership refusals", () => {
    expect(humanizeDbError("permission denied: not the owner")).toMatch(/owner of this record/);
  });

  it("says whose permission a media gate is about and where to record it", () => {
    const out = humanizeDbError("customer media permission is not approved for this project");
    expect(out).toMatch(/^Customer media permission is not approved for this project\./);
    expect(out).toMatch(/Content Opportunities/);
  });

  it("leaves unknown messages alone", () => {
    expect(humanizeDbError("a checksum is required so re-imports can be detected")).toBe("a checksum is required so re-imports can be detected");
  });

  it("still maps the classic cases", () => {
    expect(humanizeDbError("not authenticated")).toMatch(/session has expired/);
    expect(humanizeDbError("duplicate key value violates unique constraint")).toMatch(/already exists/);
    expect(humanizeDbError("new row violates row-level security policy")).toMatch(/access scope/);
    expect(humanizeDbError("P0001: merge reason required")).toBe("Merge reason required.");
  });
});
