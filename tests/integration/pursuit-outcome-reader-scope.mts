/**
 * TILE-88: who may read pursuit outcome history and the outcome report, through
 * the real local Auth (password sign-in) and PostgREST, per workspace.
 *
 *   pnpm exec tsx tests/integration/pursuit-outcome-reader-scope.mts [--expect=repaired|baseline] [--out=file.json]
 *
 * One subject user is a member of workspace A (the acting membership: oldest)
 * and workspace B. B holds an inquiry and two opportunities whose outcomes are
 * recorded by B's own salesperson through api.pursuit_outcome_command, plus a
 * reason correction (raw history has 4 events, the derived history 3). Between
 * cases only the subject's persisted memberships change. A is empty.
 *
 * Local only (refuses hosted targets). Synthetic fixtures, unique per run.
 * Outcome history is append-only by design, so the run's rows stay until the
 * local stack is reset. Never prints credentials. Exits 1 on any mismatch.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const expectMode = (args.expect ?? "repaired") as "repaired" | "baseline";
assert(["repaired", "baseline"].includes(expectMode), "--expect must be repaired or baseline");

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const url: string = status.API_URL;
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test refuses hosted targets");
const anonKey: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const secretKey: string = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
assert(anonKey && secretKey, "Local API keys unavailable");
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const RUN = randomUUID().slice(0, 8);
const PASSWORD = randomUUID() + randomUUID();
const ws = { A: randomUUID(), B: randomUUID(), C: randomUUID() };
const rec = { lead: randomUUID(), oppOther: randomUUID(), oppSubject: randomUUID() };
const people = { subject: "", seller: "", outsider: "" };
const emails = { subject: `outcome-reader-${RUN}@example.test`, seller: `outcome-seller-${RUN}@example.test`, outsider: `outcome-outsider-${RUN}@example.test` };

async function token(email: string) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const body = await r.json();
  assert.equal(r.status, 200, `password sign-in failed for a synthetic user: ${r.status}`);
  return body.access_token as string;
}
function headers(jwt: string | null) {
  return { apikey: anonKey, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), "accept-profile": "api", "content-profile": "api", "content-type": "application/json" };
}
async function rows(jwt: string | null, path: string) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: headers(jwt) });
  const body = await r.json();
  return { status: r.status, rows: Array.isArray(body) ? (body as Record<string, unknown>[]) : [], error: Array.isArray(body) ? null : (body as { code?: string }).code ?? null };
}
async function rpc(jwt: string | null, fn: string, payload: unknown) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(jwt), body: JSON.stringify(payload) });
  const body = await r.json();
  return { status: r.status, body };
}

// ---------------------------------------------------------------- fixtures
for (const k of Object.keys(people) as (keyof typeof people)[]) {
  const created = await admin.auth.admin.createUser({ email: emails[k], password: PASSWORD, email_confirm: true, user_metadata: { full_name: `Synthetic ${k} ${RUN}` } });
  assert.ifError(created.error);
  people[k] = created.data.user!.id;
}
sql(`
  insert into core.workspaces(id,slug,name) values
    ('${ws.A}','outcome-a-${RUN}','Synthetic outcome A ${RUN}'),('${ws.B}','outcome-b-${RUN}','Synthetic outcome B ${RUN}'),('${ws.C}','outcome-c-${RUN}','Synthetic outcome C ${RUN}');
  insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group,requires_reason,requires_next_action,is_active)
    select '${ws.B}',key,label,position,reporting_group,requires_reason,requires_next_action,is_active from core.opportunity_stages where workspace_id='11111111-1111-1111-1111-111111111111';
  insert into core.memberships(workspace_id,user_id,role_key,created_at) values
    ('${ws.A}','${people.subject}','admin',now()-interval '2 days'),
    ('${ws.B}','${people.subject}','admin',now()-interval '1 day'),
    ('${ws.B}','${people.seller}','sales_rep',now()),
    ('${ws.C}','${people.outsider}','admin',now());
  insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id) values
    ('${rec.lead}','${ws.B}','contacted','tiktok','Synthetic outcome lead ${RUN}','${people.seller}');
  insert into sales.opportunities(id,workspace_id,name,owner_id,stage_key,status,estimated_value,next_action,next_action_due_at) values
    ('${rec.oppOther}','${ws.B}','Synthetic seller opportunity ${RUN}','${people.seller}','consultation','open',5000,'Send options',now()+interval '1 day'),
    ('${rec.oppSubject}','${ws.B}','Synthetic subject opportunity ${RUN}','${people.subject}','consultation','open',7000,'Send options',now()+interval '1 day');
`);
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const review = new Date(Date.now() + 8 * 3600000 + 30 * 86400000).toISOString().slice(0, 10);
const seller = await token(emails.seller);
const recorded: Record<string, unknown> = {};
for (const [name, action, input] of [
  ["lead loss", "lose", { lead_id: rec.lead, reason_code: "unknown", effective_date: today }],
  ["opportunity loss (other owner)", "lose", { opportunity_id: rec.oppOther, reason_code: "competitor", competitor_relationship: "unknown", effective_date: today }],
  ["opportunity deferral (subject owner)", "defer", { opportunity_id: rec.oppSubject, reason_code: "timing", effective_date: today, review_date: review }],
] as const) {
  const r = await rpc(seller, "pursuit_outcome_command", { p_action: action, p_input: input, p_request_id: randomUUID() });
  assert.equal(r.status, 200, `${name} not recorded: ${JSON.stringify(r.body)}`);
  recorded[name] = r.body;
}
const leadEvent = (recorded["lead loss"] as { event_id: string }).event_id;
const correction = await rpc(seller, "pursuit_outcome_command", { p_action: "correct", p_input: { event_id: leadEvent, reason_code: "price", effective_date: today, correction_note: "Synthetic correction" }, p_request_id: randomUUID() });
assert.equal(correction.status, 200, `correction not recorded: ${JSON.stringify(correction.body)}`);

// ---------------------------------------------------------------- matrix
type Observed = { acting: string | null; leads: number; opps: number; raw: number; rawLead: number; rawOpp: number; derived: number; derivedLead: number; derivedOpp: number; rawStatus: number; derivedStatus: number; reportStatus: number; reportEvents: number; reportPursuits: number };
type Expected = Partial<Observed>;
const full = { leads: 1, opps: 2, raw: 4, rawLead: 2, rawOpp: 2, derived: 3, derivedLead: 1, derivedOpp: 2, rawStatus: 200, derivedStatus: 200 };
const showroom = { leads: 1, opps: 1, raw: 3, rawLead: 2, rawOpp: 1, derived: 2, derivedLead: 1, derivedOpp: 1, rawStatus: 200, derivedStatus: 200 };
const none = { leads: 0, opps: 0, raw: 0, rawLead: 0, rawOpp: 0, derived: 0, derivedLead: 0, derivedOpp: 0, rawStatus: 200, derivedStatus: 200 };
const hidden = { ...none, leads: undefined, opps: undefined };

const cases: { name: string; as: "subject" | "outsider" | "anonymous"; a?: string; b?: string | null; bStatus?: string; repaired: Expected; baseline: Expected }[] = [
  { name: "A admin / B admin", as: "subject", a: "admin", b: "admin",
    repaired: { ...full, reportStatus: 200, reportEvents: 3 }, baseline: { ...full, reportStatus: 200, reportEvents: 3 } },
  { name: "A catalog_pricing / B admin (A denied, B reader)", as: "subject", a: "catalog_pricing", b: "admin",
    repaired: { ...full, reportStatus: 200, reportEvents: 3 }, baseline: { ...full, raw: 0, rawLead: 0, rawOpp: 0, derived: 0, derivedLead: 0, derivedOpp: 0, reportStatus: 403 } },
  { name: "A analyst / B admin (A report-only, B reader)", as: "subject", a: "analyst", b: "admin",
    repaired: { ...full, reportStatus: 200, reportEvents: 3 }, baseline: { ...full, raw: 0, rawLead: 0, rawOpp: 0, derived: 0, derivedLead: 0, derivedOpp: 0, reportStatus: 200, reportEvents: 0 } },
  { name: "A admin / B catalog_pricing (A reader, B denied)", as: "subject", a: "admin", b: "catalog_pricing",
    repaired: { ...none, reportStatus: 200, reportEvents: 0 }, baseline: { ...none, reportStatus: 200, reportEvents: 0 } },
  { name: "A admin / B showroom (B sales.read without report.read; owner-only opportunities)", as: "subject", a: "admin", b: "showroom",
    repaired: { ...showroom, reportStatus: 200, reportEvents: 0 }, baseline: { ...showroom, reportStatus: 200, reportEvents: 2 } },
  { name: "A catalog_pricing / B showroom (no report reader anywhere)", as: "subject", a: "catalog_pricing", b: "showroom",
    repaired: { ...showroom, reportStatus: 403 }, baseline: { ...showroom, raw: 0, rawLead: 0, rawOpp: 0, derived: 0, derivedLead: 0, derivedOpp: 0, reportStatus: 403 } },
  { name: "A admin / B admin suspended (inactive)", as: "subject", a: "admin", b: "admin", bStatus: "suspended",
    repaired: { ...none, reportStatus: 200, reportEvents: 0 }, baseline: { ...none, reportStatus: 200, reportEvents: 0 } },
  { name: "A admin / B membership removed (revoked, nonmember)", as: "subject", a: "admin", b: null,
    repaired: { ...none, reportStatus: 200, reportEvents: 0 }, baseline: { ...none, reportStatus: 200, reportEvents: 0 } },
  { name: "Outsider: admin of unrelated C, never in B", as: "outsider",
    repaired: { ...none, reportStatus: 200, reportEvents: 0 }, baseline: { ...none, reportStatus: 200, reportEvents: 0 } },
  { name: "Anonymous", as: "anonymous",
    repaired: { ...hidden, rawStatus: 401, derivedStatus: 401, reportStatus: 401 }, baseline: { ...hidden, rawStatus: 401, derivedStatus: 401, reportStatus: 401 } },
];

function setMemberships(a: string, b: string | null, bStatus = "active") {
  sql(`update core.memberships set role_key='${a}', status='active' where user_id='${people.subject}' and workspace_id='${ws.A}';`);
  if (b === null) sql(`delete from core.memberships where user_id='${people.subject}' and workspace_id='${ws.B}';`);
  else sql(`insert into core.memberships(workspace_id,user_id,role_key,status,created_at) values ('${ws.B}','${people.subject}','${b}','${bStatus}',now()-interval '1 day')
            on conflict (workspace_id,user_id) do update set role_key=excluded.role_key, status=excluded.status;`);
  // Persisted state, read back from the database rather than assumed.
  return sql(`select string_agg(w || ':' || role_key || ':' || status, ' ' order by w) from (select case workspace_id when '${ws.A}' then 'A' when '${ws.B}' then 'B' else 'other' end w, role_key, status from core.memberships where user_id='${people.subject}') m`);
}

async function probe(jwt: string | null): Promise<Observed> {
  const B = `workspace_id=eq.${ws.B}`;
  const [me, leads, opps, raw, derived, report] = await Promise.all([
    jwt ? rpc(jwt, "my_membership", {}) : Promise.resolve({ status: 0, body: [] }),
    rows(jwt, `leads?select=id&${B}`), rows(jwt, `opportunities?select=id&${B}`),
    rows(jwt, `pursuit_outcome_events?select=id,lead_id,opportunity_id&${B}`),
    rows(jwt, `pursuit_outcome_history?select=id,lead_id,opportunity_id&${B}`),
    rpc(jwt, "report_pursuit_outcomes", {}),
  ]);
  const reportRows = Array.isArray(report.body) ? (report.body as { events: number; pursuits: number }[]) : [];
  const actingWs = Array.isArray(me.body) && me.body[0] ? (me.body[0] as { workspace_id: string }).workspace_id : null;
  return {
    acting: actingWs === ws.A ? "A" : actingWs === ws.B ? "B" : actingWs === ws.C ? "C" : actingWs,
    leads: leads.rows.length, opps: opps.rows.length,
    raw: raw.rows.length, rawLead: raw.rows.filter((r) => r.lead_id).length, rawOpp: raw.rows.filter((r) => !r.lead_id && r.opportunity_id).length,
    derived: derived.rows.length, derivedLead: derived.rows.filter((r) => r.lead_id).length, derivedOpp: derived.rows.filter((r) => !r.lead_id && r.opportunity_id).length,
    rawStatus: raw.status, derivedStatus: derived.status,
    reportStatus: report.status, reportEvents: reportRows.reduce((s, r) => s + Number(r.events), 0), reportPursuits: reportRows.reduce((s, r) => s + Number(r.pursuits), 0),
  };
}

const results = [];
let mismatches = 0;
for (const c of cases) {
  let persisted = "n/a";
  let jwt: string | null = null;
  if (c.as === "subject") { persisted = setMemberships(c.a!, c.b ?? null, c.bStatus); jwt = await token(emails.subject); }
  if (c.as === "outsider") jwt = await token(emails.outsider);
  const observed = await probe(jwt);
  const expected = c[expectMode];
  const diff = Object.entries(expected).filter(([k, v]) => v !== undefined && observed[k as keyof Observed] !== v).map(([k, v]) => `${k}: expected ${v}, observed ${observed[k as keyof Observed]}`);
  if (c.as === "subject" && observed.acting !== "A") diff.push(`acting: expected A, observed ${observed.acting}`);
  mismatches += diff.length ? 1 : 0;
  results.push({ case: c.name, persisted, observed, expected, verdict: diff.length ? "MISMATCH" : "match", diff });
  console.log(`${diff.length ? "✘" : "✓"} ${c.name}\n    persisted ${persisted} · acting ${observed.acting} · parents lead ${observed.leads} opp ${observed.opps} · raw ${observed.rawStatus}/${observed.raw} (lead ${observed.rawLead}, opp ${observed.rawOpp}) · derived ${observed.derivedStatus}/${observed.derived} (lead ${observed.derivedLead}, opp ${observed.derivedOpp}) · report ${observed.reportStatus}/events ${observed.reportEvents}${diff.length ? `\n    ${diff.join("\n    ")}` : ""}`);
}
// Reading B never lets the subject write B from the acting membership A
// (TILE-62's acting-workspace command guard; this probe runs in that order).
{
  setMemberships("admin", "admin");
  const subject = await token(emails.subject);
  const before = sql(`select count(*) from sales.pursuit_outcome_events where workspace_id='${ws.B}'`);
  const write = await rpc(subject, "pursuit_outcome_command", { p_action: "reopen", p_input: { opportunity_id: rec.oppSubject, reason_detail: "Synthetic cross-workspace reopen", next_follow_up_at: new Date(Date.now() + 86400000).toISOString(), next_action: "Call" }, p_request_id: randomUUID() });
  const after = sql(`select count(*) from sales.pursuit_outcome_events where workspace_id='${ws.B}'`);
  const ok = write.status === 403 && (write.body as { code?: string }).code === "42501" && before === after;
  mismatches += ok ? 0 : 1;
  results.push({ case: "B reader acting in A cannot write B outcomes", observed: { status: write.status, code: (write.body as { code?: string }).code, eventsBefore: before, eventsAfter: after }, expected: { status: 403, code: "42501", unchanged: true }, verdict: ok ? "match" : "MISMATCH", diff: ok ? [] : ["write was not refused or history changed"] });
  console.log(`${ok ? "✓" : "✘"} B reader acting in A cannot write B outcomes\n    command ${write.status}/${(write.body as { code?: string }).code} · B events ${before} → ${after}`);
}
// Leave the subject as a plain B admin again: the retained fixture is inert.
setMemberships("admin", "admin");

const summary = { run: RUN, expect: expectMode, cases: results.length, mismatches, migrations: sql("select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where version >= '20261029'"), results };
if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 2));
console.log(`\n${results.length - mismatches}/${results.length} cases match the ${expectMode} expectation (run ${RUN}).`);
process.exit(mismatches ? 1 : 0);
