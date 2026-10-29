/**
 * TILE-89: forecast history and the forecast readers (forecast_rows,
 * forecast_queue, forecast_week) must read each opportunity with the caller's
 * own active sales.read in THAT opportunity's workspace, under the
 * opportunity's existing RLS — never refused or hidden because the acting
 * membership (another workspace) lacks sales.read, never opened by it.
 *
 * Normal path only: real password sign-in through Auth, then GETs and RPCs over
 * PostgREST, exactly as the app calls them. Local stack only (refuses hosted
 * targets). Every user, workspace, membership and opportunity is synthetic,
 * created by this run under its own tag; each opportunity's history row is the
 * one its own capture trigger writes. Everything is removed at the end through
 * the normal cascade (verified to zero); no guard is disabled. Nobody is signed
 * out globally.
 *
 *   pnpm exec tsx tests/integration/forecast-history-reads.mts [--json=<file>]
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

const TAG = `tile89-${randomBytes(4).toString("hex")}`;
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const tile62 = sql("select position('current_workspace_id' in pg_get_functiondef('core.has_permission(text)'::regprocedure)) > 0") === "t";

// One open opportunity in each workspace, expected to close in the fixture week
// (Monday 2 Nov – Sunday 8 Nov 2026, Kuala Lumpur). A's has no owner; B's is
// owned by the "owner" case.
const WEEK = "2026-11-02";
const AS_OF = "2026-11-02T01:00:00Z";
const ws = { A: randomUUID(), B: randomUUID() };
const opp = { A: randomUUID(), B: randomUUID() };
const users: string[] = [];

type Membership = { ws: keyof typeof ws; role: string; status?: "active" | "suspended"; revoke?: boolean };
// A/B: the caller may read that workspace's opportunity — own active sales.read
// there and the owner scoping allows it. That decides history in every order.
// The opportunity itself follows its own policy: with TILE-62 the same rule;
// before TILE-62 (pre62, "A/B") it still unions permissions across memberships,
// which is TILE-62's repair, not this one. The readers return exactly the
// visible opportunities; the as-recorded view finds a row only through history.
interface Case { name: string; memberships: Membership[]; owner?: boolean; expect: { A: boolean; B: boolean; pre62?: string; readers: "ok" | "denied" } }

// A is always the OLDER membership, so it is the acting workspace.
const CASES: Case[] = [
  { name: "admin A + admin B", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "admin" }], expect: { A: true, B: true, readers: "ok" } },
  { name: "acting A without sales.read + admin B", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "admin" }], expect: { A: false, B: true, pre62: "1/1", readers: "ok" } },
  { name: "admin A + no sales.read in B", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "catalog_pricing" }], expect: { A: true, B: false, pre62: "1/1", readers: "ok" } },
  { name: "acting A without sales.read + suspended admin B", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "admin", status: "suspended" }], expect: { A: false, B: false, readers: "denied" } },
  { name: "admin A + revoked admin B", memberships: [{ ws: "A", role: "admin" }, { ws: "B", role: "admin", revoke: true }], expect: { A: true, B: false, readers: "ok" } },
  { name: "admin A, not a member of B", memberships: [{ ws: "A", role: "admin" }], expect: { A: true, B: false, readers: "ok" } },
  { name: "acting A without sales.read + sales.read-only B, not the owner", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "marketing_coordinator" }], expect: { A: false, B: false, pre62: "1/0", readers: "ok" } },
  { name: "acting A without sales.read + sales.read-only B, the owner", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "marketing_coordinator" }], owner: true, expect: { A: false, B: true, pre62: "1/1", readers: "ok" } },
  { name: "acting A without sales.read + showroom B (shared inquiries, not opportunities)", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "showroom" }], expect: { A: false, B: false, pre62: "1/0", readers: "ok" } },
  { name: "no sales.read anywhere", memberships: [{ ws: "A", role: "catalog_pricing" }, { ws: "B", role: "catalog_pricing" }], expect: { A: false, B: false, readers: "denied" } },
];

type R = { data: unknown; error: { code?: string; message?: string } | null; status: number };
const ids = (r: R) => ((r.data as { id: string }[] | null) ?? []).map((x) => x.id);
const vis = (list: string[]) => `${list.includes(opp.A) ? 1 : 0}/${list.includes(opp.B) ? 1 : 0}`;
const reader = (r: R, f: (r: R) => string) => (r.error ? (r.status === 403 && r.error.code === "42501" ? "denied" : `error(${r.status} ${r.error.code})`) : f(r));

const results: Record<string, unknown>[] = [];
let failed = 0;
try {
  sql(`insert into core.workspaces(id,slug,name) values ('${ws.A}','${TAG}-a','${TAG} A'),('${ws.B}','${TAG}-b','${TAG} B');
    insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group) values ('${ws.A}','quote_sent','Quote sent',1,'open'),('${ws.B}','quote_sent','Quote sent',1,'open');`);

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
  sql(`insert into sales.opportunities(id,workspace_id,name,stage_key,status,owner_id,expected_close_date,probability_band,estimated_value,currency) values
    ('${opp.A}','${ws.A}','${TAG} synthetic opportunity A','quote_sent','open',null,'2026-11-04','high',1000,'MYR'),
    ('${opp.B}','${ws.B}','${TAG} synthetic opportunity B','quote_sent','open','${owner}','2026-11-05','medium',2000,'MYR');`);
  const historyBefore = sql(`select string_agg(opportunity_id || ':' || kind || ':' || md5(row(h.*)::text), ',' order by opportunity_id) from sales.opportunity_forecast_history h where workspace_id in ('${ws.A}','${ws.B}')`);
  assert.equal(historyBefore.split(",").length, 2, "each opportunity's own trigger wrote exactly one history row");

  for (const { c, email, password, uid } of prepared) {
    const persisted = sql(`select coalesce(string_agg(case workspace_id when '${ws.A}' then 'A' else 'B' end || ':' || role_key || ':' || status, ',' order by created_at), 'none') from core.memberships where user_id='${uid}'`);
    const bSalesRead = sql(`select exists(select 1 from core.memberships m join core.role_permissions rp on rp.role_key=m.role_key where m.user_id='${uid}' and m.workspace_id='${ws.B}' and m.status='active' and rp.permission='sales.read')`);
    const client = createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signedIn.error);
    const acting = await client.rpc("my_membership");
    const parents = (await client.from("opportunities").select("id").in("id", [opp.A, opp.B])) as R;
    // The app's own history read (src/server/queries/forecast.ts selects by opportunity).
    const history = (await client.from("opportunity_forecast_history").select("id, opportunity_id").in("opportunity_id", [opp.A, opp.B])) as R;
    const rows = (await client.rpc("forecast_rows", { p_mode: "current" })) as R;
    const recorded = (await client.rpc("forecast_rows", { p_mode: "recorded" })) as R;
    const queue = (await client.rpc("forecast_queue", { p_queue: "week", p_week_start: WEEK, p_mode: "current", p_as_of: AS_OF })) as R;
    const week = (await client.rpc("forecast_week", { p_week_start: WEEK, p_mode: "current", p_as_of: AS_OF })) as R;

    const ownRows = (r: R) => ((r.data as { id: string; recorded: boolean }[] | null) ?? []).filter((x) => x.id === opp.A || x.id === opp.B);
    const observed = {
      parents: parents.error ? `error(${parents.status})` : vis(ids(parents)),
      history: history.error ? `error(${history.status})` : vis(((history.data as { opportunity_id: string }[] | null) ?? []).map((h) => h.opportunity_id)),
      forecast_rows: reader(rows, (r) => vis(ids(r))),
      recorded_rows: reader(recorded, (r) => vis(ownRows(r).filter((x) => x.recorded).map((x) => x.id))),
      forecast_queue: reader(queue, (r) => vis(ids(r))),
      // Only this run's two opportunities close in the fixture week for these users.
      week_count: reader(week, (r) => String((r.data as { week_count: number }).week_count)),
    };
    const h = `${c.expect.A ? 1 : 0}/${c.expect.B ? 1 : 0}`;
    const v = !tile62 && c.expect.pre62 ? c.expect.pre62 : h;
    const [pA, pB] = v.split("/").map((x) => x === "1");
    const rec = `${pA && c.expect.A ? 1 : 0}/${pB && c.expect.B ? 1 : 0}`;
    const n = String(Number(pA) + Number(pB));
    const expected = c.expect.readers === "denied"
      ? { parents: v, history: h, forecast_rows: "denied", recorded_rows: "denied", forecast_queue: "denied", week_count: "denied" }
      : { parents: v, history: h, forecast_rows: v, recorded_rows: rec, forecast_queue: v, week_count: n };
    const ok = JSON.stringify(observed) === JSON.stringify(expected);
    if (!ok) failed++;
    const actingWs = ((acting.data as { workspace_id: string; role_key: string }[] | null) ?? [])[0];
    const deniedMessage = [rows, queue, week].find((r) => r.error)?.error?.message ?? null;
    results.push({ case: c.name, persisted, persisted_B_sales_read: bSalesRead, acting: actingWs ? `${actingWs.workspace_id === ws.A ? "A" : "B"}:${actingWs.role_key}` : "none",
      expected, observed, denied_message: deniedMessage, http: { parents: parents.status, history: history.status, rows: rows.status, queue: queue.status, week: week.status }, pass: ok });
  }

  // Anonymous: no history and no forecast reader.
  const anon = createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
  const aHist = (await anon.from("opportunity_forecast_history").select("id").in("opportunity_id", [opp.A, opp.B])) as R;
  const aWeek = (await anon.rpc("forecast_week", { p_week_start: WEEK })) as R;
  const aRows = (await anon.rpc("forecast_rows", {})) as R;
  const aQueue = (await anon.rpc("forecast_queue", { p_queue: "week" })) as R;
  const anonObserved = { history: aHist.status, forecast_week: aWeek.status, forecast_rows: aRows.status, forecast_queue: aQueue.status };
  const anonOk = Object.values(anonObserved).every((s) => s === 401);
  if (!anonOk) failed++;
  results.push({ case: "anonymous", expected: "401 everywhere", observed: anonObserved, pass: anonOk });

  // Reads change nothing: the history rows are byte-for-byte as their triggers wrote them.
  const historyAfter = sql(`select string_agg(opportunity_id || ':' || kind || ':' || md5(row(h.*)::text), ',' order by opportunity_id) from sales.opportunity_forecast_history h where workspace_id in ('${ws.A}','${ws.B}')`);
  const unchanged = historyBefore === historyAfter;
  if (!unchanged) failed++;
  results.push({ case: "history unchanged by reads", expected: "2 rows, identical", observed: unchanged ? "2 rows, identical" : "changed", pass: unchanged });
} finally {
  // Normal cascade: deleting the opportunity removes its history (the append-only
  // guard allows exactly that), then the workspaces.
  sql(`delete from sales.opportunities where workspace_id in ('${ws.A}','${ws.B}');
       delete from core.memberships where workspace_id in ('${ws.A}','${ws.B}');
       delete from core.workspaces where id in ('${ws.A}','${ws.B}');`);
  for (const uid of users) {
    const r = await admin.auth.admin.deleteUser(uid);
    assert.ifError(r.error);
  }
}

const residue = sql(`select (select count(*) from core.workspaces where slug like '${TAG}%') + (select count(*) from sales.opportunities where name like '${TAG}%')
  + (select count(*) from sales.opportunity_forecast_history where opportunity_id in ('${opp.A}','${opp.B}'))
  + (select count(*) from auth.users where email like '${TAG}%') + (select count(*) from core.memberships where user_id in (${users.map((u) => `'${u}'`).join(",") || "null"}))`);
const guard = sql("select count(*) from pg_trigger where tgname='forecast_history_append_only' and tgenabled='O'");
const head = execFileSync("git", ["-C", process.env.PROBE_GIT_DIR ?? ".", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const migrations = sql("select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version >= '20261029000000'");
const report = { tag: TAG, head, migrations, tile62, results, failed, residue: Number(residue), append_only_guard_enabled: guard === "1" };
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.case}: ${r.persisted ? `persisted ${r.persisted} B sales.read=${r.persisted_B_sales_read} acting ${r.acting} ` : ""}expected ${JSON.stringify(r.expected)} observed ${JSON.stringify(r.observed)}${r.http ? ` http ${JSON.stringify(r.http)}` : ""}${r.denied_message ? ` "${r.denied_message}"` : ""}`);
console.log(`head ${head} · TILE-62 applied: ${tile62} · migrations ≥20261029: ${migrations} · residue after cleanup ${residue} · append-only guard enabled ${guard === "1"}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exit(failed === 0 && Number(residue) === 0 && guard === "1" ? 0 : 1);
