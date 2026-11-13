/**
 * Controls for the guest settings denial in guest.spec.ts: expectNotAvailable
 * with settingsContent (denial-checks.ts) passes on the page it should accept
 * and fails on each case it guards. The pages are synthetic and served by route
 * interception — no app, database or account is involved.
 */
import { test, expect, type Page } from "@playwright/test";
import { expectNotAvailable, settingsContent } from "./denial-checks";

const ORIGIN = "http://denial.test";
const ROLE = "Guest (demo)";
const denial = (role = ROLE) => `<div><h2>Not available to ${role}</h2><p>Settings and user management are restricted to administrators. Ask an administrator if you need access.</p></div>`;
const header = `<h1>Settings</h1><div>Users, invitations, role matrix, workspace, locations, opportunity stages, shared views and feature flags.</div>`;
const tabs = `<div role="tablist"><button role="tab">Users</button><button role="tab">Invites</button><button role="tab">Roles</button></div>`;
const memberControls = `<table><tbody><tr><td>Demo Sales</td><td><button>Suspend</button></td></tr></tbody></table>`;
const inviteForm = `<form><button type="submit">Invite user</button></form><p>Sends a Supabase Auth invitation. Membership is created automatically with this role when the invitee accepts.</p>`;
// A real denied page still carries the route's <title> and its flight data in scripts.
const html = (main: string, rest = "") => `<!doctype html><html><head><title>Settings · Tile Concept OS</title></head><body><nav aria-label="Primary"></nav><main id="main">${main}</main>${rest}<script>self.__flight = ["Settings", "Invite user", "Suspend"];</script></body></html>`;

async function open(page: Page, body: string) {
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: "text/html", body }));
  await page.goto(`${ORIGIN}/platform/settings`);
}

let browserErrors: string[] = [];
test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
});
test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

test("accepts one visible guest denial next to a hidden streamed copy", async ({ page }) => {
  // The shape seen on the compiled app: the denial in main while its copy is
  // still parked in <div hidden id="S:2">.
  await open(page, html(denial(), `<div hidden id="S:2">${denial()}</div>`));
  // The old guest assertion really trips over it: strict mode sees two matches.
  await expect(expect(page.getByText(/Not available/)).toBeVisible({ timeout: 1_000 })).rejects.toThrow(/strict mode violation/);
  await expectNotAvailable(page, ROLE, settingsContent(page));
});

test("accepts the guest denial once it is revealed from the hidden segment", async ({ page }) => {
  const reveal = `<script>setTimeout(() => { const s = document.getElementById("S:2"); document.getElementById("main").append(...s.childNodes); s.remove(); }, 300)</script>`;
  await open(page, html("", `<div hidden id="S:2">${denial()}</div>${reveal}`));
  await expectNotAvailable(page, ROLE, settingsContent(page));
});

const COUNT = /one visible denial/, ROLE_NAMED = /the denial names this role/, PROTECTED = /no protected content/;
for (const [name, body, reason] of [
  ["two visible denials", html(`${denial()}${denial()}`), COUNT],
  ["only a hidden denial", html("", `<div hidden id="S:2">${denial()}</div>`), COUNT],
  ["no denial", html(""), COUNT],
  ["the settings page instead of a denial", html(`${header}${tabs}${memberControls}`), COUNT],
  ["a denial naming another role", html(denial("Sales representative")), ROLE_NAMED],
  ["a denial naming no role", html("<h2>Not available</h2>"), ROLE_NAMED],
  ["the denial next to the settings header", html(`${denial()}${header}`), PROTECTED],
  ["the denial next to the settings tabs", html(`${denial()}${tabs}`), PROTECTED],
  ["the denial next to member suspend controls", html(`${denial()}${memberControls}`), PROTECTED],
  ["the denial next to the invite form", html(`${denial()}${inviteForm}`), PROTECTED],
  ["the denial next to a hidden streamed settings page", html(denial(), `<div hidden id="S:3">${header}${tabs}${memberControls}${inviteForm}</div>`), PROTECTED],
] as const) {
  test(`rejects ${name}`, async ({ page }) => {
    await open(page, body);
    await expect(expectNotAvailable(page, ROLE, settingsContent(page), { timeout: 1_000 })).rejects.toThrow(reason);
  });
}
