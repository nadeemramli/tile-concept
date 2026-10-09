import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMarketingCostServer, type MarketingCostDb } from "../../scripts/mcp/marketing-cost-tools.mts";

// Synthetic report: two dates with spend, one zero-spend date.
const report = ["Date,Campaign name,Spend,Currency", "2026-08-01,Synthetic A,10.10,MYR", "2026-08-01,Synthetic B,20.20,MYR", "2026-08-02,Synthetic A,0.00,MYR", "2026-08-03,Synthetic A,5.00,MYR"].join("\n");
const content_base64 = Buffer.from(report).toString("base64");
const cleanPreview = { importable: true, can_import: true, issues: [], duplicate_batch: null, conflicts: [] };

async function connect(answers: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } }>) {
  const calls: string[] = [];
  const db: MarketingCostDb = {
    rpc(fn, args = {}) {
      calls.push(fn);
      const a = answers[fn]?.(args) ?? { error: { message: `unexpected ${fn}` } };
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
    from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [{ id: "b1" }], error: null }) }) }) }),
  };
  const server = createMarketingCostServer(db, "synthetic.member@tileconcept.test");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const content = r.content as { type: string; text: string }[];
    return { isError: !!r.isError, body: JSON.parse(content[0].text) };
  };
  return { client, call, calls };
}

describe("marketing-cost MCP tools", () => {
  it("lists preview, import, verify and list tools with honest annotations", async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["marketing_cost_import_tiktok_report", "marketing_cost_list_imports", "marketing_cost_preview_tiktok_report", "marketing_cost_verify_import"]);
    expect(tools.find((t) => t.name === "marketing_cost_preview_tiktok_report")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "marketing_cost_import_tiktok_report")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "marketing_cost_import_tiktok_report")?.inputSchema.required).toEqual(expect.arrayContaining(["expected_entry_count", "expected_total"]));
  });

  it("previews: sums by date, excludes zero dates, and leaves tax unreported", async () => {
    const { call } = await connect({ preview_marketing_spend_batch: () => ({ data: cleanPreview }) });
    const { body, isError } = await call("marketing_cost_preview_tiktok_report", { file_name: "synthetic.csv", content_base64 });
    expect(isError).toBe(false);
    expect(body.importable).toBe(true);
    expect(body.summary).toMatchObject({ dates_with_spend: 2, total_myr: "35.30", excluded_zero_spend_dates: ["2026-08-02"], currency: "MYR" });
    expect(body.summary.tax).toMatch(/never as zero/);
    expect(body.next_step).toContain('expected_entry_count=2 and expected_total="35.30"');
  });

  it("refuses an import whose expected figures disagree, without calling the import function", async () => {
    const { call, calls } = await connect({ preview_marketing_spend_batch: () => ({ data: cleanPreview }) });
    const { body, isError } = await call("marketing_cost_import_tiktok_report", { file_name: "synthetic.csv", content_base64, expected_entry_count: 46, expected_total: "3269.40" });
    expect(isError).toBe(true);
    expect(body.blockers).toEqual(["Expected 46 dates with spend; the report has 2.", "Expected MYR 3269.40; the report totals MYR 35.30."]);
    expect(calls).not.toContain("import_marketing_spend_batch");
  });

  it("reports a permission refusal from the database as a tool error", async () => {
    const { call } = await connect({
      preview_marketing_spend_batch: () => ({ data: cleanPreview }),
      import_marketing_spend_batch: () => ({ error: { message: "Permission denied: marketing.spend.write", code: "42501" } }),
    });
    const { body, isError } = await call("marketing_cost_import_tiktok_report", { file_name: "synthetic.csv", content_base64, expected_entry_count: 2, expected_total: "35.30" });
    expect(isError).toBe(true);
    expect(body).toEqual({ ok: false, error: "Permission denied: marketing.spend.write", code: "42501" });
  });

  it("rejects unsupported files and missing input before touching the database", async () => {
    const { call, calls } = await connect({});
    expect((await call("marketing_cost_preview_tiktok_report", { file_name: "report.pdf", content_base64 })).body.error).toMatch(/must end in/);
    expect((await call("marketing_cost_preview_tiktok_report", {})).body.error).toMatch(/Send file_path/);
    expect(calls).toEqual([]);
  });
});
