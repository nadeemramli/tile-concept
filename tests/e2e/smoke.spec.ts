import { test, expect, type Page } from "@playwright/test";
import { expectHealthyRoute, PRIMARY_ROUTES, REPORT_ROUTES, SECONDARY_ROUTES } from "./route-smoke";
import { expectNotAvailable, settingsContent, settingsMarkers } from "./denial-checks";

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

test("catalog operator cannot open the pipeline", async ({ page }) => {
  await login(page, "demo.catalog@tileconcept.test");
  await page.goto("/sales/pipeline");
  await expect(page.getByText(/Not available/)).toBeVisible();
});
