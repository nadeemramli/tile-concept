import { describe, expect, it } from "vitest";
import { pursuitOutcomeSchema } from "@/features/outcomes/schema";
import { inquiryActionSchema } from "@/features/inbox/schema";

const id = "11111111-2222-3333-4444-555555555555";
const base = { request_id: id, lead_id: id, effective_date: "2026-10-28" };
const messages = (input: unknown) => {
  const r = pursuitOutcomeSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("pursuit outcome schema", () => {
  it("requires a primary reason and an effective date to record a loss", () => {
    expect(messages({ ...base, action: "lose" })).toContain("Choose a reason. Use Unknown when the reason is not known.");
    expect(messages({ request_id: id, lead_id: id, action: "lose", reason_code: "price" }).length).toBeGreaterThan(0);
    expect(messages({ ...base, action: "lose", reason_code: "unknown" })).toEqual([]);
  });

  it("requires an explanation for Other", () => {
    expect(messages({ ...base, action: "lose", reason_code: "other" })).toContain("Explain the reason (at least 3 characters)");
    expect(messages({ ...base, action: "lose", reason_code: "other", reason_detail: "  " })).toContain("Explain the reason (at least 3 characters)");
    expect(messages({ ...base, action: "lose", reason_code: "other", reason_detail: "Synthetic explanation" })).toEqual([]);
  });

  it("accepts an unnamed competitor only with an explicit relationship", () => {
    expect(messages({ ...base, action: "lose", reason_code: "competitor" })).toContain("State the relationship with the supplier, or choose Unknown");
    expect(messages({ ...base, action: "lose", reason_code: "competitor", competitor_relationship: "unknown" })).toEqual([]);
    expect(messages({ ...base, action: "lose", reason_code: "competitor", competitor_relationship: "reported", competitor_relationship_detail: "Said to be close" }))
      .toContain("State how the relationship is known");
  });

  it("keeps rejection reasons out of loss and requires review dates on deferral", () => {
    expect(messages({ ...base, action: "lose", reason_code: "spam" })).toContain("Choose a listed reason");
    expect(messages({ ...base, action: "reject", reason_code: "spam" })).toEqual([]);
    expect(messages({ ...base, action: "defer", reason_code: "timing" })).toContain("Choose a review date for the deferral");
    expect(messages({ ...base, action: "defer", reason_code: "timing", review_date: "2026-11-30" })).toEqual([]);
    expect(messages({ ...base, action: "lose", reason_code: "timing", review_date: "2026-11-30" })).toContain("Only a deferral has a review date");
  });

  it("requires a reason and next follow-up to reopen", () => {
    expect(messages({ request_id: id, lead_id: id, action: "reopen", next_follow_up_at: "2026-11-01T10:00:00+08:00" }).length).toBeGreaterThan(0);
    expect(messages({ request_id: id, lead_id: id, action: "reopen", reason_detail: "Customer came back", next_follow_up_at: "2026-11-01T10:00:00+08:00" })).toEqual([]);
  });

  it("retires the free-text lost and reopen inquiry actions", () => {
    for (const action of ["lost", "reopen"]) {
      expect(inquiryActionSchema.safeParse({ lead_id: id, request_id: id, action, body: "Free text" }).success).toBe(false);
    }
  });
});
