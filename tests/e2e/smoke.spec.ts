import { test, expect, type Page } from "@playwright/test";

const ADMIN = { email: "demo.admin@tileconcept.test", password: "TileDemo!2026" };

async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

test("unauthenticated visitor is redirected to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Tile Concept OS" })).toBeVisible();
});

test("admin can sign in and see the Command Centre", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Command Centre" })).toBeVisible();
  await expect(page.getByText("Morning brief · exceptions")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("core routes render for admin", async ({ page }) => {
  await login(page);
  for (const path of ["/sales/inbox", "/sales/pipeline", "/sales/accounts", "/sales/projects", "/sales/walk-ins", "/sales/tasks", "/sales/identity-review", "/merchandise/catalog", "/merchandise/pricing", "/platform/audit", "/platform/settings", "/platform/data-health", "/platform/integrations", "/marketing/shoot-calendar", "/merchandise/stock"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(500);
    await expect(page.locator("main h1").first(), path).toBeVisible();
  }
});

test("global search finds a seeded product", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Open global search" }).click();
  await page.getByPlaceholder(/Name, phone, email/).fill("hexagon");
  await expect(page.getByText(/Hexagon Mosaic White/)).toBeVisible({ timeout: 10_000 });
});

test("catalog operator cannot open the pipeline", async ({ page }) => {
  await login(page, "demo.catalog@tileconcept.test");
  await page.goto("/sales/pipeline");
  await expect(page.getByText(/Not available/)).toBeVisible();
});
