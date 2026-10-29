/**
 * Tasks Due cell against a running app and a LOCAL Supabase stack (TILE-83).
 * The suite creates its own synthetic users, tasks and a second workspace,
 * signs each user in within its own browser context (no global sign-out), and
 * removes everything afterwards. Real page errors and React hydration errors
 * fail the test. Refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { formatDateTime } from "../../src/lib/format";

const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = randomUUID();
const PASSWORD = `E2e!${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const MINUTE = 60_000;

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
  rep: { email: `e2e.tasks.${tag}.rep@tileconcept.test`, role: "sales_rep", name: `E2E Tasks Rep ${tag}`, id: "" },
  showroom: { email: `e2e.tasks.${tag}.showroom@tileconcept.test`, role: "showroom", name: `E2E Tasks Showroom ${tag}`, id: "" },
  catalog: { email: `e2e.tasks.${tag}.catalog@tileconcept.test`, role: "catalog_pricing", name: `E2E Tasks Catalog ${tag}`, id: "" },
};
const T = {
  upcoming: { id: randomUUID(), title: `E2E upcoming ${tag}` },
  overdue: { id: randomUUID(), title: `E2E overdue ${tag}` },
  done: { id: randomUUID(), title: `E2E done ${tag}` },
  cancelled: { id: randomUUID(), title: `E2E cancelled ${tag}` },
  undated: { id: randomUUID(), title: `E2E undated ${tag}` },
  showroom: { id: randomUUID(), title: `E2E showroom own ${tag}` },
  foreign: { id: randomUUID(), title: `E2E other workspace ${tag}` },
};
const due: Record<string, string> = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  for (const u of Object.values(users)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.name } });
    if (error || !data.user) throw error ?? new Error("user not created");
    u.id = data.user.id;
    sql(`insert into core.memberships(workspace_id,user_id,role_key) values ('${WORKSPACE}','${u.id}','${u.role}') on conflict (workspace_id,user_id) do update set role_key=excluded.role_key, status='active';
         update core.profiles set full_name='${u.name}' where user_id='${u.id}';`);
  }
  const rep = users.rep.id;
  // Due times are relative to now: one ahead, the rest already past. created_at is left to the database.
  const rows = sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WORKSPACE}','E2E tasks other workspace','e2e-tasks-${tag}');
    insert into sales.tasks(id,workspace_id,title,status,priority,due_at,assignee_id,created_by,completed_at,outcome) values
    ('${T.upcoming.id}','${WORKSPACE}','${T.upcoming.title}','open','normal',now()+interval '30 minutes','${rep}','${rep}',null,null),
    ('${T.overdue.id}','${WORKSPACE}','${T.overdue.title}','open','high',now()-interval '2 hours','${rep}','${rep}',null,null),
    ('${T.done.id}','${WORKSPACE}','${T.done.title}','done','normal',now()-interval '2 hours','${rep}','${rep}',now()-interval '1 hour','Synthetic outcome'),
    ('${T.cancelled.id}','${WORKSPACE}','${T.cancelled.title}','cancelled','normal',now()-interval '2 hours','${rep}','${rep}',now()-interval '1 hour',null),
    ('${T.undated.id}','${WORKSPACE}','${T.undated.title}','open','low',null,'${rep}','${rep}',null,null),
    ('${T.showroom.id}','${WORKSPACE}','${T.showroom.title}','open','normal',now()+interval '3 days','${users.showroom.id}','${users.showroom.id}',null,null),
    ('${T.foreign.id}','${OTHER_WORKSPACE}','${T.foreign.title}','open','normal',now()-interval '2 hours',null,null,null,null);
    select id||'|'||coalesce(to_char(due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'') from sales.tasks where id in ('${T.upcoming.id}','${T.overdue.id}','${T.done.id}');`);
  for (const line of rows.split("\n").filter((l) => l.includes("|"))) {
    const [id, at] = line.split("|");
    due[id] = at;
  }
});

test.afterAll(async () => {
  const ids = Object.values(T).map((t) => `'${t.id}'`).join(",");
  const people = Object.values(users).filter((u) => u.id).map((u) => `'${u.id}'`).join(",");
  sql(`delete from sales.activities where actor_id in (${people || "null"});
       delete from sales.tasks where id in (${ids});
       delete from core.workspaces where id='${OTHER_WORKSPACE}';
       ${people ? `delete from core.memberships where user_id in (${people});` : ""}`);
  for (const u of Object.values(users)) if (u.id) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
});

/** Collects uncaught page errors and React hydration errors for the whole test. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Development wording, and the minified production codes for hydration failures.
    if (m.type() === "error" && /hydrat|didn't match|Minified React error #(418|419|421|422|423|425)\b/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
const row = (page: Page, title: string) => page.getByRole("row").filter({ hasText: title });
const dueCell = (page: Page, title: string) => row(page, title).locator("td span[title]");

test("a browser clock ten minutes ahead hydrates the Due column cleanly, then shows its own relative time", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await login(page, users.rep.email);
  await page.clock.install({ time: new Date(Date.now() + 10 * MINUTE) });
  const response = await page.goto("/sales/tasks?view=all");
  const html = (await response!.text()).replace(/<!-- -->/g, "");
  // The server measured from its own clock: about 30 minutes ahead.
  expect(html).toMatch(new RegExp(`${T.upcoming.title}[\\s\\S]*?in (29|30) minutes`));

  // After mount the label follows the browser clock, 10 minutes later.
  await expect(dueCell(page, T.upcoming.title)).toHaveText(/^in (19|20) minutes$/);
  await expect(dueCell(page, T.upcoming.title)).toHaveAttribute("title", formatDateTime(due[T.upcoming.id]));
  await expect(dueCell(page, T.upcoming.title)).not.toHaveClass(/text-destructive/);
  await expect(dueCell(page, T.overdue.title)).toHaveText("2 hours ago");
  await expect(dueCell(page, T.overdue.title)).toHaveClass(/text-destructive/);
  await expect(dueCell(page, T.overdue.title)).toHaveAttribute("title", formatDateTime(due[T.overdue.id]));
  await expect(row(page, T.undated.title)).toContainText("—");
  await expect(row(page, T.foreign.title)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("salesperson's views, overdue styling and completion persist across reload", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await login(page, users.rep.email);

  // Overdue view keeps its existing definition: open and past due, never done or cancelled.
  await page.goto("/sales/tasks?view=overdue");
  await expect(row(page, T.overdue.title)).toBeVisible();
  for (const t of [T.upcoming, T.done, T.cancelled, T.undated, T.foreign]) await expect(row(page, t.title)).toHaveCount(0);

  // Done and cancelled tasks past their due time are never shown as overdue.
  await page.goto("/sales/tasks?view=done");
  for (const t of [T.done, T.cancelled]) {
    await expect(dueCell(page, t.title)).toHaveText("2 hours ago");
    await expect(dueCell(page, t.title)).not.toHaveClass(/text-destructive/);
  }
  await expect(dueCell(page, T.done.title)).toHaveAttribute("title", formatDateTime(due[T.done.id]));

  // My work, then complete the upcoming task and confirm it after a reload.
  await page.goto("/sales/tasks?view=mine");
  await expect(row(page, T.upcoming.title)).toBeVisible();
  await expect(row(page, T.showroom.title)).toHaveCount(0);
  await row(page, T.upcoming.title).click();
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText("Task completed.")).toBeVisible();
  await page.reload();
  await page.goto("/sales/tasks?view=mine");
  await expect(row(page, T.upcoming.title)).toHaveCount(0);
  await page.goto("/sales/tasks?view=done");
  await expect(row(page, T.upcoming.title)).toBeVisible();
  await expect(dueCell(page, T.upcoming.title)).not.toHaveClass(/text-destructive/);
  expect(errors).toEqual([]);
});

test("showroom staff see only their own tasks", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, users.showroom.email);
  await page.goto("/sales/tasks?view=all");
  await expect(dueCell(page, T.showroom.title)).toHaveText("in 3 days");
  for (const t of [T.overdue, T.undated, T.foreign]) await expect(row(page, t.title)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a role without sales access is refused", async ({ page }) => {
  await login(page, users.catalog.email);
  await page.goto("/sales/tasks");
  await expect(page.getByRole("heading", { name: /Not available/ })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
