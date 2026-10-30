/**
 * TILE-92: the Tasks Due clock must not remount the rest of a row. Against a
 * running app and a LOCAL Supabase stack, with the browser clock under test
 * control: keyboard focus on a task's linked contact or opportunity stays on
 * the same element through the mount reconciliation and repeated 30-second
 * ticks, while the Due text and overdue styling keep moving. Then the row's
 * links, drawer, assignment, completion and role boundaries still work and
 * persist across reload.
 *
 * The suite owns everything it uses: its users, one contact and opportunity in
 * the shared seed workspace, its tasks and a second workspace. It removes only
 * those ids afterwards and fails, with the reason, if any of it stays behind.
 * Refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = randomUUID();
const PASSWORD = `E2e!${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const TICK = 30_000;

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
function stack(): { url: string; key: string } {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) return { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const s = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  return { url: s.API_URL, key: s.SERVICE_ROLE_KEY ?? s.SECRET_KEY };
}
const { url, key } = stack();
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test refuses hosted targets");
const admin = createClient(url, key, { auth: { persistSession: false } });

const users = {
  rep: { email: `e2e.taskfocus.${tag}.rep@tileconcept.test`, role: "sales_rep", workspace: WORKSPACE, name: `E2E Focus Rep ${tag}`, id: "" },
  rep2: { email: `e2e.taskfocus.${tag}.rep2@tileconcept.test`, role: "sales_rep", workspace: WORKSPACE, name: `E2E Focus Second Rep ${tag}`, id: "" },
  showroom: { email: `e2e.taskfocus.${tag}.showroom@tileconcept.test`, role: "showroom", workspace: WORKSPACE, name: `E2E Focus Showroom ${tag}`, id: "" },
  catalog: { email: `e2e.taskfocus.${tag}.catalog@tileconcept.test`, role: "catalog_pricing", workspace: WORKSPACE, name: `E2E Focus Catalog ${tag}`, id: "" },
  outsider: { email: `e2e.taskfocus.${tag}.outsider@tileconcept.test`, role: "sales_manager", workspace: OTHER_WORKSPACE, name: `E2E Focus Outsider ${tag}`, id: "" },
};
const CONTACT = { id: randomUUID(), name: `E2E Focus Buyer ${tag}` };
const OPPORTUNITY = { id: randomUUID(), name: `E2E Focus Opportunity ${tag}` };
const T = {
  linked: { id: randomUUID(), title: `E2E focus linked ${tag}` },
  soon: { id: randomUUID(), title: `E2E focus soon ${tag}` },
  assign: { id: randomUUID(), title: `E2E focus assign ${tag}` },
  showroom: { id: randomUUID(), title: `E2E focus showroom own ${tag}` },
  foreign: { id: randomUUID(), title: `E2E focus other workspace ${tag}` },
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WORKSPACE}','E2E task focus other workspace','e2e-taskfocus-${tag}')`);
  for (const u of Object.values(users)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.name } });
    if (error || !data.user) throw error ?? new Error("user not created");
    u.id = data.user.id;
    sql(`insert into core.memberships(workspace_id,user_id,role_key) values ('${u.workspace}','${u.id}','${u.role}');
         update core.profiles set full_name='${u.name}' where user_id='${u.id}';`);
  }
  const rep = users.rep.id;
  sql(`insert into identity.contacts(id,workspace_id,display_name) values ('${CONTACT.id}','${WORKSPACE}','${CONTACT.name}');
    insert into sales.opportunities(id,workspace_id,name,stage_key,contact_id,owner_id) values ('${OPPORTUNITY.id}','${WORKSPACE}','${OPPORTUNITY.name}','new_inquiry','${CONTACT.id}','${rep}');
    insert into sales.tasks(id,workspace_id,title,status,priority,due_at,assignee_id,created_by,contact_id,opportunity_id) values
    ('${T.linked.id}','${WORKSPACE}','${T.linked.title}','open','high',now()-interval '150 seconds','${rep}','${rep}','${CONTACT.id}','${OPPORTUNITY.id}'),
    ('${T.soon.id}','${WORKSPACE}','${T.soon.title}','open','normal',now()+interval '3 minutes','${rep}','${rep}','${CONTACT.id}',null),
    ('${T.assign.id}','${WORKSPACE}','${T.assign.title}','open','low',now()+interval '1 day','${rep}','${rep}',null,null),
    ('${T.showroom.id}','${WORKSPACE}','${T.showroom.title}','open','normal',now()+interval '3 days','${users.showroom.id}','${users.showroom.id}',null,null),
    ('${T.foreign.id}','${OTHER_WORKSPACE}','${T.foreign.title}','open','normal',now()-interval '2 hours',null,null,null,null);`);
});

test.afterAll(async () => {
  // Only this run's ids, children before parents. Every failed step is reported.
  const problems: string[] = [];
  const reason = (e: unknown) => (e as { stderr?: string }).stderr?.trim() || String(e);
  const people = Object.values(users).filter((u) => u.id).map((u) => `'${u.id}'`).join(",") || "null";
  const tasks = Object.values(T).map((t) => `'${t.id}'`).join(",");
  try {
    sql(`delete from sales.activities where actor_id in (${people}) or contact_id='${CONTACT.id}' or opportunity_id='${OPPORTUNITY.id}';
         delete from sales.tasks where id in (${tasks});
         delete from sales.opportunity_stage_events where opportunity_id='${OPPORTUNITY.id}';
         delete from sales.opportunities where id='${OPPORTUNITY.id}';
         delete from identity.contacts where id='${CONTACT.id}';
         delete from core.memberships where user_id in (${people});
         delete from core.workspaces where id='${OTHER_WORKSPACE}';`);
  } catch (e) {
    problems.push(`database rows: ${reason(e)}`);
  }
  for (const [name, u] of Object.entries(users)) {
    if (!u.id) continue;
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) problems.push(`Auth user ${name} ${u.id} (${u.email}): ${error.status ?? "no status"} ${error.message}`);
  }
  try {
    const left = sql(`select string_agg(k||'='||n, ' ') from (values
       ('users',(select count(*) from auth.users where id in (${people}))),
       ('memberships',(select count(*) from core.memberships where user_id in (${people}))),
       ('tasks',(select count(*) from sales.tasks where id in (${tasks}))),
       ('activities',(select count(*) from sales.activities where actor_id in (${people}) or contact_id='${CONTACT.id}' or opportunity_id='${OPPORTUNITY.id}')),
       ('opportunity',(select count(*) from sales.opportunities where id='${OPPORTUNITY.id}')),
       ('contact',(select count(*) from identity.contacts where id='${CONTACT.id}')),
       ('other_workspace',(select count(*) from core.workspaces where id='${OTHER_WORKSPACE}'))) t(k,n) where n > 0`);
    if (left) problems.push(`left behind: ${left}`);
  } catch (e) {
    problems.push(`residue check: ${reason(e)}`);
  }
  if (problems.length) throw new Error(`Task focus run ${tag} did not remove everything it made:\n- ${problems.join("\n- ")}`);
});

/** Uncaught page errors and React hydration errors, collected for the whole test. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|didn't match|Minified React error #(418|419|421|422|423|425)\b/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}
async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}
const row = (page: Page, title: string) => page.getByRole("row").filter({ hasText: title });
const dueCell = (page: Page, title: string) => row(page, title).locator("td span[title]");
const contactLink = (page: Page, title: string) => row(page, title).getByRole("link", { name: CONTACT.name });
const minutes = async (page: Page, title: string) => Number(/^(\d+) minutes? ago$/.exec((await dueCell(page, title).textContent()) ?? "")?.[1] ?? NaN);

/** Remembers the focused element, then reports whether it is still the focused, connected link for `href`. */
const remember = (page: Page) => page.evaluate(() => { (window as unknown as { __focused: Element | null }).__focused = document.activeElement; });
const sameFocus = (page: Page, href: string) =>
  page.evaluate((h) => {
    const el = (window as unknown as { __focused: Element | null }).__focused;
    return { connected: !!el?.isConnected, focused: !!el && document.activeElement === el, same: !!el && document.querySelector(`tbody a[href="${h}"]`) === el, active: document.activeElement?.tagName ?? null };
  }, href);
const tick = (page: Page) => page.clock.runFor(TICK);

test("focus on a row's linked contact and opportunity survives the mount reconciliation and repeated 30-second ticks", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await signIn(browser, users.rep.email);
  const errors = watchErrors(page);
  // The browser starts slightly ahead of the server, so mount moves the labels.
  await page.clock.install({ time: new Date(Date.now() + 1_000) });
  await page.goto("/sales/tasks?view=all");
  await expect(contactLink(page, T.linked.title)).toBeVisible();
  await expect(dueCell(page, T.linked.title)).toHaveText(/^\d+ minutes ago$/);
  await expect(dueCell(page, T.soon.title)).not.toHaveClass(/text-destructive/);

  const contactHref = `/sales/contacts/${CONTACT.id}`;
  const oppHref = `/sales/pipeline?opportunity=${OPPORTUNITY.id}`;
  await contactLink(page, T.linked.title).focus();
  await remember(page);
  expect(await sameFocus(page, contactHref)).toEqual({ connected: true, focused: true, same: true, active: "A" });

  const start = await minutes(page, T.linked.title);
  for (let i = 1; i <= 4; i++) {
    await tick(page);
    expect(await sameFocus(page, contactHref), `contact link after tick ${i}`).toEqual({ connected: true, focused: true, same: true, active: "A" });
  }
  // Four ticks are two minutes: the label moved on by exactly two.
  await expect(dueCell(page, T.linked.title)).toHaveText(`${start + 2} minutes ago`);

  // The keyboard moves on to the opportunity link in the same row; it survives ticks too.
  await page.keyboard.press("Tab");
  await remember(page);
  expect(await sameFocus(page, oppHref)).toEqual({ connected: true, focused: true, same: true, active: "A" });
  for (let i = 1; i <= 4; i++) {
    await tick(page);
    expect(await sameFocus(page, oppHref), `opportunity link after tick ${i}`).toEqual({ connected: true, focused: true, same: true, active: "A" });
  }
  await expect(dueCell(page, T.linked.title)).toHaveText(`${start + 4} minutes ago`);
  // The task due three minutes after load is overdue now, styled as such.
  await expect(dueCell(page, T.soon.title)).toHaveClass(/text-destructive/);
  await expect(dueCell(page, T.soon.title)).toHaveText(/ago$/);

  // Enter on the kept focus follows the link.
  await page.keyboard.press("Enter");
  await page.waitForURL(`**${oppHref}`);
  await expect(page.getByText(OPPORTUNITY.name).first()).toBeVisible();
  await page.goBack();
  await contactLink(page, T.linked.title).focus();
  await tick(page);
  await page.keyboard.press("Enter");
  await page.waitForURL(`**${contactHref}`);
  await expect(page.getByText(CONTACT.name).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("search keeps focus, the drawer stays open across ticks, and assignment and completion persist across reload", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await signIn(browser, users.rep.email);
  const errors = watchErrors(page);
  await page.clock.install({ time: new Date() });
  await page.goto("/sales/tasks?view=all");

  // The table's search box filters rows and keeps focus while the clock moves.
  const search = page.getByRole("textbox", { name: "Filter rows" });
  await search.fill(tag);
  await tick(page);
  await expect(search).toBeFocused();
  await expect(row(page, T.linked.title)).toBeVisible();
  await search.fill(T.assign.title);
  await expect(row(page, T.linked.title)).toHaveCount(0);
  await expect(row(page, T.assign.title)).toBeVisible();

  // Row click opens the drawer; it stays open through ticks. Reassign to the second rep.
  await row(page, T.assign.title).click();
  await expect(page).toHaveURL(new RegExp(`task=${T.assign.id}`));
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText(T.assign.title).first()).toBeVisible();
  await tick(page);
  await tick(page);
  await expect(drawer.getByText(T.assign.title).first()).toBeVisible();
  await drawer.getByRole("combobox").first().click();
  await page.getByRole("option", { name: users.rep2.name }).click();
  await drawer.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Task updated.")).toBeVisible();
  expect(sql(`select assignee_id from sales.tasks where id='${T.assign.id}'`)).toBe(users.rep2.id);
  await page.reload();
  await expect(row(page, T.assign.title)).toContainText(users.rep2.name);

  // Complete the linked task with an outcome; it moves to Done after a reload.
  await page.goto(`/sales/tasks?view=all&task=${T.linked.id}`);
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("dialog", { name: "Complete task" }).getByRole("textbox").fill("Synthetic focus outcome");
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText("Task completed.")).toBeVisible();
  expect(sql(`select status||'|'||outcome||'|'||(completed_at is not null) from sales.tasks where id='${T.linked.id}'`)).toBe("done|Synthetic focus outcome|true");
  expect(sql(`select count(*) from sales.activities where actor_id='${users.rep.id}'`)).toBe("1");
  await page.goto("/sales/tasks?view=all");
  await expect(row(page, T.linked.title)).toHaveCount(0);
  await page.goto("/sales/tasks?view=done");
  await expect(row(page, T.linked.title)).toBeVisible();
  await expect(dueCell(page, T.linked.title)).not.toHaveClass(/text-destructive/);
  await expect(contactLink(page, T.linked.title)).toBeVisible();
  expect(errors).toEqual([]);
});

test("showroom staff see only their own task, another workspace sees none, and a role without sales access is refused", async ({ browser }) => {
  const showroom = await signIn(browser, users.showroom.email);
  const errors = watchErrors(showroom);
  await showroom.goto("/sales/tasks?view=all");
  await expect(dueCell(showroom, T.showroom.title)).toHaveText("in 3 days");
  for (const t of [T.soon, T.assign, T.foreign]) await expect(row(showroom, t.title)).toHaveCount(0);
  expect(errors).toEqual([]);

  const outsider = await signIn(browser, users.outsider.email);
  await outsider.goto("/sales/tasks?view=all");
  await expect(row(outsider, T.foreign.title)).toBeVisible();
  for (const t of [T.soon, T.assign, T.showroom]) await expect(row(outsider, t.title)).toHaveCount(0);

  const catalog = await signIn(browser, users.catalog.email);
  await catalog.goto("/sales/tasks");
  await expect(catalog.getByRole("heading", { name: /Not available/ })).toBeVisible();
  await expect(catalog.getByRole("table")).toHaveCount(0);
});
