/**
 * End-to-end smoke test of the marketing-cost MCP server against the LOCAL
 * stack (`pnpm db:start`). It writes synthetic records, so any other URL is
 * refused.
 *
 *   SUPABASE_URL=http://127.0.0.1:56321 SUPABASE_SECRET_KEY=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… \
 *     pnpm exec tsx scripts/mcp/smoke-marketing-cost.mts
 *
 * Spawns the real stdio server twice (marketing coordinator, then sales rep),
 * previews, imports and verifies a synthetic 46-date / MYR 3,269.40 report,
 * proves a duplicate and an overlapping report import nothing and that the
 * rep is refused, then voids its batch so the run can be repeated.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { target, userClient } from "../import/lib.mts";

const t = target(new Set(["--local"]));
if (!/127\.0\.0\.1|localhost/.test(t.url)) throw new Error("The smoke test writes synthetic records and only runs against the local stack.");

function syntheticReport(): string {
  const rows = ["Currency: MYR", "Date,Campaign name,Spend"];
  const zero = new Set([5, 17, 30, 44]);
  const lines: [string, string, number][] = [];
  for (let i = 0; i < 50; i++) {
    const day = new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10);
    if (zero.has(i)) { lines.push([day, "Smoke Awareness", 0]); continue; }
    lines.push([day, "Smoke Awareness", 4000 + ((i * 37) % 900)], [day, "Smoke Leads", 2000 + ((i * 53) % 700)]);
  }
  const sum = lines.reduce((s, l) => s + l[2], 0);
  lines[lines.length - 1][2] += 326940 - sum;
  for (const [d, c, sen] of lines) rows.push(`${d},${c},${(sen / 100).toFixed(2)}`);
  return rows.join("\n");
}

async function server(email: string) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["--import", "tsx", "scripts/mcp/marketing-cost.mts", "--local"],
    env: { ...process.env, TC_MCP_MEMBER_EMAIL: email } as Record<string, string>, stderr: "inherit",
  });
  const client = new Client({ name: "smoke", version: "1" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, body: JSON.parse((r.content as { text: string }[])[0].text) };
  };
  return { client, call };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-smoke-"));
  const file = path.join(dir, "smoke-trend-report.csv");
  fs.writeFileSync(file, syntheticReport());
  const overlap = path.join(dir, "smoke-overlap.csv");
  fs.writeFileSync(overlap, ["Date,Campaign name,Spend (MYR)", "2026-05-20,Smoke Awareness,1.00", "2026-06-30,Smoke Awareness,2.00"].join("\n"));

  const coordinator = await server("demo.marketing@tileconcept.test");
  const preview = await coordinator.call("marketing_cost_preview_tiktok_report", { file_path: file, expected_entry_count: 46, expected_total: "3,269.40" });
  assert.equal(preview.isError, false, JSON.stringify(preview.body));
  assert.equal(preview.body.summary.dates_with_spend, 46);
  assert.equal(preview.body.summary.total_myr, "3269.40");
  assert.equal(preview.body.summary.excluded_zero_spend_dates.length, 4);
  assert.equal(preview.body.importable, true, JSON.stringify(preview.body.blockers));
  console.log("✓ preview: 46 dates · MYR 3269.40 · 4 zero-spend dates excluded");

  const requestId = randomUUID();
  const imported = await coordinator.call("marketing_cost_import_tiktok_report", { file_path: file, expected_entry_count: 46, expected_total: "3269.40", request_id: requestId });
  assert.equal(imported.isError, false, JSON.stringify(imported.body));
  assert.equal(imported.body.verification.reconciled, true);
  assert.equal(imported.body.verification.summary.matching, 46);
  assert.equal(imported.body.verification.summary.tax_unreported, 46);
  const batchId: string = imported.body.batch_id;
  console.log(`✓ import: batch ${batchId} reconciled, 46 entries with tax not reported`);

  const retry = await coordinator.call("marketing_cost_import_tiktok_report", { file_path: file, expected_entry_count: 46, expected_total: "3269.40", request_id: requestId });
  assert.equal(retry.isError, false, JSON.stringify(retry.body));
  assert.equal(retry.body.batch_id, batchId, "a retry with the same request id returns the same batch");
  const duplicate = await coordinator.call("marketing_cost_import_tiktok_report", { file_path: file, expected_entry_count: 46, expected_total: "3269.40" });
  assert.equal(duplicate.isError, true);
  assert.match(duplicate.body.error, /already imported/);
  assert.equal(duplicate.body.code, "23505");
  const overlapping = await coordinator.call("marketing_cost_import_tiktok_report", { file_path: overlap, expected_entry_count: 2, expected_total: "3.00" });
  assert.equal(overlapping.isError, true);
  assert.match(overlapping.body.blockers.join(" "), /already recorded on 2026-05-20/);
  console.log("✓ same-request retry returns the batch; duplicate file and overlapping dates refused");

  const verified = await coordinator.call("marketing_cost_verify_import", { file_path: file });
  assert.equal(verified.body.imported, true);
  assert.equal(verified.body.reconciled, true);
  assert.equal(verified.body.comparison.sameFile, true);
  const listed = await coordinator.call("marketing_cost_list_imports", { limit: 5 });
  assert.ok(listed.body.some((b: { id: string }) => b.id === batchId));
  console.log("✓ verify by file: every date matches the ledger");
  await coordinator.client.close();

  const rep = await server("demo.rep1@tileconcept.test");
  const denied = await rep.call("marketing_cost_preview_tiktok_report", { file_path: file });
  assert.equal(denied.isError, true);
  assert.match(denied.body.error, /Permission denied: marketing\.spend\.read/);
  const deniedImport = await rep.call("marketing_cost_import_tiktok_report", { file_path: file, expected_entry_count: 46, expected_total: "3269.40" });
  assert.equal(deniedImport.isError, true);
  console.log("✓ sales rep refused by the database");
  await rep.client.close();

  // Leave the local stack reusable: void the batch through the reviewer command.
  const { client } = await userClient(t, "demo.marketing@tileconcept.test");
  const { error } = await client.rpc("void_marketing_spend_batch", { p_batch_id: batchId, p_reason: "Smoke test clean-up", p_request_id: randomUUID() });
  assert.equal(error, null, error?.message);
  const after = await (await server("demo.marketing@tileconcept.test")).call("marketing_cost_verify_import", { batch_id: batchId });
  assert.equal(after.body.summary.voided, 46);
  console.log("✓ batch voided; history kept");
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
