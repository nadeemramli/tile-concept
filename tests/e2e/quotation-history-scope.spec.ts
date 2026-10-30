/**
 * TILE-85: the five quotation history/reference/evidence API views, read with a
 * real password sign-in (GoTrue) and real PostgREST GETs against the LOCAL
 * Supabase stack. Each row is authorized by the caller's own membership in that
 * row's workspace; a permission held in another workspace never reads it.
 *
 * The suite owns everything it touches: three workspaces, two users and one row
 * per view in A and B. Nobody signs out globally, so no other suite's session is
 * affected. It refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const VIEWS = ["quote_references", "quote_deliveries", "quote_delivery_voids", "quote_events", "visit_quote_evidence_decisions"] as const;
const PASSWORD = `E2e!${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const WS = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const emails = { mixed: `tile85-mixed-${tag}@e2e.test`, outsider: `tile85-outsider-${tag}@e2e.test` };
const users = { mixed: "", outsider: "" };

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });
const PUBLIC_KEY: string = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const client = () => createClient(status.API_URL, PUBLIC_KEY, { db: { schema: "api" }, auth: { persistSession: false } });

/** Rows of a workspace each view returns to this client, as view=count. */
async function visible(db: ReturnType<typeof client>, ws: string) {
  const out: string[] = [];
  for (const view of VIEWS) {
    const { data, error } = await db.from(view).select("workspace_id").eq("workspace_id", ws);
    if (error) throw new Error(`${view}: ${error.message}`);
    out.push(`${view}=${data.length}`);
  }
  return out.join(",");
}
const all = (n: number) => VIEWS.map((v) => `${v}=${n}`).join(",");
const setRole = (ws: string, role: string) => sql(`with u as (update core.memberships set role_key = '${role}' where workspace_id = '${ws}' and user_id = '${users.mixed}' returning role_key) select string_agg(role_key, ',') from u`);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
    const { data, error } = await admin.auth.admin.createUser({ email: emails[key], password: PASSWORD, email_confirm: true, user_metadata: { full_name: `E2E TILE-85 ${key} ${tag}` } });
    if (error || !data.user) throw error ?? new Error("user not created");
    users[key] = data.user.id;
  }
  sql(`insert into core.workspaces(id, slug, name) values ('${WS.a}', 'e2e-t85a-${tag}', 'E2E TILE-85 A ${tag}'), ('${WS.b}', 'e2e-t85b-${tag}', 'E2E TILE-85 B ${tag}'), ('${WS.c}', 'e2e-t85c-${tag}', 'E2E TILE-85 C ${tag}');
    insert into core.memberships(workspace_id, user_id, role_key, created_at) values
      ('${WS.a}', '${users.mixed}', 'admin', now() - interval '2 days'),
      ('${WS.b}', '${users.mixed}', 'catalog_pricing', now() - interval '1 day'),
      ('${WS.c}', '${users.outsider}', 'admin', now());
    do $$
    declare ws uuid; v uuid; q uuid; qv uuid; d uuid; f uuid;
    begin
      foreach ws in array array['${WS.a}', '${WS.b}']::uuid[] loop
        insert into sales.visits(workspace_id, purpose) values (ws, 'consultation') returning id into v;
        insert into sales.quotes(workspace_id, visit_id, status, current_version_no, origin) values (ws, v, 'issued', 1, 'visit') returning id into q;
        insert into sales.quote_versions(workspace_id, quote_id, version_no, prepared_at, issued_at, currency, evidence_state)
          values (ws, q, 1, now() - interval '1 hour', now() - interval '30 minutes', 'MYR', 'staff_entered') returning id into qv;
        insert into sales.quote_references(workspace_id, ref_key, quote_id, ref_text, ref_kind) values (ws, 'SQE2ET85' || upper(replace(ws::text, '-', '')), q, 'SQ-E2E-T85', 'external_ref');
        insert into sales.quote_deliveries(workspace_id, quote_id, quote_version_id, sent_at, channel, sent_by, evidence, recorded_by, request_id)
          values (ws, q, qv, now() - interval '10 minutes', 'email', '${users.mixed}', 'staff_attested', '${users.mixed}', gen_random_uuid()) returning id into d;
        insert into sales.quote_delivery_voids(delivery_id, workspace_id, reason, voided_by) values (d, ws, 'Synthetic void', '${users.mixed}');
        insert into sales.quote_events(workspace_id, quote_id, quote_version_id, event_type, occurred_at) values (ws, q, qv, 'issued', now());
        insert into sales.visit_quotation_files(id, workspace_id, visit_id, object_path, file_name, content_type, file_size, created_by, uploaded_at)
          values (gen_random_uuid(), ws, v, ws || '/' || v || '/e2e-t85.pdf', 'e2e-t85.pdf', 'application/pdf', 10, '${users.mixed}', now()) returning id into f;
        insert into sales.visit_quote_evidence_decisions(workspace_id, visit_id, evidence_kind, file_id, resolution, quote_id, snapshot, decided_by)
          values (ws, v, 'file', f, 'linked', q, '{}', '${users.mixed}');
      end loop;
    end $$;`);
});

test.afterAll(async () => {
  sql(`delete from audit.audit_events where workspace_id in ('${WS.a}', '${WS.b}', '${WS.c}'); delete from core.workspaces where id in ('${WS.a}', '${WS.b}', '${WS.c}');`);
  for (const id of Object.values(users)) if (id) await admin.auth.admin.deleteUser(id);
  const left = sql(`select (select count(*) from core.workspaces where id in ('${WS.a}', '${WS.b}', '${WS.c}')) + (select count(*) from auth.users where id in ('${users.mixed}', '${users.outsider}')) + (select count(*) from sales.quotes where workspace_id in ('${WS.a}', '${WS.b}'))`);
  expect(left).toBe("0");
});

test("each quotation history row is read with that workspace's own sales.read, in both mixed-role orientations", async () => {
  const db = client();
  const { error } = await db.auth.signInWithPassword({ email: emails.mixed, password: PASSWORD });
  expect(error).toBeNull();

  // Admin in the acting workspace A, catalog/pricing (no sales.read) in B.
  expect(sql(`select string_agg(role_key, ',' order by created_at) from core.memberships where user_id = '${users.mixed}'`)).toBe("admin,catalog_pricing");
  expect(await visible(db, WS.a)).toBe(all(1));
  expect(await visible(db, WS.b)).toBe(all(0));

  // Denied in the acting workspace A, a legitimate reader in B: B stays readable.
  expect(setRole(WS.a, "catalog_pricing")).toBe("catalog_pricing");
  expect(setRole(WS.b, "sales_rep")).toBe("sales_rep");
  expect(await visible(db, WS.b)).toBe(all(1));
  expect(await visible(db, WS.a)).toBe(all(0));

  // Readers in both: each workspace as its own membership allows.
  expect(setRole(WS.a, "sales_rep")).toBe("sales_rep");
  expect(`${await visible(db, WS.a)};${await visible(db, WS.b)}`).toBe(`${all(1)};${all(1)}`);

  // Suspended, then removed, B membership: B is denied again.
  expect(setRole(WS.a, "admin")).toBe("admin");
  sql(`update core.memberships set status = 'suspended' where workspace_id = '${WS.b}' and user_id = '${users.mixed}'`);
  expect(await visible(db, WS.b)).toBe(all(0));
  sql(`delete from core.memberships where workspace_id = '${WS.b}' and user_id = '${users.mixed}'`);
  expect(await visible(db, WS.b)).toBe(all(0));
  expect(await visible(db, WS.a)).toBe(all(1));
  await db.auth.signOut({ scope: "local" });
});

test("an admin of another workspace and an anonymous caller read no quotation history", async () => {
  const outsider = client();
  expect((await outsider.auth.signInWithPassword({ email: emails.outsider, password: PASSWORD })).error).toBeNull();
  expect(await visible(outsider, WS.a)).toBe(all(0));
  expect(await visible(outsider, WS.b)).toBe(all(0));
  await outsider.auth.signOut({ scope: "local" });

  const anon = client();
  for (const view of VIEWS) {
    const { data, error } = await anon.from(view).select("workspace_id").eq("workspace_id", WS.b);
    expect(error, `${view} for anon`).not.toBeNull();
    expect(data).toBeNull();
  }
});
