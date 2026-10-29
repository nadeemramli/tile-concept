/**
 * TILE-86: the pursuit segmentation and lead-source reports must authorize every
 * aggregated row with the caller's own active report.read in THAT row's
 * workspace — never a permission held in another workspace, never membership
 * alone.
 *
 * Normal path only: real password sign-in through Auth, then the two RPCs over
 * PostgREST, exactly as the app calls them. Local stack only (refuses hosted
 * targets). Every user, workspace, membership and lead is synthetic, created by
 * this run under its own tag, and removed at the end (verified to zero). Nobody
 * is signed out globally.
 *
 *   pnpm exec tsx tests/integration/report-workspace-reads.mts [--json=<file>]
 *
 * Exit 0 when every case matches its expectation; 1 otherwise (the table says
 * which case leaked or was wrongly denied).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const url: string = status.API_URL;
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This check refuses hosted targets");
const anonKey: string = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const secretKey: string = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
assert(anonKey && secretKey, "Local API keys unavailable");
const jsonOut = process.argv.find((a) => a.startsWith("--json="))?.slice(7);

const TAG = `tile86-${randomBytes(4).toString("hex")}`;
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const ws = { A: randomUUID(), B: randomUUID(), C: randomUUID() };
const leads = { B: randomUUID(), C: randomUUID() };
const users: string[] = [];

type Membership = { ws: keyof typeof ws; role: string; status?: "active" | "suspended"; revoke?: boolean };
interface Case { name: string; memberships: Membership[]; expect: { segments: "denied" | "empty" | "B"; source: "empty" | "B" } }

// A is always the OLDER membership, so it is the acting workspace. A has no
// leads; B has one lead (source "other"); C has one lead nobody here belongs to.
const CASES: Case[] = [
  { name: "no report.read anywhere", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "catalog_pricing" }], expect: { segments: "denied", source: "empty" } },
  { name: "reader in acting A only, B without report.read", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "catalog_pricing" }], expect: { segments: "empty", source: "empty" } },
  { name: "acting A denied, legitimate reader in B", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "analyst" }], expect: { segments: "B", source: "B" } },
  { name: "reader in A, inactive (suspended) admin in B", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "admin", status: "suspended" }], expect: { segments: "empty", source: "empty" } },
  { name: "reader in A, B admin membership revoked", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "admin", revoke: true }], expect: { segments: "empty", source: "empty" } },
  { name: "denied in A, inactive reader in B only", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "analyst", status: "suspended" }], expect: { segments: "denied", source: "empty" } },
];

type Row = Record<string, unknown>;
function classify(rows: Row[] | null, kind: "segments" | "source") {
  if (!rows || rows.length === 0) return "empty";
  // B's single lead is the only one any case can legitimately see.
  if (kind === "segments") {
    const perDimension = new Set(rows.filter((r) => r.dimension !== "glc_party_role").map((r) => r.dimension));
    const total = rows.filter((r) => r.dimension === "buyer_role").reduce((n, r) => n + Number(r.pursuits), 0);
    return perDimension.size === 4 && total === 1 ? "B" : `unexpected(${JSON.stringify(rows)})`;
  }
  return rows.length === 1 && rows[0].source_channel === "other" && Number(rows[0].leads) === 1 ? "B" : `unexpected(${JSON.stringify(rows)})`;
}

const results: Record<string, unknown>[] = [];
let failed = 0;
try {
  sql(`insert into core.workspaces(id,slug,name) values
    ('${ws.A}','${TAG}-a','${TAG} A'),('${ws.B}','${TAG}-b','${TAG} B'),('${ws.C}','${TAG}-c','${TAG} C');
    insert into sales.leads(id,workspace_id,status,source_channel,raw_name) values
    ('${leads.B}','${ws.B}','new','other','${TAG} synthetic lead B'),('${leads.C}','${ws.C}','new','other','${TAG} synthetic lead C');`);

  for (const c of CASES) {
    const email = `${TAG}-${users.length}@example.test`;
    const password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const uid = created.data.user!.id;
    users.push(uid);
    c.memberships.forEach((m, i) => {
      sql(`insert into core.memberships(workspace_id,user_id,role_key,status,created_at) values ('${ws[m.ws]}','${uid}','${m.role}','${m.status ?? "active"}',now() - interval '${10 - i} minutes')`);
      if (m.revoke) sql(`delete from core.memberships where workspace_id='${ws[m.ws]}' and user_id='${uid}'`);
    });
    // Normal sign-in: a fresh client per case, so no session is shared or revoked.
    const client = createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signedIn.error);

    const seg = await client.rpc("report_pursuit_segments", { p_grain: "week" });
    const src = await client.rpc("report_lead_source", {});
    const observed = {
      segments: seg.error ? (seg.status === 403 || seg.error.code === "42501" ? "denied" : `error(${seg.status} ${seg.error.code})`) : classify(seg.data as Row[], "segments"),
      source: src.error ? `error(${src.status} ${src.error.code})` : classify(src.data as Row[], "source"),
    };
    const ok = observed.segments === c.expect.segments && observed.source === c.expect.source;
    if (!ok) failed++;
    results.push({ case: c.name, expected: c.expect, observed, http: { segments: seg.status, source: src.status }, pass: ok });
  }

  // Anonymous: segmentation is not executable; lead source sees no workspace.
  const anon = createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
  const aSeg = await anon.rpc("report_pursuit_segments", { p_grain: "week" });
  const aSrc = await anon.rpc("report_lead_source", {});
  const anonObserved = {
    segments: aSeg.error ? "denied" : classify(aSeg.data as Row[], "segments"),
    source: aSrc.error ? "denied" : classify(aSrc.data as Row[], "source"),
  };
  const anonOk = anonObserved.segments === "denied" && (anonObserved.source === "denied" || anonObserved.source === "empty");
  if (!anonOk) failed++;
  results.push({ case: "anonymous", expected: { segments: "denied", source: "denied or empty" }, observed: anonObserved, http: { segments: aSeg.status, source: aSrc.status }, pass: anonOk });
} finally {
  sql(`delete from sales.leads where workspace_id in ('${ws.A}','${ws.B}','${ws.C}');
       delete from core.memberships where workspace_id in ('${ws.A}','${ws.B}','${ws.C}');
       delete from core.workspaces where id in ('${ws.A}','${ws.B}','${ws.C}');`);
  for (const uid of users) {
    const r = await admin.auth.admin.deleteUser(uid);
    assert.ifError(r.error);
  }
}

const residue = sql(`select (select count(*) from core.workspaces where slug like '${TAG}%') + (select count(*) from sales.leads where raw_name like '${TAG}%')
  + (select count(*) from auth.users where email like '${TAG}%') + (select count(*) from core.memberships where user_id in (${users.map((u) => `'${u}'`).join(",") || "null"}))`);
// The checkout whose migrations are applied (an integration worktree may differ from this file's).
const head = execFileSync("git", ["-C", process.env.PROBE_GIT_DIR ?? ".", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const migrations = sql("select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version >= '20261029000000'");
const report = { tag: TAG, head, migrations, results, failed, residue: Number(residue) };
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.case}: expected ${JSON.stringify(r.expected)} observed ${JSON.stringify(r.observed)} http ${JSON.stringify(r.http)}`);
console.log(`head ${head} · migrations ≥20261029: ${migrations} · residue after cleanup ${residue}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exit(failed === 0 && Number(residue) === 0 ? 0 : 1);
