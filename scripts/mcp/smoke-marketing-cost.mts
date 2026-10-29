/**
 * End-to-end smoke test of the marketing-cost MCP server against the LOCAL
 * stack (`pnpm db:start`). It writes synthetic records, so any other URL is
 * refused.
 *
 *   SUPABASE_URL=http://127.0.0.1:56321 SUPABASE_SECRET_KEY=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… \
 *     pnpm mcp:marketing-cost:smoke
 *
 * The harness signs members in the way `mcp:marketing-cost:login` does (own
 * password; for the demo guest, a magic link whose token the harness reads in
 * place of an inbox) and spawns the real server exactly as documented
 * (`pnpm --silent mcp:marketing-cost`) WITHOUT the service-role key in its
 * environment. It checks:
 *   - authentication: no session, an email alone, a mismatched email, a forged
 *     session and a world-readable session file all refuse to start;
 *   - a synthetic 46-date / MYR 3,269.40 report previews, imports, verifies;
 *   - same-request retry, duplicate file and overlapping dates;
 *   - the database's permissions (sales rep refused) and workspace isolation
 *     (the demo-guest workspace imports the same file independently and
 *     cannot see or verify the other workspace's batch);
 * then voids its batches so it can be run again.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadEnv } from "../import/lib.mts";
import { loginWithMagicLink, loginWithPassword, logout, mcpTarget } from "./session.mts";

loadEnv();
const t = mcpTarget(new Set(["--local"]));
if (!/127\.0\.0\.1|localhost/.test(t.url)) throw new Error("The smoke test writes synthetic records and only runs against the local stack.");
const PASSWORD = "TileDemo!2026"; // local fixture accounts only
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-smoke-"));

// The server's environment: no service-role key, ever.
const serverEnv = (extra: Record<string, string>): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, SUPABASE_URL: t.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: t.publishableKey, ...extra };
  for (const k of Object.keys(env)) if (/SECRET|SERVICE_ROLE/.test(k)) delete env[k];
  return env;
};
const SERVER = ["--silent", "mcp:marketing-cost", "--local"];

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

/** Start the server and expect it to refuse; returns its stderr. */
function refusedStart(extra: Record<string, string>): string {
  const r = spawnSync("pnpm", SERVER, { env: serverEnv(extra), input: "", encoding: "utf8", timeout: 60000 });
  assert.notEqual(r.status, 0, `server should refuse to start: ${r.stderr}`);
  assert.equal(r.stdout.trim(), "", "nothing on the protocol channel");
  return r.stderr;
}

async function server(sessionFile: string) {
  const transport = new StdioClientTransport({ command: "pnpm", args: SERVER, env: serverEnv({ TC_MCP_SESSION_FILE: sessionFile }) as Record<string, string>, stderr: "inherit" });
  const client = new Client({ name: "smoke", version: "1" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, body: JSON.parse((r.content as { text: string }[])[0].text) };
  };
  return { client, call };
}

async function main() {
  const file = path.join(dir, "smoke-trend-report.csv");
  fs.writeFileSync(file, syntheticReport());
  const overlap = path.join(dir, "smoke-overlap.csv");
  fs.writeFileSync(overlap, ["Date,Campaign name,Spend (MYR)", "2026-05-20,Smoke Awareness,1.00", "2026-06-30,Smoke Awareness,2.00"].join("\n"));

  // Sign members in as `mcp:marketing-cost:login` does.
  const coordinatorSession = path.join(dir, "coordinator.json");
  const repSession = path.join(dir, "rep.json");
  const guestSession = path.join(dir, "guest.json");
  await loginWithPassword(t, "demo.marketing@tileconcept.test", PASSWORD, coordinatorSession);
  await loginWithPassword(t, "demo.rep1@tileconcept.test", PASSWORD, repSession);
  assert.equal(fs.statSync(coordinatorSession).mode & 0o777, 0o600, "session file is private");
  // The guest has no password: a magic link, read here in place of the inbox.
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(secret, "the harness (not the server) needs the local secret key to read the guest's link");
  const admin = createClient(t.url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: "demo.guest@tileconcept.test" });
  assert.equal(linkError, null);
  await loginWithMagicLink(t, `http://localhost:3000/auth/accept?token_hash=${link.properties.hashed_token}&type=email`, guestSession);
  console.log("✓ members signed in with their own password / emailed link; session files are mode 600");

  // Authentication refusals.
  assert.match(refusedStart({ TC_MCP_SESSION_FILE: path.join(dir, "none.json"), TC_MCP_MEMBER_EMAIL: "demo.admin@tileconcept.test" }), /No signed-in member/);
  assert.match(refusedStart({ TC_MCP_SESSION_FILE: repSession, TC_MCP_MEMBER_EMAIL: "demo.marketing@tileconcept.test" }), /belongs to demo\.rep1@tileconcept\.test/);
  const forged = JSON.parse(fs.readFileSync(coordinatorSession, "utf8"));
  const stored = JSON.parse(forged.items["tc-mcp-session"]);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  stored.access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "aaaaaaaa-0000-0000-0000-000000000001", email: "demo.admin@tileconcept.test", role: "authenticated", exp: 4102444800 })}.${b64({ forged: true })}`;
  stored.refresh_token = "forged-refresh-token";
  stored.user = { ...stored.user, id: "aaaaaaaa-0000-0000-0000-000000000001", email: "demo.admin@tileconcept.test" };
  forged.items["tc-mcp-session"] = JSON.stringify(stored);
  const forgedFile = path.join(dir, "forged.json");
  fs.writeFileSync(forgedFile, JSON.stringify(forged), { mode: 0o600 });
  assert.match(refusedStart({ TC_MCP_SESSION_FILE: forgedFile }), /no longer valid/);
  const openFile = path.join(dir, "open.json");
  fs.copyFileSync(repSession, openFile); fs.chmodSync(openFile, 0o644);
  assert.match(refusedStart({ TC_MCP_SESSION_FILE: openFile }), /readable by other users/);
  // Logging out revokes the session with Supabase Auth: a copy of the file stops working too.
  const revoked = path.join(dir, "revoked.json");
  await loginWithPassword(t, "demo.marketing@tileconcept.test", PASSWORD, revoked);
  const copy = path.join(dir, "revoked-copy.json");
  fs.copyFileSync(revoked, copy); fs.chmodSync(copy, 0o600);
  await logout(t, revoked);
  assert.match(refusedStart({ TC_MCP_SESSION_FILE: copy }), /no longer valid/);
  console.log("✓ no session, email alone, mismatched email, forged token, world-readable file and revoked session all refused");

  const coordinator = await server(coordinatorSession);
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
  console.log("✓ verify by file: every date matches the ledger");

  const rep = await server(repSession);
  const denied = await rep.call("marketing_cost_preview_tiktok_report", { file_path: file });
  assert.equal(denied.isError, true);
  assert.match(denied.body.error, /Permission denied: marketing\.spend\.read/);
  const deniedImport = await rep.call("marketing_cost_import_tiktok_report", { file_path: file, expected_entry_count: 46, expected_total: "3269.40" });
  assert.equal(deniedImport.isError, true);
  await rep.client.close();
  console.log("✓ sales rep refused by the database");

  const guest = await server(guestSession);
  const guestPreview = await guest.call("marketing_cost_preview_tiktok_report", { file_path: file });
  assert.equal(guestPreview.body.duplicate_batch, null, "another workspace's import is not a duplicate here");
  assert.equal(guestPreview.body.conflicts.length, 0, "another workspace's entries do not overlap here");
  const guestImport = await guest.call("marketing_cost_import_tiktok_report", { file_path: file, expected_entry_count: 46, expected_total: "3269.40" });
  assert.equal(guestImport.isError, false, JSON.stringify(guestImport.body));
  const guestBatch: string = guestImport.body.batch_id;
  const crossVerify = await guest.call("marketing_cost_verify_import", { batch_id: batchId });
  assert.equal(crossVerify.isError, true);
  assert.match(crossVerify.body.error, /Import batch not found/);
  const guestList = await guest.call("marketing_cost_list_imports", { limit: 50 });
  assert.ok(!guestList.body.some((b: { id: string }) => b.id === batchId), "guest cannot list the other workspace's batch");
  const coordList = await coordinator.call("marketing_cost_list_imports", { limit: 50 });
  assert.ok(coordList.body.some((b: { id: string }) => b.id === batchId));
  assert.ok(!coordList.body.some((b: { id: string }) => b.id === guestBatch), "coordinator cannot list the guest workspace's batch");
  console.log("✓ workspace isolation: the demo workspace imports independently and cannot see or verify the other batch");

  // Leave the local stack reusable: reviewers void their own batches.
  for (const [session, id] of [[coordinatorSession, batchId], [guestSession, guestBatch]] as const) {
    const s = await import("./session.mts").then((m) => m.memberFromSession(t, session));
    const { error } = await s.client.rpc("void_marketing_spend_batch", { p_batch_id: id, p_reason: "Smoke test clean-up", p_request_id: randomUUID() });
    s.client.auth.stopAutoRefresh();
    assert.equal(error, null, error?.message);
  }
  const after = await coordinator.call("marketing_cost_verify_import", { batch_id: batchId });
  assert.equal(after.body.summary.voided, 46);
  console.log("✓ batches voided; history kept");
  await coordinator.client.close(); await guest.client.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((error) => { console.error(error); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); });
