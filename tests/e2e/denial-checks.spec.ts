/**
 * Controls for the TILE-69 denial check (denial-checks.ts): it passes on the
 * page it should accept and fails on each case it guards. The pages are
 * synthetic and served by route interception — no app, database or account is
 * involved.
 */
import { test, expect, type Page } from "@playwright/test";
import { expectNotAvailable, pipelineContent } from "./denial-checks";

const ORIGIN = "http://denial.test";
const ROLE = "Catalog / pricing operator";
const denial = (role = ROLE) => `<div><h2>Not available to ${role}</h2><p>Sales access needs a sales role. Ask an administrator if you need access.</p></div>`;
const pipeline = `<h1>Pipeline</h1><p>Every active opportunity has a stage, owner, next action and due date.</p><div role="tablist"><button role="tab">Open</button><button role="tab">Missing next action</button></div>`;
// A real denied page still carries the route's <title> and its flight data in scripts.
const html = (main: string, rest = "") => `<!doctype html><html><head><title>Pipeline · Tile Concept OS</title></head><body><nav aria-label="Primary"></nav><main id="main">${main}</main>${rest}<script>self.__flight = ["Pipeline", "Missing next action"];</script></body></html>`;

async function open(page: Page, body: string) {
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: "text/html", body }));
  await page.goto(`${ORIGIN}/sales/pipeline`);
}

let browserErrors: string[] = [];
test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
});
test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

test("accepts one visible denial next to a hidden streamed copy", async ({ page }) => {
  // The shape of the failing trace: the denial in main, its copy in <div hidden id="S:1">.
  await open(page, html(denial(), `<div hidden id="S:1">${denial()}</div>`));
  // The old assertion really trips over it: strict mode sees two matches.
  await expect(expect(page.getByText(/Not available/)).toBeVisible({ timeout: 1_000 })).rejects.toThrow(/strict mode violation/);
  await expectNotAvailable(page, ROLE, pipelineContent(page));
});

test("accepts the denial once it is revealed from the hidden segment", async ({ page }) => {
  // Streaming order: content arrives hidden, then is moved into place.
  const reveal = `<script>setTimeout(() => { const s = document.getElementById("S:1"); document.getElementById("main").append(...s.childNodes); s.remove(); }, 300)</script>`;
  await open(page, html("", `<div hidden id="S:1">${denial()}</div>${reveal}`));
  await expectNotAvailable(page, ROLE, pipelineContent(page));
});

const COUNT = /one visible denial/, ROLE_NAMED = /the denial names this role/, PROTECTED = /no protected content/;
for (const [name, body, reason] of [
  ["two visible denials", html(`${denial()}${denial()}`), COUNT],
  ["a second visible denial outside main", html(denial(), denial()), COUNT],
  ["only a hidden denial", html("", `<div hidden id="S:1">${denial()}</div>`), COUNT],
  ["no denial", html(""), COUNT],
  ["the denial as text, not a heading", html(`<p>Not available to ${ROLE}</p>`), COUNT],
  ["a denial naming another role", html(denial("Sales representative")), ROLE_NAMED],
  ["a denial naming no role", html("<h2>Not available</h2>"), ROLE_NAMED],
  ["the denial outside main", html("", denial()), ROLE_NAMED],
  ["the denial next to the pipeline", html(`${denial()}${pipeline}`), PROTECTED],
  ["the denial next to a hidden streamed pipeline", html(denial(), `<div hidden id="S:1">${pipeline}</div>`), PROTECTED],
  ["the denial next to the pipeline description alone", html(`${denial()}<p>Every active opportunity has a stage, owner, next action and due date. Won/Lost/Deferred and backward moves require a reason.</p>`), PROTECTED],
] as const) {
  test(`rejects ${name}`, async ({ page }) => {
    await open(page, body);
    await expect(expectNotAvailable(page, ROLE, pipelineContent(page), { timeout: 1_000 })).rejects.toThrow(reason);
  });
}

test("rejects pipeline content the page removes after it was sent", async ({ page }) => {
  // Removed inside the timeout: a count that waits for content to disappear would pass this.
  const remove = `<script>setTimeout(() => document.getElementById("leak").remove(), 1000)</script>`;
  await open(page, html(denial(), `<div id="leak" hidden>${pipeline}</div>${remove}`));
  await expect(expectNotAvailable(page, ROLE, pipelineContent(page), { timeout: 2_000 })).rejects.toThrow(PROTECTED);
  await expect(pipelineContent(page)).toHaveCount(0);
});
