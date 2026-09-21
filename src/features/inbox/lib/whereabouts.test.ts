import { describe, expect, it } from "vitest";
import { whereIsLead, whereSentence, type LeadLocation } from "./whereabouts";

const now = new Date("2026-09-11T02:00:00Z"); // 10:00 in Kuala Lumpur
const me = "user-me";

function lead(over: Partial<LeadLocation> = {}): LeadLocation {
  return {
    status: "new",
    owner_id: null,
    source_channel: "tiktok",
    first_response_at: null,
    first_response_due_at: "2026-09-11T03:00:00Z",
    next_follow_up_at: null,
    duplicate_of_lead_id: null,
    created_at: "2026-09-10T23:00:00Z",
    ...over,
  };
}

describe("whereIsLead", () => {
  it("a fresh unowned lead is in New and Unassigned", () => {
    expect(whereIsLead(lead(), me, now)).toEqual({ home: "new", also: ["unassigned"] });
  });

  it("after Done WhatsApp on an unowned lead it is Waiting for reply and mine", () => {
    const after = lead({ status: "contact_attempted", owner_id: me, first_response_at: "2026-09-11T01:59:00Z" });
    expect(whereIsLead(after, me, now)).toEqual({ home: "waiting", also: ["mine"] });
    expect(whereSentence(whereIsLead(after, me, now))).toBe("Now in Awaiting reply and My leads.");
  });

  it("a logged conversation goes to Contacted", () => {
    expect(whereIsLead(lead({ status: "contacted", owner_id: "someone-else", first_response_at: "2026-09-11T01:00:00Z" }), me, now)).toEqual({ home: "contacted", also: [] });
  });

  it("a reminder due today adds Follow-ups due; one due tomorrow does not", () => {
    const today = lead({ status: "contact_attempted", owner_id: me, first_response_at: "x", next_follow_up_at: "2026-09-11T10:00:00Z" });
    expect(whereIsLead(today, me, now).also).toContain("follow-ups-due");
    const tomorrow = lead({ status: "contact_attempted", owner_id: me, first_response_at: "x", next_follow_up_at: "2026-09-12T01:00:00Z" });
    expect(whereIsLead(tomorrow, me, now).also).not.toContain("follow-ups-due");
  });

  it("an unanswered lead past its 4-hour target is SLA overdue", () => {
    expect(whereIsLead(lead({ first_response_due_at: "2026-09-11T01:00:00Z" }), me, now).also).toEqual(["unassigned", "follow-up"]);
  });

  it("an old unanswered lead is also Aging", () => {
    expect(whereIsLead(lead({ created_at: "2026-09-01T00:00:00Z" }), me, now).also).toContain("aging");
  });

  it("walk-in mirrors never claim the Waiting or Contacted views", () => {
    expect(whereIsLead(lead({ status: "contacted", source_channel: "walk_in", owner_id: me, first_response_at: "x" }), me, now).home).toBe("all");
  });

  it("closed states have a single home", () => {
    expect(whereIsLead(lead({ status: "disqualified", owner_id: me }), me, now)).toEqual({ home: "disqualified", also: [] });
    expect(whereIsLead(lead({ status: "converted", owner_id: me }), me, now).home).toBe("qualified");
    expect(whereIsLead(lead({ status: "duplicate" }), me, now).home).toBe("duplicates");
  });
});
