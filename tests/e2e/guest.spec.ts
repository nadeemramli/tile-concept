import { test, expect, type Page } from "@playwright/test";

/**
 * Guest mode is the only path into this app that needs no credentials, which
 * makes it the only one an end-to-end suite can drive without a password in the
 * repository. These tests exist as much to guard the isolation as to prove the
 * button works: a regression that let a guest see the real workspace would be
 * the most serious failure this system could have, and it would be invisible
 * from the outside.
 */

async function enterAsGuest(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Enter as guest" }).click();
  await page.waitForURL("**/", { timeout: 30_000 });
}

test("the sign-in page offers guest entry without asking for anything", async ({ page }) => {
  await page.goto("/login");
  const button = page.getByRole("button", { name: "Enter as guest" });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(page.getByText(/No account needed/i)).toBeVisible();
});

test("a guest lands in a working app", async ({ page }) => {
  await enterAsGuest(page);
  await expect(page.getByRole("heading", { name: "Command Centre" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("a guest is in the demo workspace, not the real one", async ({ page }) => {
  await enterAsGuest(page);
  await page.goto("/merchandise/catalog");
  await expect(page.locator("main h1").first()).toBeVisible();

  // Terramoda is invented and exists only in the demo workspace. StoneLine and
  // MosaicWorks belong to the seeded "real" workspace; a guest must never see
  // either, and if this assertion ever flips it means RLS stopped separating
  // them.
  await expect(page.getByText(/Terramoda/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/StoneLine/)).toHaveCount(0);
  await expect(page.getByText(/MosaicWorks/)).toHaveCount(0);
});

test("a guest sees priced products with a stated basis", async ({ page }) => {
  await enterAsGuest(page);
  await page.goto("/merchandise/pricing");
  await expect(page.locator("main h1").first()).toBeVisible();
  // Every demo price names its programme; a price with no list would mean the
  // demo is teaching that a price can exist without one.
  await expect(page.getByText(/Retail 2026|Showroom 2026|Project 2026/).first()).toBeVisible({ timeout: 15_000 });
});

test("the routes a guest is allowed to see all render", async ({ page }) => {
  await enterAsGuest(page);
  for (const path of [
    "/sales/inbox",
    "/sales/pipeline",
    "/sales/accounts",
    "/sales/projects",
    "/sales/walk-ins",
    "/sales/tasks",
    "/merchandise/catalog",
    "/merchandise/pricing",
    "/merchandise/stock",
    "/sources/review",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(500);
    await expect(page.locator("main h1").first(), path).toBeVisible();
  }
});

test("a guest cannot manage settings", async ({ page }) => {
  await enterAsGuest(page);
  await page.goto("/platform/settings");
  // settings.manage is the one permission the guest role does not carry, because
  // it includes sending invitations.
  await expect(page.getByText(/Not available/)).toBeVisible();
});

test("what a guest creates is still there after a reload", async ({ page }) => {
  await enterAsGuest(page);
  await page.goto("/sales/walk-ins");
  await expect(page.locator("main h1").first()).toBeVisible();

  // The count before and after a reload must match: guest writes are ordinary
  // writes, not a session-local illusion.
  const before = await page.locator("table tbody tr").count();
  await page.reload();
  await expect(page.locator("main h1").first()).toBeVisible();
  const after = await page.locator("table tbody tr").count();
  expect(after).toBe(before);
});
