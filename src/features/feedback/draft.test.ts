import { describe, expect, it } from "vitest";
import { buildDeterministicDraft, feedbackInputHash } from "./draft-core";

describe("customer feedback draft fallback", () => {
  it("preserves criticism and skips unanswered questions", () => {
    const draft = buildDeterministicDraft([
      "tiles for my kitchen",
      "the staff explained the finishes clearly",
      "",
      "the visit was straightforward",
      "the waiting time was too long",
    ]);
    expect(draft).toContain("tiles for my kitchen");
    expect(draft).toContain("waiting time was too long");
    expect(draft).not.toContain("five-star");
  });

  it("hashes normalized answers deterministically", () => {
    expect(feedbackInputHash(["  clear   advice "])).toBe(feedbackInputHash(["clear advice"]));
  });

  it("does not duplicate sentence starters supplied by the customer", () => {
    const draft = buildDeterministicDraft([
      "I was looking for bathroom tiles.",
      "The size comparison was useful.",
      "I chose the lighter tile because the room is small.",
      "Helpful service, but the store was busy.",
      "Show sample stock availability earlier.",
    ]);

    expect(draft).toBe(
      "I was looking for bathroom tiles. The size comparison was useful. I chose the lighter tile because the room is small. Overall, helpful service, but the store was busy. For a future visit, I would suggest show sample stock availability earlier.",
    );
    expect(draft).not.toContain("I chose I chose");
  });
});
