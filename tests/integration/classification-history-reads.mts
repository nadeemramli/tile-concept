/**
 * TILE-87: classification history must be readable with the caller's own active
 * sales.read in the history row's workspace AND a linked lead or opportunity
 * the caller can see under its existing RLS — never hidden because the acting
 * membership (another workspace) lacks sales.read, never opened by it.
 *
 * Normal path only: real password sign-in through Auth, then GETs of
 * api.leads, api.opportunities and api.classification_events over PostgREST,
 * as the app reads them. Local stack only (refuses hosted targets). Every user,
 * workspace, membership, lead, opportunity and history row is synthetic,
 * created by this run under its own tag, and removed at the end (verified to
 * zero). Nobody is signed out globally.
 *
 *   pnpm exec tsx tests/integration/classification-history-reads.mts [--json=<file>]
 *
 * Exit 0 when every case matches its expectation; 1 otherwise.
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

const TAG = `tile87-${randomBytes(4).toString("hex")}`;
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// TILE-62 narrows the lead/opportunity policies to the row's workspace. Before
// it, "admin in A, no sales.read in B" still sees B's parents through the old
// union; that is TILE-62's repair, so only that parent expectation follows it.
const tile62 = sql("select position('current_workspace_id' in pg_get_functiondef('core.has_permission(text)'::regprocedure)) > 0") === "t";

const ws = { A: randomUUID(), B: randomUUID() };
const lead = randomUUID();
const opp = randomUUID();
const events = { lead: randomUUID(), opp: randomUUID(), both: randomUUID() };
const users: string[] = [];

type Membership = { ws: keyof typeof ws; role: string; status?: "active" | "suspended"; revoke?: boolean };
// parents "lead/opportunity" visible; history counts for the lead and the opportunity.
interface Case { name: string; memberships: Membership[]; owner?: boolean; expect: { parents: string; leadHistory: number; oppHistory: number } }

// A is always the OLDER membership, so it is the acting workspace. B holds one
// lead and one opportunity, owned by the "owner" case, and three history rows:
// lead only, opportunity only, and one naming both.
const CASES: Case[] = [
  { name: "admin A + sales_rep B", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "sales_rep" }], expect: { parents: "1/1", leadHistory: 2, oppHistory: 2 } },
  { name: "acting A without sales.read + sales_rep B", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "sales_rep" }], expect: { parents: "1/1", leadHistory: 2, oppHistory: 2 } },
  { name: "admin A + no sales.read in B", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "catalog_pricing" }], expect: { parents: tile62 ? "0/0" : "1/1", leadHistory: 0, oppHistory: 0 } },
  { name: "acting A without sales.read + suspended sales_rep B", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "sales_rep", status: "suspended" }], expect: { parents: "0/0", leadHistory: 0, oppHistory: 0 } },
  { name: "admin A + revoked sales_rep B", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "sales_rep", revoke: true }], expect: { parents: "0/0", leadHistory: 0, oppHistory: 0 } },
  { name: "admin A, not a member of B", memberships: [{ ws: "A", role: "admin" }], expect: { parents: "0/0", leadHistory: 0, oppHistory: 0 } },
  { name: "acting A without sales.read + sales.read-only B, not the owner", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "marketing_coordinator" }], expect: { parents: "0/0", leadHistory: 0, oppHistory: 0 } },
  { name: "acting A without sales.read + sales.read-only B, the owner", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "marketing_coordinator" }], owner: true, expect: { parents: "1/1", leadHistory: 2, oppHistory: 2 } },
  // Shared inquiry read: the lead branch only. Of the opportunity's history,
  // only the row that also names the visible lead.
  { name: "acting A without sales.read + showroom B (shared inquiry)", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "showroom" }], expect: { parents: "1/0", leadHistory: 2, oppHistory: 1 } },
];

type Q = { data: unknown[] | null; error: { code?: string } | null; status: number };
const n = (r: Q) => (r.error ? `error(${r.status} ${r.error.code})` : (r.data ?? []).length);

const results: Record<string, unknown>[] = [];
let failed = 0;
try {
  sql(`insert into core.workspaces(id,slug,name) values ('${ws.A}','${TAG}-a','${TAG} A'),('${ws.B}','${TAG}-b','${TAG} B');
    insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group) values ('${ws.B}','new','New',1,'open');`);

  const prepared: { c: Case; email: string; password: string; uid: string }[] = [];
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
    prepared.push({ c, email, password, uid });
  }
  const owner = prepared.find((p) => p.c.owner)!.uid;
  sql(`insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id) values ('${lead}','${ws.B}','new','call','${TAG} synthetic lead','${owner}');
    insert into sales.opportunities(id,workspace_id,name,stage_key,owner_id) values ('${opp}','${ws.B}','${TAG} synthetic opportunity','new','${owner}');
    insert into sales.classification_events(id,workspace_id,lead_id,opportunity_id,basis,before_values,after_values,reason) values
      ('${events.lead}','${ws.B}','${lead}',null,'correction','{"buyer_role":"end_user"}','{"buyer_role":"contractor"}','${TAG} lead correction'),
      ('${events.opp}','${ws.B}',null,'${opp}','correction','{"work_type":"unknown"}','{"work_type":"renovation"}','${TAG} opportunity correction'),
      ('${events.both}','${ws.B}','${lead}','${opp}','correction','{"project_use":"unknown"}','{"project_use":"residential"}','${TAG} pursuit correction');`);
  const historyBefore = sql(`select string_agg(id || ':' || md5(row(e.*)::text), ',' order by id) from sales.classification_events e where workspace_id='${ws.B}'`);

  for (const { c, email, password, uid } of prepared) {
    // The roles as persisted, read back rather than assumed.
    const persisted = sql(`select coalesce(string_agg(case workspace_id when '${ws.A}' then 'A' else 'B' end || ':' || role_key || ':' || status, ',' order by created_at), 'none') from core.memberships where user_id='${uid}'`);
    // Normal sign-in: a fresh client per case, so no session is shared or revoked.
    const client = createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signedIn.error);
    const acting = await client.rpc("my_membership");
    const pLead = (await client.from("leads").select("id").eq("id", lead)) as Q;
    const pOpp = (await client.from("opportunities").select("id").eq("id", opp)) as Q;
    // The app's own history query shape (src/server/queries/classification.ts).
    const hLead = (await client.from("classification_events").select("id, basis, before_values, after_values, reason").eq("lead_id", lead)) as Q;
    const hOpp = (await client.from("classification_events").select("id, basis, before_values, after_values, reason").eq("opportunity_id", opp)) as Q;
    const observed = { parents: `${n(pLead)}/${n(pOpp)}`, leadHistory: n(hLead), oppHistory: n(hOpp) };
    const ok = observed.parents === c.expect.parents && observed.leadHistory === c.expect.leadHistory && observed.oppHistory === c.expect.oppHistory;
    if (!ok) failed++;
    const actingWs = ((acting.data as { workspace_id: string; role_key: string }[] | null) ?? [])[0];
    results.push({ case: c.name, persisted, acting: actingWs ? `${actingWs.workspace_id === ws.A ? "A" : "B"}:${actingWs.role_key}` : "none",
      expected: c.expect, observed, http: { lead: pLead.status, opportunity: pOpp.status, leadHistory: hLead.status, oppHistory: hOpp.status }, pass: ok });
  }

  // Anonymous: no history at all.
  const anon = createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
  const aHist = (await anon.from("classification_events").select("id").eq("lead_id", lead)) as Q;
  const anonOk = Boolean(aHist.error) || (aHist.data ?? []).length === 0;
  if (!anonOk) failed++;
  results.push({ case: "anonymous", expected: "refused or empty", observed: aHist.error ? `refused(${aHist.status} ${aHist.error.code})` : (aHist.data ?? []).length, pass: anonOk });

  // Reads change nothing: the history rows are byte-for-byte as written.
  const historyAfter = sql(`select string_agg(id || ':' || md5(row(e.*)::text), ',' order by id) from sales.classification_events e where workspace_id='${ws.B}'`);
  const unchanged = historyBefore === historyAfter && historyAfter.split(",").length === 3;
  if (!unchanged) failed++;
  results.push({ case: "history unchanged by reads", expected: "3 rows, identical", observed: unchanged ? "3 rows, identical" : "changed", pass: unchanged });
} finally {
  sql(`delete from sales.classification_events where workspace_id in ('${ws.A}','${ws.B}');
       delete from sales.opportunities where workspace_id in ('${ws.A}','${ws.B}');
       delete from sales.leads where workspace_id in ('${ws.A}','${ws.B}');
       delete from core.opportunity_stages where workspace_id in ('${ws.A}','${ws.B}');
       delete from core.memberships where workspace_id in ('${ws.A}','${ws.B}');
       delete from core.workspaces where id in ('${ws.A}','${ws.B}');`);
  for (const uid of users) {
    const r = await admin.auth.admin.deleteUser(uid);
    assert.ifError(r.error);
  }
}

const residue = sql(`select (select count(*) from core.workspaces where slug like '${TAG}%') + (select count(*) from sales.leads where raw_name like '${TAG}%')
  + (select count(*) from sales.opportunities where name like '${TAG}%') + (select count(*) from sales.classification_events where reason like '${TAG}%')
  + (select count(*) from auth.users where email like '${TAG}%') + (select count(*) from core.memberships where user_id in (${users.map((u) => `'${u}'`).join(",") || "null"}))`);
// The checkout whose migrations are applied (an integration worktree may differ from this file's).
const head = execFileSync("git", ["-C", process.env.PROBE_GIT_DIR ?? ".", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const migrations = sql("select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version >= '20261029000000'");
const policy = sql("select qual from pg_policies where schemaname='sales' and tablename='classification_events' and policyname='member_read'");
const report = { tag: TAG, head, migrations, tile62, policy, results, failed, residue: Number(residue) };
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.case}: ${r.persisted ? `persisted ${r.persisted} acting ${r.acting} ` : ""}expected ${JSON.stringify(r.expected)} observed ${JSON.stringify(r.observed)}${r.http ? ` http ${JSON.stringify(r.http)}` : ""}`);
console.log(`head ${head} · TILE-62 applied: ${tile62} · migrations ≥20261029: ${migrations} · residue after cleanup ${residue}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exit(failed === 0 && Number(residue) === 0 ? 0 : 1);
