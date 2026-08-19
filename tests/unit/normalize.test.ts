import { describe, expect, it } from "vitest";
import { extractFromText, normalizeEmail, normalizePhone, normalizeRegistrationNumber } from "@/lib/identity/normalize";

describe("normalizePhone", () => {
  it("normalizes Malaysian mobile formats to E.164", () => {
    expect(normalizePhone("012-345 6789")).toBe("+60123456789");
    expect(normalizePhone("0123456789")).toBe("+60123456789");
    expect(normalizePhone("+60 12 345 6789")).toBe("+60123456789");
    expect(normalizePhone("60123456789")).toBe("+60123456789");
  });
  it("returns null for empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("normalizeEmail / registration", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
  });
  it("strips punctuation from registration numbers", () => {
    expect(normalizeRegistrationNumber("2020 01-012345 (A)")).toBe("202001012345a");
  });
});

describe("extractFromText", () => {
  it("proposes phone, email, name from a pasted DM", () => {
    const r = extractFromText("Hi, my name is Aisyah Rahman. I want tiles for bathroom. Call me 012-3456789 or aisyah@example.test");
    expect(r.phone).toBe("012-3456789");
    expect(r.email).toBe("aisyah@example.test");
    expect(r.name).toBe("Aisyah Rahman");
  });
});
