import { describe, expect, it } from "vitest";
import { NO_ACCESS_COPY, toAccessState } from "./access-state";

describe("toAccessState", () => {
  it("accepts every state api.claim_my_invites() returns", () => {
    for (const s of ["active", "suspended", "unconfirmed", "none"]) expect(toAccessState(s)).toBe(s);
  });

  it("falls back to none for anything else, including a missing RPC result", () => {
    expect(toAccessState(undefined)).toBe("none");
    expect(toAccessState(null)).toBe("none");
    expect(toAccessState("admin")).toBe("none");
  });
});

describe("NO_ACCESS_COPY", () => {
  it("names the signed-in address and tells the user who can fix it", () => {
    for (const copy of Object.values(NO_ACCESS_COPY)) {
      const body = copy.body("someone@example.test");
      expect(body).toContain("someone@example.test");
      expect(copy.title.length).toBeGreaterThan(0);
    }
    expect(NO_ACCESS_COPY.none.body("x@example.test")).toMatch(/administrator/);
    expect(NO_ACCESS_COPY.suspended.body("x@example.test")).toMatch(/administrator/);
  });
});
