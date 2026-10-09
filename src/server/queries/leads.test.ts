import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInquiryPage, getLead, getLeadIntakeEvents, getLeadTimeline } from "./leads";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), result: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => mock }));
vi.mock("@/server/queries/reference", () => ({ getMemberMap: async () => new Map() }));

const filters = { view: "all" as const, search: "Sensitive search fixture", owner: "all", source: "", page: 1 };
const leadId = "eeeeeeee-2109-0016-0000-000000000001";

beforeEach(() => {
  mock.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: mock.result, order: () => ({ limit: mock.result }) }) }) }));
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe("inquiry database diagnostics", () => {
  it.each([
    ["inquiry_page", () => getInquiryPage(filters), "Unable to load inquiries. Please retry."],
    ["inbox_leads", () => getLead(leadId), "Unable to load this inquiry. Please retry."],
    ["intake_events", () => getLeadIntakeEvents(leadId), "Unable to load inquiry source history."],
    ["entity_timeline", () => getLeadTimeline(leadId), "Unable to load inquiry activity history."],
  ] as const)("logs only the operation and code when %s fails", async (operation, query, message) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = { data: null, error: { code: "57014", message: "Customer example@example.test", details: "Phone +60178880001", hint: "Private note" } };
    mock.rpc.mockResolvedValue(failure);
    mock.result.mockResolvedValue(failure);

    // A failure must remain a failure, not become an empty list or a missing lead.
    await expect(query()).rejects.toThrow(message);
    expect(log.mock.calls).toEqual([["inquiry_query_failed", { operation, code: "57014" }]]);
  });

  it("retains a PostgREST code without exposing its schema error text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Private database detail" } });
    await expect(getLeadTimeline(leadId)).rejects.toThrow("Unable to load inquiry activity history.");
    expect(log.mock.calls).toEqual([["inquiry_query_failed", { operation: "entity_timeline", code: "PGRST202" }]]);
  });

  it("does not log unexpected content in the code field", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mock.rpc.mockResolvedValue({ data: null, error: { code: "Private customer detail", message: "Private message" } });
    await expect(getInquiryPage(filters)).rejects.toThrow("Unable to load inquiries. Please retry.");
    expect(log.mock.calls).toEqual([["inquiry_query_failed", { operation: "inquiry_page", code: "unknown" }]]);
  });

  it("keeps valid empty results and missing records distinct from query failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mock.rpc.mockResolvedValue({ data: { rows: [], total: 0, page: 1, page_size: 25, counts: {} }, error: null });
    mock.result.mockResolvedValue({ data: null, error: null });
    expect(await getInquiryPage(filters)).toMatchObject({ leads: [], total: 0, page: 1 });
    expect(await getLead(leadId)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});
