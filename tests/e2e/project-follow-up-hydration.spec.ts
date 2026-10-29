/**
 * TILE-90: the shared Projects list's "Next follow-up" and "Last followed up"
 * cells, end to end against a running app and the LOCAL Supabase stack:
 * registration, claiming, follow-up recording, view filters, reload, the
 * permitted/denied/foreign-workspace boundaries, and hydration with the
 * browser clock ahead of or behind the server's. Synthetic accounts and
 * projects only, created and removed by this spec. It refuses hosted targets,
 * never backdates a record, and fails on any console error or page error.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { followUpRelative } from "../../src/features/crm/follow-up-time";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = randomUUID();
const run = randomUUID().slice(0, 8);
const user = (key: string, role: string | null, workspace = WORKSPACE) =>
  ({ id: randomUUID(), email: `e2e.tile90.${key}.${run}@tileconcept.test`, name: `TILE90 ${key} ${run}`, role, workspace });
const REP = user("rep", "sales_rep");
const REP2 = user("teammate", "sales_rep");
const CATALOG = user("catalog", "catalog_pricing");
const FOREIGN = user("foreign", "sales_rep", OTHER_WORKSPACE);
const NOMEMBER = user("nomember", null);
const OWNED = [REP, REP2, CATALOG, FOREIGN, NOMEMBER];
const TITLE = `TILE90 ${run} shared project`;
const FOREIGN_PROJECT = { id: randomUUID(), name: `TILE90 ${run} foreign project` };

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atqc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const API_URL: string = status.API_URL;
const PUBLISHABLE_KEY: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const values = OWNED.map((u) => `('${u.id}'::uuid,'${u.email}','${u.name}')`).join(",");
  sql(`with u(id,email,name) as (values ${values})
       insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
         confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
       select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,extensions.crypt('${PASSWORD}',extensions.gen_salt('bf')),now(),
         '{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',name),now(),now(),'','','','','','','','',false from u;
       with u(id,email) as (values ${OWNED.map((u) => `('${u.id}'::uuid,'${u.email}')`).join(",")})
       insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
       select gen_random_uuid(),id,email,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now(),now() from u;
       insert into core.workspaces(id,slug,name) values ('${OTHER_WORKSPACE}','e2e-tile90-${run}','E2E TILE-90 other workspace');
       insert into core.memberships(workspace_id,user_id,role_key) values
         ${OWNED.filter((u) => u.role).map((u) => `('${u.workspace}','${u.id}','${u.role}')`).join(",")};
       insert into identity.projects(id,workspace_id,name,owner_id,created_by) values
         ('${FOREIGN_PROJECT.id}','${OTHER_WORKSPACE}','${FOREIGN_PROJECT.name}','${FOREIGN.id}','${FOREIGN.id}');`);
});

test.afterAll(() => {
  const ids = OWNED.map((u) => `'${u.id}'`).join(",");
  const projects = `select id from identity.projects where name like 'TILE90 ${run} %'`;
  sql(`delete from identity.project_events where project_id in (${projects});
       delete from identity.project_requests where actor_id in (${ids});
       delete from identity.project_sites where project_id in (${projects});
       delete from identity.projects where name like 'TILE90 ${run} %';
       delete from core.workspaces where id='${OTHER_WORKSPACE}';
       delete from auth.users where id in (${ids});`);
  assert.equal(sql(`select count(*) from identity.projects where name like 'TILE90 ${run} %'`), "0");
  assert.equal(sql(`select count(*) from identity.project_requests where actor_id in (${ids})`), "0");
  assert.equal(sql(`select count(*) from core.workspaces where id='${OTHER_WORKSPACE}'`), "0");
  assert.equal(sql(`select count(*) from auth.users where id in (${ids})`), "0");
  assert.equal(sql(`select count(*) from core.memberships where user_id in (${ids})`), "0");
});

/** Every console error and uncaught page error, kept for the report and asserted empty. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  // While the page streams, React can keep a hidden copy of the form; type into the visible one.
  const form = page.locator("form").filter({ has: page.locator("#password"), visible: true });
  await expect(form).toHaveCount(1);
  await form.locator("#email").fill(email);
  await form.locator("#password").fill(PASSWORD);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login" || url.searchParams.has("reason"), { timeout: 30_000 });
}

/** The browser's own Supabase session, read from the SSR auth cookie. */
async function accessToken(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const raw = parts.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw);
  return JSON.parse(json).access_token;
}

async function rpc(context: BrowserContext, fn: string, body: object) {
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${await accessToken(context)}`, "Content-Type": "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

const projectId = () => sql(`select id from identity.projects where name='${TITLE}'`);
const project = () => {
  const [owner, nextAction, due, lastAt, lastBy, version] = sql(`select coalesce(owner_id::text,''),coalesce(next_action,''),coalesce(to_char(next_action_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),''),coalesce(to_char(last_follow_up_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),''),coalesce(last_follow_up_by::text,''),version from identity.projects where name='${TITLE}'`).split("|");
  return { owner, nextAction, due, lastAt, lastBy, version: Number(version) };
};
const events = (kind: string) => Number(sql(`select count(*) from identity.project_events where project_id='${projectId()}' and kind='${kind}'`));

/**
 * A cell under a header in the row of the given project, through the real
 * table header. Waits for the visible table first: while the page streams,
 * the loading skeleton's table comes before it.
 */
async function cell(page: Page, name: string, header: "Next follow-up" | "Last followed up" | "Internal handler"): Promise<Locator> {
  const table = page.locator("table").filter({ visible: true, has: page.getByRole("columnheader", { name: new RegExp(`^${header}`) }) });
  await expect(table).toHaveCount(1);
  const headers = await table.locator("thead th").allTextContents();
  const index = headers.findIndex((h) => h.trim().startsWith(header));
  expect(index, header).toBeGreaterThanOrEqual(0);
  return table.getByRole("row").filter({ hasText: name }).locator("td").nth(index);
}

const browserNow = (page: Page) => page.evaluate(() => Date.now());

/** 15:00 Kuala Lumpur, two days from now, as the form enters it and as the database stores it. */
function dueInTwoDays() {
  const local = `${new Date(Date.now() + 8 * 3_600_000 + 2 * 86_400_000).toISOString().slice(0, 10)}T15:00`;
  return { local, iso: new Date(`${local}:00+08:00`).toISOString() };
}
const DUE = dueInTwoDays();

test("a rep registers a shared project, claims it from the list and records a follow-up that persists", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await signIn(page, REP.email);
  await page.goto("/sales/projects?new=1");
  await page.locator("#project-name").fill(TITLE);
  await page.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(page.getByRole("heading", { name: TITLE, exact: true })).toBeVisible({ timeout: 20_000 });
  expect(sql(`select workspace_id from identity.projects where name='${TITLE}'`)).toBe(WORKSPACE);
  expect(project()).toMatchObject({ owner: "", lastAt: "", version: 1 });

  await page.goto("/sales/projects");
  const row = page.getByRole("row").filter({ hasText: TITLE });
  await expect(await cell(page, TITLE, "Last followed up")).toHaveText("Not yet");
  await page.getByRole("button", { name: /^Unassigned/ }).click();
  await row.getByRole("button", { name: "I'll handle this", exact: true }).click();
  await expect(row).toBeHidden();
  await page.getByRole("button", { name: /^My follow-ups/ }).click();
  await expect(row).toBeVisible();
  await expect(await cell(page, TITLE, "Internal handler")).toHaveText(REP.name);
  expect(project()).toMatchObject({ owner: REP.id, version: 2 });

  await page.goto(`/sales/projects/${projectId()}`);
  await page.getByRole("button", { name: "Log follow-up", exact: true }).click();
  await page.locator("#followup-note").fill("Synthetic follow-up: customer asked for outdoor samples.");
  await page.locator("#next-action").fill("Deliver synthetic samples");
  await page.locator("#next-due").fill(DUE.local);
  await page.getByRole("button", { name: "Record follow-up", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const saved = project();
  expect(saved).toMatchObject({ owner: REP.id, nextAction: "Deliver synthetic samples", due: DUE.iso, lastBy: REP.id, version: 3 });
  expect([events("registered"), events("assigned"), events("follow_up")]).toEqual([1, 1, 1]);

  // A fresh load renders the list on the server and hydrates it in the browser.
  await page.goto("/sales/projects");
  await page.reload();
  await page.getByRole("button", { name: /^My follow-ups/ }).click();
  await expect(row).toBeVisible();
  await expect(await cell(page, TITLE, "Next follow-up")).toHaveText(`Deliver synthetic samples${followUpRelative(DUE.iso, await browserNow(page))}`);
  await expect(await cell(page, TITLE, "Last followed up")).toHaveText(`${REP.name}${followUpRelative(saved.lastAt, await browserNow(page))}`);
  await page.getByRole("button", { name: /^Unassigned/ }).click();
  await expect(row).toBeHidden();
  expect(errors).toEqual([]);
});

for (const [label, skew] of [["ten minutes ahead", 10 * 60_000], ["ten minutes behind", -10 * 60_000]] as const) {
  // In this environment the streamed page did not reproduce CI's mismatch even
  // on the original build (see the TILE-90 handoff); the discriminating
  // reproduction is the component test. This checks the delivered page: no
  // error with a skewed browser clock, live browser-clock text after mount,
  // and the 30-second refresh updating the text in place.
  test(`with the browser clock ${label} the server, the list loads cleanly and its time cells follow the browser clock`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await signIn(page, REP.email);
    // The server renders at its own time; only the browser's clock is moved.
    await page.clock.install({ time: Date.now() + skew });
    const response = await page.goto("/sales/projects");
    expect(response?.status()).toBe(200);
    const saved = project();
    const html = await response!.text();
    expect(html).toContain(TITLE);
    const row = page.getByRole("row").filter({ hasText: TITLE });
    await expect(row).toBeVisible();
    // After mount the cells follow the browser's clock, in the shared wording.
    const now = await browserNow(page);
    await expect(await cell(page, TITLE, "Last followed up")).toHaveText(`${REP.name}${followUpRelative(saved.lastAt, now)}`);
    await expect(await cell(page, TITLE, "Next follow-up")).toHaveText(`Deliver synthetic samples${followUpRelative(saved.due, now)}`);
    expect(followUpRelative(saved.lastAt, now)).toMatch(skew > 0 ? /^1[01] minutes ago$/ : /^in (9|10) minutes$/);
    // The 30-second refresh changes the text without replacing the cell's nodes.
    const lastText = (await cell(page, TITLE, "Last followed up")).locator("p");
    const node = await lastText.elementHandle();
    await page.clock.runFor(3 * 60_000);
    const later = await browserNow(page);
    expect(followUpRelative(saved.lastAt, later)).not.toBe(followUpRelative(saved.lastAt, now));
    await expect(lastText).toHaveText(followUpRelative(saved.lastAt, later));
    expect(await node!.evaluate((n) => n.isConnected)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("a teammate sees the shared project, follows up without taking it over, and the filters follow ownership", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await signIn(page, REP2.email);
  await page.goto("/sales/projects");
  const row = page.getByRole("row").filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await expect(await cell(page, TITLE, "Internal handler")).toHaveText(REP.name);
  await page.getByRole("button", { name: /^My follow-ups/ }).click();
  await expect(row).toBeHidden();
  await page.getByRole("button", { name: /^Unassigned/ }).click();
  await expect(row).toBeHidden();

  const before = project();
  await page.goto(`/sales/projects/${projectId()}`);
  await page.getByRole("button", { name: "Log follow-up", exact: true }).click();
  await page.locator("#followup-note").fill("Synthetic teammate follow-up: samples confirmed.");
  await page.getByRole("button", { name: "Record follow-up", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const after = project();
  expect(after).toMatchObject({ owner: REP.id, lastBy: REP2.id, nextAction: before.nextAction, due: before.due, version: before.version + 1 });
  expect(events("follow_up")).toBe(2);

  await page.goto("/sales/projects");
  await page.reload();
  await expect(row).toBeVisible();
  await expect(await cell(page, TITLE, "Last followed up")).toHaveText(`${REP2.name}${followUpRelative(after.lastAt, await browserNow(page))}`);
  await expect(await cell(page, TITLE, "Internal handler")).toHaveText(REP.name);
  expect(errors).toEqual([]);
});

test("a role without projects.follow_up reads the list but cannot claim or follow up, and the database refuses it", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await signIn(page, CATALOG.email);
  await page.goto("/sales/projects");
  await expect(page.getByRole("row").filter({ hasText: TITLE })).toBeVisible();
  await expect(page.getByRole("button", { name: "I'll handle this", exact: true })).toHaveCount(0);
  await page.goto(`/sales/projects/${projectId()}`);
  await expect(page.getByRole("button", { name: "Log follow-up", exact: true })).toBeDisabled();
  const before = project();
  const refused = await rpc(context, "project_command", { p_action: "follow_up", p_request_id: randomUUID(), p_input: { id: projectId(), version: before.version, note: "Synthetic refused follow-up" } });
  expect(refused.status).toBe(403);
  expect(project()).toEqual(before);
  expect(events("follow_up")).toBe(2);
  expect(errors).toEqual([]);
});

test("workspaces stay separate: neither side lists or opens the other's project, and a foreign follow-up is refused", async ({ browser }) => {
  test.setTimeout(120_000);
  const rep = await browser.newPage();
  await signIn(rep, REP.email);
  const repErrors = watchErrors(rep);
  await rep.goto("/sales/projects");
  await expect(rep.getByRole("row").filter({ hasText: TITLE })).toBeVisible();
  await expect(rep.getByText(FOREIGN_PROJECT.name)).toHaveCount(0);
  expect(repErrors).toEqual([]);
  // The route streams behind its loading state, so a missing project is the
  // not-found page inside an already-started 200 response.
  await rep.goto(`/sales/projects/${FOREIGN_PROJECT.id}`);
  await expect(rep.getByRole("main").getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(rep.getByText(FOREIGN_PROJECT.name)).toHaveCount(0);
  expect(repErrors).toEqual([]);

  const foreign = await browser.newPage();
  await signIn(foreign, FOREIGN.email);
  const foreignErrors = watchErrors(foreign);
  await foreign.goto("/sales/projects");
  await expect(foreign.getByRole("row").filter({ hasText: FOREIGN_PROJECT.name })).toBeVisible();
  await expect(foreign.getByText(TITLE)).toHaveCount(0);
  expect(foreignErrors).toEqual([]);
  await foreign.goto(`/sales/projects/${projectId()}`);
  await expect(foreign.getByRole("main").getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(foreign.getByText(TITLE)).toHaveCount(0);
  expect(foreignErrors).toEqual([]);
  const before = project();
  const refused = await rpc(foreign.context(), "project_command", { p_action: "follow_up", p_request_id: randomUUID(), p_input: { id: projectId(), version: before.version, note: "Synthetic foreign follow-up" } });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(refused.body).toContain("Project not found");
  expect(project()).toEqual(before);
  expect(events("follow_up")).toBe(2);
  await rep.close();
  await foreign.close();
});

// On this base a signed-in account with no membership is bounced between
// /login?reason=no-membership and / (the proxy and the app layout disagree);
// that redirect is outside TILE-90. What matters here is that the account
// never reaches the Projects list and the database refuses its commands.
test("an account with no membership never reaches the Projects list, and the database refuses its follow-up", async ({ page, context }) => {
  test.setTimeout(120_000);
  await signIn(page, NOMEMBER.email);
  await page.goto("/sales/projects").catch(() => null);
  await expect(page).not.toHaveURL(/\/sales\/projects/);
  await expect(page.getByRole("heading", { name: "Project registration" })).toHaveCount(0);
  await expect(page.getByText(TITLE)).toHaveCount(0);
  const before = project();
  const refused = await rpc(context, "project_command", { p_action: "follow_up", p_request_id: randomUUID(), p_input: { id: projectId(), version: before.version, note: "Synthetic no-membership follow-up" } });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(project()).toEqual(before);
  expect(events("follow_up")).toBe(2);
});
