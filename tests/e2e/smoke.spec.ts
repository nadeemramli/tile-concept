import { test, expect, type Page } from "@playwright/test";
import { expectHealthyRoute, PRIMARY_ROUTES, REPORT_ROUTES, SECONDARY_ROUTES } from "./route-smoke";
import { expectNotAvailable, pipelineContent } from "./denial-checks";

const ADMIN = { email: "demo.admin@tileconcept.test", password: "TileDemo!2026" };

// `next=/` is the Command Centre bookmark: the administrator holds both
// workspace areas, so a plain /login would stop at the area chooser instead
// (covered in workspace-entry.spec.ts).
async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
  await page.goto("/login?next=%2F");
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

for (const path of [...PRIMARY_ROUTES.map((route) => route.path), ...REPORT_ROUTES, ...SECONDARY_ROUTES]) {
  test(`admin route renders: ${path}`, async ({ page }) => {
    await login(page);
    await expectHealthyRoute(page, path);
  });
}

test("global search finds a seeded product", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Open global search" }).click();
  await page.getByPlaceholder(/Name, phone, email/).fill("hexagon");
  await expect(page.getByText(/Hexagon Mosaic White/)).toBeVisible({ timeout: 10_000 });
});

test("catalog operator cannot open the pipeline", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page, "demo.catalog@tileconcept.test");
  const response = await page.goto("/sales/pipeline");
  expect(response!.status(), "HTTP status").toBeLessThan(400);
  expect(new URL(page.url()).pathname, "denied in place, not redirected").toBe("/sales/pipeline");
  await expectNotAvailable(page, "Catalog / pricing operator", pipelineContent(page));
  expect(pageErrors, "uncaught browser errors").toEqual([]);
});
