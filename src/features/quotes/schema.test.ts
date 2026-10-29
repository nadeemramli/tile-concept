import { describe, expect, it } from "vitest";
import { QuoteInputError, quoteCommandSchema, showroomIso, toQuoteRpcInput } from "./schema";
import { QUOTE_CHANNEL, QUOTE_EVIDENCE_STATE, QUOTE_LIFECYCLE, QUOTE_SEND_EVIDENCE, QUOTE_SEND_KIND, QUOTE_VERSION_STATE, VISIT_QUOTE_RESOLUTION } from "@/lib/domain/status-maps";
import { GLOSSARY } from "@/lib/domain/glossary";

const id = "eeeeeeee-5000-0000-0000-0000000000a1";
const req = "ffffffff-5000-0000-0000-000000000001";
const parse = (v: unknown) => quoteCommandSchema.parse(v);

describe("showroomIso", () => {
  it("reads datetime-local input as Malaysia time", () => {
    expect(showroomIso("2026-10-26T09:00")).toBe("2026-10-26T01:00:00.000Z");
  });
  it("keeps an explicit offset", () => {
    expect(showroomIso("2026-10-26T09:00:00Z")).toBe("2026-10-26T09:00:00.000Z");
  });
});

describe("quote command input", () => {
  const prepare = { lead_id: id, origin: "inbox", currency: "myr", total_amount: "1200", quote_number: "", external_ref: " SQ-1 " };

  it("records a prepared quote with no issue or send fact", () => {
    const input = toQuoteRpcInput(parse({ action: "prepare", request_id: req, input: { ...prepare, stage: "prepared", sent_at: "2026-10-26T09:00" } }));
    expect(input).toMatchObject({ lead_id: id, origin: "inbox", currency: "MYR", total_amount: 1200, external_ref: "SQ-1" });
    expect(input).not.toHaveProperty("issue");
    expect(input).not.toHaveProperty("send");
    expect(input).not.toHaveProperty("quote_number");
  });

  it("keeps issue and send as separate times", () => {
    const input = toQuoteRpcInput(parse({ action: "prepare", request_id: req, input: { ...prepare, stage: "sent", issued_at: "2026-10-23T15:00", sent_at: "2026-10-26T09:00", channel: "whatsapp", evidence: "staff_attested" } }));
    expect(input.issue).toEqual({ issued_at: "2026-10-23T07:00:00.000Z" });
    expect(input.send).toEqual({ sent_at: "2026-10-26T01:00:00.000Z", channel: "whatsapp", evidence: "staff_attested" });
  });

  it("issues at the send time when no separate issue time is given", () => {
    const input = toQuoteRpcInput(parse({ action: "prepare", request_id: req, input: { ...prepare, stage: "sent", sent_at: "2026-10-26T09:00", channel: "email", evidence: "staff_attested" } }));
    expect(input.issue).toEqual({ issued_at: "2026-10-26T01:00:00.000Z" });
  });

  it("refuses a send without channel and evidence", () => {
    const cmd = parse({ action: "prepare", request_id: req, input: { ...prepare, stage: "sent", sent_at: "2026-10-26T09:00" } });
    expect(() => toQuoteRpcInput(cmd)).toThrow(QuoteInputError);
  });

  it("never defaults the currency", () => {
    expect(quoteCommandSchema.safeParse({ action: "prepare", request_id: req, input: { lead_id: id, origin: "inbox" } }).success).toBe(false);
  });

  it("requires a stated revision base for concurrency", () => {
    expect(quoteCommandSchema.safeParse({ action: "revise", request_id: req, input: { quote_id: id, currency: "MYR" } }).success).toBe(false);
  });

  it("passes issue_if_prepared only as a real boolean", () => {
    const input = toQuoteRpcInput(parse({ action: "send", request_id: req, input: { version_id: id, sent_at: "2026-10-26T09:00", channel: "in_person", evidence: "customer_acknowledged", issue_if_prepared: false } }));
    expect(input).toEqual({ version_id: id, sent_at: "2026-10-26T01:00:00.000Z", channel: "in_person", evidence: "customer_acknowledged", issue_if_prepared: false });
    expect(quoteCommandSchema.safeParse({ action: "send", request_id: req, input: { version_id: id, sent_at: "x", channel: "email", evidence: "staff_attested", issue_if_prepared: "false" } }).success).toBe(false);
  });

  it("asks for a reason when evidence is unresolved or not a quote, and a currency to create a record", () => {
    const base = { visit_id: id, file_id: "", expected_decision_id: "" };
    expect(quoteCommandSchema.safeParse({ action: "resolve_evidence", request_id: req, input: { ...base, resolution: "unresolved" } }).success).toBe(false);
    expect(quoteCommandSchema.safeParse({ action: "resolve_evidence", request_id: req, input: { ...base, resolution: "create_prepared" } }).success).toBe(false);
    expect(quoteCommandSchema.safeParse({ action: "resolve_evidence", request_id: req, input: { ...base, resolution: "link" } }).success).toBe(false);
    expect(toQuoteRpcInput(parse({ action: "resolve_evidence", request_id: req, input: { ...base, resolution: "create_prepared", currency: "myr" } }))).toEqual({ visit_id: id, resolution: "create_prepared", currency: "MYR" });
  });

  it("requires a reason to reject, reopen or void", () => {
    for (const action of ["reject", "reopen"]) expect(quoteCommandSchema.safeParse({ action, request_id: req, input: { quote_id: id } }).success).toBe(false);
    expect(quoteCommandSchema.safeParse({ action: "void_send", request_id: req, input: { delivery_id: id } }).success).toBe(false);
    expect(quoteCommandSchema.safeParse({ action: "accept", request_id: req, input: { quote_id: id } }).success).toBe(true);
  });
});

describe("quote status maps explain themselves", () => {
  const maps = { QUOTE_LIFECYCLE, QUOTE_VERSION_STATE, QUOTE_SEND_KIND, QUOTE_CHANNEL, QUOTE_SEND_EVIDENCE, QUOTE_EVIDENCE_STATE, VISIT_QUOTE_RESOLUTION };
  it.each(Object.entries(maps))("%s has a hint for every state and appears in Help & glossary", (_, map) => {
    for (const meta of Object.values(map)) expect(meta.hint?.length).toBeGreaterThan(10);
    expect(GLOSSARY.flatMap((g) => g.entries).some((e) => e.map === map)).toBe(true);
  });
  it("never calls a quote outcome a sale", () => {
    expect(QUOTE_LIFECYCLE.accepted.hint).toMatch(/not record a sale/);
  });
});
