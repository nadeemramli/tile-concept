/**
 * TILE-86 in the browser: the pursuit segmentation and lead-source report pages
 * show a workspace's rows only to someone whose own membership THERE grants
 * report.read. Local stack only. The suite creates its own users, workspaces
 * and one synthetic lead, signs each user in on a separate browser context,
 * never signs anyone out globally, and removes everything it made.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = `E2e-${randomBytes(9).toString("base64url")}!`;
const RUN = randomBytes(4).toString("hex");
const WS = { A: randomUUID(), B: randomUUID() };
const LEAD = randomUUID();
const people = {
  // Report reader in acting A; in B without report.read.
  aOnly: { email: `e2e.tile86.a-only.${RUN}@tileconcept.test`, roles: { A: "admin", B: "catalog_pricing" }, id: "" },
  // Report reader in both: the legitimate control that B's row is reachable.
  both: { email: `e2e.tile86.both.${RUN}@tileconcept.test`, roles: { A: "admin", B: "analyst" }, id: "" },
};

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  sql(`insert into core.workspaces(id,slug,name) values ('${WS.A}','e2e-tile86-a-${RUN}','E2E TILE-86 A'),('${WS.B}','e2e-tile86-b-${RUN}','E2E TILE-86 B');
       insert into sales.leads(id,workspace_id,status,source_channel,raw_name) values ('${LEAD}','${WS.B}','new','other','E2E TILE-86 lead ${RUN}');`);
  for (const p of Object.values(people)) {
    const { data, error } = await admin.auth.admin.createUser({ email: p.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `E2E TILE-86 ${RUN}` } });
    if (error || !data.user) throw error ?? new Error("user not created");
    p.id = data.user.id;
    // A is the older membership, so it is the acting workspace.
    sql(`insert into core.memberships(workspace_id,user_id,role_key,created_at) values
      ('${WS.A}','${p.id}','${p.roles.A}',now() - interval '10 minutes'),('${WS.B}','${p.id}','${p.roles.B}',now() - interval '5 minutes')`);
  }
});

test.afterAll(async () => {
  sql(`delete from sales.leads where id='${LEAD}'; delete from core.memberships where workspace_id in ('${WS.A}','${WS.B}');
       delete from core.workspaces where id in ('${WS.A}','${WS.B}');`);
  for (const p of Object.values(people)) if (p.id) await admin.auth.admin.deleteUser(p.id);
  expect(sql(`select (select count(*) from core.workspaces where slug like 'e2e-tile86-%-${RUN}') + (select count(*) from auth.users where email like 'e2e.tile86.%.${RUN}@tileconcept.test')`)).toBe("0");
});

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("a report reader in one workspace does not see another workspace's segmentation or lead-source rows", async ({ browser }) => {
  const page = await signIn(browser, people.aOnly.email);
  for (const slug of ["pursuit-segments", "lead-source"]) {
    await page.goto(`/insights/reports/${slug}`);
    await expect(page.getByText("Nothing to report for this period")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Nothing to report for this period")).toBeVisible();
  }
});

test("a reader in both workspaces sees the other workspace's rows", async ({ browser }) => {
  const page = await signIn(browser, people.both.email);
  await page.goto("/insights/reports/lead-source");
  await expect(page.getByRole("row").filter({ hasText: /Other|other/ })).toHaveCount(1);
  await page.goto("/insights/reports/pursuit-segments");
  await expect(page.getByText("Nothing to report for this period")).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Buyer role" }).first()).toBeVisible();
});
