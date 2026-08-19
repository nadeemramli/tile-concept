import { describe, expect, it } from "vitest";
import { optionalUuid, uuid } from "@/lib/zod";

describe("uuid validator", () => {
  it("accepts any PostgreSQL uuid, including non-RFC-4122 fixture ids", () => {
    // zod's built-in .uuid() rejects these because the version/variant bits are
    // not RFC 4122 — but PostgreSQL stores and returns them happily.
    expect(uuid().safeParse("22222222-2222-2222-2222-222222222201").success).toBe(true);
    expect(uuid().safeParse("aaaaaaaa-0000-0000-0000-000000000001").success).toBe(true);
    expect(uuid().safeParse("3135edfc-107c-438b-8aca-a73f62ff3095").success).toBe(true);
  });
  it("rejects non-uuid strings", () => {
    expect(uuid().safeParse("not-a-uuid").success).toBe(false);
    expect(uuid().safeParse("").success).toBe(false);
    expect(uuid().safeParse("22222222-2222-2222-2222-2222222222011").success).toBe(false);
  });
  it("optionalUuid accepts an unset select value", () => {
    expect(optionalUuid().safeParse("").success).toBe(true);
    expect(optionalUuid().safeParse(undefined).success).toBe(true);
    expect(optionalUuid().safeParse("22222222-2222-2222-2222-222222222201").success).toBe(true);
    expect(optionalUuid().safeParse("nope").success).toBe(false);
  });
});
