/**
 * Controls for the TILE-67 recovery checks (recovery-checks.ts): each check
 * passes on the page it should accept and fails on the case it guards. The
 * pages are synthetic and served by route interception — no app, database or
 * account is involved.
 */
import { test, expect, type Page } from "@playwright/test";
import { expectLanded, expectSignedInAs, expectStable, QUIET_MS } from "./recovery-checks";

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

test.describe("landed", () => {
  /**
   * The order a streamed redirect can land in (TILE-67 trace): the router lands
   * softly on /no-access, Next's `meta#__next-page-redirect` streams in while
   * the old document is still loading (held open here by a slow image), and the
   * browser loads `target` a second after that load.
   */
  async function softLanding(page: Page, target: string, landing = html(signedIn(EMAIL))) {
    const tag = `<script>setTimeout(() => { const m = document.createElement("meta"); m.id = "__next-page-redirect"; m.httpEquiv = "refresh"; m.content = "1;url=${target}"; document.body.append(m); }, 300)</script>`;
    // Landing softly renders the explanation into the old document, as the router does.
    const soft = `<script>setTimeout(() => { history.replaceState(null, "", "/no-access"); document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(signedIn(EMAIL))}); }, 50)</script>`;
    const documents = await serve(page, { "/sales/inbox": html(`<img src="/slow.gif" alt="">${soft}${tag}`), "/no-access": landing, "/login": html("") });
    await page.route(`${ORIGIN}/slow.gif`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 204 });
    });
    // From the commit, as the redirect check watches it: the old document is still loading.
    await page.goto(`${ORIGIN}/sales/inbox`, { waitUntil: "commit" });
    return documents;
  }

  test("the quiet window started before the landing fails on a soft landing whose document is still to come", async ({ page }) => {
    const documents = await softLanding(page, "/no-access");
    // The order the explanation check used: the URL, the current document's load, the identity, then the quiet window.
    await expect(page).toHaveURL(/\/no-access$/);
    await page.waitForLoadState("load");
    await expectSignedInAs(page, EMAIL);
    await expect(expectStable(page)).rejects.toThrow(/requested a new document .*\/no-access/);
    expect(documents).toEqual(["/sales/inbox", "/no-access"]);
  });

  test("accepts a soft landing once the redirect's own document has loaded", async ({ page }) => {
    const documents = await softLanding(page, "/no-access");
    await expectLanded(page, /\/no-access$/);
    await expectSignedInAs(page, EMAIL);
    await expectStable(page);
    // One redirect, one landing document: nothing went round again.
    expect(documents).toEqual(["/sales/inbox", "/no-access"]);
  });

  test("accepts a page that never carried the tag at once", async ({ page }) => {
    const documents = await serve(page, { "/no-access": html(signedIn(EMAIL)) });
    await page.goto(`${ORIGIN}/no-access`);
    await expectLanded(page, /\/no-access$/);
    await expectStable(page);
    expect(documents).toEqual(["/no-access"]);
  });

  test("rejects a landing that then moves to another URL", async ({ page }) => {
    await softLanding(page, "/no-access", html(signedIn(EMAIL), `<script>setTimeout(() => history.pushState(null, "", "/login?reason=no-membership"), 700)</script>`));
    await expectLanded(page, /\/no-access$/);
    await expect(expectStable(page)).rejects.toThrow(/moved from .*\/no-access to .*\/login/);
  });

  test("rejects a landing that reloads itself again", async ({ page }) => {
    // An ordinary refresh, not Next's redirect tag: nothing excuses it.
    const documents = await softLanding(page, "/no-access", html(signedIn(EMAIL), `<meta http-equiv="refresh" content="1">`));
    await expectLanded(page, /\/no-access$/);
    await expect(expectStable(page)).rejects.toThrow(/requested a new document .*\/no-access/);
    expect(documents.filter((d) => d === "/no-access").length).toBeGreaterThan(1);
  });

  test("rejects a streamed redirect that keeps coming back", async ({ page }) => {
    const documents = await softLanding(page, "/no-access", html(signedIn(EMAIL), `<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/no-access">`));
    await expect(expectLanded(page, /\/no-access$/).then(() => expectStable(page))).rejects.toThrow(/the streamed redirect has landed|stable at/);
    expect(documents.filter((d) => d === "/no-access").length).toBeGreaterThan(1);
  });

  test("rejects a streamed redirect that lands somewhere else", async ({ page }) => {
    const documents = await softLanding(page, "/login");
    await expect(expectLanded(page, /\/no-access$/)).rejects.toThrow(/toHaveURL/);
    expect(documents).toEqual(["/sales/inbox", "/login"]);
  });
});
