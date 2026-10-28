/**
 * TILE-59 local-only check over HTTP (PostgREST + GoTrue): members cannot start,
 * finish or write connector runs and checkpoints; the service-role worker can,
 * and only a complete success moves freshness or the cursor. Synthetic fixtures,
 * removed at the end; never prints credentials.
 *   pnpm exec tsx tests/integration/connector-sync-guards.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const url = status.API_URL;
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test refuses hosted targets");
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const secretKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
assert(anonKey && secretKey, "Local API keys unavailable");
const options = { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } };
const memberClient = () => createClient(url, anonKey, options);
type Client = ReturnType<typeof memberClient>;
const worker = createClient(url, secretKey, options);
const workspaceA = "11111111-1111-1111-1111-111111111111";
const tag = `tile59-${randomUUID()}`;
function sql(query: string) { return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
// Everything a sync could touch, in every workspace.
const fingerprint = () => sql(`select md5(concat_ws('|',
  (select string_agg(to_jsonb(c)::text, ',' order by c.id) from ingest.integration_connections c),
  (select string_agg(to_jsonb(r)::text, ',' order by r.id) from ingest.sync_runs r),
  (select string_agg(to_jsonb(k)::text, ',' order by k.id) from ingest.connector_checkpoints k),
  (select count(*)::text from ingest.data_quality_issues),
  (select count(*)::text from audit.audit_events e where e.object_table in ('sync_runs','connector_checkpoints','integration_connections'))))`);
const connection = () => sql(`select status||'|'||last_success_at::date||'|'||coalesce(last_error,'-') from ingest.integration_connections where id='${conn}'`);
const cursor = () => sql(`select cursor from ingest.connector_checkpoints where connection_id='${conn}' and stream='default'`);

const userIds: string[] = [];
let conn = "";
try {
  conn = sql(`insert into ingest.integration_connections(workspace_id, provider, name, environment, direction, status, last_success_at)
    values ('${workspaceA}', 'synthetic_probe', 'Synthetic ${tag}', 'demo', 'pull', 'healthy', '2026-01-01T00:00:00Z') returning id`);
  sql(`insert into ingest.connector_checkpoints(connection_id, stream, cursor, updated_at) values ('${conn}', 'default', 'synthetic-0', '2026-01-01T00:00:00Z')`);
  const pending = sql(`insert into ingest.sync_runs(connection_id, status, started_at) values ('${conn}', 'running', '2026-01-02T00:00:00Z') returning id`);
  const workspaceB = sql("select core.demo_workspace_id()");

  // anon, no membership, audit.read without settings.manage, admin elsewhere, admin here
  const callers: [string, Client][] = [["anon", memberClient()]];
  for (const [who, workspace, role] of [["no membership", null, null], ["showroom A", workspaceA, "showroom"], ["admin B", workspaceB, "admin"], ["admin A", workspaceA, "admin"]] as const) {
    const email = `synthetic.${tag}.${role ?? "none"}.${workspace === workspaceB ? "b" : "a"}@example.test`;
    const password = randomUUID() + randomUUID();
    const created = await worker.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error); userIds.push(created.data.user!.id);
    if (workspace) sql(`insert into core.memberships(workspace_id, user_id, role_key) values ('${workspace}', '${created.data.user!.id}', '${role}')`);
    const client = memberClient();
    const signedIn = await client.auth.signInWithPassword({ email, password }); assert.ifError(signedIn.error);
    callers.push([who, client]);
  }

  const before = fingerprint();
  for (const [who, client] of callers) {
    const attempts = {
      "rpc start_sync_run": client.rpc("start_sync_run", { p_connection_id: conn }),
      "rpc finish_sync_run": client.rpc("finish_sync_run", { p_run_id: pending, p_status: "partial", p_read: 5, p_rejected: 5, p_checkpoint: "probe" }),
      "insert sync_runs": client.from("sync_runs").insert({ connection_id: conn, status: "succeeded" }),
      "update sync_runs": client.from("sync_runs").update({ records_read: 99 }).eq("connection_id", conn).select(),
      "delete sync_runs": client.from("sync_runs").delete().eq("connection_id", conn).select(),
      "upsert connector_checkpoints": client.from("connector_checkpoints").upsert({ connection_id: conn, stream: "default", cursor: "probe" }, { onConflict: "connection_id,stream" }),
      "update connector_checkpoints": client.from("connector_checkpoints").update({ cursor: "probe" }).eq("connection_id", conn).select(),
      "delete connector_checkpoints": client.from("connector_checkpoints").delete().eq("connection_id", conn).select(),
    };
    for (const [what, attempt] of Object.entries(attempts)) {
      const { error } = await attempt;
      assert.equal(error?.code, "42501", `${who}: ${what} must be refused`);
    }
  }
  assert.equal(fingerprint(), before, "refused calls changed nothing");

  const visible = async (client: Client) => {
    const [runs, checkpoints] = await Promise.all([
      client.from("sync_runs").select("id").eq("connection_id", conn),
      client.from("connector_checkpoints").select("cursor").eq("connection_id", conn),
    ]);
    return runs.error || checkpoints.error ? "refused" : `${runs.data.length}/${checkpoints.data.length}`;
  };
  const reader = Object.fromEntries(callers);
  assert.equal(await visible(reader["showroom A"]), "1/1", "audit.read in A still reads A runs and checkpoints");
  assert.equal(await visible(reader["admin A"]), "1/1", "admin A still reads A runs and checkpoints");
  assert.equal(await visible(reader["admin B"]), "0/0", "admin B reads nothing of A");
  assert.equal(await visible(reader["no membership"]), "0/0", "no membership reads nothing");
  assert.equal(await visible(reader.anon), "refused", "anon reads nothing");

  // The trusted worker
  const start = async () => { const r = await worker.rpc("start_sync_run", { p_connection_id: conn }); assert.ifError(r.error); return r.data as string; };
  const first = await start();
  assert.ifError((await worker.rpc("finish_sync_run", { p_run_id: first, p_status: "succeeded", p_read: 4, p_created: 4, p_checkpoint: "synthetic-1" })).error);
  assert.match(connection(), /^healthy\|\d{4}-\d\d-\d\d\|-$/); assert.notEqual(connection().split("|")[1], "2026-01-01");
  assert.equal(cursor(), "synthetic-1", "a complete success advances the cursor");
  assert.equal((await worker.rpc("finish_sync_run", { p_run_id: first, p_status: "succeeded", p_read: 99, p_checkpoint: "synthetic-replay" })).error?.code, "55000", "a finished run is final");
  assert.equal((await worker.rpc("finish_sync_run", { p_run_id: first, p_status: "bogus" })).error?.code, "22023", "invalid status refused");
  assert.equal(cursor(), "synthetic-1", "replays left the cursor alone");

  sql(`update ingest.integration_connections set last_success_at = '2026-01-01T00:00:00Z' where id = '${conn}'`);
  assert.ifError((await worker.rpc("finish_sync_run", { p_run_id: await start(), p_status: "partial", p_read: 6, p_created: 4, p_rejected: 2, p_error: "synthetic: 2 rows rejected", p_checkpoint: "synthetic-2" })).error);
  assert.equal(connection(), "degraded|2026-01-01|synthetic: 2 rows rejected", "partial keeps the last complete success and the detail");
  assert.equal(cursor(), "synthetic-1", "partial keeps the cursor");
  assert.ifError((await worker.rpc("finish_sync_run", { p_run_id: await start(), p_status: "failed", p_error: "synthetic: provider timeout", p_checkpoint: "synthetic-3" })).error);
  assert.equal(connection(), "failed|2026-01-01|synthetic: provider timeout", "failed keeps the last complete success and the error");
  assert.equal(cursor(), "synthetic-1", "failed keeps the cursor");
  assert.equal(await visible(reader["showroom A"]), "4/1", "audit.read in A reads the worker's runs");
  console.log("connector sync guards: ok");
} finally {
  for (const id of userIds) await worker.auth.admin.deleteUser(id);
  if (conn) {
    sql(`delete from ingest.data_quality_issues where object_id = '${conn}'`);
    sql(`delete from ingest.integration_connections where id = '${conn}'`);
  }
}
