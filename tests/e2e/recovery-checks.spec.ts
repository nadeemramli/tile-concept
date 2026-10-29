/**
 * Controls for the TILE-67 recovery checks (recovery-checks.ts): each check
 * passes on the page it should accept and fails on the case it guards. The
 * pages are synthetic and served by route interception — no app, database or
 * account is involved.
 */
import { test, expect, type Page } from "@playwright/test";
import { expectSignedInAs, expectStable, QUIET_MS } from "./recovery-checks";

const ORIGIN = "http://recovery.test";
const EMAIL = "e2e.access.none.control@tileconcept.test";
const signedIn = (email: string) => `<p class="text-sm">Signed in as <span class="font-medium break-all">${email}</span></p>`;
const html = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body><h1>No workspace access</h1>${body}</body></html>`;

/** Serves `pages` by path on ORIGIN and counts document requests per path. */
async function serve(page: Page, pages: Record<string, string>) {
  const documents: string[] = [];
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().isNavigationRequest()) documents.push(path);
    const body = pages[path];
    return body === undefined ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ contentType: "text/html", body });
  });
  return documents;
}

let browserErrors: string[] = [];
test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
});
test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

test.describe("visible identity", () => {
  test("accepts one visible identity next to a hidden streamed copy", async ({ page }) => {
    await serve(page, { "/no-access": html(`${signedIn(EMAIL)}<div hidden id="S:0">${signedIn(EMAIL)}</div>`) });
    await page.goto(`${ORIGIN}/no-access`);
    // The duplicate the old getByText(email) tripped over is really there.
    await expect(page.getByText(EMAIL, { exact: true })).toHaveCount(2);
    await expectSignedInAs(page, EMAIL);
  });

  test("accepts the identity once it is revealed from the hidden segment", async ({ page }) => {
    // Streaming order: content arrives hidden, then is moved into place.
    const reveal = `<script>setTimeout(() => { const s = document.getElementById("S:0"); document.body.append(...s.childNodes); s.remove(); }, 300)</script>`;
    await serve(page, { "/no-access": html(`<div hidden id="S:0">${signedIn(EMAIL)}</div>${reveal}`) });
    await page.goto(`${ORIGIN}/no-access`);
    await expectSignedInAs(page, EMAIL);
  });

  for (const [name, body] of [
    ["two visible identities", `${signedIn(EMAIL)}${signedIn(EMAIL)}`],
    ["only a hidden identity", `<div hidden id="S:0">${signedIn(EMAIL)}</div>`],
    ["no identity", ""],
    ["another account's identity", signedIn("e2e.access.other.control@tileconcept.test")],
    ["the right email outside the identity, another account inside it", `${signedIn("e2e.access.other.control@tileconcept.test")}<p>${EMAIL}</p>`],
    ["the identity plus a second visible copy of the email", `${signedIn(EMAIL)}<p>${EMAIL}</p>`],
  ] as const) {
    test(`rejects ${name}`, async ({ page }) => {
      await serve(page, { "/no-access": html(body) });
      await page.goto(`${ORIGIN}/no-access`);
      await expect(expectSignedInAs(page, EMAIL, { timeout: 1_000 })).rejects.toThrow();
    });
  }
});

test.describe("stable", () => {
  test("accepts a page that stays put", async ({ page }) => {
    await serve(page, { "/no-access": html(signedIn(EMAIL)) });
    await page.goto(`${ORIGIN}/no-access`);
    await expectStable(page);
  });

  test("accepts a same-document history update that keeps the URL", async ({ page }) => {
    // What a client router does when it hydrates: replaceState(state, "", sameUrl).
    await serve(page, { "/no-access": html(signedIn(EMAIL), `<script>setTimeout(() => history.replaceState({ hydrated: true }, "", location.href), 300)</script>`) });
    await page.goto(`${ORIGIN}/no-access`);
    // The previous check — any framenavigated in the window fails — sees this
    // update and fails, although the page never moved.
    const navigated = page.waitForEvent("framenavigated", { timeout: QUIET_MS });
    await expectStable(page);
    // The update did happen inside the window: a check that saw nothing proves nothing.
    expect((await navigated).url()).toBe(`${ORIGIN}/no-access`);
    expect(await page.evaluate(() => history.state)).toEqual({ hydrated: true });
  });

  test("rejects a client-side move to another URL", async ({ page }) => {
    await serve(page, { "/no-access": html(signedIn(EMAIL), `<script>setTimeout(() => history.pushState(null, "", "/login?reason=no-membership"), 300)</script>`) });
    await page.goto(`${ORIGIN}/no-access`);
    await expect(expectStable(page)).rejects.toThrow(/moved from .*\/no-access to .*\/login/);
  });

  test("rejects a /start ⇄ /no-access redirect loop", async ({ page }) => {
    const hop = (to: string) => html("", `<script>setTimeout(() => location.replace("${to}"), 300)</script>`);
    const documents = await serve(page, { "/no-access": hop("/start"), "/start": hop("/login"), "/login": hop("/no-access") });
    await page.goto(`${ORIGIN}/no-access`);
    await expect(expectStable(page)).rejects.toThrow(/stable at/);
    expect(documents.length).toBeGreaterThan(1);
  });

  test("rejects a page that keeps reloading itself", async ({ page }) => {
    const documents = await serve(page, { "/no-access": html(signedIn(EMAIL), `<meta http-equiv="refresh" content="1">`) });
    await page.goto(`${ORIGIN}/no-access`);
    await expect(expectStable(page)).rejects.toThrow(/requested a new document .*\/no-access/);
    expect(documents.filter((d) => d === "/no-access").length).toBeGreaterThan(1);
  });
});
