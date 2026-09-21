import { expect, type Page } from "@playwright/test";
import { ROUTES } from "../../src/lib/nav/routes";
import { REPORTS } from "../../src/features/reports/registry";

// One test per route gives cold compilation its own normal test budget and
// identifies the failing page. Keep these in sync with the product registries.
export const PRIMARY_ROUTES = ROUTES.filter((route) => route.status === "live");
export const REPORT_ROUTES = [
  "/insights/reports/funnel",
  ...REPORTS.map((report) => `/insights/reports/${report.slug}`),
];
export const SECONDARY_ROUTES = [
  "/sales/record-sale",
  "/sales/walk-ins/new",
  "/sales/walk-ins/import",
  "/merchandise/catalog/compare",
];

export async function expectHealthyRoute(page: Page, path: string) {
  const pageErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  page.on("pageerror", onPageError);
  try {
    const response = await page.goto(path);
    expect(response, `${path}: document response`).not.toBeNull();
    expect(response!.status(), `${path}: HTTP status`).toBeLessThan(400);
    expect(new URL(page.url()).pathname, `${path}: no unexpected redirect`).toBe(path);
    await expect(page.locator("main h1").first(), `${path}: page content`).toBeVisible();

    // Error boundaries and report RPC failures can return HTTP 200 with a h1.
    // Check their explicit messages, rather than the word "error" in legitimate
    // audit entries, glossary text, or connector status descriptions.
    await expect(page.getByRole("heading", {
      name: /^(?:This page couldn’t load|The Inquiry Inbox could not load|Report unavailable)$/,
    }), `${path}: application error boundary`).toHaveCount(0);
    await expect(page.locator("main").getByText(/^This report could not be computed:/),
      `${path}: report RPC error`).toHaveCount(0);
    expect(pageErrors, `${path}: uncaught browser errors`).toEqual([]);
  } finally {
    page.off("pageerror", onPageError);
  }
}
