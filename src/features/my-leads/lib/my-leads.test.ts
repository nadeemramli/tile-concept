import { describe, expect, it } from "vitest";
import { contactLinks, dueState, fill, parseTab, primaryAction, secondaryActions, TAB_VIEW } from "./my-leads";

const base = {
  status: "new", confirmed_sales: 0, contact_attempts: 0, first_whatsapp_sent_at: null, last_contact_attempt_at: null,
  first_response_at: null, first_customer_reply_at: null, next_follow_up_task_id: null, no_next_action_reason: null,
};

describe("my leads next action", () => {
  it("asks for the first WhatsApp before anything else", () => {
    expect(primaryAction(base)).toBe("whatsapp_sent");
    // A status past "new" is contact already made, even without attempt counters.
    expect(primaryAction({ ...base, status: "contact_attempted" })).toBe("schedule");
    expect(secondaryActions(base)).not.toContain("whatsapp_sent");
  });

  it("completes an open follow-up once contacted, and schedules one when none exists", () => {
    const contacted = { ...base, status: "contacted", first_whatsapp_sent_at: "2026-10-01T01:00:00Z" };
    expect(primaryAction({ ...contacted, next_follow_up_task_id: "t" })).toBe("complete");
    expect(secondaryActions({ ...contacted, next_follow_up_task_id: "t" })).toEqual(["whatsapp_sent", "customer_replied", "no_response", "contact_attempt", "reschedule", "remark"]);
    expect(primaryAction(contacted)).toBe("schedule");
    expect(secondaryActions(contacted)).toContain("no_next_action");
    expect(secondaryActions({ ...contacted, no_next_action_reason: "Bought elsewhere" })).not.toContain("no_next_action");
  });

  it("offers no action on a closed inquiry and never offers loss or reopening", () => {
    for (const closed of [{ ...base, status: "disqualified" }, { ...base, status: "duplicate" }, { ...base, confirmed_sales: 1 }]) {
      expect(primaryAction(closed)).toBeNull();
      expect(secondaryActions(closed)).toEqual(["remark"]);
    }
    expect(secondaryActions(base).join()).not.toMatch(/lost|reopen/);
  });
});

describe("my leads tabs and dates", () => {
  it("maps each tab onto an existing inbox view and defaults to today", () => {
    expect(TAB_VIEW).toEqual({ today: "follow-ups-due", action: "needs-action", upcoming: "upcoming", all: "all" });
    expect(parseTab("upcoming")).toBe("upcoming");
    expect(parseTab("lost")).toBe("today");
    expect(parseTab(undefined)).toBe("today");
  });

  it("uses Kuala Lumpur days for due today", () => {
    const now = Date.parse("2026-10-29T10:00:00+08:00");
    expect(dueState(null, now)).toBe("none");
    expect(dueState("2026-10-29T09:00:00+08:00", now)).toBe("overdue");
    expect(dueState("2026-10-29T23:30:00+08:00", now)).toBe("today");
    expect(dueState("2026-10-30T00:30:00+08:00", now)).toBe("upcoming");
  });

  it("fills message placeholders", () => {
    expect(fill("Halaman {page} daripada {pages}", { page: 2, pages: 5 })).toBe("Halaman 2 daripada 5");
  });
});

describe("contact links", () => {
  it("open the salesperson's own apps without any prefilled message", () => {
    expect(contactLinks("012-345 6789")).toEqual({ tel: "tel:+60123456789", whatsapp: "https://wa.me/60123456789" });
    expect(contactLinks("+60123456789")?.whatsapp).not.toContain("text=");
    expect(contactLinks(null)).toBeNull();
    expect(contactLinks("123")).toBeNull();
  });
});
