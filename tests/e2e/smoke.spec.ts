import { test, expect, type Page } from "@playwright/test";
import { expectHealthyRoute, PRIMARY_ROUTES, REPORT_ROUTES, SECONDARY_ROUTES } from "./route-smoke";
import { expectNotAvailable, pipelineContent, settingsContent, settingsMarkers } from "./denial-checks";

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

test("the settings content a guest must not get is what an admin is sent", async ({ page }) => {
  // Binds settingsMarkers to the real page, so the guest denial check in
  // guest.spec.ts cannot pass by looking for content that no longer exists.
  await login(page);
  const markers = settingsMarkers(page);
  await page.goto("/platform/settings");
  await expect(markers.header.filter({ visible: true }), "header and description").toHaveCount(2);
  await expect(markers.tabs.filter({ visible: true }), "Users, Invites and Roles tabs").toHaveCount(3);
  await expect(markers.memberControls.filter({ visible: true }), "suspend or reactivate a member").not.toHaveCount(0);
  await page.goto("/platform/settings?tab=invites");
  await expect(markers.inviteForm.filter({ visible: true }), "invite button and note").toHaveCount(2);
  // And the guest check rejects this page: it is not a denial.
  await expect(expectNotAvailable(page, "Administrator", settingsContent(page), { timeout: 1_000 })).rejects.toThrow(/one visible denial/);
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

test("the pipeline content a catalog operator must not get is what an admin is sent", async ({ page }) => {
  // Binds each part of pipelineContent to the real page, so the denial check
  // below cannot pass by looking for content that no longer exists.
  await login(page);
  await page.goto("/sales/pipeline");
  const visible = pipelineContent(page).filter({ visible: true });
  await expect(visible.filter({ hasText: /^Pipeline$/ }), "header").toHaveCount(1);
  await expect(visible.filter({ hasText: /^Every active opportunity has a stage, owner, next action and due date\./ }), "description").toHaveCount(1);
  await expect(visible.filter({ hasText: /^Missing next action$/ }), "Missing next action view").toHaveCount(1);
  // And the denial check rejects this page: it is not a denial.
  await expect(expectNotAvailable(page, "Administrator", pipelineContent(page), { timeout: 1_000 })).rejects.toThrow(/one visible denial/);
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
