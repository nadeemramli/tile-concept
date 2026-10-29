/**
 * Controls for the TILE-70 sign-in helper (login-form.ts): it signs in through
 * the page it should accept and refuses, before typing anything, each case it
 * guards. The pages are synthetic and served by route interception — no app,
 * database or account is involved.
 */
import { test, expect, type Page } from "@playwright/test";
import { submitPasswordForm } from "./login-form";

const ORIGIN = "http://login.test";
const EMAIL = "e2e.management.control@tileconcept.test";
const PASSWORD = "control-password";
// Demo mode prefills the form, so a hidden copy carries these values too.
const DEMO_EMAIL = "demo.admin@tileconcept.test";
const DEMO_PASSWORD = "TileDemo!2026";

const field = (id: string, type: string, value: string) => `<label for="${id}">${id}</label><input id="${id}" name="${id}" type="${type}" value="${value}">`;
const email = field("email", "email", DEMO_EMAIL);
const password = field("password", "password", DEMO_PASSWORD);
const submit = `<button type="submit">Sign in</button>`;
const form = (inner = `${email}${password}${submit}`) =>
  `<div role="tabpanel"><form method="post" action="/session"><input type="hidden" name="next" value="/merchandise/catalog">${inner}</form></div>`;
const html = (body: string) => `<!doctype html><html><body><h1>Tile Concept OS</h1>${body}</body></html>`;

/** Serves `body` at /login and records every submitted form. */
async function open(page: Page, body: string) {
  const posts: Record<string, string>[] = [];
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      posts.push(Object.fromEntries(new URLSearchParams(request.postData() ?? "")));
      return route.fulfill({ contentType: "text/html", body: html("<p>Signed in</p>") });
    }
    return route.fulfill({ contentType: "text/html", body });
  });
  await page.goto(`${ORIGIN}/login`);
  return posts;
}

/** Every email and password value in the hidden streamed copy. */
const hiddenValues = (page: Page) =>
  page.locator('[hidden] input:not([type="hidden"])').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));

let browserErrors: string[] = [];
test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
});
test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

test("signs in through the visible form next to a hidden streamed copy, leaving the copy untouched", async ({ page }) => {
  // The shape of the failing trace: the form on the page, its copy in <div hidden id="S:0">.
  const posts = await open(page, html(`${form()}<div hidden id="S:0">${form()}</div>`));
  // The old fill really trips over it: strict mode sees two #email inputs.
  await expect(page.locator("#email").fill(EMAIL, { timeout: 1_000 })).rejects.toThrow(/strict mode violation/);
  await submitPasswordForm(page, EMAIL, PASSWORD);
  await expect(page.getByText("Signed in")).toBeVisible();
  expect(posts).toEqual([{ next: "/merchandise/catalog", email: EMAIL, password: PASSWORD }]);
});

test("types nothing into the hidden copy", async ({ page }) => {
  // Submitting leaves the page, so the copy is read with submission held back.
  await open(page, html(`${form()}<div hidden id="S:0">${form()}</div>`));
  await page.evaluate(() => document.querySelectorAll("form").forEach((f) => f.addEventListener("submit", (e) => e.preventDefault())));
  await submitPasswordForm(page, EMAIL, PASSWORD);
  expect(await hiddenValues(page)).toEqual([DEMO_EMAIL, DEMO_PASSWORD]);
  await expect(page.locator("form").filter({ visible: true }).locator("#email")).toHaveValue(EMAIL);
});

test("signs in once the form is revealed from the hidden segment", async ({ page }) => {
  // Streaming order: content arrives hidden, then is moved into place.
  const reveal = `<script>setTimeout(() => { const s = document.getElementById("S:0"); document.body.append(...s.childNodes); s.remove(); }, 300)</script>`;
  const posts = await open(page, html(`<div hidden id="S:0">${form()}</div>${reveal}`));
  await submitPasswordForm(page, EMAIL, PASSWORD);
  await expect(page.getByText("Signed in")).toBeVisible();
  expect(posts).toEqual([{ next: "/merchandise/catalog", email: EMAIL, password: PASSWORD }]);
});

const FORM = /one visible password sign-in form/, EMAILS = /one visible email field/, PASSWORDS = /one visible password field/;
const IN_FORM = /the email field is in the form/, SUBMIT = /one submit button in the form/;
for (const [name, body, reason] of [
  ["two visible password forms", html(`${form()}${form()}`), FORM],
  ["only a hidden form", html(`<div hidden id="S:0">${form()}</div>`), FORM],
  ["no form", html(""), FORM],
  ["a form with no password field", html(form(`${email}${submit}`)), FORM],
  ["a second visible email field in the form", html(form(`${email}${email}${password}${submit}`)), EMAILS],
  ["a second visible email field outside the form", html(`${form()}${email}`), EMAILS],
  ["a second visible password field outside the form", html(`${form()}${password}`), PASSWORDS],
  ["the email field outside the form", html(`${email}${form(`${password}${submit}`)}`), IN_FORM],
  ["the submit button outside the form", html(`${form(`${email}${password}`)}${submit}`), SUBMIT],
  ["two submit buttons in the form", html(form(`${email}${password}${submit}${submit}`)), SUBMIT],
] as const) {
  test(`refuses ${name}`, async ({ page }) => {
    const posts = await open(page, body);
    const values = await page.locator('input:not([type="hidden"])').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));
    await expect(submitPasswordForm(page, EMAIL, PASSWORD)).rejects.toThrow(reason);
    // Refused before anything was typed or sent.
    expect(await page.locator('input:not([type="hidden"])').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value))).toEqual(values);
    expect(posts).toEqual([]);
  });
}
