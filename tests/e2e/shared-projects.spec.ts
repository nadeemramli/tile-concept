import { test, expect, type Page } from "@playwright/test";

// Uses only the local demo seed. Registration deliberately needs no CRM fixture.
async function signIn(page: Page, role: "catalog" | "rep1" | "rep2") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#email").fill(`demo.${role}@tileconcept.test`);
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
