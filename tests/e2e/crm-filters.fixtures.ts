/**
 * Suite-owned fixtures for crm-filters.spec.ts, against the LOCAL Supabase
 * stack only. Every record and user carries this run's id, so the suite never
 * reuses or signs out a shared demo user and never touches another suite's
 * rows. Synthetic data only: no contact points, no real names.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const WORKSPACE = "11111111-1111-1111-1111-111111111111";
export const OTHER_WORKSPACE = randomUUID();
export const RUN = randomUUID().slice(0, 8);
export const PREFIX = `E2E CRMF ${RUN}`;
export const PASSWORD = `E2e!${randomBytes(12).toString("hex")}`;

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });

type UserKey = "owner" | "peer" | "denied" | "foreign";
export const USERS: Record<UserKey, { email: string; name: string; role: string; workspace: string; id?: string }> = {
  owner: { email: `e2e.crmf.${RUN}.owner@tileconcept.test`, name: `${PREFIX} Owner`, role: "sales_rep", workspace: WORKSPACE },
  peer: { email: `e2e.crmf.${RUN}.peer@tileconcept.test`, name: `${PREFIX} Peer`, role: "sales_rep", workspace: WORKSPACE },
  // catalog_pricing has no sales.read in core.role_permissions.
  denied: { email: `e2e.crmf.${RUN}.denied@tileconcept.test`, name: `${PREFIX} Denied`, role: "catalog_pricing", workspace: WORKSPACE },
  foreign: { email: `e2e.crmf.${RUN}.foreign@tileconcept.test`, name: `${PREFIX} Foreign`, role: "sales_rep", workspace: OTHER_WORKSPACE },
};

interface ContactFixture { name: string; type: string; source: string; life: string; activityDaysAgo?: number; workspace: string }
interface AccountFixture { name: string; type: string; source: string; life: string; owner?: UserKey; workspace: string }

export const CONTACTS: ContactFixture[] = [
  { name: "Alpha", type: "homeowner", source: "walk_in", life: "new", activityDaysAgo: 2, workspace: WORKSPACE },
  { name: "Bravo", type: "contractor", source: "tiktok", life: "active", activityDaysAgo: 20, workspace: WORKSPACE },
  { name: "Charlie", type: "contractor", source: "walk_in", life: "repeat", activityDaysAgo: 60, workspace: WORKSPACE },
  { name: "Delta", type: "designer", source: "referral", life: "lapsed", workspace: WORKSPACE },
  { name: "Foreign Echo", type: "contractor", source: "walk_in", life: "active", activityDaysAgo: 2, workspace: OTHER_WORKSPACE },
  { name: "Foreign Fox", type: "homeowner", source: "tiktok", life: "new", workspace: OTHER_WORKSPACE },
];

export const ACCOUNTS: AccountFixture[] = [
  { name: "Acme", type: "contractor", source: "walk_in", life: "active", owner: "owner", workspace: WORKSPACE },
  { name: "Beacon", type: "developer", source: "tiktok", life: "new", workspace: WORKSPACE },
  { name: "Cobalt", type: "contractor", source: "referral", life: "repeat", owner: "peer", workspace: WORKSPACE },
  { name: "Dune", type: "designer", source: "walk_in", life: "lapsed", workspace: WORKSPACE },
  { name: "Foreign Gamma", type: "contractor", source: "walk_in", life: "active", owner: "foreign", workspace: OTHER_WORKSPACE },
  { name: "Foreign Halo", type: "designer", source: "referral", life: "new", workspace: OTHER_WORKSPACE },
];

export const fullName = (name: string) => `${PREFIX} ${name}`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function createFixtures() {
  sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WORKSPACE}','E2E CRM filters other workspace','e2e-crmf-${RUN}')`);
  for (const user of Object.values(USERS)) {
    const { data, error } = await admin.auth.admin.createUser({ email: user.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: user.name } });
    if (error) throw error;
    user.id = data.user.id;
    sql(`insert into core.memberships(workspace_id,user_id,role_key) values ('${user.workspace}','${user.id}','${user.role}')`);
  }
  const contacts = CONTACTS.map((c) => `(${lit(c.workspace)},${lit(fullName(c.name))},${lit(c.type)},${lit(c.life)},${lit(c.source)})`).join(",");
  sql(`insert into identity.contacts(workspace_id,display_name,customer_type,lifecycle_state,original_acquisition_source) values ${contacts}`);
  const accounts = ACCOUNTS.map((a) => `(${lit(a.workspace)},${lit(fullName(a.name))},${lit(a.type)},${lit(a.life)},${lit(a.source)},${a.owner ? lit(USERS[a.owner].id!) : "null"})`).join(",");
  sql(`insert into identity.accounts(workspace_id,name,account_type,lifecycle_state,original_acquisition_source,owner_id) values ${accounts}`);
  for (const c of CONTACTS.filter((c) => c.activityDaysAgo !== undefined)) {
    sql(`insert into sales.activities(workspace_id,kind,subject,occurred_at,contact_id)
         select workspace_id,'note','E2E CRM filter fixture',now() - interval '${c.activityDaysAgo} days',id from identity.contacts
         where workspace_id=${lit(c.workspace)} and display_name=${lit(fullName(c.name))}`);
  }
}

export async function removeFixtures() {
  const like = lit(`${PREFIX} %`);
  sql(`delete from sales.activities where contact_id in (select id from identity.contacts where display_name like ${like} and workspace_id in ('${WORKSPACE}','${OTHER_WORKSPACE}'));
       delete from identity.contacts where display_name like ${like} and workspace_id in ('${WORKSPACE}','${OTHER_WORKSPACE}');
       delete from identity.accounts where name like ${like} and workspace_id in ('${WORKSPACE}','${OTHER_WORKSPACE}');`);
  for (const user of Object.values(USERS)) {
    if (!user.id) continue;
    sql(`delete from core.memberships where user_id='${user.id}'`);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }
  sql(`delete from core.workspaces where id='${OTHER_WORKSPACE}'`);
}

/** Rows left behind by this run; cleanup is verified, not assumed. */
export function leftovers() {
  const like = lit(`${PREFIX} %`);
  return Number(sql(`select (select count(*) from identity.contacts where display_name like ${like})
    + (select count(*) from identity.accounts where name like ${like})
    + (select count(*) from auth.users where email like ${lit(`e2e.crmf.${RUN}.%`)})
    + (select count(*) from core.workspaces where id='${OTHER_WORKSPACE}')`));
}

/**
 * A signed-in API client for one suite-owned user, using the publishable key
 * exactly as the app does. Sessions are never persisted and never signed out
 * globally; deleting the user at teardown ends them.
 */
export async function serviceAs(user: UserKey) {
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: USERS[user].email, password: PASSWORD });
  if (error) throw error;
  return client;
}
