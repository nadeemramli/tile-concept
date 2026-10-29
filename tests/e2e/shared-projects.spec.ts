import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Uses the local demo seed; the two-membership case adds synthetic fixtures to the LOCAL stack only.
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
  const title = `Synthetic shared project ${Date.now()}`;
  await signIn(page, "catalog");
  await page.getByRole("link", { name: "Project registration", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Register project", exact: true }).click();
  await page.locator("#project-name").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  const projectUrl = page.url();
  expect(projectUrl).toMatch(/sales\/projects\/[a-f0-9-]+$/);
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
  const title = `Synthetic stale claim ${Date.now()}`;
  const first = await browser.newPage();
  const second = await browser.newPage();
  await signIn(first, "rep1");
  await first.goto("/sales/projects?new=1");
  await first.locator("#project-name").fill(title);
  await first.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(first.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  const projectUrl = first.url();

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
  const title = `Synthetic catalog registration ${Date.now()}`;
  await signIn(page, "catalog");
  await page.goto("/sales/projects?new=1");
  await page.locator("#project-name").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
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
  const sql = (query: string) => execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atqc", query], { encoding: "utf8" }).trim();
  const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });
  const email = `synthetic.projects.dual-${randomUUID().slice(0, 8)}@tileconcept.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "TileDemo!2026", email_confirm: true, user_metadata: { full_name: "Synthetic Dual Member" } });
  if (error) throw error;
  const uid = data.user.id;
  // Catalogue in the seed workspace (acting: the oldest membership), sales rep in the demo workspace.
  sql(`insert into core.memberships(workspace_id,user_id,role_key,status,created_at) values ('11111111-1111-1111-1111-111111111111','${uid}','catalog_pricing','active',now()-interval '2 days'),(core.demo_workspace_id(),'${uid}','sales_rep','active',now()-interval '1 day')`);

  const title = `Synthetic dual-membership project ${Date.now()}`;
  await signInAs(page, email);
  await page.goto("/sales/projects?new=1");
  await page.locator("#project-name").fill(title);
  await page.getByRole("dialog").getByRole("button", { name: "Register project", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
  expect(sql(`select p.workspace_id from identity.projects p where p.name='${title}'`)).toBe("11111111-1111-1111-1111-111111111111");
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
  sql(`update core.memberships set status='suspended' where user_id='${uid}'`);
});
