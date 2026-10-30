import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Uses the local demo seed users, which this suite does not own. It owns the
// projects it registers (and their sites, events and command requests) and the
// two-membership user it creates. It removes exactly those ids afterwards and
// fails, with the reason, if any of it stays behind. LOCAL stack only.
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const tag = randomUUID().slice(0, 8);
const owned = { titles: new Set<string>(), projects: new Set<string>(), users: new Map<string, string>() };

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atqc", query], { encoding: "utf8" }).trim();
}
function stack(): { url: string; key: string } {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) return { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const s = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  return { url: s.API_URL, key: s.SERVICE_ROLE_KEY ?? s.SECRET_KEY };
}
const { url, key } = stack();
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test refuses hosted targets");
const admin = createClient(url, key, { auth: { persistSession: false } });

/** A title unique to this run, recorded before the project exists so a half-finished registration is still found. */
function projectTitle(kind: string) {
  const title = `${kind} ${tag} ${Date.now()}`;
  owned.titles.add(title);
  return title;
}
/** Records the registered project's id from its page URL. */
function ownProject(pageUrl: string) {
  const id = /\/sales\/projects\/([a-f0-9-]+)$/.exec(new URL(pageUrl).pathname)?.[1];
  if (!id) throw new Error(`No project id in ${pageUrl}`);
  owned.projects.add(id);
}

test.afterAll(async () => {
  // Only this run's ids, children before parents. Every failed step is reported.
  const problems: string[] = [];
  const reason = (e: unknown) => (e as { stderr?: string }).stderr?.trim() || String(e);
  const list = (ids: Iterable<string>) => [...ids].map((id) => `'${id}'`).join(",") || "null";
  const people = list(owned.users.keys());
  let projects = list(owned.projects);
  try {
    const titles = [...owned.titles].map((t) => `'${t}'`).join(",") || "null";
    const found = sql(`select id from identity.projects where name in (${titles})`).split("\n").filter(Boolean);
    projects = list(new Set([...owned.projects, ...found]));
    sql(`do $$ begin
           if exists(select 1 from sales.opportunities where project_id in (${projects}) union all select 1 from sales.activities where project_id in (${projects})
                     union all select 1 from sales.tasks where project_id in (${projects}) union all select 1 from sales.purchases where project_id in (${projects})
                     union all select 1 from marketing.content_opportunities where project_id in (${projects}))
           then raise exception 'this run''s projects are referenced by records it did not create'; end if;
         end $$;
         delete from identity.project_requests where result->>'project_id' in (${projects});
         delete from identity.project_events where project_id in (${projects});
         delete from identity.project_sites where project_id in (${projects});
         delete from identity.projects where id in (${projects});
         delete from core.memberships where user_id in (${people});`);
  } catch (e) {
    problems.push(`database rows: ${reason(e)}`);
  }
  for (const [id, email] of owned.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) problems.push(`Auth user ${id} (${email}): ${error.status ?? "no status"} ${error.message}`);
  }
  try {
    const left = sql(`select string_agg(k||'='||n, ' ') from (values
       ('users',(select count(*) from auth.users where id in (${people}))),
       ('memberships',(select count(*) from core.memberships where user_id in (${people}))),
       ('profiles',(select count(*) from core.profiles where user_id in (${people}))),
       ('projects',(select count(*) from identity.projects where id in (${projects}))),
       ('sites',(select count(*) from identity.project_sites where project_id in (${projects}))),
       ('events',(select count(*) from identity.project_events where project_id in (${projects}) or actor_id in (${people}))),
       ('requests',(select count(*) from identity.project_requests where result->>'project_id' in (${projects}) or actor_id in (${people})))) t(k,n) where n > 0`);
    if (left) problems.push(`left behind: ${left}`);
  } catch (e) {
    problems.push(`residue check: ${reason(e)}`);
  }
  if (problems.length) throw new Error(`Shared project run ${tag} did not remove everything it made:\n- ${problems.join("\n- ")}`);
});

async function signIn(page: Page, role: "catalog" | "rep1" | "rep2") {
  await signInAs(page, `demo.${role}@tileconcept.test`);
}
async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("TileDemo!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/");
}

test("staff register and enrich a shared project; sales claim, follow up and hand over", async ({ page }) => {
  test.setTimeout(120_000);
  const title = projectTitle("Synthetic shared project");
  await signIn(page, "catalog");
  await page.getByRole("link", { name: "Project registration", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Register project", exact: true }).click();
  await page.locator("#project-name").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  const projectUrl = page.url();
  expect(projectUrl).toMatch(/sales\/projects\/[a-f0-9-]+$/);
  ownProject(projectUrl);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByText("Unassigned — available for pickup", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log follow-up", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Enrich project", exact: true }).click();
  await page.locator("#site_address").fill("Synthetic test site, Batu Caves");
  await page.locator("#product_specification").fill("600 x 600 outdoor porcelain, 120 m2");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("600 x 600 outdoor porcelain, 120 m2", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "rep1");
  await page.getByRole("link", { name: "Project registration", exact: true }).click();
  await page.getByRole("button", { name: /^Unassigned/ }).click();
  const row = page.getByRole("row").filter({ hasText: title });
  await row.getByRole("button", { name: "I'll handle this", exact: true }).click();
  await expect(row).toBeHidden();
  await page.getByRole("button", { name: /^My follow-ups/ }).click();
  await expect(row).toBeVisible();

  await signIn(page, "rep2");
  await page.goto(projectUrl);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  const followUp = page.locator('[data-slot="card"]').filter({ has: page.getByText("Project follow-up", { exact: true }) });
  await expect(followUp).toContainText("Aiman Sales");
  await page.getByRole("button", { name: "Log follow-up", exact: true }).click();
  await page.locator("#followup-note").fill("Customer requested outdoor samples.");
  await page.locator("#next-action").fill("Deliver samples");
  await page.locator("#next-due").fill("2026-10-01T15:00");
  await page.getByRole("button", { name: "Record follow-up", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  // Logging another salesperson's project records the actor without taking ownership.
  await expect(followUp).toContainText("Aiman Sales");
  await expect(followUp).toContainText("Mei Ling Sales");
  await expect(followUp).toContainText("1 Oct 2026, 3:00 pm");
  await page.getByRole("button", { name: "Assign handler", exact: true }).click();
  await page.locator("#handler").click();
  await page.getByRole("option", { name: "Mei Ling Sales", exact: true }).click();
  await expect(page.locator("#handover")).toHaveAttribute("required", "");
  await page.locator("#handover").fill("Agreed handover for the sample visit.");
  await page.getByRole("dialog").getByRole("button", { name: "Assign handler", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await signIn(page, "catalog");
  await page.goto(projectUrl);
  await expect(page.getByText("Handler: Aiman Sales → Mei Ling Sales", { exact: true })).toBeVisible();
  await expect(page.getByText("Agreed handover for the sample visit.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enrich project", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Assign handler", exact: true })).toBeDisabled();
});

test("a stale claim from a second salesperson is refused and the first handler stays after reload", async ({ browser }) => {
  test.setTimeout(120_000);
  const title = projectTitle("Synthetic stale claim");
  const first = await browser.newPage();
  const second = await browser.newPage();
  await signIn(first, "rep1");
  await first.goto("/sales/projects?new=1");
  await first.locator("#project-name").fill(title);
  await first.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(first.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  const projectUrl = first.url();
  ownProject(projectUrl);

  // Both salespeople are looking at the same unassigned version of the project.
  await signIn(second, "rep2");
  await second.goto(projectUrl);
  await expect(second.getByRole("button", { name: "I'll handle this", exact: true })).toBeVisible();

  await first.getByRole("button", { name: "I'll handle this", exact: true }).click();
  await expect(first.getByText("You are handling this project.")).toBeVisible();

  await second.getByRole("button", { name: "I'll handle this", exact: true }).click();
  await expect(second.getByText("Project changed. Refresh before saving or assigning it.")).toBeVisible();

  await second.reload();
  const followUp = second.locator('[data-slot="card"]').filter({ has: second.getByText("Project follow-up", { exact: true }) });
  await expect(followUp).toContainText("Aiman Sales");
  await expect(second.getByText("Handler: Unassigned → Aiman Sales", { exact: true })).toHaveCount(1);
  await expect(second.getByText("Handler: Unassigned → Mei Ling Sales", { exact: true })).toHaveCount(0);
  await expect(second.getByRole("button", { name: "I'll handle this", exact: true })).toHaveCount(0);
  await first.close();
  await second.close();
});

test("non-sales staff keep registration but cannot claim, and enrichment persists across reload", async ({ page }) => {
  test.setTimeout(120_000);
  const title = projectTitle("Synthetic catalog registration");
  await signIn(page, "catalog");
  await page.goto("/sales/projects?new=1");
  await page.locator("#project-name").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  ownProject(page.url());
  // No claim affordance for a role without projects.follow_up; follow-up and assignment are shown disabled.
  await expect(page.getByRole("button", { name: "I'll handle this", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log follow-up", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Assign handler", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Enrich project", exact: true }).click();
  await page.locator("#notes").fill("Synthetic requirement: anti-slip porch tiles");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Project details updated", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic requirement: anti-slip porch tiles", { exact: true })).toBeVisible();
  // Sales-only sections stay hidden from a role without sales.read.
  await expect(page.getByText("Sales, invoices & receipts", { exact: true })).toHaveCount(0);
  await page.goto("/sales/pipeline");
  await expect(page.getByRole("heading", { name: /^Not available to Catalog/ })).toBeVisible();
});

test("a sales role in another workspace grants nothing in the acting workspace", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `synthetic.projects.dual-${tag}@tileconcept.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "TileDemo!2026", email_confirm: true, user_metadata: { full_name: "Synthetic Dual Member" } });
  if (error) throw error;
  const uid = data.user.id;
  owned.users.set(uid, email);
  // Catalogue in the seed workspace (acting: the oldest membership), sales rep in the demo workspace.
  sql(`insert into core.memberships(workspace_id,user_id,role_key,status,created_at) values ('${WORKSPACE}','${uid}','catalog_pricing','active',now()-interval '2 days'),(core.demo_workspace_id(),'${uid}','sales_rep','active',now()-interval '1 day')`);

  const title = projectTitle("Synthetic dual-membership project");
  await signInAs(page, email);
  await page.goto("/sales/projects?new=1");
  await page.locator("#project-name").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  ownProject(page.url());
  expect(sql(`select p.workspace_id from identity.projects p where p.name='${title}'`)).toBe(WORKSPACE);
  // The session reflects the acting catalogue membership: no claim, follow-up or assignment.
  await expect(page.getByRole("button", { name: "I'll handle this", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log follow-up", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Assign handler", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Enrich project", exact: true }).click();
  await page.locator("#notes").fill("Synthetic note from a dual member");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await expect(page.getByText("Synthetic note from a dual member", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log follow-up", exact: true })).toBeDisabled();
  await page.goto("/sales/pipeline");
  await expect(page.getByRole("heading", { name: /^Not available to Catalog/ })).toBeVisible();
  // Nothing was recorded through the sales role held in the other workspace.
  expect(sql(`select count(*) from identity.project_events e join identity.projects p on p.id=e.project_id where p.name='${title}' and e.kind in ('assigned','follow_up')`)).toBe("0");
});
