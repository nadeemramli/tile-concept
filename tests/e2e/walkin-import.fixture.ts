/**
 * Suite-owned fixture for walkin-import.spec.ts. LOCAL Supabase only.
 *
 * Every run gets its own disposable workspace, location and users, so the
 * import can be committed for real without touching the seeded workspace,
 * the shared demo logins or another suite's records. Passwords are random per
 * run and never printed. `destroy()` removes everything the run created.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type FixtureRole = "showroom" | "management";
export type ServiceClient = Awaited<ReturnType<WalkinImportFixture["serviceClient"]>>;
export interface FixtureUser { id: string; email: string; password: string; fullName: string; role: FixtureRole }

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const API_URL: string = status.API_URL;
assert(["127.0.0.1", "localhost"].includes(new URL(API_URL).hostname), "The walk-in import suite refuses hosted targets");
const PUBLISHABLE_KEY: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const SECRET_KEY: string = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
assert(PUBLISHABLE_KEY && SECRET_KEY, "Local API keys unavailable");

const admin = createClient(API_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export class WalkinImportFixture {
  readonly run = randomUUID().slice(0, 8);
  readonly workspaceId = randomUUID();
  readonly locationId = randomUUID();
  readonly locationName = `E2E Walk-in Showroom ${this.run}`;
  readonly users: FixtureUser[] = [];

  async create() {
    sql(`insert into core.workspaces(id,slug,name) values ('${this.workspaceId}','e2e-walkin-${this.run}','E2E walk-in import ${this.run}');
         insert into core.business_locations(id,workspace_id,code,name,kind) values ('${this.locationId}','${this.workspaceId}','E2E-${this.run}','${this.locationName}','showroom');`);
  }

  async addUser(label: string, role: FixtureRole): Promise<FixtureUser> {
    const email = `e2e-walkin-${label}-${this.run}@example.test`;
    const password = randomBytes(24).toString("base64url");
    const fullName = `E2E ${label} ${this.run}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    assert.ifError(created.error);
    const id = created.data.user?.id;
    assert(id, "Fixture user was not created");
    const user: FixtureUser = { id, email, password, fullName, role };
    this.users.push(user);
    sql(`insert into core.memberships(workspace_id,user_id,role_key,default_location_id) values ('${this.workspaceId}','${id}','${role}','${this.locationId}')`);
    return user;
  }

  /** Changes a suite-owned member's role; only ever called on this run's users. */
  setRole(user: FixtureUser, role: FixtureRole) {
    assert(this.users.includes(user), "Refusing to change a user this run does not own");
    sql(`update core.memberships set role_key='${role}' where workspace_id='${this.workspaceId}' and user_id='${user.id}'`);
    user.role = role;
  }

  /** A separate API session for the fixture user: the app's normal security-invoker read path. */
  async serviceClient(user: FixtureUser) {
    const client = createClient(API_URL, PUBLISHABLE_KEY, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    assert.ifError(signedIn.error);
    return client;
  }

  async destroy() {
    const ws = this.workspaceId;
    // Workspace-scoped rows first for the foreign keys that do not cascade,
    // then the workspace (which cascades the rest), then the audit rows the
    // deletes themselves emitted. Scoped to this run's workspace id only.
    sql(`do $$
      declare r record;
      begin
        for r in select c.conrelid::regclass as tbl from pg_constraint c
                 where c.confrelid = 'core.workspaces'::regclass and c.contype = 'f' and c.confdeltype <> 'c' loop
          execute format('delete from %s where workspace_id = %L', r.tbl, '${ws}');
        end loop;
        delete from core.workspaces where id = '${ws}';
        delete from audit.audit_events where workspace_id = '${ws}';
        delete from audit.outbox_events where workspace_id = '${ws}';
      end $$;`);
    for (const user of this.users) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      assert.ifError(deleted.error);
    }
    assert.equal(sql(`select count(*) from core.workspaces where id='${ws}'`), "0");
  }
}
